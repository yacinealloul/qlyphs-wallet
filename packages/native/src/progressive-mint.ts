/** Progressive mint profiles: 1,000 equal lots at five fixed Qlyphs fees, each lot bought through a
 * one-shot native right (docs/native/PROGRESSIVE-MINT.md). A profile never changes once defined:
 * progressive-1000-v1 (tag 11) and progressive-1000-v2 (tag 12) differ only in their fees. */
import { compact, concat, fromHex, hex, Reader, uint } from './codec.ts';
import { sha512 } from './sha512.ts';
import type { Id } from './codec.ts';

export const PROGRESSIVE_MINT_PROFILE = 'progressive-1000-v1';
export const PROGRESSIVE_MINT_PROFILE_V2 = 'progressive-1000-v2';
export type ProgressiveProfile = typeof PROGRESSIVE_MINT_PROFILE | typeof PROGRESSIVE_MINT_PROFILE_V2;
export const PROGRESSIVE_MINT_LOTS = 1_000n;
/** Total issuance fees, excluding deployment, network charges and the native ticket cost. */
export const PROGRESSIVE_MINT_TOTAL_FEE = 300_000_000_000_000n;
export const PROGRESSIVE_MINT_TOTAL_FEE_V2 = 210_000_000_000_000n;

const MAX_AMOUNT = (1n << 128n) - 1n;
const LOTS_PER_TIER = 200n;
// Pure module top level: bundles that never price a lot (such as a page script) drop this module.
const FEES = /* @__PURE__ */ Object.freeze([
  100_000_000_000n,
  200_000_000_000n,
  300_000_000_000n,
  400_000_000_000n,
  500_000_000_000n,
]);
const FEES_V2 = /* @__PURE__ */ Object.freeze([
  10_000_000_000n,
  100_000_000_000n,
  200_000_000_000n,
  300_000_000_000n,
  440_000_000_000n,
]);
const feesOf = (profile: ProgressiveProfile): readonly bigint[] => {
  need(profile === PROGRESSIVE_MINT_PROFILE || profile === PROGRESSIVE_MINT_PROFILE_V2, 'unknown profile');
  return profile === PROGRESSIVE_MINT_PROFILE ? FEES : FEES_V2;
};

export interface ProgressiveMintQuote {
  readonly profile: ProgressiveProfile;
  readonly lotSize: bigint;
  readonly mintedLots: bigint;
  readonly remainingLots: bigint;
  /** Null at exhaustion: zero would incorrectly describe a free mint. */
  readonly nextFee: bigint | null;
}

function need(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

/** A quote is a calculation, not a reservation, authorization or payment guarantee. */
export function progressiveMintQuote(
  cap: bigint,
  minted: bigint,
  profile: ProgressiveProfile = PROGRESSIVE_MINT_PROFILE,
): ProgressiveMintQuote {
  const fees = feesOf(profile);
  need(typeof cap === 'bigint' && cap > 0n && cap <= MAX_AMOUNT, 'invalid supply');
  need(cap % PROGRESSIVE_MINT_LOTS === 0n, 'supply must contain 1000 equal lots');
  need(
    typeof minted === 'bigint' && minted >= 0n && minted <= cap,
    'invalid minted amount',
  );
  const lotSize = cap / PROGRESSIVE_MINT_LOTS;
  need(minted % lotSize === 0n, 'minted amount must contain whole lots');
  const mintedLots = minted / lotSize;
  let nextFee: bigint | null = null;
  if (mintedLots < PROGRESSIVE_MINT_LOTS) {
    // Only this bounded array index becomes a Number; token and QTC amounts never do.
    const fee = fees[Number(mintedLots / LOTS_PER_TIER)];
    need(fee !== undefined, 'invalid mint tier');
    nextFee = fee;
  }
  return Object.freeze({
    profile,
    lotSize,
    mintedLots,
    remainingLots: PROGRESSIVE_MINT_LOTS - mintedLots,
    nextFee,
  });
}

/** Validate one whole lot against supplied state; this does not execute or reserve a mint. */
export function requireProgressiveMint(
  cap: bigint,
  minted: bigint,
  amount: bigint,
  profile: ProgressiveProfile = PROGRESSIVE_MINT_PROFILE,
) {
  const quote = progressiveMintQuote(cap, minted, profile);
  need(quote.nextFee !== null, 'mint sold out');
  need(typeof amount === 'bigint' && amount > 0n, 'invalid mint amount');
  need(amount === quote.lotSize, 'mint amount must equal one lot');
  return Object.freeze({
    profile: quote.profile,
    lot: quote.mintedLots + 1n,
    amount: quote.lotSize,
    fee: quote.nextFee,
  });
}

/** The Qlyphs fee of lot number `lot` (1 to 1000): the price a wallet shows before signing. */
export function progressiveLotFee(
  lot: bigint,
  profile: ProgressiveProfile = PROGRESSIVE_MINT_PROFILE,
): bigint {
  const fees = feesOf(profile);
  need(typeof lot === 'bigint' && lot >= 1n && lot <= PROGRESSIVE_MINT_LOTS, 'invalid lot');
  const fee = fees[Number((lot - 1n) / LOTS_PER_TIER)];
  need(fee !== undefined, 'invalid mint tier');
  return fee;
}

/** Where the current right was created: the progressive DEPLOY, or the last native use of the
 * previous right. Its block hash does not exist before that block, so no right can be used early. */
export interface Anchor {
  height: number;
  hash: Id;
  index: number;
}

/** The native marker of one right: the 2-of-2 multisig `(signers, 2, nonce)`, which
 * `multisig.create_multisig` can create only once. Neither signer is a key; they only name it. */
export interface MintTicket {
  signers: [Id, Id];
  nonce: bigint;
}

// Each profile names its rights in its own domain: a v1 ticket can never be a v2 right.
const RIGHT_DOMAINS: Readonly<Record<ProgressiveProfile, string>> = /* @__PURE__ */ Object.freeze({
  'progressive-1000-v1': 'Qlyphs/ProgressiveMint/right/v1\0',
  'progressive-1000-v2': 'Qlyphs/ProgressiveMint/right/v2\0',
});

const ascii = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));
// A ticket is a pure function of its inputs, and a reducer asks for the same ones on every block.
// Remembering them keeps each block's work independent of how many rights exist.
const tickets = new Map<string, MintTicket>();
const MAX_REMEMBERED_TICKETS = 100_000;

/** The ticket for the next lot of `asset`, bound to this network, the profile, the asset, the lot
 * and the anchor. */
export function mintTicket(
  genesis: Id,
  asset: Id,
  mintedLots: bigint,
  anchor: Anchor,
  profile: ProgressiveProfile = PROGRESSIVE_MINT_PROFILE,
): MintTicket {
  feesOf(profile);
  need(
    typeof mintedLots === 'bigint' && mintedLots >= 0n && mintedLots < PROGRESSIVE_MINT_LOTS,
    'no lot left to mint',
  );
  need(
    Number.isSafeInteger(anchor.height) &&
      anchor.height >= 0 &&
      Number.isSafeInteger(anchor.index) &&
      anchor.index >= 0 &&
      anchor.index <= 0xffffffff,
    'invalid right anchor',
  );
  fromHex(anchor.hash, 32);
  const key = `${profile}:${genesis}:${asset}:${mintedLots}:${anchor.hash}:${anchor.index}`;
  const known = tickets.get(key);
  if (known) return { signers: [known.signers[0], known.signers[1]], nonce: known.nonce };
  const namespace = hex(
    sha512(concat(ascii(RIGHT_DOMAINS[profile]), fromHex(genesis, 32), fromHex(asset, 40), uint(mintedLots, 2))).slice(
      0,
      32,
    ),
  );
  // Lowercase hex of equal length sorts like the bytes, as the pallet sorts its signers.
  const signers = [namespace, anchor.hash].sort() as [Id, Id];
  need(signers[0] !== signers[1], 'ticket signer collision');
  if (tickets.size >= MAX_REMEMBERED_TICKETS) tickets.clear();
  tickets.set(key, { signers: [signers[0], signers[1]], nonce: BigInt(anchor.index) });
  return { signers, nonce: BigInt(anchor.index) };
}

/** The only call that buys a lot:
 * `utility.batch_all([multisig.create_multisig(ticket), balances.transfer_keep_alive(feeTo, fee)])`.
 * The creation runs first, so a used ticket fails before any QTC moves, and batch_all undoes the
 * creation when the payment fails. */
export function settlementCall(ticket: MintTicket, feeTo: Id, fee: bigint): Uint8Array {
  return concat(
    Uint8Array.of(9, 2),
    compact(2n),
    Uint8Array.of(19, 0),
    compact(2n),
    fromHex(ticket.signers[0], 32),
    fromHex(ticket.signers[1], 32),
    uint(2n, 4),
    uint(ticket.nonce, 8),
    Uint8Array.of(2, 3, 0),
    fromHex(feeTo, 32),
    compact(fee),
  );
}

/** A call of exactly the settlement shape, for any ticket, recipient and amount; null otherwise,
 * including for bytes or hex that are not canonical. */
export function readSettlement(
  input: Uint8Array | string,
): { ticket: MintTicket; to: Id; amount: bigint } | null {
  try {
    const call = typeof input === 'string' ? fromHex(input) : input;
    const r = new Reader(call);
    const byte = (n: number) => r.small(1) === n;
    need(byte(9) && byte(2) && r.compact() === 2n && byte(19) && byte(0) && r.compact() === 2n, 'shape');
    const signers: [Id, Id] = [r.id(), r.id()];
    need(r.int(4) === 2n, 'threshold');
    const nonce = r.int(8);
    need(byte(2) && byte(3) && byte(0), 'payment');
    const to = r.id(),
      amount = r.compact();
    r.end();
    const ticket = { signers, nonce };
    need(hex(settlementCall(ticket, to, amount)) === hex(call), 'noncanonical');
    return { ticket, to, amount };
  } catch {
    return null;
  }
}
