import {
  assetId,
  callBytes,
  decode,
  fromHex,
  hex,
  MAX_U64,
  parseCall,
  PROTOCOL_HEADER,
  requireThat,
  ZERO,
} from './codec.ts';
import type { Call, Envelope, Id, Operation } from './codec.ts';
import {
  mintTicket,
  PROGRESSIVE_MINT_LOTS,
  PROGRESSIVE_MINT_PROFILE,
  PROGRESSIVE_MINT_PROFILE_V2,
  progressiveMintQuote,
  readSettlement,
  settlementCall,
} from './progressive-mint.ts';
import type { Anchor, MintTicket, ProgressiveProfile } from './progressive-mint.ts';

export { PROTOCOL_VERSION } from './codec.ts';
export const PROTOCOL_LABEL = 'QLYP-v1';
/** Revision of the installed replay rules. A durable index written under another revision (e.g.
 * an exploration build that interpreted the now-reserved tags 4..8) is re-derived from its
 * finalized blocks on open. Bump whenever the reducer's interpretation of existing blocks changes. */
export const RULES_MARKER = 'QLYP-v1+inscriptions-2';
export const MAINNET = '0xfb5487c0be6ae4ade2d41d16e50465129861636c2b8d61fa94d7a19631626fba';

/* QLYP-v1 fees. Protocol constants, identical on every network.
 * - DEPLOY and MINT are valid only inside utility.batch_all([system.remark_with_event(payload),
 *   balances.transfer_keep_alive(QLYPHS_FEE_ACCOUNT, exact fee)]), signed by the operation owner.
 * - TRANSFER is free: a direct signed system.remark_with_event.
 * - Exchange fee, a general rule: ANY token-for-QTC exchange pays saleFee(price), 1% of the QTC
 *   price rounded up, to QLYPHS_FEE_ACCOUNT, committed in the signed operation and paid by the
 *   buyer next to the seller's price. Today that is OFFER (tag 3) and its purchase batch; a future
 *   open-offer/DEX operation inherits the same rule. Tags 4..8 are RESERVED for the planned
 *   launchpad/AMM (docs/native/LAUNCHPAD-AMM.md, not part of the protocol) and rejected.
 * - Plain QTC sends are not QLYP operations and carry no fee. */
/** Qlyphs fee account (SS58 qzkCoLhkccQnzEG79s61bFpf5bLKfKKnq7S5YqazgzdCwgARA). */
export const QLYPHS_FEE_ACCOUNT =
  '0x2139a57532fbf4764ad95754c17545fed7af915fb008b6494b02e503084da8b3';
/** Which rules a reducer applies. Always passed explicitly: never read from a checkpoint or a block. */
export interface Rules {
  /** First block whose tag-11 DEPLOYs (progressive-1000-v1) count, or null for never. */
  progressive: { from: number } | null;
  /** First block whose tag-12 DEPLOYs (progressive-1000-v2) count, or null for never. */
  progressiveV2: { from: number } | null;
}
/** QLYP-v1 before progressive mint: tags 11 and 12 stay unknown operations. */
export const LEGACY_RULES: Rules = /* @__PURE__ */ Object.freeze({
  progressive: null,
  progressiveV2: null,
});
const activation = (v: unknown, name: string): { from: number } | null => {
  if (v === null) return null;
  const p = v as Record<string, unknown> | undefined;
  requireThat(
    p !== null &&
      typeof p === 'object' &&
      Object.keys(p).length === 1 &&
      Number.isSafeInteger(p.from) &&
      (p.from as number) >= 1,
    `invalid ${name} activation`,
  );
  return { from: p.from as number };
};
/** A rules object exactly as the reducer accepts it: no missing or extra field, no default. */
export function checkRules(rules: unknown): Rules {
  requireThat(
    rules !== null && typeof rules === 'object' && !Array.isArray(rules),
    'rules required',
  );
  const r = rules as Record<string, unknown>;
  requireThat(
    Object.keys(r).length === 2 && 'progressive' in r && 'progressiveV2' in r,
    'invalid rules',
  );
  return {
    progressive: activation(r.progressive, 'progressive'),
    progressiveV2: activation(r.progressiveV2, 'progressive v2'),
  };
}
export const progressiveActive = (rules: Rules, height: number): boolean =>
  rules.progressive !== null && height >= rules.progressive.from;
export const progressiveV2Active = (rules: Rules, height: number): boolean =>
  rules.progressiveV2 !== null && height >= rules.progressiveV2.from;
/** The reviewed mainnet activation of progressive-1000-v2: the first Quantus mainnet block whose
 * tag-12 DEPLOYs count. null keeps progressive mint off on mainnet, and no configuration can switch
 * it on: setting this value, with the mainnet witness policy that binds it, is the activation. The
 * Python verifier mirrors it (apps/native/verifier/replay.py). progressive-1000-v1 never runs on
 * mainnet. */
export const MAINNET_PROGRESSIVE_V2_FROM: number | null = null;
/** The rules every mainnet reader runs: legacy until the reviewed activation, then
 * progressive-1000-v2 from it. `from` is a parameter only for tests of an activation. */
export const mainnetRules = (from: number | null = MAINNET_PROGRESSIVE_V2_FROM): Rules =>
  from === null ? LEGACY_RULES : checkRules({ progressive: null, progressiveV2: { from } });
/** Whether a mainnet reader that starts at `activationHeight` may run `rules`: exactly the mainnet
 * rules, with an activation after the block QLYP starts reading. Anything else would read paid
 * lots differently from the wallets and witnesses of the release. */
export function mainnetRulesAllowed(
  rules: Rules,
  activationHeight: number,
  from: number | null = MAINNET_PROGRESSIVE_V2_FROM,
): boolean {
  const expected = mainnetRules(from);
  return (
    rules.progressive === null &&
    (rules.progressiveV2 === null
      ? expected.progressiveV2 === null
      : expected.progressiveV2 !== null &&
        rules.progressiveV2.from === expected.progressiveV2.from &&
        rules.progressiveV2.from > activationHeight)
  );
}
/** 1 QTC (12 decimals). */
export const DEPLOY_FEE = 1_000_000_000_000n;
/** 0.01 QTC (12 decimals). */
export const MINT_FEE = 10_000_000_000n;
/** 1% of the QTC price of any token-for-QTC exchange. */
export const SALE_FEE_BPS = 100n;
/** 0.1 QTC (12 decimals), paid in the fee batch of an INSCRIBE (docs/native/INSCRIPTIONS.md §2). */
export const INSCRIBE_FEE = 100_000_000_000n;
/** Inscription numbers start at 1 and are never reused. */
export const FIRST_INSCRIPTION = 1;
/** ceil(price * SALE_FEE_BPS / 10000): at least 1 base unit for any positive price. */
export function saleFee(price: bigint): bigint {
  requireThat(typeof price === 'bigint' && price >= 0n, 'invalid price');
  return (price * SALE_FEE_BPS + 9999n) / 10000n;
}
/** The fixed Qlyphs fee an operation kind must pay in its fee batch (0n when none applies). */
export function operationFee(kind: Operation['kind']): bigint {
  if (kind === 'deploy' || kind === 'deployProgressive' || kind === 'deployProgressiveV2')
    return DEPLOY_FEE;
  if (kind === 'mint') return MINT_FEE;
  if (kind === 'inscribe') return INSCRIBE_FEE;
  return 0n;
}
/** The only valid runtime call for a fee-bearing operation (deploy/mint/inscribe). */
export function feeBatchCall(payload: string, fee: bigint): Call {
  return {
    kind: 'batch',
    calls: [
      { kind: 'remark', event: true, payload },
      { kind: 'pay', to: QLYPHS_FEE_ACCOUNT, amount: fee },
    ],
  };
}
/** The QLYP-v1 payload a call declares, by shape only (acceptance is decided by the indexer):
 * a direct remark_with_event, a multisig proposal of a plain remark, or any remark inside a batch
 * (so a misshapen fee batch is audited and rejected rather than silently ignored). */
export function declaredPayload(call: Call): string | undefined {
  let payload: string | undefined;
  if (call.kind === 'remark' && call.event) payload = call.payload;
  else if (call.kind === 'propose' && call.call.kind === 'remark' && !call.call.event)
    payload = call.call.payload;
  else if (call.kind === 'batch')
    payload = call.calls.find(
      (c): c is Extract<Call, { kind: 'remark' }> =>
        c.kind === 'remark' && c.payload.startsWith(PROTOCOL_HEADER),
    )?.payload;
  return payload?.startsWith(PROTOCOL_HEADER) ? payload : undefined;
}
export type NativeEvent =
  /* `creator` and `nonce` are optional only so that blocks archived before progressive mint still
   * replay; progressive rules refuse a multisig event without them. */
  | { kind: 'multisig'; id: Id; signers: Id[]; threshold: number; creator?: Id; nonce?: bigint }
  | { kind: 'created'; multisig: Id; proposal: number; proposer: Id }
  | { kind: 'approved'; multisig: Id; proposal: number; approver: Id }
  | { kind: 'closed'; multisig: Id; proposal: number }
  | { kind: 'paid'; from: Id; to: Id; amount: bigint }
  | { kind: 'remarked'; sender: Id }
  | { kind: 'batchCompleted' };
/** These are trusted-node execution receipts, NEVER requests supplied by a trader.
 * Adapter must correlate events to extrinsic index and preserve all lifecycle events,
 * including ones emitted by wrappers our protocol refuses to execute. */
export interface Receipt {
  index: number;
  hash: Id;
  signer: Id | null;
  callHex: string;
  success: boolean;
  events: NativeEvent[];
}
export interface Block {
  height: number;
  hash: Id;
  parent: Id;
  spec: number;
  txVersion: number;
  finalized: number;
  receipts: Receipt[];
}
/** A deployed asset's definition. An inscription is an asset with
 * { symbol: '', decimals: 0, cap: 1, limit: 0, policy: 'inscription' }. A progressive asset has
 * policy 'progressive' (progressive-1000-v1) or 'progressive-v2' (progressive-1000-v2) and
 * limit = cap / 1000, one lot. */
export type AssetDefinition = Omit<Extract<Operation, { kind: 'deploy' }>, 'policy'> & {
  policy: 'open' | 'issuer' | 'inscription' | 'progressive' | 'progressive-v2';
};
/** The fixed asset definition of every inscription. */
export const INSCRIPTION_DEFINITION: AssetDefinition = {
  kind: 'deploy',
  symbol: '',
  decimals: 0,
  cap: 1n,
  limit: 0n,
  policy: 'inscription',
};
/** A Qlyph inscription (docs/native/INSCRIPTIONS.md §2). `id` is also its asset id. */
export interface Inscription {
  id: Id;
  /** Sequential number, from FIRST_INSCRIPTION, never reused. */
  number: number;
  creator: Id;
  contentType: string;
  /** Canonical lowercase hex ("0x..."), at least 1 byte. */
  content: string;
  height: number;
  index: number;
}
export interface Asset {
  creator: Id;
  definition: AssetDefinition;
  minted: bigint;
  /** Progressive assets only: where the right to mint the next lot was created, or null once all
   * 1,000 lots are minted. Absent from every other asset. */
  right?: Anchor | null;
}
export interface Ticket {
  key: string;
  multisig: Id;
  proposal: number;
  seller: Id;
  offer: Extract<Operation, { kind: 'offer' }>;
  callHex: string;
  createdHeight: number;
  status: 'locked' | 'settled' | 'released';
  settlement?: Id;
}
export interface State {
  height: number;
  hash: Id;
  finalized: number;
  sequences: Map<Id, bigint>;
  assets: Map<Id, Asset>;
  balances: Map<string, bigint>;
  multisigs: Map<Id, { signers: Id[]; threshold: number }>;
  tickets: Map<string, Ticket>;
  /** Unique token symbols (DEPLOY): symbol -> asset id. First valid claim wins. */
  symbols: Map<string, Id>;
  /** Qlyph inscriptions by id (= asset id). */
  inscriptions: Map<Id, Inscription>;
  /** Number of the next accepted inscription (starts at FIRST_INSCRIPTION). */
  nextInscription: number;
  journal: { height: number; index: number; verdict: string }[];
}
export const ticketKey = (multisig: Id, proposal: number): string => `${multisig}:${proposal}`;
const balanceKey = (asset: Id, owner: Id) => `${asset}:${owner}`;
export const balanceOf = (s: State, asset: Id, owner: Id): bigint =>
  s.balances.get(balanceKey(asset, owner)) ?? 0n;
function change(s: State, asset: Id, owner: Id, amount: bigint): void {
  const n = balanceOf(s, asset, owner) + amount;
  requireThat(n >= 0n, 'insufficient available tokens');
  s.balances.set(balanceKey(asset, owner), n);
}
function release(s: State, t: Ticket): void {
  if (t.status !== 'locked') return;
  change(s, t.offer.asset, t.seller, t.offer.amount);
  t.status = 'released';
}
/** The next lot of a progressive asset and the exact call that buys it. */
export interface ProgressiveLot {
  asset: Id;
  profile: ProgressiveProfile;
  /** Lot number, 1 to 1000. */
  lot: bigint;
  amount: bigint;
  fee: bigint;
  anchor: Anchor;
  ticket: MintTicket;
  call: Uint8Array;
}
/** The progressive profile of an asset's policy, or null for any other asset. */
export function progressiveProfile(policy: AssetDefinition['policy']): ProgressiveProfile | null {
  return policy === 'progressive'
    ? PROGRESSIVE_MINT_PROFILE
    : policy === 'progressive-v2'
      ? PROGRESSIVE_MINT_PROFILE_V2
      : null;
}
export function progressiveLot(s: State, genesis: Id, asset: Id): ProgressiveLot {
  const a = s.assets.get(asset);
  const profile = a ? progressiveProfile(a.definition.policy) : null;
  requireThat(a && profile, 'not a progressive asset');
  const q = progressiveMintQuote(a.definition.cap, a.minted, profile);
  requireThat(q.nextFee !== null && a.right, 'all 1000 lots are minted');
  const ticket = mintTicket(genesis, asset, q.mintedLots, a.right, profile);
  return {
    asset,
    profile,
    lot: q.mintedLots + 1n,
    amount: q.lotSize,
    fee: q.nextFee,
    anchor: { ...a.right },
    ticket,
    call: settlementCall(ticket, QLYPHS_FEE_ACCOUNT, q.nextFee),
  };
}
/** The key of a 2-of-2 signer pair, in the pallet's sorted order whatever order it was given in. */
const pairKey = (signers: readonly Id[]): string => [...signers].sort().join(':');
/** The current rights by their ticket's signer pair, built once per block from the state before it.
 * A right created in a block is not in it: its ticket names the hash of the block that contains it.
 * A used right leaves it. Two current rights never share a pair: each names its own asset and
 * anchor block. */
function rightsByPair(s: State, genesis: Id): Map<string, Id> {
  const m = new Map<string, Id>();
  for (const [id, a] of s.assets) {
    const profile = progressiveProfile(a.definition.policy);
    if (profile && a.right) {
      const q = progressiveMintQuote(a.definition.cap, a.minted, profile);
      m.set(pairKey(mintTicket(genesis, id, q.mintedLots, a.right, profile).signers), id);
    }
  }
  return m;
}
/** The progressive asset whose current right this multisig creation uses, if any. */
function usedRight(
  s: State,
  genesis: Id,
  rights: Map<string, Id>,
  ev: Extract<NativeEvent, { kind: 'multisig' }>,
): ProgressiveLot | undefined {
  if (ev.threshold !== 2 || ev.signers.length !== 2) return undefined;
  const id = rights.get(pairKey(ev.signers));
  if (id === undefined) return undefined;
  requireThat(
    typeof ev.nonce === 'bigint' &&
      ev.nonce >= 0n &&
      ev.nonce < 1n << 64n &&
      typeof ev.creator === 'string',
    'multisig event lacks creator/nonce under progressive rules',
  );
  const lot = progressiveLot(s, genesis, id);
  // Same signers, another nonce: another multisig, not this right.
  return ev.nonce === lot.ticket.nonce ? lot : undefined;
}
/** Exactly one creation of the ticket by the signer, one payment of the lot fee from the signer to
 * Qlyphs and one batchCompleted, in that order. */
function settlementReceipt(r: Receipt, lot: ProgressiveLot): boolean {
  const relevant = r.events.filter(
    (e) => e.kind === 'multisig' || e.kind === 'paid' || e.kind === 'batchCompleted',
  );
  const [created, paid, done] = relevant;
  return (
    relevant.length === 3 &&
    created?.kind === 'multisig' &&
    created.creator === r.signer &&
    created.nonce === lot.ticket.nonce &&
    pairKey(created.signers) === pairKey(lot.ticket.signers) &&
    paid?.kind === 'paid' &&
    paid.from === r.signer &&
    paid.to === QLYPHS_FEE_ACCOUNT &&
    paid.amount === lot.fee &&
    done?.kind === 'batchCompleted'
  );
}
/** Every use of a current right ends it: the exact settlement mints the lot to its signer, any other
 * use (a bare creation, a wrapper, a wrong payment) mints nothing. The next right, if a lot remains,
 * is anchored at this extrinsic. */
function useRights(s: State, r: Receipt, used: ProgressiveLot[], rights: Map<string, Id>): void {
  for (const lot of used) {
    rights.delete(pairKey(lot.ticket.signers));
    const a = s.assets.get(lot.asset);
    requireThat(a && a.right, 'unknown progressive right');
    const canonical =
      r.success &&
      r.signer !== null &&
      r.signer !== ZERO &&
      r.signer !== QLYPHS_FEE_ACCOUNT &&
      used.length === 1 &&
      r.callHex === hex(lot.call) &&
      settlementReceipt(r, lot);
    if (canonical && r.signer !== null) {
      a.minted += lot.amount;
      change(s, lot.asset, r.signer, lot.amount);
    }
    a.right =
      a.minted === a.definition.cap ? null : { height: s.height, hash: s.hash, index: r.index };
    s.journal.push({
      height: s.height,
      index: r.index,
      verdict: canonical
        ? 'accepted'
        : 'rejected: progressive mint right used without its exact settlement; no lot minted',
    });
  }
}
export function buyCall(t: Ticket): Call {
  const calls: Call[] = [
    {
      kind: 'approve',
      multisig: t.multisig,
      proposal: t.proposal,
      call: parseCall(fromHex(t.callHex)),
    },
    { kind: 'pay', to: t.offer.payout, amount: t.offer.price },
  ];
  if (t.offer.fee > 0n) calls.push({ kind: 'pay', to: t.offer.feeTo, amount: t.offer.fee });
  return { kind: 'batch', calls };
}
function isPurchase(r: Receipt, t: Ticket): boolean {
  if (!r.success || r.signer !== t.offer.buyer || r.callHex !== hex(callBytes(buyCall(t))))
    return false;
  if (r.events.filter((e) => e.kind === 'batchCompleted').length !== 1) return false;
  const approvals = r.events.filter((e) => e.kind === 'approved');
  if (approvals.length !== 1) return false;
  const payments = r.events.filter((e) => e.kind === 'paid');
  const expected = [{ to: t.offer.payout, amount: t.offer.price }];
  if (t.offer.fee > 0n) expected.push({ to: t.offer.feeTo, amount: t.offer.fee });
  return (
    payments.length === expected.length &&
    payments.every((p, i) => {
      const leg = expected[i];
      return (
        leg !== undefined && p.from === t.offer.buyer && p.to === leg.to && p.amount === leg.amount
      );
    })
  );
}
/** Exactly one remark by `from`, one payment from `from` to `to` of `amount`, one batchCompleted. */
function batchReceipt(r: Receipt, from: Id, to: Id, amount: bigint): boolean {
  const remarked = r.events.filter((x) => x.kind === 'remarked');
  const paid = r.events.filter((x) => x.kind === 'paid');
  const pay = paid[0];
  return (
    remarked.length === 1 &&
    remarked[0]?.sender === from &&
    paid.length === 1 &&
    pay !== undefined &&
    pay.from === from &&
    pay.to === to &&
    pay.amount === amount &&
    r.events.filter((x) => x.kind === 'batchCompleted').length === 1
  );
}
function applyOperation(s: State, genesis: Id, r: Receipt, e: Envelope, call: Call): void {
  requireThat(r.signer !== null, 'unsigned protocol operation');
  const owner = r.signer;
  fromHex(owner, 32);
  requireThat(owner !== ZERO, 'zero sender');
  requireThat(e.genesis === genesis, 'wrong genesis');
  requireThat(
    e.sequence === (s.sequences.get(owner) ?? 0n) && e.sequence < MAX_U64,
    'wrong/exhausted sequence',
  );
  const p = e.op;
  if (p.kind === 'deployProgressive' || p.kind === 'deployProgressiveV2') {
    const v2 = p.kind === 'deployProgressiveV2';
    progressiveMintQuote(p.cap, 0n, v2 ? PROGRESSIVE_MINT_PROFILE_V2 : PROGRESSIVE_MINT_PROFILE);
    const id = assetId(owner, e.sequence);
    requireThat(!s.assets.has(id), 'asset already exists');
    requireThat(!s.symbols.has(p.symbol), 'symbol taken');
    s.symbols.set(p.symbol, id);
    s.assets.set(id, {
      creator: owner,
      definition: {
        kind: 'deploy',
        symbol: p.symbol,
        decimals: p.decimals,
        cap: p.cap,
        limit: p.cap / PROGRESSIVE_MINT_LOTS,
        policy: v2 ? 'progressive-v2' : 'progressive',
      },
      minted: 0n,
      // The first right is anchored at this DEPLOY; it can be used from the next block on.
      right: { height: s.height, hash: s.hash, index: r.index },
    });
  } else if (p.kind === 'deploy') {
    const id = assetId(owner, e.sequence);
    requireThat(!s.assets.has(id), 'asset already exists');
    requireThat(!s.symbols.has(p.symbol), 'symbol taken');
    s.symbols.set(p.symbol, id);
    s.assets.set(id, { creator: owner, definition: p, minted: 0n });
  } else if (p.kind === 'inscribe') {
    const id = assetId(owner, e.sequence);
    requireThat(!s.assets.has(id), 'asset already exists');
    const number = s.nextInscription;
    requireThat(Number.isSafeInteger(number) && number >= FIRST_INSCRIPTION, 'inscription counter');
    s.assets.set(id, { creator: owner, definition: { ...INSCRIPTION_DEFINITION }, minted: 1n });
    change(s, id, owner, 1n);
    s.inscriptions.set(id, {
      id,
      number,
      creator: owner,
      contentType: p.contentType,
      content: p.content,
      height: s.height,
      index: r.index,
    });
    s.nextInscription = number + 1;
  } else {
    const a = s.assets.get(p.asset);
    requireThat(a, 'unknown asset');
    if (a.definition.policy === 'inscription') {
      requireThat(p.kind !== 'mint', 'inscriptions cannot be minted');
      requireThat(p.amount === 1n, 'inscription amount must be 1');
    }
    if (p.kind === 'mint') {
      requireThat(
        progressiveProfile(a.definition.policy) === null,
        'progressive assets mint one lot at a time through their native right',
      );
      requireThat(a.definition.policy === 'open' || a.creator === owner, 'issuer only');
      requireThat(
        p.amount <= a.definition.limit && a.minted + p.amount <= a.definition.cap,
        'mint cap/limit',
      );
      a.minted += p.amount;
      change(s, p.asset, owner, p.amount);
    } else if (p.kind === 'transfer') {
      requireThat(p.to !== ZERO, 'zero recipient');
      change(s, p.asset, owner, -p.amount);
      change(s, p.asset, p.to, p.amount);
    } else {
      requireThat(call.kind === 'propose', 'offer requires direct proposal');
      requireThat(
        call.expiry === p.expiry && p.expiry > s.height && p.expiry <= s.height + 100800,
        'invalid expiry',
      );
      requireThat(
        p.buyer !== owner && p.buyer !== ZERO && p.payout !== p.buyer && p.payout !== ZERO,
        'invalid counterparties',
      );
      requireThat(
        p.fee === saleFee(p.price) && p.feeTo === QLYPHS_FEE_ACCOUNT && p.feeTo !== p.buyer,
        'offer must commit the 1% Qlyphs sale fee',
      );
      const m = s.multisigs.get(call.multisig);
      requireThat(
        m &&
          m.threshold === 2 &&
          m.signers.length === 2 &&
          m.signers.includes(owner) &&
          m.signers.includes(p.buyer),
        'not exact bilateral multisig',
      );
      const created = r.events.filter((x) => x.kind === 'created');
      const ev = created[0];
      requireThat(created.length === 1 && ev, 'missing/ambiguous proposal event');
      requireThat(ev.multisig === call.multisig && ev.proposer === owner, 'wrong proposal origin');
      const key = ticketKey(call.multisig, ev.proposal);
      requireThat(!s.tickets.has(key), 'ticket reused');
      change(s, p.asset, owner, -p.amount);
      s.tickets.set(key, {
        key,
        multisig: call.multisig,
        proposal: ev.proposal,
        seller: owner,
        offer: p,
        callHex: hex(callBytes(call.call)),
        createdHeight: s.height,
        status: 'locked',
      });
    }
  }
  s.sequences.set(owner, e.sequence + 1n);
}
/** Binds every operation kind to exactly one call context. Throws (=> rejected verdict). */
function requireContext(r: Receipt, e: Envelope, call: Call, payload: string): void {
  const owner = r.signer;
  const kind = e.op.kind;
  if (
    kind === 'deploy' ||
    kind === 'mint' ||
    kind === 'inscribe' ||
    kind === 'deployProgressive' ||
    kind === 'deployProgressiveV2'
  ) {
    const fee = operationFee(kind);
    requireThat(
      call.kind === 'batch',
      `${kind === 'inscribe' ? kind : 'deploy/mint'} requires the Qlyphs fee batch`,
    );
    requireThat(
      hex(callBytes(call)) === hex(callBytes(feeBatchCall(payload, fee))),
      'fee batch must be exactly remark_with_event + transfer of the exact fee to Qlyphs',
    );
    requireThat(
      owner !== null && batchReceipt(r, owner, QLYPHS_FEE_ACCOUNT, fee),
      'fee batch receipt does not show the exact Qlyphs fee',
    );
  } else if (kind === 'transfer') {
    requireThat(
      call.kind === 'remark' && call.event,
      'transfer requires a direct remark_with_event',
    );
    requireThat(
      r.events.some((x) => x.kind === 'remarked' && x.sender === owner),
      'missing remark event',
    );
  } else {
    requireThat(call.kind === 'propose', 'offer requires direct proposal');
  }
}
/** The rejection verdict for a failed signed extrinsic that declares a fee-bearing operation. */
/** Which progressive DEPLOY tags a block at this height reads: the options for `decode`. */
export const progressiveTags = (rules: Rules, height: number) => ({
  progressive: progressiveActive(rules, height),
  progressiveV2: progressiveV2Active(rules, height),
});
function failedFeeOperation(
  r: Receipt,
  tags: ReturnType<typeof progressiveTags>,
): string | undefined {
  try {
    const call = parseCall(fromHex(r.callHex));
    const payload = declaredPayload(call);
    if (payload === undefined) return undefined;
    if (operationFee(decode(fromHex(payload), tags).op.kind) === 0n) return undefined;
    return call.kind === 'batch' ? 'rejected: fee batch failed' : 'rejected: extrinsic failed';
  } catch {
    return undefined; // outside the call grammar or not a decodable QLYP-v1 payload
  }
}
function applyReceipt(
  s: State,
  genesis: Id,
  r: Receipt,
  rules: Rules,
  rights: Map<string, Id> | null,
): State {
  const tags = progressiveTags(rules, s.height);
  const progressive = tags.progressive || tags.progressiveV2;
  const used: ProgressiveLot[] = [];
  // Lifecycle events are authoritative even for calls outside our operation grammar.
  for (const ev of r.events) {
    if (ev.kind === 'multisig') {
      // A progressive ticket is tracked by its asset's right, not kept as a multisig.
      const lot = rights ? usedRight(s, genesis, rights, ev) : undefined;
      if (lot) {
        requireThat(
          !used.some((u) => u.asset === lot.asset),
          'duplicate right use in trusted input',
        );
        used.push(lot);
        continue;
      }
      requireThat(!s.multisigs.has(ev.id), 'duplicate multisig in trusted input');
      fromHex(ev.id, 32);
      for (const x of ev.signers) fromHex(x, 32);
      s.multisigs.set(ev.id, { signers: [...ev.signers], threshold: ev.threshold });
    }
  }
  if (r.success && r.signer !== null) {
    // Unknown runtime calls are ordinary chain traffic, not automatically token operations.
    let call: Call | undefined;
    try {
      call = parseCall(fromHex(r.callHex));
    } catch {
      /* outside the supported call grammar */
    }
    const payload = call && declaredPayload(call);
    if (payload !== undefined && call) {
      const next = structuredClone(s);
      try {
        const envelope = decode(fromHex(payload), tags);
        requireContext(r, envelope, call, payload);
        applyOperation(next, genesis, r, envelope, call);
        s = next;
        s.journal.push({ height: s.height, index: r.index, verdict: 'accepted' });
      } catch (error) {
        s.journal.push({
          height: s.height,
          index: r.index,
          verdict: `rejected: ${error instanceof Error ? error.message : 'invalid'}`,
        });
      }
    }
  } else if (r.signer !== null) {
    // A deploy/mint whose extrinsic failed (e.g. the Qlyphs fee leg of batch_all could not be paid,
    // reverting the whole batch) is recorded as rejected: no state effect, no sequence advance.
    // Other failed extrinsics stay ordinary chain traffic without a QLYP verdict.
    const verdict = failedFeeOperation(r, tags);
    if (verdict !== undefined) s.journal.push({ height: s.height, index: r.index, verdict });
  }
  if (used.length > 0 && rights) useRights(s, r, used, rights);
  else if (progressive && r.signer !== null && readSettlement(r.callHex)?.to === QLYPHS_FEE_ACCOUNT)
    // The settlement shape without a current right: say what happened to the payment.
    s.journal.push({
      height: s.height,
      index: r.index,
      verdict: r.success
        ? 'rejected: not the current progressive mint right; no lot minted'
        : 'rejected: progressive mint failed natively; no Qlyphs fee was paid',
    });
  for (const ev of r.events) {
    if (ev.kind !== 'approved' && ev.kind !== 'closed') continue;
    const t = s.tickets.get(ticketKey(ev.multisig, ev.proposal));
    if (!t || t.status !== 'locked') continue;
    if (ev.kind === 'closed') {
      release(s, t);
      continue;
    }
    if (ev.approver !== t.offer.buyer) continue;
    if (isPurchase(r, t)) {
      change(s, t.offer.asset, t.offer.buyer, t.offer.amount);
      t.status = 'settled';
      t.settlement = r.hash;
    } else release(s, t); // Standalone/noncanonical first approval consumes the native ticket.
  }
  return s;
}
/** Whole lots, a right exactly while lots remain, and an anchor no later than the current block. */
function assertProgressiveInvariants(s: State): void {
  for (const a of s.assets.values()) {
    const profile = progressiveProfile(a.definition.policy);
    if (!profile) {
      requireThat(!Object.hasOwn(a, 'right'), 'right on a non-progressive asset');
      continue;
    }
    const q = progressiveMintQuote(a.definition.cap, a.minted, profile);
    requireThat(
      a.definition.limit === q.lotSize && (a.right === null) === (q.remainingLots === 0n),
      'progressive asset invariant',
    );
    if (a.right) {
      fromHex(a.right.hash, 32);
      requireThat(
        Number.isSafeInteger(a.right.height) &&
          a.right.height >= 0 &&
          a.right.height <= s.height &&
          Number.isSafeInteger(a.right.index) &&
          a.right.index >= 0 &&
          a.right.index <= 0xffffffff &&
          (a.right.height < s.height || a.right.hash === s.hash),
        'progressive right invariant',
      );
    }
  }
}
/** `progressive = false` skips the progressive section: `apply` checks it once per block, since a
 * pass over every progressive asset after every receipt would make a block cost receipts × assets. */
export function assertInvariants(s: State, progressive = true): void {
  for (const [id, a] of s.assets) {
    let total = 0n;
    for (const [key, n] of s.balances) {
      requireThat(n >= 0n, 'negative balance invariant');
      if (key.startsWith(`${id}:`)) total += n;
    }
    for (const t of s.tickets.values())
      if (t.offer.asset === id && t.status === 'locked') total += t.offer.amount;
    requireThat(total === a.minted && total <= a.definition.cap, 'supply conservation invariant');
  }
  if (progressive) assertProgressiveInvariants(s);
  // Unique symbols: exactly the DEPLOY assets, each under its own symbol.
  let named = 0;
  for (const [id, a] of s.assets) {
    if (a.definition.policy === 'inscription') {
      const ins = s.inscriptions.get(id);
      requireThat(
        ins &&
          ins.id === id &&
          ins.creator === a.creator &&
          a.minted === 1n &&
          a.definition.cap === 1n &&
          a.definition.limit === 0n &&
          a.definition.decimals === 0 &&
          a.definition.symbol === '',
        'inscription asset invariant',
      );
    } else {
      named++;
      requireThat(s.symbols.get(a.definition.symbol) === id, 'symbol index invariant');
    }
  }
  requireThat(s.symbols.size === named, 'symbol index invariant');
  requireThat(
    Number.isSafeInteger(s.nextInscription) &&
      s.nextInscription === FIRST_INSCRIPTION + s.inscriptions.size,
    'inscription counter invariant',
  );
  const numbers = new Set<number>();
  for (const [id, ins] of s.inscriptions) {
    requireThat(
      ins.id === id &&
        s.assets.get(id)?.definition.policy === 'inscription' &&
        Number.isSafeInteger(ins.number) &&
        ins.number >= FIRST_INSCRIPTION &&
        ins.number < s.nextInscription &&
        !numbers.has(ins.number),
      'inscription invariant',
    );
    numbers.add(ins.number);
  }
}
/** Reference in-memory replay engine, not a production database or independently verified node.
 * All state is detached on input/output; failed blocks cannot partially mutate the checkpoint. */
export class NativeIndexer {
  private current: State;
  private history = new Map<number, State>();
  readonly genesis: Id;
  readonly rules: Rules;
  private readonly retainHistory: boolean;
  constructor(
    genesis: Id,
    activation = { height: 0, hash: genesis },
    retainHistory = true,
    // A mainnet reader may run no other rules, so they are its default.
    rules: Rules = genesis === MAINNET ? mainnetRules() : LEGACY_RULES,
  ) {
    fromHex(genesis, 32);
    this.rules = checkRules(rules);
    // Mainnet reads progressive mint only from its reviewed activation: no configuration can switch
    // it on, move it, or turn on progressive-1000-v1.
    requireThat(
      genesis !== MAINNET || mainnetRulesAllowed(this.rules, activation.height),
      'progressive mint is not enabled on mainnet',
    );
    fromHex(activation.hash, 32);
    requireThat(
      genesis !== MAINNET || activation.height > 0,
      'QLYP reads Quantus mainnet only from a pinned activation block',
    );
    requireThat(
      Number.isSafeInteger(activation.height) && activation.height >= 0,
      'invalid activation',
    );
    this.genesis = genesis;
    this.retainHistory = retainHistory;
    this.current = {
      height: activation.height,
      hash: activation.hash,
      finalized: activation.height,
      sequences: new Map(),
      assets: new Map(),
      balances: new Map(),
      multisigs: new Map(),
      tickets: new Map(),
      symbols: new Map(),
      inscriptions: new Map(),
      nextInscription: FIRST_INSCRIPTION,
      journal: [],
    };
    this.history.set(activation.height, structuredClone(this.current));
  }
  /** Only restore operator-owned, integrity-checked checkpoints, never HTTP request data.
   * The durable store checks the network/activation manifest and checkpoint digest first. */
  static fromCheckpoint(
    genesis: Id,
    checkpoint: State,
    retainHistory = false,
    rules: Rules = genesis === MAINNET ? mainnetRules() : LEGACY_RULES,
  ): NativeIndexer {
    fromHex(checkpoint.hash, 32);
    requireThat(
      Number.isSafeInteger(checkpoint.height) && checkpoint.height >= 0,
      'invalid checkpoint height',
    );
    requireThat(
      Number.isSafeInteger(checkpoint.finalized) &&
        checkpoint.finalized >= 0 &&
        checkpoint.finalized <= checkpoint.height,
      'invalid checkpoint finality',
    );
    for (const map of [
      checkpoint.sequences,
      checkpoint.assets,
      checkpoint.balances,
      checkpoint.multisigs,
      checkpoint.tickets,
      checkpoint.symbols,
      checkpoint.inscriptions,
    ])
      requireThat(map instanceof Map, 'invalid checkpoint map');
    requireThat(Number.isSafeInteger(checkpoint.nextInscription), 'invalid checkpoint counters');
    requireThat(Array.isArray(checkpoint.journal), 'invalid checkpoint journal');
    assertInvariants(checkpoint);
    // A progressive asset's right would silently stop moving under rules that are not yet active.
    for (const [policy, active] of [
      ['progressive', rules.progressive],
      ['progressive-v2', rules.progressiveV2],
    ] as const)
      requireThat(
        ![...checkpoint.assets.values()].some((a) => a.definition.policy === policy) ||
          (active !== null && active.from <= checkpoint.height),
        'checkpoint holds progressive assets: progressive rules required',
      );
    const x = new NativeIndexer(
      genesis,
      { height: checkpoint.height, hash: checkpoint.hash },
      retainHistory,
      rules,
    );
    x.current = structuredClone(checkpoint);
    x.history.set(checkpoint.height, structuredClone(checkpoint));
    return x;
  }
  state(): State {
    return structuredClone(this.current);
  }
  apply(block: Block): void {
    const b = structuredClone(block),
      old = this.current;
    requireThat(
      b.spec === 152 && b.txVersion === 6,
      'unsupported runtime: halt, do not reinterpret',
    );
    requireThat(
      Number.isSafeInteger(b.height) && b.height === old.height + 1 && b.parent === old.hash,
      'noncontiguous block/reorg: rollback first',
    );
    fromHex(b.hash, 32);
    requireThat(b.hash !== b.parent, 'invalid block hash');
    requireThat(
      Number.isSafeInteger(b.finalized) && b.finalized >= old.finalized && b.finalized <= b.height,
      'invalid finality',
    );
    let s = structuredClone(old);
    s.height = b.height;
    s.hash = b.hash;
    s.finalized = b.finalized;
    for (const t of s.tickets.values()) if (b.height > t.offer.expiry) release(s, t);
    // Built only for blocks that create a 2-of-2 multisig: nothing else can use a right.
    const rights =
      (progressiveActive(this.rules, b.height) || progressiveV2Active(this.rules, b.height)) &&
      b.receipts.some((r) =>
        r.events.some((e) => e.kind === 'multisig' && e.threshold === 2 && e.signers.length === 2),
      )
        ? rightsByPair(s, this.genesis)
        : null;
    let last = -1;
    for (const r of b.receipts) {
      requireThat(Number.isSafeInteger(r.index) && r.index > last, 'unordered/duplicate extrinsic');
      last = r.index;
      fromHex(r.hash, 32);
      s = applyReceipt(s, this.genesis, r, this.rules, rights);
      assertInvariants(s, false);
    }
    assertInvariants(s);
    // Journal entries are also persisted separately by the durable adapter; keep a bounded view.
    if (s.journal.length > 10000) s.journal = s.journal.slice(-10000);
    this.current = s;
    if (!this.retainHistory) this.history.clear();
    this.history.set(s.height, structuredClone(s));
    for (const h of this.history.keys()) if (h < s.finalized) this.history.delete(h);
  }
  rollback(height: number, expectedHash: Id): void {
    requireThat(height >= this.current.finalized, 'cannot roll back finalized state');
    const s = this.history.get(height);
    requireThat(s && s.hash === expectedHash, 'unknown rollback checkpoint');
    const finality = this.current.finalized;
    this.current = structuredClone(s);
    this.current.finalized = finality;
    for (const h of this.history.keys()) if (h > height) this.history.delete(h);
  }
  prepareBuy(key: string, buyer: Id): Uint8Array {
    const t = this.current.tickets.get(key);
    requireThat(
      t && t.status === 'locked' && t.offer.buyer === buyer,
      'not a live ticket for this buyer',
    );
    requireThat(t.createdHeight <= this.current.finalized, 'reservation is not finalized');
    requireThat(this.current.height <= t.offer.expiry, 'expired ticket');
    return callBytes(buyCall(t));
  }
}
