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
  MAX_U64,
  ZERO,
  requireThat,
} from './codec.ts';
import type { Operation } from './codec.ts';
import {
  buyCall,
  balanceOf,
  feeBatchCall,
  INSCRIBE_FEE,
  NativeIndexer,
  operationFee,
  QLYPHS_FEE_ACCOUNT,
  saleFee,
} from './protocol.ts';
import type { State, Ticket } from './protocol.ts';
export type Command =
  | Operation
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
/** The Qlyphs fee (QTC base units) the signer of this command pays at signing:
 * DEPLOY_FEE for deploy, MINT_FEE for mint, INSCRIBE_FEE for inscribe, the ticket's committed 1%
 * sale fee for buy, else 0n. The seller of an offer pays nothing. */
export function qlyphsFee(command: Command, ticket?: Ticket): bigint {
  if (command.kind === 'deploy' || command.kind === 'mint') return operationFee(command.kind);
  if (command.kind === 'inscribe') return INSCRIBE_FEE;
  if (command.kind === 'buy') return ticket?.offer.fee ?? 0n;
  return 0n;
}
/** Commit the exact QLYP-v1 sale fee (1% of price, rounded up, to Qlyphs) into an offer. */
export function withSaleFee<T extends Extract<Operation, { kind: 'offer' }>>(offer: T): T {
  return { ...offer, fee: saleFee(offer.price), feeTo: QLYPHS_FEE_ACCOUNT };
}
export function buildCall(
  genesis: string,
  owner: string,
  sequence: bigint,
  command: Command,
  ticket?: Ticket,
): Uint8Array {
  fromHex(owner, 32);
  requireThat(owner !== ZERO, 'zero account');
  switch (command.kind) {
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
        feeBatchCall(hex(encode({ genesis, sequence, op: command })), operationFee(command.kind)),
      );
    case 'transfer':
      return callBytes({
        kind: 'remark',
        event: true,
        payload: hex(encode({ genesis, sequence, op: command })),
      });
  }
}
export function preflight(s: State, genesis: string, owner: string, command: Command): Uint8Array {
  const sequence = s.sequences.get(owner) ?? 0n;
  const t =
    command.kind === 'buy' || command.kind === 'cancel' ? s.tickets.get(command.ticket) : undefined;
  if (command.kind === 'buy')
    return NativeIndexer.fromCheckpoint(genesis, s).prepareBuy(command.ticket, owner);
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
        (a.definition.policy === 'open' || a.creator === owner) &&
          p.amount <= a.definition.limit &&
          a.minted + p.amount <= a.definition.cap,
        'mint not permitted or cap/limit exceeded',
      );
    else requireThat(p.amount <= balanceOf(s, p.asset, owner), 'insufficient available tokens');
    if (p.kind === 'transfer') requireThat(p.to !== ZERO, 'zero recipient');
  }
  if (command.kind === 'deploy' || command.kind === 'inscribe')
    requireThat(!s.assets.has(assetId(owner, sequence)), 'asset already exists');
  if (command.kind === 'deploy') requireThat(!s.symbols.has(command.symbol), 'symbol taken');
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
  return buildCall(genesis, owner, sequence, command, t);
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
