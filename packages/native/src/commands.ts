/** Shared with the browser: it reconstructs the exact call from the user's intent,
 * rather than signing opaque bytes returned by the API. Amounts on the wire are base units. */
import {
  assetId,
  callBytes,
  concat,
  compact,
  encode,
  fromHex,
  hex,
  uint,
  isContentType,
  MAX_PAYLOAD,
  MAX_U128,
  MAINNET,
  MAX_U64,
  ZERO,
  requireThat,
} from './codec.ts';
import type { FeeGovernanceOperation, Id, Operation, UserOperation } from './codec.ts';
import {
  buyCall,
  balanceOf,
  feeBatchCall,
  feeScheduleActive,
  LEGACY_RULES,
  mainnetReviewed,
  mainnetRules,
  MINT_FEE,
  NativeIndexer,
  progressiveActive,
  progressiveLot,
  progressiveProfile,
  progressiveV2Active,
  QLYPHS_FEE_ACCOUNT,
  saleFee,
} from './protocol.ts';
import type { ProgressiveLot, Rules, State, Ticket } from './protocol.ts';
import {
  applyFeeAdmin,
  applyFeeRate,
  FEE_TARGETS_CENTS,
  fee,
  feeAt,
  feeMode,
  isRateDerived,
  LEGACY_DEPLOY_FEE,
  LEGACY_INSCRIBE_FEE,
  legacyFee,
  stepFees,
  symbolClass,
} from './fee-schedule.ts';
import type { Grid } from './fee-schedule.ts';
import type { PublicFeeGrid, PublicFeeSchedule } from './public.ts';
import {
  PROGRESSIVE_MINT_PROFILE,
  PROGRESSIVE_MINT_PROFILE_V2,
  progressiveLotFee,
  progressiveMintQuote,
} from './progressive-mint.ts';
import type { ProgressiveProfile } from './progressive-mint.ts';
export type Command =
  | UserOperation
  /** Buy lot `lot` (1 to 1000) of a progressive asset through its current native right. `profile`
   * is the fee schedule the dapp priced it with (default progressive-1000-v1); a wallet refuses
   * a lot whose attested asset has another profile. */
  | { kind: 'mintProgressive'; asset: string; lot: number; profile?: ProgressiveProfile }
  | { kind: 'sendQtc'; to: string; amount: bigint }
  | { kind: 'pair'; buyer: string; nonce: bigint }
  | { kind: 'sell'; multisig: string; offer: Extract<Operation, { kind: 'offer' }> }
  | { kind: 'buy' | 'cancel'; ticket: string };
const object = (value: unknown): Record<string, unknown> => {
  requireThat(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    'object required',
  );
  return value as Record<string, unknown>;
};
const keys = (o: Record<string, unknown>, allowed: string[]): void => {
  requireThat(
    Object.keys(o).every((k) => allowed.includes(k)) && allowed.every((k) => k in o),
    'unexpected or missing fields',
  );
};
const id = (x: unknown, bytes = 32): string => {
  requireThat(typeof x === 'string', 'account/asset ID required');
  fromHex(x, bytes);
  return x;
};
const amount = (x: unknown, max = MAX_U128): bigint => {
  requireThat(
    typeof x === 'string' && /^(0|[1-9]\d{0,38})$/.test(x),
    'canonical integer string required',
  );
  const n = BigInt(x);
  requireThat(n <= max, 'amount exceeds maximum');
  return n;
};
const integer = (x: unknown, max: number): number => {
  requireThat(
    typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= max,
    'invalid integer',
  );
  return x;
};
export function parseCommand(input: unknown): Command {
  const x = object(input);
  switch (x.kind) {
    case 'sendQtc': {
      keys(x, ['kind', 'to', 'amount']);
      const n = amount(x.amount),
        to = id(x.to);
      requireThat(n > 0n && to !== ZERO, 'invalid QTC transfer');
      return { kind: 'sendQtc', to, amount: n };
    }
    case 'deploy':
      keys(x, ['kind', 'symbol', 'decimals', 'cap', 'limit', 'policy']);
      requireThat(
        typeof x.symbol === 'string' && (x.policy === 'issuer' || x.policy === 'open'),
        'invalid asset definition',
      );
      return {
        kind: 'deploy',
        symbol: x.symbol,
        decimals: integer(x.decimals, 18),
        cap: amount(x.cap),
        limit: amount(x.limit),
        policy: x.policy,
      };
    case 'mint':
      keys(x, ['kind', 'asset', 'amount']);
      return { kind: 'mint', asset: id(x.asset, 40), amount: amount(x.amount) };
    case 'deployProgressive':
      keys(x, ['kind', 'symbol', 'decimals', 'cap']);
      requireThat(typeof x.symbol === 'string', 'invalid asset definition');
      return {
        kind: 'deployProgressive',
        symbol: x.symbol,
        decimals: integer(x.decimals, 18),
        cap: amount(x.cap),
      };
    case 'deployProgressiveV2':
      keys(x, ['kind', 'symbol', 'decimals', 'cap']);
      requireThat(typeof x.symbol === 'string', 'invalid asset definition');
      return {
        kind: 'deployProgressiveV2',
        symbol: x.symbol,
        decimals: integer(x.decimals, 18),
        cap: amount(x.cap),
      };
    case 'mintProgressive': {
      keys(x, 'profile' in x ? ['kind', 'asset', 'lot', 'profile'] : ['kind', 'asset', 'lot']);
      const lot = integer(x.lot, 1000);
      requireThat(lot >= 1, 'invalid lot');
      if (!('profile' in x)) return { kind: 'mintProgressive', asset: id(x.asset, 40), lot };
      requireThat(
        x.profile === PROGRESSIVE_MINT_PROFILE || x.profile === PROGRESSIVE_MINT_PROFILE_V2,
        'invalid progressive profile',
      );
      return { kind: 'mintProgressive', asset: id(x.asset, 40), lot, profile: x.profile };
    }
    case 'transfer':
      keys(x, ['kind', 'asset', 'amount', 'to']);
      return { kind: 'transfer', asset: id(x.asset, 40), amount: amount(x.amount), to: id(x.to) };
    case 'pair':
      keys(x, ['kind', 'buyer', 'nonce']);
      return { kind: 'pair', buyer: id(x.buyer), nonce: amount(x.nonce, MAX_U64) };
    case 'sell': {
      keys(x, ['kind', 'multisig', 'offer']);
      const p = object(x.offer);
      keys(p, ['kind', 'asset', 'amount', 'buyer', 'payout', 'price', 'fee', 'feeTo', 'expiry']);
      requireThat(p.kind === 'offer', 'offer required');
      return {
        kind: 'sell',
        multisig: id(x.multisig),
        offer: {
          kind: 'offer',
          asset: id(p.asset, 40),
          amount: amount(p.amount),
          buyer: id(p.buyer),
          payout: id(p.payout),
          price: amount(p.price),
          fee: amount(p.fee),
          feeTo: id(p.feeTo),
          expiry: integer(p.expiry, 0xffffffff),
        },
      };
    }
    case 'inscribe':
      keys(x, ['kind', 'contentType', 'content']);
      requireThat(isContentType(x.contentType), 'invalid content type');
      requireThat(
        typeof x.content === 'string' &&
          x.content.length <= 2 + 2 * MAX_PAYLOAD &&
          /^0x(?:[0-9a-f]{2})+$/.test(x.content),
        'content must be non-empty lowercase hex',
      );
      return { kind: 'inscribe', contentType: x.contentType, content: x.content };
    case 'buy':
    case 'cancel':
      keys(x, ['kind', 'ticket']);
      requireThat(
        typeof x.ticket === 'string' && /^0x[0-9a-f]{64}:(0|[1-9]\d{0,9})$/.test(x.ticket),
        'invalid ticket',
      );
      return { kind: x.kind, ticket: x.ticket };
    default:
      throw Error('unsupported command');
  }
}
/** What a rate-derived fee is priced with: the current rate of an attested state, or the fixed
 * legacy fees where the network still reads them. */
export type FeeBasis = { rate: bigint } | { legacy: true };
type RateDerivedCommand = Extract<
  Command,
  { kind: 'deploy' | 'inscribe' | 'deployProgressive' | 'deployProgressiveV2' }
>;
const rateDerived = (c: Command): c is RateDerivedCommand => isRateDerived(c.kind);
const MAINNET_FEES_OFF = 'QLYP fees are not active on mainnet yet.';
/** The Qlyphs fee (QTC base units) the signer of this command pays at signing: the rate-derived
 * fee of a deploy or an inscribe (which needs `basis`), MINT_FEE for mint, the lot's fee for a
 * progressive mint, the ticket's committed 1% sale fee for buy, else 0n. The seller of an offer
 * pays nothing. */
export function qlyphsFee(command: Command, ticket?: Ticket, basis?: FeeBasis): bigint {
  if (command.kind === 'mint') return MINT_FEE;
  if (rateDerived(command)) {
    requireThat(basis, 'fee schedule required');
    return 'rate' in basis ? fee(command, basis.rate) : legacyFee(command.kind);
  }
  if (command.kind === 'mintProgressive')
    return progressiveLotFee(BigInt(command.lot), command.profile ?? PROGRESSIVE_MINT_PROFILE);
  if (command.kind === 'buy') return ticket?.offer.fee ?? 0n;
  return 0n;
}
/** The fee basis of the state `s`, for an operation signed with an era born at `s` (so included at
 * a later block of a chain that contains it). The rate is the current grid of `s`; the legacy fees
 * apply where `s` itself still reads them, and stay accepted for `grace` blocks after `from`. */
export function feeBasis(s: State, rules: Rules, genesis: Id): FeeBasis {
  // Mainnet reads the legacy fees until the reviewed activation, as it always has; no Qlyphs client
  // starts signing rate-derived operations there before the release that pins the schedule.
  requireThat(genesis !== MAINNET || mainnetReviewed(), MAINNET_FEES_OFF);
  if (s.fees) return { rate: s.fees.current.rate };
  if (rules.feeSchedule === null || feeMode(rules, genesis, s.height) === 'legacy')
    return { legacy: true };
  throw Error('fee schedule not active');
}
/** A client rule on top of consensus: no Qlyphs client signs a blocked deploy, and none signs a
 * rate-derived operation on mainnet before the reviewed activation. */
function requireSignable(genesis: Id, command: Command): void {
  if (!rateDerived(command)) return;
  if (command.kind !== 'inscribe')
    requireThat(symbolClass(command.symbol) === 'allowed', 'symbol blocked');
  requireThat(genesis !== MAINNET || mainnetReviewed(), MAINNET_FEES_OFF);
}
/** Commit the exact QLYP-v1 sale fee (1% of price, rounded up, to Qlyphs) into an offer. */
export function withSaleFee<T extends Extract<Operation, { kind: 'offer' }>>(offer: T): T {
  return { ...offer, fee: saleFee(offer.price), feeTo: QLYPHS_FEE_ACCOUNT };
}
/** `lot` is the progressive lot the signer verified (from attested state in a wallet). */
export function buildCall(
  genesis: string,
  owner: string,
  sequence: bigint,
  command: Command,
  ticket?: Ticket,
  lot?: ProgressiveLot,
  basis?: FeeBasis,
): Uint8Array {
  fromHex(owner, 32);
  requireThat(owner !== ZERO, 'zero account');
  const kind: string = command.kind;
  requireThat(
    kind !== 'feeRate' && kind !== 'feeAdmin',
    'governance operations are not wallet commands',
  );
  requireSignable(genesis, command);
  switch (command.kind) {
    case 'mintProgressive':
      requireThat(
        lot && lot.asset === command.asset && lot.lot === BigInt(command.lot),
        `lot ${command.lot} is no longer the next lot of this asset`,
      );
      requireThat(
        lot.profile === (command.profile ?? PROGRESSIVE_MINT_PROFILE),
        'this token has another progressive profile',
      );
      requireThat(owner !== QLYPHS_FEE_ACCOUNT, 'the Qlyphs fee account cannot mint');
      return Uint8Array.from(lot.call);
    case 'deployProgressive':
    case 'deployProgressiveV2':
      progressiveMintQuote(
        command.cap,
        0n,
        command.kind === 'deployProgressive'
          ? PROGRESSIVE_MINT_PROFILE
          : PROGRESSIVE_MINT_PROFILE_V2,
      );
      return callBytes(
        feeBatchCall(
          hex(encode({ genesis, sequence, op: command })),
          qlyphsFee(command, undefined, basis),
        ),
      );
    case 'sendQtc':
      requireThat(command.amount > 0n && command.to !== ZERO, 'invalid QTC transfer');
      return callBytes({ kind: 'pay', to: command.to, amount: command.amount });
    case 'pair': {
      requireThat(command.buyer !== owner && command.buyer !== ZERO, 'invalid counterparty');
      const signers = [owner, command.buyer].sort();
      return concat(
        Uint8Array.of(19, 0),
        compact(2n),
        ...signers.map((x) => fromHex(x, 32)),
        uint(2n, 4),
        uint(command.nonce, 8),
      );
    }
    case 'buy':
      requireThat(
        ticket && ticket.key === command.ticket && ticket.offer.buyer === owner,
        'wrong buyer/ticket',
      );
      return callBytes(buyCall(ticket));
    case 'cancel':
      requireThat(
        ticket && ticket.key === command.ticket && ticket.seller === owner,
        'only seller can close offer',
      );
      return concat(
        Uint8Array.of(19, 3),
        fromHex(ticket.multisig, 32),
        uint(BigInt(ticket.proposal), 4),
      );
    case 'sell':
      return callBytes({
        kind: 'propose',
        multisig: command.multisig,
        expiry: command.offer.expiry,
        call: {
          kind: 'remark',
          event: false,
          payload: hex(encode({ genesis, sequence, op: command.offer })),
        },
      });
    case 'offer':
      throw Error('use sell with a multisig');
    case 'inscribe':
    case 'deploy':
    case 'mint':
      return callBytes(
        feeBatchCall(
          hex(encode({ genesis, sequence, op: command })),
          qlyphsFee(command, undefined, basis),
        ),
      );
    case 'transfer':
      return callBytes({
        kind: 'remark',
        event: true,
        payload: hex(encode({ genesis, sequence, op: command })),
      });
  }
}
/** What preflight checked: the exact call, the Qlyphs fee it pays, the symbol class of a deploy
 * (a blocked symbol is refused) and whether the user must be warned that another deploy of the
 * same symbol can be included first, keeping the fee. */
export interface Preflight {
  call: Uint8Array;
  fee: bigint;
  symbolClass: 'allowed' | null;
  raceWarning: boolean;
}
export function preflight(
  s: State,
  genesis: string,
  owner: string,
  command: Command,
  // The reader's own default: a mainnet state past the activation is restored under the pinned
  // rules, never under the legacy ones.
  rules: Rules = genesis === MAINNET ? mainnetRules() : LEGACY_RULES,
): Preflight {
  const sequence = s.sequences.get(owner) ?? 0n;
  requireSignable(genesis, command);
  const deploys =
    command.kind === 'deploy' ||
    command.kind === 'deployProgressive' ||
    command.kind === 'deployProgressiveV2';
  const basis = isRateDerived(command.kind) ? feeBasis(s, rules, genesis) : undefined;
  const done = (call: Uint8Array, fee: bigint): Preflight => ({
    call,
    fee,
    symbolClass: deploys ? 'allowed' : null,
    raceWarning: deploys,
  });
  if (command.kind === 'deployProgressive')
    requireThat(
      progressiveActive(rules, s.height + 1),
      'progressive mint is not active on this network',
    );
  if (command.kind === 'deployProgressiveV2')
    requireThat(
      progressiveV2Active(rules, s.height + 1),
      'progressive mint is not active on this network',
    );
  if (command.kind === 'mintProgressive') {
    const lot = progressiveLot(s, genesis, command.asset);
    requireThat(
      (lot.profile === PROGRESSIVE_MINT_PROFILE ? progressiveActive : progressiveV2Active)(
        rules,
        s.height + 1,
      ),
      'progressive mint is not active on this network',
    );
    requireThat(
      lot.lot === BigInt(command.lot),
      `lot ${command.lot} is no longer the next lot; lot ${lot.lot} is`,
    );
    // An unfinal right is signable: a wallet signs a lot with an era born at the block whose state
    // its witnesses attested, so the payment cannot execute where this right does not exist.
    return done(buildCall(genesis, owner, sequence, command, undefined, lot), lot.fee);
  }
  const t =
    command.kind === 'buy' || command.kind === 'cancel' ? s.tickets.get(command.ticket) : undefined;
  if (command.kind === 'buy')
    return done(
      NativeIndexer.fromCheckpoint(genesis, s, false, rules).prepareBuy(command.ticket, owner),
      qlyphsFee(command, t),
    );
  if (command.kind === 'mint' || command.kind === 'transfer' || command.kind === 'sell') {
    const p = command.kind === 'sell' ? command.offer : command;
    const a = s.assets.get(p.asset);
    requireThat(a, 'unknown asset');
    if (a.definition.policy === 'inscription') {
      requireThat(p.kind !== 'mint', 'inscriptions cannot be minted');
      requireThat(p.amount === 1n, 'inscription amount must be 1');
    }
    if (p.kind === 'mint')
      requireThat(
        progressiveProfile(a.definition.policy) === null &&
          (a.definition.policy === 'open' || a.creator === owner) &&
          p.amount <= a.definition.limit &&
          a.minted + p.amount <= a.definition.cap,
        'mint not permitted or cap/limit exceeded',
      );
    else requireThat(p.amount <= balanceOf(s, p.asset, owner), 'insufficient available tokens');
    if (p.kind === 'transfer') requireThat(p.to !== ZERO, 'zero recipient');
  }
  if (
    command.kind === 'deploy' ||
    command.kind === 'inscribe' ||
    command.kind === 'deployProgressive' ||
    command.kind === 'deployProgressiveV2'
  )
    requireThat(!s.assets.has(assetId(owner, sequence)), 'asset already exists');
  if (
    command.kind === 'deploy' ||
    command.kind === 'deployProgressive' ||
    command.kind === 'deployProgressiveV2'
  )
    requireThat(!s.symbols.has(command.symbol), 'symbol taken');
  if (command.kind === 'sell') {
    const p = command.offer,
      m = s.multisigs.get(command.multisig);
    requireThat(
      m &&
        m.threshold === 2 &&
        m.signers.length === 2 &&
        m.signers.includes(owner) &&
        m.signers.includes(p.buyer),
      'create a bilateral trading account first',
    );
    requireThat(
      p.buyer !== owner && p.buyer !== ZERO && p.payout === owner,
      'invalid counterparties',
    );
    requireThat(
      p.fee === saleFee(p.price) && p.feeTo === QLYPHS_FEE_ACCOUNT,
      'offer must commit the 1% Qlyphs sale fee',
    );
    requireThat(
      p.expiry >= s.height + 256 && p.expiry <= s.height + 100000,
      'expiry must leave time for finality',
    );
  }
  return done(
    buildCall(genesis, owner, sequence, command, t, undefined, basis),
    qlyphsFee(command, t, basis),
  );
}
/** The direct remark_with_event that carries a fee schedule operation, for a role account to sign. */
export function feeGovernanceCall(
  genesis: Id,
  owner: Id,
  sequence: bigint,
  op: FeeGovernanceOperation,
): Uint8Array {
  fromHex(owner, 32);
  requireThat(owner !== ZERO, 'zero account');
  requireThat(op.kind === 'feeRate' || op.kind === 'feeAdmin', 'not a fee schedule operation');
  return callBytes({
    kind: 'remark',
    event: true,
    payload: hex(encode({ genesis, sequence, op })),
  });
}
/** Runs the fee schedule checks of `op` as if it were included in the block after `s`, and returns
 * the call to sign. Throws the reducer's verdict. */
export function governancePreflight(
  s: State,
  genesis: Id,
  owner: Id,
  op: FeeGovernanceOperation,
  rules: Rules,
): Uint8Array {
  const h = s.height + 1;
  requireThat(rules.feeSchedule !== null && feeScheduleActive(rules, h), 'fee schedule not active');
  const fees = stepFees(s.fees, rules.feeSchedule, h);
  requireThat(fees, 'fee state missing');
  if (op.kind === 'feeRate') applyFeeRate(fees, rules.feeSchedule, owner, op, h, 0);
  else applyFeeAdmin(fees, rules.feeSchedule, owner, op, h);
  return feeGovernanceCall(genesis, owner, s.sequences.get(owner) ?? 0n, op);
}
const publicGrid = (g: Grid | null): PublicFeeGrid | null =>
  g && { id: g.id, rate: String(g.rate), effective: g.effective, height: g.height, index: g.index };
/** The fee schedule of a state, for display. Wallets price from attested state, never from this. */
export function feeScheduleView(s: State, rules: Rules, genesis: Id): PublicFeeSchedule {
  const f = s.fees;
  const at = (rate: bigint) => ({
    deploy: String(feeAt(FEE_TARGETS_CENTS.deploy, rate)),
    inscribe: String(feeAt(FEE_TARGETS_CENTS.inscribe, rate)),
  });
  const mode = f ? 'schedule' : feeMode(rules, genesis, s.height);
  return {
    height: s.height,
    hash: s.hash,
    mode,
    from: rules.feeSchedule?.from ?? null,
    current: publicGrid(f?.current ?? null),
    previous: publicGrid(f?.previous ?? null),
    pending: publicGrid(f?.pending ?? null),
    frozen: f !== null && f.operator === null,
    fees: f
      ? { ...at(f.current.rate), mint: String(MINT_FEE) }
      : mode === 'legacy'
        ? {
            deploy: String(LEGACY_DEPLOY_FEE),
            inscribe: String(LEGACY_INSCRIBE_FEE),
            mint: String(MINT_FEE),
          }
        : null,
    pendingFees: f?.pending ? at(f.pending.rate) : null,
  };
}
export const json = (value: unknown): string =>
  JSON.stringify(value, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
export function parseUnits(value: string, decimals: number): bigint {
  requireThat(Number.isInteger(decimals) && decimals >= 0 && decimals <= 18, 'invalid decimals');
  requireThat(/^(0|[1-9]\d*)(\.\d+)?$/.test(value), 'enter a plain decimal amount');
  const [whole = '', fraction = ''] = value.split('.');
  requireThat(fraction.length <= decimals, 'too many decimal places');
  const result = BigInt(whole + fraction.padEnd(decimals, '0'));
  requireThat(result > 0n && result <= MAX_U128, 'amount out of range');
  return result;
}
export function formatUnits(value: bigint, decimals: number): string {
  const s = value.toString().padStart(decimals + 1, '0');
  if (decimals === 0) return s;
  const f = s.slice(-decimals).replace(/0+$/, '');
  return s.slice(0, -decimals) + (f ? '.' + f : '');
}
