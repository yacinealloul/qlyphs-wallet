/** Bounded mint sessions: the terms a dapp proposes and the snapshot it observes. */

// Literals only: this module ships in page-injected scripts, which must not carry protocol code.
export const MINT_SESSION_PROFILE = 'progressive-1000-v2';
/** Highest Qlyphs fee of any lot of the profile, in QTC base units. */
export const MAX_FEE_PER_LOT = 440_000_000_000n;

/** The bounds a wallet build accepts; a newer wallet may advertise other values. */
export interface MintSessionLimits {
  readonly profiles: readonly string[];
  readonly maxLots: number;
  /** Attempts beyond `maxLots`, applied as `maxLots + min(maxLots, maxRetries)`: each one is a
   * payment the session may sign after a lost race. */
  readonly maxRetries: number;
  readonly minDurationSeconds: number;
  readonly maxDurationSeconds: number;
}
export const MINT_SESSION_LIMITS: MintSessionLimits = Object.freeze({
  profiles: Object.freeze([MINT_SESSION_PROFILE]),
  maxLots: 25,
  maxRetries: 10,
  minDurationSeconds: 30,
  maxDurationSeconds: 300,
});

export interface MintSessionTerms {
  /** 0x + 80 lowercase hex: the 40-byte asset id. */
  readonly asset: string;
  readonly profile: typeof MINT_SESSION_PROFILE;
  /** Token base units per lot, as the dapp displayed it. */
  readonly lotAmount: string;
  /** Lots verified in a block before the session completes. */
  readonly maxLots: number;
  /**
   * Signatures the session may ever produce. `maxAttempts - maxLots` is how many lost races the
   * session accepts: the next one ends it with `race-lost`, so with `maxAttempts === maxLots` the
   * first lost race does.
   */
  readonly maxAttempts: number;
  /** QTC base units: highest Qlyphs fee of any lot the session may pay. */
  readonly maxFeePerLot: string;
  /** QTC base units: cap on Qlyphs fees plus native ticket charges. */
  readonly maxSpend: string;
  /** Signing window from approval; the wallet's unlock deadline may end it sooner. */
  readonly maxDurationSeconds: number;
}
export interface MintSessionParams {
  readonly owner: string;
  readonly genesis: string;
  readonly terms: MintSessionTerms;
}
export type MintSessionState = 'running' | 'paused' | 'stopping' | 'ended';
export type MintSessionEnd =
  | 'completed'
  | 'stopped'
  | 'cancelled'
  | 'deadline'
  | 'locked'
  | 'context-changed'
  /** Lost races used up the retries the terms allow (`maxAttempts - maxLots`). */
  | 'race-lost'
  | 'attempt-limit'
  | 'spend-limit'
  | 'fee-limit'
  | 'sold-out'
  | 'failed'
  | 'unverified'
  | 'insufficient-funds'
  | 'unavailable';
/**
 * `signed`, `uncertain`, `sent` and `included`: the session is still following the payment.
 * `unresolved`: a reorganization or the wallet's history contradicted what the session recorded for
 * it, so its outcome is reconciled in history (the wallet's Activity), not by the session. `settled`:
 * the payment is final in history, whose entry gives its result, but the session did not verify that
 * result itself: it ended before classifying the payment, or the payment was `unresolved`.
 */
export type MintAttemptStatus =
  | 'signed'
  | 'uncertain'
  | 'sent'
  | 'included'
  | 'minted'
  | 'lost-race'
  | 'failed'
  | 'cancelled'
  | 'dead'
  | 'expired'
  | 'replaced'
  | 'unresolved'
  | 'settled';
export interface MintAttemptView {
  /** 32-byte extrinsic hash, computed by the wallet. */
  readonly hash: string;
  /** Lot number from attested state, 1 to 1000. */
  readonly lot: number;
  readonly status: MintAttemptStatus;
  /** Last block height that can include the payment: its birth height + 255. */
  readonly lastBlock: number;
}
export interface MintSessionSnapshot {
  readonly id: string;
  readonly owner: string;
  readonly genesis: string;
  /** Canonical echo of the approved terms. */
  readonly terms: MintSessionTerms;
  readonly state: MintSessionState;
  /** Non-null exactly when `state` is `ended`. */
  readonly end: MintSessionEnd | null;
  /**
   * Lots the wallet verified in a block (`included`, provisional) and those of them in a final block
   * (`finalized`). An `unresolved` or `settled` payment is in neither.
   */
  readonly lots: { readonly included: number; readonly finalized: number };
  readonly attempts: {
    /** Signatures reserved so far; never decreases. */
    readonly used: number;
    /** Payments the wallet verified as lost to another buyer. */
    readonly lostRaces: number;
    /** Payments shown as `unresolved`: in doubt, and not final in history yet. */
    readonly unresolved: number;
  };
  readonly spent: {
    /** Strict: Qlyphs fees and native tickets of verified lots. */
    readonly protocol: string;
    /**
     * Strict worst case of the payments that may still be charged until history settles them: the
     * one the session follows, those whose fate only the wallet's node reported, and the
     * `unresolved` ones. Never above `maxSpend` minus `protocol`, which no chain can exceed.
     */
    readonly reserved: string;
    /** An estimate, never a cap. */
    readonly networkEstimate: string;
  };
  /**
   * A recorded inclusion left the chain, or the wallet's history finalized one of the session's
   * payments otherwise than the session recorded it: at least one payment is `unresolved` or was
   * settled by history, and the counters leave it out.
   */
  readonly reorganized: boolean;
  /** The payment the session is still following, once it has a hash; it may outlive the end of the
   * session. */
  readonly pending: MintAttemptView | null;
  /** The most recent payment the session no longer follows: resolved, `unresolved` or `settled`. */
  readonly last: MintAttemptView | null;
}

const MAX_U128 = (1n << 128n) - 1n;
const MAX_LOT = 1000;
const HEX32 = /^0x[0-9a-f]{64}$/;
const ASSET = /^0x[0-9a-f]{80}$/;
const POSITIVE = /^[1-9][0-9]{0,38}$/;
const DECIMAL = /^(?:0|[1-9][0-9]{0,38})$/;
const FEE = /^[1-9][0-9]{0,11}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TERMS_KEYS = [
  'asset',
  'profile',
  'lotAmount',
  'maxLots',
  'maxAttempts',
  'maxFeePerLot',
  'maxSpend',
  'maxDurationSeconds',
] as const;
const STATES: readonly string[] = ['running', 'paused', 'stopping', 'ended'];
const ENDS: readonly string[] = [
  'completed',
  'stopped',
  'cancelled',
  'deadline',
  'locked',
  'context-changed',
  'race-lost',
  'attempt-limit',
  'spend-limit',
  'fee-limit',
  'sold-out',
  'failed',
  'unverified',
  'insufficient-funds',
  'unavailable',
];
/** Statuses of `pending` and of `last`. */
const FOLLOWED: readonly string[] = ['signed', 'uncertain', 'sent', 'included'];
const NOT_FOLLOWED: readonly string[] = [
  'minted',
  'lost-race',
  'failed',
  'cancelled',
  'dead',
  'expired',
  'replaced',
  'unresolved',
  'settled',
];

/** Thrown inside the parsers only; callers see a fixed message that never echoes the input. */
class Invalid extends Error {}
function check(condition: unknown): asserts condition {
  if (!condition) throw new Invalid();
}
/** Plain objects from any realm (structured clones, JSON); arrays, class instances and proxies of them fail. */
function fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  check(typeof value === 'object' && value !== null && !Array.isArray(value));
  const proto = Object.getPrototypeOf(value);
  check(proto === null || Object.getPrototypeOf(proto) === null);
  const own = Reflect.ownKeys(value);
  check(own.length === keys.length && keys.every((k) => own.includes(k)));
  // Copy each value once so a getter cannot answer differently between check and use.
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(value, k);
    check(d && 'value' in d && d.enumerable);
    out[k] = d.value;
  }
  return out;
}
function count(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  check(typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max);
  return value;
}
function digits(value: unknown, shape: RegExp, max: bigint): string {
  check(typeof value === 'string' && shape.test(value) && BigInt(value) <= max);
  return value;
}
function matching(value: unknown, shape: RegExp): string {
  check(typeof value === 'string' && shape.test(value));
  return value;
}
function oneOf<T extends string>(value: unknown, allowed: readonly string[]): T {
  check(typeof value === 'string' && allowed.includes(value));
  return value as T;
}

function terms(value: unknown): MintSessionTerms {
  const v = fields(value, TERMS_KEYS);
  check(v.profile === MINT_SESSION_PROFILE);
  const maxLots = count(v.maxLots, 1, MINT_SESSION_LIMITS.maxLots);
  return Object.freeze({
    asset: matching(v.asset, ASSET),
    profile: MINT_SESSION_PROFILE,
    lotAmount: digits(v.lotAmount, POSITIVE, MAX_U128),
    maxLots,
    maxAttempts: count(
      v.maxAttempts,
      maxLots,
      maxLots + Math.min(maxLots, MINT_SESSION_LIMITS.maxRetries),
    ),
    maxFeePerLot: digits(v.maxFeePerLot, FEE, MAX_FEE_PER_LOT),
    maxSpend: digits(v.maxSpend, POSITIVE, MAX_U128),
    maxDurationSeconds: count(
      v.maxDurationSeconds,
      MINT_SESSION_LIMITS.minDurationSeconds,
      MINT_SESSION_LIMITS.maxDurationSeconds,
    ),
  });
}

function attempt(value: unknown, allowed: readonly string[]): MintAttemptView | null {
  if (value === null) return null;
  const v = fields(value, ['hash', 'lot', 'status', 'lastBlock']);
  return Object.freeze({
    hash: matching(v.hash, HEX32),
    lot: count(v.lot, 1, MAX_LOT),
    status: oneOf<MintAttemptStatus>(v.status, allowed),
    lastBlock: count(v.lastBlock),
  });
}

function snapshot(value: unknown): MintSessionSnapshot {
  const v = fields(value, [
    'id',
    'owner',
    'genesis',
    'terms',
    'state',
    'end',
    'lots',
    'attempts',
    'spent',
    'reorganized',
    'pending',
    'last',
  ]);
  const agreed = terms(v.terms);
  const state = oneOf<MintSessionState>(v.state, STATES);
  const end = v.end === null ? null : oneOf<MintSessionEnd>(v.end, ENDS);
  check((end !== null) === (state === 'ended'));
  const l = fields(v.lots, ['included', 'finalized']);
  const a = fields(v.attempts, ['used', 'lostRaces', 'unresolved']);
  const s = fields(v.spent, ['protocol', 'reserved', 'networkEstimate']);
  const lots = Object.freeze({ included: count(l.included), finalized: count(l.finalized) });
  const attempts = Object.freeze({
    used: count(a.used),
    lostRaces: count(a.lostRaces),
    unresolved: count(a.unresolved),
  });
  const spent = Object.freeze({
    protocol: digits(s.protocol, DECIMAL, MAX_U128),
    reserved: digits(s.reserved, DECIMAL, MAX_U128),
    networkEstimate: digits(s.networkEstimate, DECIMAL, MAX_U128),
  });
  check(typeof v.reorganized === 'boolean');
  const reorganized = v.reorganized;
  check(lots.finalized <= lots.included && lots.included <= agreed.maxLots);
  // Only a reorganization, or history contradicting the session, puts a payment in doubt.
  check(reorganized || attempts.unresolved === 0);
  check(attempts.used <= agreed.maxAttempts);
  // Verified lots, verified lost races and payments in doubt are distinct signatures.
  check(lots.included + attempts.lostRaces + attempts.unresolved <= attempts.used);
  const cap = BigInt(agreed.maxSpend);
  check(BigInt(spent.protocol) <= cap);
  check(BigInt(spent.protocol) + BigInt(spent.reserved) <= cap);
  return Object.freeze({
    id: matching(v.id, UUID),
    owner: matching(v.owner, HEX32),
    genesis: matching(v.genesis, HEX32),
    terms: agreed,
    state,
    end,
    lots,
    attempts,
    spent,
    reorganized,
    pending: attempt(v.pending, FOLLOWED),
    last: attempt(v.last, NOT_FOLLOWED),
  });
}

/**
 * Validates proposed terms against the V1 bounds and returns a frozen canonical copy.
 * Throws `Error('Invalid mint session terms')`, whatever the fault.
 */
export function parseMintSessionTerms(value: unknown): MintSessionTerms {
  try {
    return terms(value);
  } catch {
    throw new Error('Invalid mint session terms');
  }
}

/**
 * Validates a wallet's snapshot, including the invariants between its counters, and returns a
 * deep-frozen copy. Throws `Error('Invalid mint session snapshot')`, whatever the fault.
 */
export function parseMintSessionSnapshot(value: unknown): MintSessionSnapshot {
  try {
    return snapshot(value);
  } catch {
    throw new Error('Invalid mint session snapshot');
  }
}
