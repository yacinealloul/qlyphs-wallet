/** QLYP fee schedule (fees-1): rate-derived fees, the fee state and its governance, as specified in
 * docs/extension/PROTOCOL-FEES.md. Pure functions of chain data: no clock, no network, no oracle. */
import { hex, MAINNET, QLYPHS_FEE_ACCOUNT, requireThat, ZERO } from './codec.ts';
import type { FeeAdminOp, Id, Operation } from './codec.ts';
import { sha512 } from './sha512.ts';
import { BLOCKED, TICKERS_DIGEST } from './tickers.ts';

/** 0.001 QTC, the Quantus existential deposit: no fee is ever below it. */
export const ED = 1_000_000_000n;
/** Rate bounds, in QTC base units per USD: QTC = 5,000 USD and QTC = 5 USD. */
export const RATE_MIN = 200_000_000n;
export const RATE_MAX = 200_000_000_000n;
/** A new rate is within x4/5 .. x5/4 of the current one. */
export const STEP_NUM = 5n;
export const STEP_DEN = 4n;
/** The fixed fees every network reads without a schedule, before it and in its legacy window. */
export const LEGACY_DEPLOY_FEE = 1_000_000_000_000n;
export const LEGACY_INSCRIBE_FEE = 100_000_000_000n;
/** USD targets of the rate-derived fees, in US cents. MINT is not rate-derived and has none. */
export const FEE_TARGETS_CENTS: Readonly<{ deploy: bigint; inscribe: bigint }> = Object.freeze({
  deploy: 2_500n,
  inscribe: 2_500n,
});
/** Window bounds, in blocks. The minimum grace keeps a margin over the 256-block era wallets use. */
export const MIN_GRACE = 320;
export const MAX_DELAY = 1_000_000;
export const MAX_RESETS = 8;
/** The `index` of the genesis grid, which no extrinsic posted. */
export const GENESIS_GRID_INDEX = 0xffffffff;
/** Heights, grid ids and `nextGrid` are u32 in the state. */
export const U32_MAX = 0xffffffff;

const SYMBOL = /^[A-Z0-9]{1,12}$/;
// The blocked list is consensus data: refuse to load a list that is malformed or that differs
// from the digest pinned next to it. Marked pure so bundles that never read BLOCKED_SET (page
// scripts) drop the check and SHA-512; every module that reads it still runs the check at load.
function checkedBlocked(): ReadonlySet<string> {
  requireThat(
    BLOCKED.every((s, i) => SYMBOL.test(s) && (i === 0 || BLOCKED[i - 1]! < s)),
    'blocked tickers must be valid, unique and sorted',
  );
  // The preimage is ASCII (checked above), so its bytes are its char codes. Not TextEncoder: this
  // runs at module load, also in sandboxes that do not provide it.
  const preimage = 'Qlyphs/QLYP/tickers/v1\0' + JSON.stringify({ blocked: BLOCKED });
  requireThat(
    hex(sha512(Uint8Array.from(preimage, (c) => c.charCodeAt(0)))) === '0x' + TICKERS_DIGEST,
    'blocked tickers differ from TICKERS_DIGEST',
  );
  return new Set(BLOCKED);
}
export const BLOCKED_SET: ReadonlySet<string> = /* @__PURE__ */ checkedBlocked();

/** Any operation kind, or a wallet command kind: only the listed kinds carry a fee. */
type Kind = string;
/** Operations that carry a Qlyphs fee in their fee batch. */
export const isFeeBearing = (kind: Kind): boolean => kind === 'mint' || isRateDerived(kind);
/** Fee-bearing operations whose fee comes from the rate. MINT keeps its fixed fee. */
export const isRateDerived = (kind: Kind): boolean =>
  kind === 'deploy' ||
  kind === 'inscribe' ||
  kind === 'deployProgressive' ||
  kind === 'deployProgressiveV2';
const claimsSymbol = (op: Operation): op is Extract<Operation, { symbol: string }> =>
  op.kind === 'deploy' || op.kind === 'deployProgressive' || op.kind === 'deployProgressiveV2';

/** Why `r` is not an acceptable rate, or null when it is: within bounds and at most 3 significant
 * digits, so that every fee is an exact integer in any language. */
export function rateError(r: bigint): 'rate out of bounds' | 'rate not canonical' | null {
  if (typeof r !== 'bigint' || r < RATE_MIN || r > RATE_MAX) return 'rate out of bounds';
  return r % 10n ** BigInt(r.toString().length - 3) === 0n ? null : 'rate not canonical';
}
export const checkRate = (r: bigint): boolean => rateError(r) === null;
/** Exact byte comparison: lookalikes such as USDT0 or WBTC are allowed on purpose. */
export function symbolClass(symbol: string): 'blocked' | 'allowed' {
  requireThat(typeof symbol === 'string' && SYMBOL.test(symbol), 'invalid symbol');
  return BLOCKED_SET.has(symbol) ? 'blocked' : 'allowed';
}
/** The USD target of a rate-derived operation. Every allowed symbol costs the same. */
export function centsFor(op: Operation): bigint {
  if (claimsSymbol(op)) {
    requireThat(symbolClass(op.symbol) === 'allowed', 'symbol blocked');
    return FEE_TARGETS_CENTS.deploy;
  }
  requireThat(op.kind === 'inscribe', 'the mint fee is not rate-derived');
  return FEE_TARGETS_CENTS.inscribe;
}
/** max(ED, cents * rate / 100): exact, because a canonical rate is a multiple of 100. */
export function feeAt(cents: bigint, rate: bigint): bigint {
  const error = rateError(rate);
  requireThat(error === null, error ?? '');
  requireThat(typeof cents === 'bigint' && cents >= 0n, 'invalid fee target');
  const f = (cents * rate) / 100n;
  return f > ED ? f : ED;
}
export const fee = (op: Operation, rate: bigint): bigint => feeAt(centsFor(op), rate);
/** The fixed fee of a rate-derived kind where the legacy reading applies. */
export function legacyFee(kind: Kind): bigint {
  requireThat(isRateDerived(kind), 'the mint fee is not rate-derived');
  return kind === 'inscribe' ? LEGACY_INSCRIBE_FEE : LEGACY_DEPLOY_FEE;
}

export interface FeeReset {
  at: number;
  operator: Id;
  guardian: Id;
  sentinel: Id;
}
/** The fee schedule of a rules object. `rate` is a decimal string so that the rules stay plain JSON
 * for the rules fingerprint. */
export interface FeeRules {
  from: number;
  operator: Id;
  guardian: Id;
  sentinel: Id;
  rate: string;
  delay: number;
  grace: number;
  guardianDelay: number;
  legacyBefore: boolean;
  resets: FeeReset[];
}
/** A posted rate. (height, index) is the extrinsic that posted it. */
export interface Grid {
  id: number;
  rate: bigint;
  effective: number;
  height: number;
  index: number;
}
export interface PendingRole {
  account: Id;
  effective: number;
}
export interface FeeState {
  /** null while frozen. */
  operator: Id | null;
  guardian: Id;
  sentinel: Id;
  pendingOperator: PendingRole | null;
  pendingGuardian: PendingRole | null;
  current: Grid;
  previous: Grid | null;
  pending: Grid | null;
  nextGrid: number;
  /** How many of the rules' resets are applied. */
  nextReset: number;
}

const ID = /^0x[0-9a-f]{64}$/;
const FEE_RULES_KEYS = [
  'from',
  'operator',
  'guardian',
  'sentinel',
  'rate',
  'delay',
  'grace',
  'guardianDelay',
  'legacyBefore',
  'resets',
];
const exactKeys = (v: unknown, keys: string[]): Record<string, unknown> => {
  requireThat(v !== null && typeof v === 'object' && !Array.isArray(v), 'invalid fee schedule');
  const o = v as Record<string, unknown>;
  requireThat(
    Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k)),
    'invalid fee schedule',
  );
  return o;
};
const safe = (v: unknown, min: number): number => {
  requireThat(Number.isSafeInteger(v) && (v as number) >= min, 'invalid fee schedule');
  return v as number;
};
const roles = (o: Record<string, unknown>): { operator: Id; guardian: Id; sentinel: Id } => {
  const [operator, guardian, sentinel] = [o.operator, o.guardian, o.sentinel].map((x) => {
    requireThat(
      typeof x === 'string' && ID.test(x) && x !== ZERO && x !== QLYPHS_FEE_ACCOUNT,
      'invalid fee schedule',
    );
    return x;
  }) as [Id, Id, Id];
  requireThat(
    operator !== guardian && operator !== sentinel && guardian !== sentinel,
    'invalid fee schedule',
  );
  return { operator, guardian, sentinel };
};
/** A fee schedule exactly as the reducer accepts it: every key, no extra key, no default. */
export function checkFeeRules(v: unknown): FeeRules {
  const o = exactKeys(v, FEE_RULES_KEYS);
  const from = safe(o.from, 1);
  const { operator, guardian, sentinel } = roles(o);
  // A JSON number would lose precision in some readers: the rate is always a decimal string.
  requireThat(
    typeof o.rate === 'string' && /^[1-9][0-9]*$/.test(o.rate) && checkRate(BigInt(o.rate)),
    'invalid fee schedule',
  );
  const delay = safe(o.delay, 1),
    grace = safe(o.grace, MIN_GRACE),
    guardianDelay = safe(o.guardianDelay, delay);
  // delay > grace keeps at most two rates acceptable at any height.
  requireThat(grace < delay && delay <= MAX_DELAY, 'invalid fee schedule');
  // Every effective height a window allows from `from` fits the u32 state fields. guardianDelay is
  // at least delay, so its window bounds the others: no role rotation is impossible by construction.
  requireThat(from + 2 * guardianDelay <= U32_MAX, 'invalid fee schedule');
  requireThat(typeof o.legacyBefore === 'boolean', 'invalid fee schedule');
  requireThat(Array.isArray(o.resets) && o.resets.length <= MAX_RESETS, 'invalid fee schedule');
  let last = from;
  const resets = (o.resets as unknown[]).map((x) => {
    const r = exactKeys(x, ['at', 'operator', 'guardian', 'sentinel']);
    const at = safe(r.at, 1);
    requireThat(at > last && at <= U32_MAX, 'invalid fee schedule');
    last = at;
    return { at, ...roles(r) };
  });
  return {
    from,
    operator,
    guardian,
    sentinel,
    rate: o.rate,
    delay,
    grace,
    guardianDelay,
    legacyBefore: o.legacyBefore,
    resets,
  };
}
/** How clients see rate-derived fees at height `h`: the fixed legacy fees, the schedule, or not at
 * all. Without a schedule mainnet shows 'inactive', since no Qlyphs client signs there before the
 * reviewed activation; the reducer still reads the legacy fees there (protocol.ts). */
export function feeMode(
  rules: { feeSchedule: FeeRules | null },
  genesis: Id,
  h: number,
): 'legacy' | 'schedule' | 'inactive' {
  const f = rules.feeSchedule;
  if (f === null) return genesis === MAINNET ? 'inactive' : 'legacy';
  if (h >= f.from) return 'schedule';
  return f.legacyBefore ? 'legacy' : 'inactive';
}
/** The state installed at `from`. */
export function genesisFeeState(rules: FeeRules): FeeState {
  return {
    operator: rules.operator,
    guardian: rules.guardian,
    sentinel: rules.sentinel,
    pendingOperator: null,
    pendingGuardian: null,
    current: {
      id: 0,
      rate: BigInt(rules.rate),
      effective: rules.from,
      height: rules.from,
      index: GENESIS_GRID_INDEX,
    },
    previous: null,
    pending: null,
    nextGrid: 1,
    nextReset: 0,
  };
}
/** The block-start step for block `h`, before its receipts. Returns a new state. */
export function stepFees(
  fees: FeeState | null,
  rules: FeeRules | null,
  h: number,
): FeeState | null {
  if (rules === null || h < rules.from) return fees === null ? null : structuredClone(fees);
  const f = h === rules.from ? genesisFeeState(rules) : structuredClone(fees);
  requireThat(f !== null, 'fee state missing');
  for (
    let r = rules.resets[f.nextReset];
    r !== undefined && r.at <= h;
    r = rules.resets[f.nextReset]
  ) {
    f.operator = r.operator;
    f.guardian = r.guardian;
    f.sentinel = r.sentinel;
    f.pendingOperator = f.pendingGuardian = f.pending = null;
    f.nextReset++;
  }
  if (f.pendingGuardian && f.pendingGuardian.effective <= h) {
    f.guardian = f.pendingGuardian.account;
    f.pendingGuardian = null;
  }
  if (f.pendingOperator && f.pendingOperator.effective <= h) {
    f.operator = f.pendingOperator.account;
    f.pendingOperator = null;
  }
  if (f.pending && f.pending.effective <= h) {
    f.previous = f.current;
    f.current = f.pending;
    f.pending = null;
  }
  if (f.previous && h >= f.current.effective + rules.grace) f.previous = null;
  return f;
}
/** The amounts a rate-derived operation may pay at height `h`: at most two, by the overlap bound. */
export function allowedFees(fees: FeeState, rules: FeeRules, op: Operation, h: number): bigint[] {
  const out = [fee(op, fees.current.rate)];
  if (fees.previous) out.push(fee(op, fees.previous.rate));
  if (rules.legacyBefore && h < rules.from + rules.grace) out.push(legacyFee(op.kind));
  return [...new Set(out)];
}
const effectiveIn = (effective: number, P: number, delay: number): void =>
  requireThat(P + delay <= effective && effective <= P + 2 * delay, 'invalid effective height');
/** FEE_RATE at inclusion height `P`, extrinsic `index`. Throws the verdict, else returns the new
 * state. */
export function applyFeeRate(
  fees: FeeState,
  rules: FeeRules,
  signer: Id,
  op: Extract<Operation, { kind: 'feeRate' }>,
  P: number,
  index: number,
): FeeState {
  requireThat(fees.operator !== null, 'fee operator frozen');
  requireThat(signer === fees.operator, 'not the fee operator');
  effectiveIn(op.effective, P, rules.delay);
  const error = rateError(op.rate);
  requireThat(error === null, error ?? '');
  // Against the current rate, never the pending one being replaced: replacing cannot chain steps.
  const c = fees.current.rate;
  requireThat(
    STEP_DEN * op.rate <= STEP_NUM * c && STEP_NUM * op.rate >= STEP_DEN * c,
    'rate step too large',
  );
  // Ids are never reused and `nextGrid` is a u32: once the last id is spent, FEE_RATE is refused
  // like any invalid operation instead of reaching the state invariant, which halts the reader.
  requireThat(fees.nextGrid < U32_MAX, 'grid ids exhausted');
  const f = structuredClone(fees);
  f.pending = { id: f.nextGrid, rate: op.rate, effective: op.effective, height: P, index };
  f.nextGrid++;
  return f;
}
/** FEE_ADMIN at inclusion height `P`. Each action runs its checks in order and changes nothing on
 * failure. The role sets exclude exactly the accounts that would break role distinctness. */
export function applyFeeAdmin(
  fees: FeeState,
  rules: FeeRules,
  signer: Id,
  op: FeeAdminOp,
  P: number,
): FeeState {
  const f = structuredClone(fees);
  const excluded = (account: Id, ...xs: (Id | null | undefined)[]): void =>
    requireThat(![...xs, ZERO, QLYPHS_FEE_ACCOUNT].includes(account), 'invalid fee account role');
  if (op.action === 'cancel') {
    requireThat(
      signer === f.operator || signer === f.sentinel || signer === f.guardian,
      'not a fee role',
    );
    requireThat(f.pending !== null, 'no pending grid');
    f.pending = null;
  } else if (op.action === 'freeze') {
    requireThat(signer === f.sentinel || signer === f.guardian, 'not the fee guardian or sentinel');
    f.operator = f.pendingOperator = f.pending = null;
  } else {
    requireThat(signer === f.guardian, 'not the fee guardian');
    if (op.action === 'setOperator') {
      excluded(op.account, f.operator, f.guardian, f.sentinel, f.pendingGuardian?.account);
      effectiveIn(op.effective, P, rules.delay);
      f.pendingOperator = { account: op.account, effective: op.effective };
    } else if (op.action === 'setGuardian') {
      // Naming the current guardian aborts a rotation, whatever `effective` says.
      if (op.account === f.guardian) f.pendingGuardian = null;
      else {
        excluded(op.account, f.operator, f.sentinel, f.pendingOperator?.account);
        effectiveIn(op.effective, P, rules.guardianDelay);
        f.pendingGuardian = { account: op.account, effective: op.effective };
      }
    } else if (op.action === 'setSentinel') {
      // Immediate: the sentinel's powers are a protective subset of the guardian's.
      excluded(
        op.account,
        f.operator,
        f.guardian,
        f.sentinel,
        f.pendingOperator?.account,
        f.pendingGuardian?.account,
      );
      f.sentinel = op.account;
    }
  }
  return f;
}
const u32 = (n: unknown): boolean =>
  Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= U32_MAX;
const isId = (x: unknown): boolean => typeof x === 'string' && ID.test(x);
const gridOk = (g: Grid): boolean =>
  g !== null &&
  typeof g === 'object' &&
  u32(g.id) &&
  checkRate(g.rate) &&
  u32(g.effective) &&
  u32(g.height) &&
  u32(g.index);
/** The fee state invariants at `height`. `grace` (from the rules) also bounds how long `previous`
 * stays; a snapshot alone carries no rules, so it is checked without it. */
export function checkFeeState(fees: FeeState, height: number, grace?: number): void {
  const ok = (v: unknown) => requireThat(v, 'fee state invariant');
  ok(
    fees !== null &&
      typeof fees === 'object' &&
      gridOk(fees.current) &&
      u32(fees.nextGrid) &&
      u32(fees.nextReset),
  );
  ok(fees.nextReset <= MAX_RESETS);
  const grids = [fees.current, fees.previous, fees.pending].filter((g): g is Grid => g !== null);
  ok(grids.every(gridOk) && grids.every((g) => g.id < fees.nextGrid));
  ok(fees.pending === null || fees.pending.effective > height);
  ok(fees.previous === null || grace === undefined || height < fees.current.effective + grace);
  const pendingOk = (p: PendingRole | null) =>
    p === null || (p !== undefined && isId(p.account) && u32(p.effective));
  ok(pendingOk(fees.pendingOperator) && pendingOk(fees.pendingGuardian));
  ok((fees.operator === null || isId(fees.operator)) && isId(fees.guardian) && isId(fees.sentinel));
  const accounts = [
    fees.operator,
    fees.guardian,
    fees.sentinel,
    fees.pendingOperator?.account,
    fees.pendingGuardian?.account,
  ].filter((x): x is Id => typeof x === 'string');
  ok(
    new Set(accounts).size === accounts.length &&
      !accounts.includes(ZERO) &&
      !accounts.includes(QLYPHS_FEE_ACCOUNT),
  );
}
