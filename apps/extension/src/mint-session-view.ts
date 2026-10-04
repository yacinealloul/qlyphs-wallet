/** Presentation of a mint session's review and progress. Pure. */
import { parseMintSessionSnapshot } from '../../../packages/provider/src/mint-session.ts';
import type {
  MintAttemptView,
  MintSessionSnapshot,
  MintSessionTerms,
} from '../../../packages/provider/src/mint-session.ts';
import { formatUnits } from '../../../packages/native/src/commands.ts';
import { formatEta } from './tx-progress.ts';
import type { ChainHeights } from './tx-progress.ts';

/** Poll period of the progress window while signing may still happen. */
export const UI_POLL_MS = 1000;
/** Poll period once signing ended, while a payment or a lot's finality is still outstanding. */
export const ENDED_POLL_MS = 4000;
/** A Keys overlay call never settles when its worker died, so each poll gets its own bound. */
export const UI_CALL_TIMEOUT_MS = 5000;
/** The wallet forgets an ended session's window after this long. */
export const ENDED_RETENTION_MS = 1_800_000;
/** The wallet refuses to start when less signing time than this is left before it locks. */
export const MIN_START_MS = 30_000;

export const LOCKS_TOO_SOON =
  'The wallet locks too soon to start minting. Lock it, unlock it and start again from the site.';
export const ARCHIVE_FULL = 'Archive capacity reached; preserve history before continuing';
export const RECORDS_FULL =
  'Too many mint sessions are still settling; try again once their payments are final';
export const NO_SESSION = 'No mint session for this window';
/** What a reloaded window learns when its approval was still being saved: that start was cancelled. */
export const RELOADED_BEFORE_START =
  'This window was reloaded before minting started, so nothing was signed. Start again from the site.';
export const NOT_ANSWERING = 'The wallet is not answering.';
export const NOT_CONFIRMED =
  'The wallet did not confirm the start. Check Activity before trying again.';

/** Why the wallet ended a session. Precise, for the wallet's own window; dapps see a coarser value. */
export type MintEndReason =
  | 'completed'
  | 'stopped'
  | 'cancelled'
  | 'deadline'
  | 'locked'
  | 'account'
  | 'network'
  | 'reset'
  | 'window'
  | 'disconnected'
  | 'revoked'
  | 'restarted'
  | 'update'
  | 'race-lost'
  | 'attempt-limit'
  | 'spend-limit'
  | 'fee-limit'
  | 'sold-out'
  | 'failed'
  | 'anomaly'
  | 'reorg'
  | 'account-activity'
  | 'unverified'
  | 'insufficient-funds'
  | 'unavailable'
  | 'capacity';
const REASONS: readonly string[] = [
  'completed',
  'stopped',
  'cancelled',
  'deadline',
  'locked',
  'account',
  'network',
  'reset',
  'window',
  'disconnected',
  'revoked',
  'restarted',
  'update',
  'race-lost',
  'attempt-limit',
  'spend-limit',
  'fee-limit',
  'sold-out',
  'failed',
  'anomaly',
  'reorg',
  'account-activity',
  'unverified',
  'insufficient-funds',
  'unavailable',
  'capacity',
];

/** What the review window shows and the approval digest binds. */
export interface MintSessionReview {
  id: string;
  terms: MintSessionTerms;
  asset: { id: string; symbol: string; decimals: number; cap: string; creator: string };
  start: { lot: number; fee: string; minted: string; block: { height: number; hash: string } };
  /** Highest lot whose fee is within `maxFeePerLot`, and that fee. */
  range: { lastLot: number; lastFee: string };
  costs: { networkFee: string; networkReserve: string; ticket: string; margin: number };
  /** Journal entries left and needed, and free session record slots. */
  capacity: { remaining: number; needed: number; records: number };
  policy: { version: number; rulesHash: string; runtimeHash: string };
  horizonBlocks: number;
  digest: string;
}

/** The answer to `session-state`, `session-stop` and an approval: the snapshot plus wallet-only facts. */
export interface MintSessionView extends MintSessionSnapshot {
  /** Non-null exactly when the session ended. */
  readonly reason: MintEndReason | null;
  readonly endedAt: number | null;
  /** Signing deadline fixed at approval, and the unlock deadline that may have set it. */
  readonly deadline: number;
  readonly unlockDeadline: number;
  readonly now: number;
  /** Lot the session would pay for next, from its latest attestation, when known. */
  readonly next: number | null;
  /**
   * Every payment the session signed, oldest first. Named `payments` because the snapshot's
   * `attempts` already holds the counters.
   */
  readonly payments: readonly MintAttemptView[];
  /** Last block that can still include an outstanding payment. */
  readonly horizon: number | null;
  /** Chain heights the wallet last observed, for time estimates. */
  readonly chain: ChainHeights | null;
}

/** The `status.mintSession` summary that the wallet's tracker shows. */
export interface MintSessionStatus {
  id: string;
  state: MintSessionSnapshot['state'];
  reason: MintEndReason | null;
  symbol: string;
  included: number;
  maxLots: number;
  used: number;
  maxAttempts: number;
  deadline: number;
  outstanding: boolean;
  reorganized: boolean;
}

export type Clock = (ms: number) => string;
export type Row = readonly [label: string, value: string];
const defaultTime: Clock = (ms) => new Date(ms).toLocaleTimeString();
const qtc = (value: string | bigint) => formatUnits(BigInt(value), 12) + ' QTC';

const SNAPSHOT_KEYS = [
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
] as const;
const VIEW_KEYS = [
  'reason',
  'endedAt',
  'deadline',
  'unlockDeadline',
  'now',
  'next',
  'payments',
  'horizon',
  'chain',
] as const;
const MAX_PAYMENTS = 35;
const STATUSES: readonly string[] = [
  'signed',
  'uncertain',
  'sent',
  'included',
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
const HASH = /^0x[0-9a-f]{64}$/;
const time = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/**
 * Checks a view from the background before anything is painted from it. The UI renders text only,
 * but a view that breaks the snapshot's invariants must never be shown as counts or limits.
 */
export function parseMintSessionView(value: unknown): MintSessionView {
  const fail = (): never => {
    throw new Error('Invalid mint session view');
  };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail();
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v);
  if (keys.length !== SNAPSHOT_KEYS.length + VIEW_KEYS.length) fail();
  if (![...SNAPSHOT_KEYS, ...VIEW_KEYS].every((k) => Object.hasOwn(v, k))) fail();
  let snapshot: MintSessionSnapshot;
  try {
    const picked: Record<string, unknown> = {};
    for (const k of SNAPSHOT_KEYS) picked[k] = v[k];
    snapshot = parseMintSessionSnapshot(picked);
  } catch {
    return fail();
  }
  const list = v.payments;
  if (!Array.isArray(list) || list.length > MAX_PAYMENTS) fail();
  const payments = (list as unknown[]).map((a) => {
    if (typeof a !== 'object' || a === null) return fail();
    const x = a as Record<string, unknown>;
    if (
      Object.keys(x).length !== 4 ||
      typeof x.hash !== 'string' ||
      !HASH.test(x.hash) ||
      !Number.isSafeInteger(x.lot) ||
      (x.lot as number) < 1 ||
      (x.lot as number) > 1000 ||
      typeof x.status !== 'string' ||
      !STATUSES.includes(x.status) ||
      !time(x.lastBlock)
    )
      fail();
    return Object.freeze({
      hash: x.hash as string,
      lot: x.lot as number,
      status: x.status as MintAttemptView['status'],
      lastBlock: x.lastBlock as number,
    });
  });
  const reason = v.reason;
  if (reason === null ? snapshot.state === 'ended' : snapshot.state !== 'ended') fail();
  if (reason !== null && !REASONS.includes(reason as string)) fail();
  if ((reason === null) !== (v.endedAt === null)) fail();
  if (v.endedAt !== null && !time(v.endedAt)) fail();
  if (!time(v.deadline) || !time(v.unlockDeadline) || !time(v.now)) fail();
  if (v.next !== null && !(Number.isSafeInteger(v.next) && (v.next as number) >= 1 && (v.next as number) <= 1000))
    fail();
  if (v.horizon !== null && !time(v.horizon)) fail();
  const c = v.chain as Record<string, unknown> | null;
  if (c !== null && (typeof c !== 'object' || !time(c.head) || !time(c.finalized) || !time(c.at)))
    fail();
  return Object.freeze({
    ...snapshot,
    reason: reason as MintEndReason | null,
    endedAt: v.endedAt as number | null,
    deadline: v.deadline as number,
    unlockDeadline: v.unlockDeadline as number,
    now: v.now as number,
    next: v.next as number | null,
    payments: Object.freeze(payments),
    horizon: v.horizon as number | null,
    chain:
      c === null
        ? null
        : Object.freeze({ head: c.head as number, finalized: c.finalized as number, at: c.at as number }),
  });
}

/** The same view, ended in this window only: the wallet no longer knows the session. */
export function endedLocally(view: MintSessionView, reason: MintEndReason, now: number): MintSessionView {
  if (view.state === 'ended') return view;
  return Object.freeze({ ...view, state: 'ended', end: 'context-changed', reason, endedAt: now });
}

// ---- Review -----------------------------------------------------------------------------------

/** Signing ends at the approved duration or when the wallet locks, whichever comes first. */
export function signingDeadline(terms: MintSessionTerms, now: number, unlockDeadline: number) {
  return Math.min(now + terms.maxDurationSeconds * 1000, unlockDeadline);
}

function clockLeft(ms: number) {
  const left = Math.max(0, Math.floor(ms / 1000));
  return { m: Math.floor(left / 60), s: left % 60 };
}

export function reviewTitle(review: MintSessionReview) {
  return `Mint up to ${review.terms.maxLots} lots`;
}

/** The token amount the session may mint at most, as quantity and currency. */
export function reviewAmount(review: MintSessionReview) {
  const total = BigInt(review.terms.lotAmount) * BigInt(review.terms.maxLots);
  return { quantity: formatUnits(total, review.asset.decimals), currency: review.asset.symbol };
}

/** The live value of the `Signing stops` row. */
export function signingStops(
  review: MintSessionReview,
  now: number,
  unlockDeadline: number,
  clock: Clock = defaultTime,
) {
  const deadline = signingDeadline(review.terms, now, unlockDeadline);
  const { m, s } = clockLeft(deadline - now);
  return `${clock(deadline)} · in ${m} min ${s} s, or when you press Stop`;
}

export const AFTER_STOP =
  'Payments already sent can still be included for up to 256 blocks, about 51 min at 12-second blocks. Stop cancels nothing already sent.';
export const PRICE_SCHEDULE = 'progressive-1000-v2 · 0.01 to 0.44 QTC per lot';
/** Rows that `pairs()` groups under Limits, and the session rows that belong to the token details. */
export const LIMIT_ROWS =
  /^(Lots|Signatures|Qlyphs fee per lot|Maximum protocol spend|Signing stops|After Stop|History space)$/;
export const DETAIL_ROWS = /^(Price schedule|Next lot|Lots it may pay for)$/;

/** Every review row in display order, apart from the account and network rows. */
export function reviewRows(
  review: MintSessionReview,
  now: number,
  unlockDeadline: number,
  clock: Clock = defaultTime,
): Row[] {
  const t = review.terms,
    n = t.maxLots,
    s = t.maxAttempts;
  const lot = formatUnits(BigInt(t.lotAmount), review.asset.decimals);
  const firstFee = formatUnits(BigInt(review.start.fee), 12);
  return [
    ['Lots', `Up to ${n} · ${lot} ${review.asset.symbol} each`],
    // A lost race with no retry left ends the session, so lost races can reach one more than the
    // retries: the row counts retries, which is the exact bound.
    [
      'Signatures',
      s === n
        ? `Up to ${n} · stops if another buyer takes a lot first`
        : `Up to ${s} · at most ${s - n} ${s - n === 1 ? 'retry after a lost race' : 'retries after lost races'}`,
    ],
    ['Qlyphs fee per lot', `At most ${qtc(t.maxFeePerLot)}`],
    ['Maximum protocol spend', `${qtc(t.maxSpend)} · Qlyphs fees and native tickets`],
    ['Signing stops', signingStops(review, now, unlockDeadline, clock)],
    ['After Stop', AFTER_STOP],
    [
      'History space',
      `Uses up to ${review.capacity.needed} of ${review.capacity.remaining} entries`,
    ],
    ['Asset', review.asset.symbol],
    ['Full asset ID', review.asset.id],
    ['Price schedule', PRICE_SCHEDULE],
    ['Next lot', `${review.start.lot} / 1000 · ${firstFee} QTC`],
    [
      'Lots it may pay for',
      `Up to lot ${review.range.lastLot} · ${firstFee} to ${formatUnits(BigInt(review.range.lastFee), 12)} QTC each · other buyers can move the next lot`,
    ],
    ['Attested at block', String(review.start.block.height)],
    ['Network fee estimate', `${qtc(review.costs.networkFee)} per signature`],
    ['Native ticket per lot', `${qtc(review.costs.ticket)} · charged only for a lot you receive`],
    [
      'Network fees for this session',
      `Up to about ${qtc(BigInt(s) * BigInt(review.costs.networkFee))} · estimate`,
    ],
  ];
}

/** The review's warning. `extension` selects the browser extension's wording over Qlyphs Keys'. */
export function reviewWarning(review: MintSessionReview, extension: boolean) {
  const t = review.terms,
    retries = t.maxAttempts - t.maxLots;
  const lostRace =
    'If another buyer takes a lot first, that payment fails on chain: you pay its network fee only, and ' +
    (retries === 0
      ? 'signing stops. '
      : `the wallet signs one payment for the lot that is next then, never above ${qtc(t.maxFeePerLot)}. ` +
        `After ${retries} lost ${retries === 1 ? 'race' : 'races'}, the next one stops signing. `);
  return (
    `Approving lets the wallet sign up to ${t.maxAttempts} lot payments for this token, one at a time, each from fresh attestations by both witnesses. ` +
    `Signing stops when ${t.maxLots} lots are in a block, a limit above is reached, you press Stop, or the wallet locks. ` +
    lostRace +
    'Qlyphs fees and native tickets never exceed the maximum protocol spend; network fees are estimates. ' +
    (extension
      ? 'Keep this window open and stay on the site’s page: closing this window, switching accounts, or any page change on the site, even inside the site, stops signing.'
      : 'Keep this window open: closing it, closing the site’s tab or switching accounts stops signing. Leaving the site asks the wallet to stop, but closing this window is the sure way.')
  );
}

export function reviewExpiry(expires: number, unlockDeadline: number, clock: Clock = defaultTime) {
  return `Review expires at ${clock(expires)} · wallet locks at ${clock(unlockDeadline)}`;
}

/**
 * Why the session cannot be approved from this review, or null. The background enforces the same
 * rules; the window says why the button is off instead of letting the approval fail.
 */
export function approvalBlock(review: MintSessionReview, unlockDeadline: number, now: number) {
  if (unlockDeadline - now < MIN_START_MS) return LOCKS_TOO_SOON;
  if (review.capacity.remaining < review.capacity.needed) return ARCHIVE_FULL;
  if (review.capacity.records < 1) return RECORDS_FULL;
  return null;
}

// ---- Progress ---------------------------------------------------------------------------------

/** Seal stages shared with the receipt, plus `idle` for a session that ended with nothing minted. */
export type SessionStage = 'sent' | 'included' | 'confirmed' | 'failed' | 'idle';
export interface Progress {
  title: string;
  count: string;
  detail: string;
  rows: Row[];
  stage: SessionStage;
  /** Share of the lots in a block, 0..100, for the seal ring; null keeps the ring spinning. */
  ring: number | null;
  stopVisible: boolean;
  /** Stop was requested: the button stays focusable but ignores clicks. */
  stopBusy: boolean;
  doneVisible: boolean;
  /** Changes only on a transition; the window reads it out through one hidden status node. */
  announce: string;
  ended: boolean;
  included: number;
  /** The payment to show and copy: the one the session still follows, else the latest it no
   * longer follows (resolved, unresolved or settled). */
  hash: string | null;
}

/** Ends that mean something went wrong. A lost race is an expected outcome of a contested token,
 * so `race-lost` ends quietly, like a limit. */
const ERROR_REASONS: readonly MintEndReason[] = [
  'failed',
  'anomaly',
  'reorg',
  'account-activity',
  'unverified',
  'insufficient-funds',
  'unavailable',
  'capacity',
];
const PAYMENT_STATUS: Record<string, string> = {
  signed: 'signing',
  uncertain: 'checking that the network received it',
  sent: 'waiting for a block',
  included: 'in a block · checking the outcome',
};
/** When the background has no precise reason, its public value still gets a truthful text. */
const FALLBACK: Record<string, MintEndReason> = {
  completed: 'completed',
  stopped: 'stopped',
  cancelled: 'cancelled',
  deadline: 'deadline',
  locked: 'locked',
  'race-lost': 'race-lost',
  'attempt-limit': 'attempt-limit',
  'spend-limit': 'spend-limit',
  'fee-limit': 'fee-limit',
  'sold-out': 'sold-out',
  failed: 'failed',
  unverified: 'unverified',
  'insufficient-funds': 'insufficient-funds',
  unavailable: 'unavailable',
};

function reasonOf(view: MintSessionView): MintEndReason | null {
  return view.reason ?? (view.end ? (FALLBACK[view.end] ?? null) : null);
}

/**
 * Why signing stopped, in one or two sentences, without the outstanding-payment notes. A
 * reorganized session has a payment in doubt, whose result only history gives: no text then says
 * that the session's lots are in a block or that a payment cost only its network fee.
 */
export function endReasonText(view: MintSessionView, clock: Clock = defaultTime): string {
  const t = view.terms;
  switch (reasonOf(view)) {
    case 'completed':
      // Signing stops at the first doubt, so a completed session was reorganized after its end.
      return view.reorganized
        ? `Signing ended once ${t.maxLots} lots were in a block, then the chain reorganized.`
        : `Done: ${t.maxLots} lots are in a block. They become final in about 100 blocks.`;
    case 'stopped':
      return 'Signing stopped.';
    case 'cancelled':
      return 'The site stopped signing.';
    case 'deadline':
      return 'Signing time is over.';
    case 'locked':
      // The last reservation must leave time to sign, so the session can end shortly before the lock.
      return view.endedAt !== null && view.endedAt < view.unlockDeadline
        ? `Signing time is over: the wallet locks at ${clock(view.unlockDeadline)}.`
        : 'Stopped: the wallet locked.';
    case 'account':
      return 'Stopped: the account changed.';
    case 'network':
      return 'Stopped: the network changed.';
    case 'reset':
      return 'Stopped: the wallet was reset.';
    case 'window':
      return 'Stopped: the wallet window was closed or reloaded.';
    case 'disconnected':
      return 'Stopped: the site’s page changed, closed or reloaded.';
    case 'revoked':
      return 'Stopped: the site’s access was revoked.';
    case 'restarted':
      return 'Stopped: the wallet restarted.';
    case 'update':
      return 'Stopped: the wallet was updated.';
    case 'race-lost':
      // Neutral on purpose: a bare burn of the right loses the race as well as another buyer's lot.
      return view.reorganized
        ? 'Stopped: the lot’s right was used by another transaction first.'
        : 'Stopped: the lot’s right was used by another transaction first. Its payment cost only its network fee.';
    case 'attempt-limit':
      return `Stopped: all ${t.maxAttempts} signatures were used.`;
    case 'spend-limit':
      return 'Stopped: the next lot would exceed your spend limit.';
    case 'fee-limit':
      return `Stopped: the next lot costs more than ${qtc(t.maxFeePerLot)}.`;
    case 'sold-out':
      return 'All lots of this token are minted.';
    case 'failed':
      return 'Stopped: a payment failed on chain for a reason other than a lost race. Its Qlyphs fee and ticket are shown as may still be charged until its history entry is final.';
    case 'anomaly':
      return 'Stopped: a payment was accepted without minting a lot. Check Activity.';
    case 'reorg':
      return 'Stopped: the chain reorganized.';
    case 'account-activity':
      return 'Stopped: another transaction from this account was detected.';
    case 'unverified':
      return 'Stopped: the wallet could not verify the last payment.';
    case 'insufficient-funds':
      return 'Stopped: not enough spendable QTC for the next lot.';
    case 'unavailable':
      return 'Stopped: the network or the witnesses did not answer in time.';
    case 'capacity':
      return 'Stopped: wallet history is full.';
    default:
      return 'Signing stopped.';
  }
}

/** What a reorganization left for history to settle: the counts keep only verified payments. */
function reconciledText(view: MintSessionView) {
  const u = view.attempts.unresolved;
  // A reorg end, and a completed one, already say that the chain reorganized.
  const reason = reasonOf(view);
  const after = reason === 'reorg' || reason === 'completed' ? '' : 'After a reorganization, ';
  const sentence =
    u === 0
      ? `${after}these counts leave out the payments ${after ? 'it' : 'the reorganization'} affected; Activity shows their results.`
      : `${after}the outcome of ${u === 1 ? 'one payment' : `${u} payments`} is being reconciled; these counts leave ${u === 1 ? 'it' : 'them'} out. Check Activity.`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** The full detail line of an ended session, with what is still outstanding. */
export function endText(view: MintSessionView, clock: Clock = defaultTime): string {
  let text = endReasonText(view, clock);
  if (view.pending)
    text += ` A payment already sent can still be included until block ${view.pending.lastBlock}; Stop does not cancel it.`;
  if (view.reorganized) text += ' ' + reconciledText(view);
  return text;
}

/** Verified lots only, so lots that stayed final count as final after a reorganization too. */
function countText(view: MintSessionView) {
  const k = view.lots.included,
    n = view.terms.maxLots,
    j = view.lots.finalized;
  return `${k} of ${n} lots in a block` + (j > 0 ? ` · ${j} final` : '');
}

function titleOf(view: MintSessionView) {
  const p = view.pending;
  if (view.state === 'ended') {
    const reason = reasonOf(view);
    // After a reorganization, some of those lots are in doubt.
    if (reason === 'completed' && !view.reorganized) return `${view.terms.maxLots} lots minted`;
    if (reason === 'sold-out') return 'All lots are minted';
    return 'Signing stopped';
  }
  if (view.state === 'stopping') return 'Stopping…';
  if (view.state === 'paused')
    return p?.status === 'uncertain' ? 'Checking the last payment' : 'Waiting for the network';
  if (p?.status === 'sent' || p?.status === 'uncertain')
    return `Waiting for lot ${p.lot} to be in a block`;
  if (p?.status === 'included') return `Checking lot ${p.lot}`;
  if (p) return `Minting lot ${p.lot}`;
  return view.next !== null ? `Minting lot ${view.next}` : 'Minting…';
}

function runningDetail(view: MintSessionView) {
  if (view.state === 'stopping')
    return 'Signing is stopping. A payment already sent can still be included.';
  if (view.state === 'paused' && view.pending?.status === 'uncertain')
    return 'The network did not confirm it received the last payment. The wallet keeps checking and never sends it twice.';
  if (view.state === 'paused')
    return 'The network or the witnesses did not answer. The wallet retries before it signs again.';
  return 'Keep this window open: closing it stops signing. Stop cannot cancel a payment already sent.';
}

/** Time left as m:ss. */
export function countdown(ms: number) {
  const { m, s } = clockLeft(ms);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function outstandingUntil(lastBlock: number, chain: ChainHeights | null, rate?: number) {
  if (!chain) return `Block ${lastBlock}`;
  const remaining = Math.max(0, lastBlock - chain.head);
  if (rate) return `Block ${lastBlock} · ${formatEta(remaining / rate).replace(/^~/, 'about ')}`;
  return `Block ${lastBlock} · ${remaining} blocks away`;
}

/** Everything the progress screen paints, derived from one view at one instant. */
export function progress(
  view: MintSessionView,
  now: number,
  options: { clock?: Clock; rate?: number } = {},
): Progress {
  const clock = options.clock ?? defaultTime;
  const t = view.terms,
    n = t.maxLots,
    k = view.lots.included;
  const ended = view.state === 'ended';
  // Counts and spend are verified; a payment in doubt is only in the reserve and its own row.
  const rows: Row[] = [
    ['In a block', `${k} of ${n}`],
    ['Final', String(view.lots.finalized)],
    ['Lost races', `${view.attempts.lostRaces} · network fee only`],
  ];
  if (view.attempts.unresolved > 0)
    rows.push([
      'Unresolved',
      `${view.attempts.unresolved} · outcome being reconciled after a reorganization · check Activity`,
    ]);
  rows.push(
    ['Signatures', `${view.attempts.used} of ${t.maxAttempts}`],
    [
      'Protocol spend',
      `${formatUnits(BigInt(view.spent.protocol), 12)} of ${qtc(t.maxSpend)}` +
        (BigInt(view.spent.reserved) > 0n ? ` · ${qtc(view.spent.reserved)} may still be charged` : ''),
    ],
    ['Network fees', `About ${qtc(view.spent.networkEstimate)} · estimate`],
  );
  if (view.pending)
    rows.push([
      'Current payment',
      `Lot ${view.pending.lot} · ${PAYMENT_STATUS[view.pending.status] ?? view.pending.status}`,
    ]);
  if (ended && view.pending)
    rows.push(['Outstanding until', outstandingUntil(view.pending.lastBlock, view.chain, options.rate)]);
  if (view.state === 'running' || view.state === 'paused')
    rows.push(['Signing stops at', `${clock(view.deadline)} · ${countdown(view.deadline - now)} left`]);
  const reason = reasonOf(view);
  let stage: SessionStage;
  if (!ended) stage = k === 0 ? 'sent' : 'included';
  else if (reason === 'completed' && !view.reorganized) stage = 'confirmed';
  else if (k > 0) stage = 'included';
  else stage = reason && ERROR_REASONS.includes(reason) ? 'failed' : 'idle';
  const title = titleOf(view);
  const count = countText(view);
  const phase = ended ? '' : view.state === 'running' ? '' : title;
  return {
    title,
    count,
    detail: ended ? endText(view, clock) : runningDetail(view),
    rows,
    stage,
    ring: stage === 'included' ? Math.round((100 * k) / n) : null,
    stopVisible: !ended,
    stopBusy: view.state === 'stopping',
    doneVisible: ended,
    // "Signing stopped" adds nothing to the reason that follows it. A reorganization found after
    // the end, and each change in what it left in doubt, is a transition too.
    announce: ended
      ? (title === 'Signing stopped'
          ? endReasonText(view, clock)
          : `${title}. ${endReasonText(view, clock)}`) +
        (view.reorganized ? ' ' + reconciledText(view) : '')
      : phase
        ? `${phase.replace(/…$/, '')}. ${count}`
        : count,
    ended,
    included: k,
    hash: view.pending?.hash ?? view.last?.hash ?? null,
  };
}

// ---- Polling ----------------------------------------------------------------------------------

/**
 * A verified lost race that may still leave the chain, which would put it in doubt. The view does
 * not say when a lost race is final, only how many verified lots are: they become final in chain
 * order, and each payment is signed after the previous one is in a block, so a lost race before a
 * final lot is final too.
 */
function openLostRace(view: MintSessionView) {
  let finalLots = view.lots.finalized;
  let open = false;
  for (const p of view.payments) {
    if (p.status === 'lost-race') open = true;
    else if (p.status === 'minted' && finalLots > 0) {
      finalLots--;
      open = false;
    }
  }
  return open;
}

/** Something can still change after the end: a payment in flight, a lot or a lost race not final
 * yet, a charge history has not settled, or a payment in doubt. */
export function outstanding(view: MintSessionView) {
  return (
    view.pending !== null ||
    view.lots.finalized < view.lots.included ||
    view.attempts.unresolved > 0 ||
    BigInt(view.spent.reserved) > 0n ||
    openLostRace(view)
  );
}

/**
 * Delay before the next `session-state` poll, or null to stop polling. Polls keep running while the
 * window is hidden: they are what keeps signing alive, and their absence is what stops it.
 */
export function pollDelay(view: MintSessionView, now: number): number | null {
  if (view.state !== 'ended') return UI_POLL_MS;
  if (!outstanding(view)) return null;
  if (view.endedAt !== null && now - view.endedAt > ENDED_RETENTION_MS) return null;
  return ENDED_POLL_MS;
}

/** How a session action ended: a view, the wallet's refusal, or a dead extension context. */
export type SessionAnswer =
  | { kind: 'view'; view: MintSessionView }
  | { kind: 'error'; error: string }
  | { kind: 'transport' };
/** How one poll ended: an answer, or no answer within UI_CALL_TIMEOUT_MS. */
export type PollOutcome = SessionAnswer | { kind: 'timeout' };

/**
 * The window's next view, its note and whether polling stops. A wallet that forgot the session
 * (or whose context is gone) can no longer be signing for it: the last view is ended locally as a
 * restart, unless it had already ended.
 */
export function afterPoll(
  view: MintSessionView,
  outcome: PollOutcome,
  now: number,
): { view: MintSessionView; note: string | null; stop: boolean } {
  switch (outcome.kind) {
    case 'view':
      return { view: outcome.view, note: '', stop: false };
    case 'timeout':
      return { view, note: NOT_ANSWERING, stop: false };
    case 'transport':
      return { view: endedLocally(view, 'restarted', now), note: '', stop: true };
    case 'error':
      if (outcome.error === NO_SESSION)
        return { view: endedLocally(view, 'restarted', now), note: '', stop: true };
      return { view, note: null, stop: false };
  }
}

/** The window's next step while it waits for the session it approved. */
export type StartStep =
  | { kind: 'show'; view: MintSessionView }
  | { kind: 'wait' }
  | { kind: 'fail'; error: string };

/**
 * What the window does after one `session-state` poll while it waits for the session it approved:
 * show it, keep waiting, or give up. A started session keeps signing only while this window polls
 * it, so the window gives up only on proof that none runs: the approval's refusal or a dead
 * extension context, because the wallet starts a session before it answers its approval and no
 * session outlives its context; or no session for a poll sent once the review expired, because
 * the wallet never starts one after that. Silence proves nothing. `approval` is the approval's
 * answer if it came before the poll was sent.
 */
export function afterStartPoll(
  approval: SessionAnswer | undefined,
  poll: PollOutcome,
  polledAt: number,
  expires: number,
): StartStep {
  if (poll.kind === 'view') return { kind: 'show', view: poll.view };
  if (approval?.kind === 'view') return { kind: 'show', view: approval.view };
  if (approval)
    return { kind: 'fail', error: approval.kind === 'error' ? approval.error : NOT_CONFIRMED };
  const none = poll.kind === 'transport' || (poll.kind === 'error' && poll.error === NO_SESSION);
  return none && polledAt >= expires ? { kind: 'fail', error: NOT_CONFIRMED } : { kind: 'wait' };
}

// ---- Wallet tracker -----------------------------------------------------------------------------

/** The tracker's steps; `idle` lights none, for a session that ended with no lot in a block. */
export type TrackerStage = 'sent' | 'included' | 'idle';

/** The wallet's tracker card while a session runs or its payments are still settling. */
export function trackerText(status: MintSessionStatus, clock: Clock = defaultTime) {
  const title = `Minting ${status.symbol} · ${status.included} of ${status.maxLots} lots`;
  const running = status.state !== 'ended';
  const lots = status.included > 0;
  const detail = status.reorganized
    ? 'Outcome being reconciled after a reorganization · check Activity'
    : running
      ? `Signing stops at ${clock(status.deadline)}`
      : status.outstanding
        ? 'Signing stopped · a payment can still be included'
        : lots
          ? 'Signing stopped · lots becoming final'
          : 'Signing stopped · payments becoming final';
  const stage: TrackerStage = running || (!lots && status.outstanding) ? 'sent' : lots ? 'included' : 'idle';
  return { title, detail, stage };
}
