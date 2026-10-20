/** Mint session ledger and controller: one lot payment at a time, within the approved bounds. */
// Pure: only type imports, apart from the provider's import-free validators, so Node runs this
// module directly. Every network, storage, clock and signing effect goes through `SessionDeps`.
import {
  parseMintSessionSnapshot,
  parseMintSessionTerms,
} from '../../../packages/provider/src/mint-session.ts';
import type {
  MintAttemptStatus,
  MintAttemptView,
  MintSessionEnd,
  MintSessionSnapshot,
  MintSessionState,
  MintSessionTerms,
} from '../../../packages/provider/src/mint-session.ts';
import type { SigningContext } from '../../../packages/native/src/network.ts';
import type { AttestedAsset } from '../../native/web/pq-guard.ts';
import type * as ChainModule from './mint-session-chain.ts';
import type { Account, Block, ChainReads, Payment, Position } from './mint-session-chain.ts';
import type { MintSessionView } from './mint-session-view.ts';

export type { Account, Block, ChainReads, Payment, Position };

/** Mortal era period of every payment: valid in the 255 blocks after its birth block. */
export const ERA_PERIOD = 256;
/**
 * Native charge of one ticket creation (`MultisigFee`), pinned per runtime code hash. Sessions are
 * offered only on a pinned runtime: the service reports this charge, but a strict spend cap cannot
 * rest on a service figure. Development runtime 152: 0.03 QTC. Quantus mainnet runtime 153 (the
 * code hash in deploy/mainnet/pins.json): 0.003 QTC, read from its metadata.
 */
export const TICKET_CHARGE: Readonly<Record<string, bigint>> = Object.freeze({
  '0xe2e37391ee730603d0c66dfbff9dafe9badc5dbc2caa7e151231e590c04ee820': 30_000_000_000n,
  '0x78389c85e3698b7e24cf292907f2eec0657297fd8a4d82669cf357974f15ec56': 3_000_000_000n,
});
/** Network fees are estimates: an unresolved payment holds twice the service's estimate. */
export const NETWORK_FEE_MARGIN = 2;
/** Signing stops this long after the progress window's last poll. */
export const LEASE_MS = 10_000;
/** Longest wait between two checks of the signing authority. */
export const WAIT_SLICE_MS = 1_000;
/** Pause between two inclusion searches for a payment that is not in a block yet. */
export const INCLUSION_POLL_MS = 2_000;
/** Pause after a transient read failure before the pass starts over. */
export const RETRY_MS = 2_000;
/** Approval is refused when less signing time than this is left. */
export const MIN_START_MS = 30_000;
/** No new payment is reserved when less signing time than this is left; inclusions are still
 * classified. */
export const MIN_ATTEMPT_MS = 10_000;
/** Least time between two reservations: a session reserves at most 12 payments a minute. */
export const MIN_ATTEMPT_GAP_MS = 5_000;
/** Attestation calls per controller in any 60 s, before and after the end, which keeps the load a
 * session puts on the attestation service small and steady. */
export const ATTEST_CALLS_PER_MINUTE = 8;
/** Calls one classification may need: its inclusion block and that block's parent. A tip
 * attestation always leaves them free, so a payment in a block never waits for them. */
export const CLASSIFY_CALLS = 2;
/** Longest wait for a tip attestation once a payment is in a block. When the budget needs longer,
 * the payment is classified from its own block first. */
export const TIP_WAIT_MS = 5_000;
/** Consecutive failed passes after which the session ends `unavailable`. */
export const TRANSIENT_FAILURES = 5;
/** A block is attested only while it is at most this far below the best block the wallet saw last:
 * the witnesses attest blocks at most 32 below their best. */
export const WITNESS_WINDOW = 30;
/** Session records kept in the wallet; settled ones are dropped first. */
export const MAX_SESSION_RECORDS = 8;
/** Least time between two finality checks of recorded inclusions. */
export const FINALITY_REFRESH_MS = 10_000;
/** An ended controller and its settle task live at most this long. */
export const ENDED_RETENTION_MS = 1_800_000;
/** An update waits this long for running sessions to end before it reloads the wallet. */
export const UPDATE_SETTLE_MS = 10_000;
/** Adding or deriving an account waits this long for a stopped session to end. */
export const ACCOUNT_STOP_MS = 5_000;

const ROLLING_MINUTE = 60_000;
const END_WRITE_RETRY_MS = 500;
const MINT_PROFILE = 'progressive-1000-v2';
const LOTS = 1000;
const MAX_U128 = (1n << 128n) - 1n;
const HASH = /^0x[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** The service's intent id, as `prepare` in network.ts accepts it. */
const INTENT = /^[0-9a-f-]{36}$/;
const DECIMAL = /^(?:0|[1-9][0-9]{0,38})$/;

/** Why the wallet ended a session. Dapps only see the coarser `toSnapshotEnd` of it. */
export type WalletEndReason =
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

export type AttemptStatus =
  /** Counted and reserved; no signature exists. */
  | 'reserved'
  /** Hash and history entry saved; the signed bytes were not released. */
  | 'signed'
  /** History says broadcast-uncertain: released, or about to be. */
  | 'uncertain'
  /** The service acknowledged the submission. */
  | 'sent'
  /** The wallet's node shows it in a block; the outcome is not classified yet. */
  | 'included'
  | 'minted'
  | 'lost-race'
  | 'failed'
  | 'anomaly'
  /** Never released. */
  | 'cancelled'
  /** Never included: birth block left the finalized chain, era ended, or nonce used by another
   * transaction. */
  | 'dead'
  | 'expired'
  | 'replaced'
  /** Ended record only: history finalized the payment before the wallet classified it. */
  | 'settled';

/** One signature the session may produce, with every fact its checks and its display need. */
export interface MintAttempt {
  /** 1-based position in the session. */
  n: number;
  status: AttemptStatus;
  /** Lot number from attested state at the birth block. */
  lot: number;
  /** Attested Qlyphs fee of that lot, QTC base units. */
  fee: string;
  /** The right the payment uses: where it was created. */
  anchor: Position;
  /** The right's native marker. */
  ticket: { signers: [string, string]; nonce: string };
  /** Attested minted amount at birth. */
  minted: string;
  /** The owner's attested token balance at birth. */
  held: string;
  /** Attested block the payment's era is born at. */
  birth: Block;
  nonce: number;
  intentId: string;
  /** The service's network fee estimate at birth. */
  networkFee: string;
  /** Worst case held until the payment resolves. */
  reserve: { network: string; protocol: string };
  hash: string | null;
  /** Where the wallet's node shows the payment: a candidate that every verdict proves again from a
   * block both witnesses attested (`ChainProofs.proveInclusion`). */
  inclusion: Position | null;
  /** The inclusion block is final on the wallet's node. */
  finalized: boolean;
  /**
   * Set once a reorganization or the wallet's history contradicts what the session recorded for
   * this payment, and never cleared. `status` keeps the verdict that admitted the next signature;
   * the outcome now comes from history, so the payment leaves the verified counts and its worst
   * case stays reserved until its history entry is final.
   */
  doubt: boolean;
}

export interface MintSessionRecord {
  id: string;
  origin: string;
  owner: string;
  genesis: string;
  terms: MintSessionTerms;
  /** Digest of the approved review. */
  digest: string;
  /** Runtime code hash at approval. */
  runtime: string;
  /** Native ticket charge pinned for that runtime, QTC base units. */
  ticket: string;
  margin: number;
  symbol: string;
  decimals: number;
  approvedAt: number;
  /** Signing deadline, fixed at approval: the approved duration clamped by the unlock deadline. */
  deadline: number;
  /** Pausing and stopping exist only in memory. */
  state: 'running' | 'ended';
  reason: WalletEndReason | null;
  endedAt: number | null;
  /** Signatures reserved so far; never decreases. */
  used: number;
  /** Some attempt is in doubt (`MintAttempt.doubt`): a recorded inclusion left the chain, or
   * history finalized a payment otherwise than the record says. */
  reorganized: boolean;
  attempts: MintAttempt[];
}

/** The history entry a signed attempt adds: the wallet's generic transaction record plus the
 * session and lot it belongs to. */
export interface JournalEntry {
  hash: string;
  owner: string;
  genesis: string;
  nonce: number;
  intentId: string;
  createdAt: number;
  label: string;
  status: string;
  validUntil: number;
  session: string;
  lot: number;
  amount: string;
  symbol: string;
  decimals: number;
}
/** What the ledger rules read from any history entry. */
export interface JournalLine {
  hash: string;
  owner: string;
  genesis: string;
  nonce: number;
  status: string;
  session?: string;
  /** What history reports once it found the payment in a block: that block's height, whether the
   * extrinsic succeeded natively, and the protocol's verdict on it. */
  height?: number;
  nativeSuccess?: boolean | null;
  verdict?: string | null;
}

/** A prepared lot payment. `review` is the network module's review, returned to `recheck`. */
export interface Quote {
  review: unknown;
  intentId: string;
  callHex: string;
  context: SigningContext;
  expiresAt: number;
  networkFee: bigint;
  nativeFee: bigint;
  platformFee: bigint;
  existentialDeposit: bigint;
}
/** What the signed bytes say, decoded by the wallet. */
export interface SignedFacts {
  scheme: string;
  accountId: string;
  callHex: string;
  nonce: number;
  tip: bigint;
  eraHex: string;
  hash: string;
}
export type Sign = (callHex: string, context: SigningContext) => Uint8Array;
/** The chain proofs of mint-session-chain.ts, passed in so that this module stays pure. */
export type ChainProofs = Pick<
  typeof ChainModule,
  'onAncestry' | 'proveLineage' | 'findInclusion' | 'locatePayment' | 'proveInclusion'
>;

/**
 * Everything the controller does outside memory. Reads take the session's stop signal; the
 * controller also races them against it, so a stop never waits for a slow node.
 */
export interface SessionDeps {
  now(): number;
  /** Resolves after `ms`, or early once `signal` fires; never rejects. It must really wait. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  /** Null while signing authority holds; otherwise why it ended (lock, account, window...). */
  authority(): WalletEndReason | null;
  /** The wallet node's reads for the owner (`chainReads(owner)`). */
  chain: ChainReads;
  proofs: ChainProofs;
  /** Both witnesses' view of the asset at the node's best block. */
  attestTip(signal: AbortSignal): Promise<AttestedAsset>;
  /** Both witnesses' view of the asset at exactly `block`. */
  attestAt(block: Block, signal: AbortSignal): Promise<AttestedAsset>;
  prepare(view: AttestedAsset): Promise<Quote>;
  recheck(quote: Quote): Promise<void>;
  unlockSigner(): Promise<Sign>;
  inspect(bytes: Uint8Array): SignedFacts;
  /** Era bytes of a payment born at `height`. */
  era(height: number): string;
  /** Exactly one transport call; never raced or retried. */
  submit(
    intentId: string,
    hash: string,
    bytes: Uint8Array,
  ): Promise<'submitted' | 'broadcast-uncertain'>;
  journalFull(): boolean;
  journalAdd(entry: JournalEntry): void;
  journalStatus(hash: string, status: string): void;
  /** The history entry is finalized, expired or cancelled-before-broadcast. */
  journalFinal(hash: string): boolean;
  /** The history entry is final and says the payment never ran: expired or
   * cancelled-before-broadcast. */
  journalNeverRan(hash: string): boolean;
  /** Saves the whole wallet, ledger and history together. */
  persist(): Promise<void>;
  /** The session's snapshot may have changed. */
  changed(): void;
}

/** A classification verdict; `unverified` leaves the attempt included. */
export type Outcome = 'minted' | 'lost-race' | 'failed' | 'anomaly' | 'unverified';
/** What a classification gives when the witnesses no longer attest a block its verdict needs. */
const OUT_OF_REACH = 'out-of-reach';
/** The text of `UNPROVEN` in proof/inclusion.ts: node data that failed a proof. */
const UNPROVEN = 'Block data does not match the attested chain';
const unproven = (error: unknown): boolean => error instanceof Error && error.message === UNPROVEN;

const UNRESOLVED: readonly AttemptStatus[] = [
  'reserved',
  'signed',
  'uncertain',
  'sent',
  'included',
];
/** Fates only the wallet's node vouched for: still charged at worst until history settles them. */
const NODE_VERDICTS: readonly AttemptStatus[] = ['failed', 'dead', 'expired', 'replaced'];
const WITH_INCLUSION: readonly AttemptStatus[] = [
  'included',
  'minted',
  'lost-race',
  'failed',
  'anomaly',
];
const FINAL_JOURNAL: readonly string[] = ['finalized', 'expired', 'cancelled-before-broadcast'];
/** Final history statuses of a payment that never ran: no block of the finalized chain holds it. */
export const NEVER_RAN_JOURNAL: readonly string[] = ['expired', 'cancelled-before-broadcast'];
/** Statuses that say the payment never ran: never released, or a fate the node reported. */
const NEVER_RAN: readonly AttemptStatus[] = ['cancelled', 'dead', 'expired', 'replaced'];
/** A settle task needs the network and the wallet it was started in. */
const NO_SETTLE: readonly WalletEndReason[] = ['reset', 'network', 'update', 'restarted'];
const STATUSES: readonly AttemptStatus[] = [
  ...UNRESOLVED,
  'minted',
  'lost-race',
  'failed',
  'anomaly',
  'cancelled',
  'dead',
  'expired',
  'replaced',
  'settled',
];
const REASONS: readonly WalletEndReason[] = [
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

export const isUnresolved = (a: MintAttempt): boolean => UNRESOLVED.includes(a.status);
const lastOf = <T>(list: readonly T[]): T | undefined => list[list.length - 1];
const count = (rec: MintSessionRecord, status: AttemptStatus): number =>
  rec.attempts.filter((a) => a.status === status).length;
/** Each signature beyond `maxLots` is a retry after a lost race: once lost races outnumber them,
 * the session ends `race-lost`. Read from the verdicts that admitted signatures, never from doubt. */
const racesExhausted = (rec: MintSessionRecord): boolean =>
  count(rec, 'lost-race') > rec.terms.maxAttempts - rec.terms.maxLots;
/** Bytes that may have left the wallet: only such a payment can have run on some chain. */
const mayHaveRun = (a: MintAttempt): boolean =>
  a.hash !== null && a.status !== 'reserved' && a.status !== 'signed' && a.status !== 'cancelled';
/** Puts `from` in doubt, and every later payment that may have run: each was born on a block
 * descending from `from`'s recorded inclusion, so what the session recorded for it is in doubt too. */
function doubtFrom(rec: MintSessionRecord, from: MintAttempt): void {
  for (const a of rec.attempts) if (a === from || (a.n > from.n && mayHaveRun(a))) a.doubt = true;
  rec.reorganized = true;
}
/** A recorded inclusion left the tip's chain: every inclusion not final yet is in doubt. Which one
 * left is not known, only that the chain the session recorded is no longer the tip's. */
function doubtOpen(rec: MintSessionRecord): void {
  for (const a of rec.attempts)
    if (a.inclusion !== null && !a.finalized) {
      a.doubt = true;
      rec.reorganized = true;
    }
}
const samePlace = (a: Position | null, b: Position | null): boolean =>
  a !== null && b !== null && a.height === b.height && a.hash === b.hash && a.index === b.index;
const hexOf = (bytes: Uint8Array): string =>
  '0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const payment = (a: MintAttempt): Payment => ({
  hash: a.hash!,
  nonce: a.nonce,
  birth: { height: a.birth.height, hash: a.birth.hash },
});
const inclusions = (rec: MintSessionRecord): Block[] =>
  rec.attempts.flatMap((a) =>
    a.inclusion ? [{ height: a.inclusion.height, hash: a.inclusion.hash }] : [],
  );
/** A position the node names for `a` lies in its era window; anything else is not recorded. */
const inWindow = (a: MintAttempt, at: Position): boolean =>
  Number.isSafeInteger(at.height) &&
  at.height > a.birth.height &&
  at.height <= a.birth.height + ERA_PERIOD - 1 &&
  HASH.test(at.hash) &&
  Number.isSafeInteger(at.index) &&
  at.index >= 0;

/** The pinned native ticket charge of a runtime, or null when sessions cannot run on it. */
export function ticketCharge(runtime: string): bigint | null {
  return Object.hasOwn(TICKET_CHARGE, runtime) ? TICKET_CHARGE[runtime]! : null;
}

/** Sessions run only with compiled witness pins and a pinned ticket charge, on either network.
 * The mainnet activation of progressive mints is the caller's check, as for a single lot. */
export const sessionsAvailable = (pq: boolean, codeHash: string): boolean =>
  pq && ticketCharge(codeHash) !== null;

/** Systems `runtime.getPlatformInfo()` names where extension sessions were tested: desktop
 * Windows, macOS and Linux. Android (Firefox for Android), ChromeOS and anything else are refused,
 * as Qlyphs Keys refuses them. */
const SESSION_SYSTEMS: readonly string[] = ['win', 'mac', 'linux'];
export const sessionPlatform = (os: unknown): boolean =>
  typeof os === 'string' && SESSION_SYSTEMS.includes(os);

/** The public end value: never names the wallet window or which context changed. */
export function toSnapshotEnd(reason: WalletEndReason): MintSessionEnd {
  switch (reason) {
    case 'window':
      return 'stopped';
    case 'account':
    case 'network':
    case 'reset':
    case 'revoked':
    case 'restarted':
    case 'update':
    case 'disconnected':
      return 'context-changed';
    case 'anomaly':
    case 'reorg':
    case 'account-activity':
      return 'unverified';
    case 'capacity':
      return 'unavailable';
    default:
      return reason;
  }
}

// ---- Spend accounting ---------------------------------------------------------------------------

const charge = (rec: MintSessionRecord, a: MintAttempt): bigint =>
  BigInt(a.fee) + BigInt(rec.ticket);

/** Qlyphs fees and native tickets of the payments classified as debited: verified lots, and the
 * impossible "right used without a lot". A payment in doubt is not verified. */
export function protocolSpent(rec: MintSessionRecord): bigint {
  return rec.attempts
    .filter((a) => !a.doubt && (a.status === 'minted' || a.status === 'anomaly'))
    .reduce((sum, a) => sum + charge(rec, a), 0n);
}

/**
 * The admission bound: the `count(minted)` largest charges among the payments that could have
 * succeeded. On any chain the counted successes are among them, whichever the node said
 * succeeded, so the spend cap holds without trusting the node.
 */
export function protocolBound(rec: MintSessionRecord): bigint {
  const charges = rec.attempts
    .filter((a) => a.status === 'minted' || a.status === 'lost-race')
    .map((a) => charge(rec, a))
    .sort((x, y) => (x < y ? 1 : x > y ? -1 : 0));
  return charges.slice(0, count(rec, 'minted')).reduce((sum, c) => sum + c, 0n);
}

/** A payment that may still be charged: unresolved, resolved only on the node's word, or in doubt,
 * and not final in history. */
export function mayCharge(a: MintAttempt, final: (hash: string) => boolean): boolean {
  return (
    a.hash !== null &&
    (UNRESOLVED.includes(a.status) || NODE_VERDICTS.includes(a.status) || a.doubt) &&
    !final(a.hash)
  );
}

/** The worst case of every payment that may still be charged. The snapshot clamps the part of
 * the payments in doubt (`sessionSnapshot`). */
export function protocolReserved(rec: MintSessionRecord, final: (hash: string) => boolean): bigint {
  return rec.attempts
    .filter((a) => mayCharge(a, final))
    .reduce((sum, a) => sum + BigInt(a.reserve.protocol), 0n);
}

/** Statuses whose network fee the ledger counts at its estimate: the node placed them in a block. */
const IN_BLOCK: readonly AttemptStatus[] = [...WITH_INCLUSION, 'settled'];
/** Statuses whose network fee the ledger counts at its reserve: they may still land. */
const IN_FLIGHT: readonly AttemptStatus[] = ['uncertain', 'sent', 'replaced'];

/**
 * Network fees: only payments that may have been charged count. History's final word comes first:
 * a payment it finalized as never run cost nothing, one that ran costs its estimate, even when the
 * ledger's verdict is in doubt. Otherwise the ledger decides: the estimate of every payment in a
 * block, and the reserve of every payment that may still be. An estimate, never a cap.
 */
export function networkEstimate(
  rec: MintSessionRecord,
  final: (hash: string) => boolean,
  neverRan: (hash: string) => boolean,
): bigint {
  let sum = 0n;
  for (const a of rec.attempts) {
    if (a.hash !== null && final(a.hash)) sum += neverRan(a.hash) ? 0n : BigInt(a.networkFee);
    else if (IN_BLOCK.includes(a.status)) sum += BigInt(a.networkFee);
    else if (IN_FLIGHT.includes(a.status)) sum += BigInt(a.reserve.network);
  }
  return sum;
}

// ---- Snapshot -----------------------------------------------------------------------------------

/** A payment in doubt shows `unresolved` until history settles it; the wallet never shows the
 * verdict it doubts. */
function publicStatus(a: MintAttempt, final: (hash: string) => boolean): MintAttemptStatus {
  if (a.doubt) return a.hash !== null && final(a.hash) ? 'settled' : 'unresolved';
  return a.status === 'anomaly' ? 'failed' : (a.status as MintAttemptStatus);
}

/** The public view of an attempt; null before it has a hash. */
export function attemptView(
  a: MintAttempt,
  final: (hash: string) => boolean,
): MintAttemptView | null {
  if (a.hash === null) return null;
  return {
    hash: a.hash,
    lot: a.lot,
    status: publicStatus(a, final),
    lastBlock: a.birth.height + ERA_PERIOD - 1,
  };
}

/**
 * The dapp's view of a record. `state` adds the in-memory pause and stop of a running session.
 * `neverRan` says which final history entries are payments that never ran; without it, every
 * final payment counts as charged in the network estimate.
 */
export function sessionSnapshot(
  rec: MintSessionRecord,
  final: (hash: string) => boolean,
  state: MintSessionState = 'running',
  neverRan: (hash: string) => boolean = () => false,
): MintSessionSnapshot {
  const ended = rec.state === 'ended';
  const verified = rec.attempts.filter((a) => !a.doubt);
  const minted = verified.filter((a) => a.status === 'minted');
  // The payment the session still follows; one in doubt is left to history.
  const pending = verified.find(
    (a) => a.hash !== null && ['signed', 'uncertain', 'sent', 'included'].includes(a.status),
  );
  const last = [...rec.attempts]
    .reverse()
    .find((a) => a.hash !== null && (a.doubt || !UNRESOLVED.includes(a.status)));
  const protocol = protocolSpent(rec);
  const bounded = protocolReserved({ ...rec, attempts: verified }, final);
  const doubted = protocolReserved(rec, final) - bounded;
  // Lemma S: no chain debits the session more than maxSpend, so the payments in doubt never need
  // more than the cap leaves. Only their part is clamped: the rest is what admission bounded.
  const room = BigInt(rec.terms.maxSpend) - protocol - bounded;
  const reserved = bounded + (room < 0n ? 0n : doubted < room ? doubted : room);
  return {
    id: rec.id,
    owner: rec.owner,
    genesis: rec.genesis,
    terms: { ...rec.terms },
    state: ended ? 'ended' : state === 'ended' ? 'running' : state,
    end: ended ? toSnapshotEnd(rec.reason!) : null,
    lots: {
      included: minted.length,
      finalized: minted.filter((a) => a.finalized).length,
    },
    attempts: {
      used: rec.used,
      lostRaces: verified.filter((a) => a.status === 'lost-race').length,
      unresolved: rec.attempts.filter((a) => a.doubt && a.hash !== null && !final(a.hash)).length,
    },
    spent: {
      protocol: String(protocol),
      reserved: String(reserved),
      networkEstimate: String(networkEstimate(rec, final, neverRan)),
    },
    reorganized: rec.reorganized,
    pending: pending ? attemptView(pending, final) : null,
    last: last ? attemptView(last, final) : null,
  };
}

// ---- Classification -----------------------------------------------------------------------------

/** Success judged at the next birth block: the right still sits at the payment's position, one lot
 * minted and credited since birth. Null when that block does not decide (another buyer may have
 * used the next right since). The caller proved the position on that block's chain first. */
export function classifyAt(p: MintAttempt, v: AttestedAsset, lotSize: bigint): 'minted' | null {
  const L = lotSize;
  return samePlace(v.right, p.inclusion) &&
    v.minted === BigInt(p.minted) + L &&
    v.held === BigInt(p.held) + L
    ? 'minted'
    : null;
}

/** What `classifyExact` returns when the verdict needs the attested parent of the inclusion. */
export const NEEDS_PARENT = 'parent';

/**
 * The outcome from attested state at exactly the inclusion block `x` (and its parent `y` when
 * asked for). The caller proved the payment's position first (`MintSessionController.classify`).
 * Every verdict must also match the owner's attested balance: one lot for a success, none for a
 * lost race or a failure; anything the balances cannot explain is `unverified`. The last lot
 * leaves no right to place its use at our position, so it is never `minted`.
 */
export function classifyExact(
  p: MintAttempt,
  x: AttestedAsset,
  lotSize: bigint,
  y?: AttestedAsset,
): Outcome | typeof NEEDS_PARENT {
  const L = lotSize;
  const pos = p.inclusion;
  if (pos === null) return 'unverified';
  const d = x.held - BigInt(p.held);
  const minted = BigInt(p.minted);
  // A balance change the session cannot explain.
  if (d !== 0n && d !== L) return 'unverified';
  const right = x.right;
  // The right was last used by the extrinsic at our position.
  if (samePlace(right, pos)) {
    if (d === L && x.minted === minted + L) return 'minted';
    // Our payment used the right without minting: the case the settlement excludes.
    if (d === 0n && x.minted === minted) return 'anomaly';
    return 'unverified';
  }
  if (right === null) {
    if (x.minted !== x.cap) return 'unverified';
    // Sold out, and the owner holds one lot more: our last lot, or another buyer's next to an
    // unrelated transfer to the owner. No attested block tells them apart, X's parent included,
    // and the node's word on whose use it was is no evidence.
    if (d === L) return 'unverified';
    // One right use per asset per block: had our right been current when X started, the token
    // could not be sold out by its end. So it was used before X.
    if (p.lot < LOTS) return 'lost-race';
    if (!y) return NEEDS_PARENT;
    if (y.right === null) return 'lost-race';
    return p.birth.height < y.right.height && y.right.height < pos.height
      ? 'lost-race'
      : 'unverified';
  }
  if (right.height === pos.height && right.hash === pos.hash) {
    if (d !== 0n) return 'unverified';
    // Whatever right was current when X started was used before our extrinsic.
    if (right.index < pos.index) return 'lost-race';
    // A right was used in X after our extrinsic: was ours current when X started?
    if (!y) return NEEDS_PARENT;
    if (samePlace(y.right, p.anchor)) return 'failed';
    return y.right !== null && p.birth.height < y.right.height && y.right.height < pos.height
      ? 'lost-race'
      : 'unverified';
  }
  // Our right was never used: the payment failed for another reason.
  if (samePlace(right, p.anchor)) return d === 0n ? 'failed' : 'unverified';
  // Our right was used strictly between our birth block and X.
  if (p.birth.height < right.height && right.height < pos.height)
    return d === 0n ? 'lost-race' : 'unverified';
  // An anchor at or below birth other than ours contradicts the birth attestation; one above X
  // contradicts the inclusion.
  return 'unverified';
}

// ---- Read failures ------------------------------------------------------------------------------

/** Refusals that retrying cannot cure: node data that failed a proof, the runtime, network or
 * protocol changed, or the service's answer does not match what the wallet derived. Exact texts of
 * proof/inclusion.ts, network.ts, profile.ts and packages/native/src/balance.ts. */
const UNVERIFIED_ERRORS: readonly string[] = [
  UNPROVEN,
  'Unsupported runtime; signing disabled',
  'Mainnet is disabled',
  'This wallet only works on Quantus mainnet',
  'Incorrect network or protocol activation',
  'Wallet and indexer run different protocol versions. Reload the extension, or restart the indexer.',
  'Network configuration changed; reconnect explicitly',
  'Service asked for an incorrect Qlyphs fee; signing refused',
  'Prepared call differs from requested action',
  'Prepared at another block than the attested one',
  'Invalid cost estimate or unexpected platform fee',
  'Unexpected signing context',
];
const FUNDS_ERRORS: readonly string[] = [
  'Insufficient spendable QTC. Leave enough for the Qlyphs fee, network fee and minimum account balance.',
  'Part of your balance is still being confirmed. You can send it once it is final.',
];

/** The end reason of a failed read that retrying cannot cure, or null for a transient failure. */
export function terminalReason(error: unknown): WalletEndReason | null {
  const message = error instanceof Error ? error.message : '';
  if (UNVERIFIED_ERRORS.includes(message)) return 'unverified';
  if (FUNDS_ERRORS.includes(message)) return 'insufficient-funds';
  return null;
}

/** Races `p` against `signal`, without leaving a listener behind. */
function untilAborted<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    p.catch(() => undefined);
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    p.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}
function invoke<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return Promise.resolve(fn());
  } catch (error) {
    return Promise.reject(error);
  }
}

/** The prepared payment is exactly the attested lot's settlement, at its attested fee, signed with
 * an era born at B. `prepare` checks the same against its own build of the call; checking it here
 * keeps the one-lot rule (I1) within this module. */
export function quoteMatches(
  quote: Quote,
  next: NonNullable<AttestedAsset['next']>,
  B: Block,
  genesis: string,
): boolean {
  const c = quote.context;
  return (
    quote.callHex === hexOf(next.call) &&
    quote.platformFee === next.fee &&
    c.genesisHash === genesis &&
    c.blockNumber === B.height &&
    c.blockHash === B.hash &&
    c.period === ERA_PERIOD &&
    c.tip === '0' &&
    Number.isSafeInteger(c.nonce) &&
    c.nonce >= 0 &&
    c.nonce <= 0xffffffff &&
    INTENT.test(quote.intentId) &&
    quote.networkFee >= 0n &&
    quote.existentialDeposit >= 0n
  );
}

/** Unwinds a pass with the reason the session ends. */
class Exit {
  readonly reason: WalletEndReason;
  constructor(reason: WalletEndReason) {
    this.reason = reason;
  }
}
/** Unwinds a pass after a transient failure; the next pass starts over. */
class Retry {}

type Reader = <T>(fn: (signal: AbortSignal) => Promise<T>) => Promise<T>;

// ---- Controller ---------------------------------------------------------------------------------

/**
 * Runs one approved session: reserves, signs and releases one lot payment at a time, waits for it
 * in a block, classifies it from attested state, and stops at the first limit, doubt or loss of
 * authority. `run()` never rejects and always ends the record. After the end, a read-only settle
 * task keeps classifying the last payment and following finality.
 */
export class MintSessionController {
  readonly record: MintSessionRecord;
  /** The settle task, once `run()` ended the session (absent after reset, network, update). */
  settling: Promise<void> | null = null;
  private readonly deps: SessionDeps;
  private readonly unlockDeadline: number;
  private readonly stopper = new AbortController();
  private readonly settleStopper = new AbortController();
  private stopWith: WalletEndReason | null = null;
  private started: Promise<WalletEndReason> | null = null;
  private paused = false;
  private failures = 0;
  /** Attempts whose bytes went to `submit`. */
  private readonly released = new Set<number>();
  private attestations: number[] = [];
  private reservedAt = Number.NEGATIVE_INFINITY;
  private finalityAt = Number.NEGATIVE_INFINITY;
  private head: number | null = null;
  private finalized: number | null = null;
  private seenAt = 0;
  private nextLot: number | null = null;
  /** An attested view showed no next lot: every lot of the token is minted. */
  private soldOut = false;
  /** An inclusion classified `unverified`: the same attested blocks would give the same verdict. */
  private unverifiedAt: Position | null = null;
  /** Node data failed a proof: nothing the node shows later is classified. */
  private proofFailed = false;
  private wake: AbortController | null = null;
  private roundAt = Number.NEGATIVE_INFINITY;

  constructor(record: MintSessionRecord, deps: SessionDeps, options: { unlockDeadline: number }) {
    // A session never resumes: a controller only starts on the record its approval just wrote.
    if (record.state !== 'running' || record.used !== 0 || record.attempts.length !== 0)
      throw new Error('A mint session controller starts only on a new session');
    this.record = record;
    this.deps = deps;
    this.unlockDeadline = options.unlockDeadline;
  }

  /** Fires with the first stop; every read of the loop takes it. */
  get signal(): AbortSignal {
    return this.stopper.signal;
  }
  get stopReason(): WalletEndReason | null {
    return this.stopWith;
  }

  /** Ends signing at the next check, or at once while the loop waits or reads. The first reason
   * wins. Payments already released are not affected. */
  stop(reason: WalletEndReason): void {
    if (this.stopWith !== null) return;
    this.stopWith = reason;
    this.stopper.abort();
    // Callers are revocation hooks; tell observers outside their handler.
    queueMicrotask(() => this.notify());
  }

  state(): MintSessionState {
    if (this.record.state === 'ended') return 'ended';
    if (this.stopWith !== null) return 'stopping';
    return this.paused ? 'paused' : 'running';
  }

  snapshot(): MintSessionSnapshot {
    return sessionSnapshot(
      this.record,
      (h) => this.deps.journalFinal(h),
      this.state(),
      (h) => this.deps.journalNeverRan(h),
    );
  }

  /** The wallet window's view: the snapshot plus wallet-only facts. No network call. */
  view(): MintSessionView {
    const rec = this.record;
    const final = (h: string) => this.deps.journalFinal(h);
    const outstanding = [...rec.attempts]
      .reverse()
      .find((a) => a.hash !== null && ['uncertain', 'sent', 'included'].includes(a.status));
    return {
      ...this.snapshot(),
      reason: rec.reason,
      endedAt: rec.endedAt,
      deadline: rec.deadline,
      unlockDeadline: this.unlockDeadline,
      now: this.deps.now(),
      next: this.nextLot,
      payments: rec.attempts
        .map((a) => attemptView(a, final))
        .filter((v): v is MintAttemptView => v !== null),
      horizon: outstanding ? outstanding.birth.height + ERA_PERIOD - 1 : null,
      chain:
        this.head !== null && this.finalized !== null
          ? { head: this.head, finalized: this.finalized, at: this.seenAt }
          : null,
    };
  }

  /** Runs the session to its end once; later calls return the same promise. Never rejects. */
  run(): Promise<WalletEndReason> {
    this.started ??= this.execute();
    return this.started;
  }

  /** Ends the settle task (wallet reset, network switch, update, history resolution). */
  abortSettle(): void {
    this.settleStopper.abort();
  }

  /** Lets a waiting settle task run its next round now, at most once per poll period. */
  nudge(): void {
    if (this.deps.now() - this.roundAt >= INCLUSION_POLL_MS) this.wake?.abort();
  }

  private async execute(): Promise<WalletEndReason> {
    let reason: WalletEndReason;
    try {
      reason = await this.loop();
    } catch {
      reason = 'unavailable';
    }
    await this.end(reason);
    return reason;
  }

  private notify(): void {
    try {
      this.deps.changed();
    } catch {
      // Observers never decide anything here.
    }
  }

  private setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.notify();
  }

  private deadlineReason(): WalletEndReason {
    // The deadline equals the unlock deadline when the unlock bound it.
    return this.record.deadline >= this.unlockDeadline ? 'locked' : 'deadline';
  }

  /** Why signing must stop, or null. A reason found here becomes the stop: the first one wins. */
  private authority(): WalletEndReason | null {
    if (this.stopWith === null) {
      let lost: WalletEndReason | null;
      try {
        lost = this.deps.authority();
      } catch {
        lost = 'unavailable';
      }
      if (lost === null && this.deps.now() >= this.record.deadline) lost = this.deadlineReason();
      if (lost !== null) this.stop(lost);
    }
    return this.stopWith;
  }

  /** Waits `ms` in slices, checking authority after each; returns the reason if it ended. */
  private async idle(ms: number): Promise<WalletEndReason | null> {
    for (let left = ms; left > 0; left -= WAIT_SLICE_MS) {
      await this.deps.sleep(Math.min(WAIT_SLICE_MS, left), this.stopper.signal);
      const lost = this.authority();
      if (lost) return lost;
    }
    return this.authority();
  }

  private async idleOrExit(ms: number): Promise<void> {
    const lost = await this.idle(ms);
    if (lost) throw new Exit(lost);
  }

  /** Checks authority every slice while a read is pending: a lease or deadline that passes during
   * a hanging read stops the session within one slice. */
  private async watch(signal: AbortSignal): Promise<void> {
    try {
      while (!signal.aborted) {
        await this.deps.sleep(WAIT_SLICE_MS, signal);
        if (!signal.aborted) this.authority();
      }
    } catch {
      // The read still settles on its own or on the stop.
    }
  }

  /** One wallet read of the loop: raced against the stop, classified when it fails. */
  private async read<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const lost = this.authority();
    if (lost) throw new Exit(lost);
    const signal = this.stopper.signal;
    const watching = new AbortController();
    void this.watch(watching.signal);
    let value: T;
    try {
      value = await untilAborted(
        invoke(() => fn(signal)),
        signal,
      );
    } catch (error) {
      if (signal.aborted) throw new Exit(this.stopWith ?? 'unavailable');
      if (unproven(error)) this.proofFailed = true;
      const terminal = terminalReason(error);
      if (terminal) throw new Exit(terminal);
      return this.transient();
    } finally {
      watching.abort();
    }
    if (signal.aborted) throw new Exit(this.stopWith ?? 'unavailable');
    return value;
  }

  /** A failed pass. Counted per pass, not per read: a pass that fails at a late read after
   * successful early ones must still use up the budget. */
  private transient(): never {
    this.failures += 1;
    if (this.failures >= TRANSIENT_FAILURES) throw new Exit('unavailable');
    throw new Retry();
  }

  /** Attestation calls the rolling budget allows now. */
  private free(): number {
    const now = this.deps.now();
    this.attestations = this.attestations.filter((t) => now - t < ROLLING_MINUTE);
    return ATTEST_CALLS_PER_MINUTE - this.attestations.length;
  }

  /** How long until the budget allows `n` calls at once. */
  private until(n: number): number {
    const free = this.free();
    return free >= n ? 0 : this.attestations[n - free - 1]! + ROLLING_MINUTE - this.deps.now();
  }

  /** Waits until the budget allows one more call with `keep` calls still free after it, paused
   * meanwhile while the session runs. Returns whether it had to wait. */
  private async room(
    wait: (ms: number) => Promise<void>,
    running: boolean,
    keep: number,
  ): Promise<boolean> {
    let waited = false;
    while (this.free() < 1 + keep) {
      if (running) this.setPaused(true);
      waited = true;
      await wait(Math.min(WAIT_SLICE_MS, this.attestations[0]! + ROLLING_MINUTE - this.deps.now()));
    }
    if (running) this.setPaused(false);
    return waited;
  }

  /** P4: the witnesses' view at the node's best block. It never takes the calls a classification
   * may need: those of the payment this pass classifies, or of the one it may sign. */
  private async attestTip(): Promise<AttestedAsset> {
    await this.room((ms) => this.idleOrExit(ms), true, CLASSIFY_CALLS);
    this.attestations.push(this.deps.now());
    return this.read((s) => this.deps.attestTip(s));
  }

  /** Whether the witnesses still attest `b`, measured from the best block the wallet saw last. */
  private reachable(b: Block): boolean {
    return this.head === null || b.height >= this.head - WITNESS_WINDOW;
  }

  /**
   * The witnesses' view at exactly `block`, for a classification: it may use every call left, and
   * is never asked once the witnesses would refuse a block that deep, which gives null. After a
   * wait for the budget the depth is measured again from the node's best block.
   */
  private async attestExact(
    block: Block,
    wait: (ms: number) => Promise<void>,
    running: boolean,
    read: Reader,
  ): Promise<AttestedAsset | null> {
    if (!this.reachable(block)) return null;
    if (await this.room(wait, running, 0)) {
      const t = await read((s) => this.deps.chain.tip(s));
      this.sawHead(t.height);
      if (!this.reachable(block)) return null;
    }
    this.attestations.push(this.deps.now());
    return read((s) => this.deps.attestAt(block, s));
  }

  /** At least MIN_ATTEMPT_GAP_MS between two reservations. */
  private async pace(): Promise<void> {
    for (;;) {
      const wait = this.reservedAt + MIN_ATTEMPT_GAP_MS - this.deps.now();
      if (wait <= 0) return;
      await this.idleOrExit(Math.min(wait, WAIT_SLICE_MS));
    }
  }

  private sawHead(height: number): void {
    this.head = height;
    this.seenAt = this.deps.now();
  }

  private async loop(): Promise<WalletEndReason> {
    for (;;) {
      let reason: WalletEndReason | null;
      try {
        reason = await this.pass();
        this.failures = 0;
      } catch (error) {
        if (error instanceof Exit) return error.reason;
        if (!(error instanceof Retry)) throw error;
        this.setPaused(true);
        reason = await this.idle(RETRY_MS);
      }
      if (reason !== null) return reason;
    }
  }

  /** P1-P15: one pass. Null when the next pass should run. */
  private async pass(): Promise<WalletEndReason | null> {
    const rec = this.record;
    const terms = rec.terms;
    const L = BigInt(terms.lotAmount);
    const T = BigInt(rec.ticket);
    const read: Reader = (fn) => this.read(fn);
    // P1
    const lost = this.authority();
    if (lost) return lost;
    if (await this.refreshFinality(read)) return 'reorg';
    const prev = lastOf(rec.attempts);
    // P2: the previous payment must be in a block of the tip's chain before anything else.
    if (prev && (prev.status === 'sent' || prev.status === 'uncertain')) {
      const waited = await this.follow(prev, read);
      if (waited !== undefined) return waited;
    }
    this.setPaused(false);
    // P3. Nothing is reserved once an attested view showed the token sold out, so an early verdict
    // from an inclusion block that shows it ends the session without waiting for a tip attestation.
    let classify = prev?.status === 'included';
    const admits = () =>
      count(rec, 'minted') < terms.maxLots &&
      !this.soldOut &&
      !racesExhausted(rec) &&
      rec.used < terms.maxAttempts &&
      this.deps.now() < rec.deadline - MIN_ATTEMPT_MS;
    const admit = admits();
    if (!classify && !admit) return this.limit();
    const exact = (block: Block) =>
      this.attestExact(block, (ms) => this.idleOrExit(ms), true, read);
    // A tip attestation that leaves this classification its calls would come too late, with the
    // inclusion block aging meanwhile: classify from that block first, while the witnesses still
    // attest it. Once that block is beyond their reach, only the next birth block can decide.
    if (prev && classify && this.until(1 + CLASSIFY_CALLS) > TIP_WAIT_MS) {
      const t = await read((s) => this.deps.chain.tip(s));
      this.sawHead(t.height);
      if (!(await read((s) => this.deps.proofs.onAncestry(this.deps.chain, t, inclusions(rec), s))))
        return this.reorg();
      const outcome = await this.classify(prev, null, L, exact, read);
      if (outcome !== OUT_OF_REACH || this.reachable(prev.inclusion!)) {
        const end = await this.judge(prev, outcome);
        if (end !== null) return end;
        // With nothing left to sign, a tip attestation is not worth its wait.
        if (!admit || !admits()) return this.limit();
        classify = false;
      }
    }
    // P4
    if (admit) await this.pace();
    const view = await this.attestTip();
    const B = view.block;
    if (!Number.isSafeInteger(B.height) || B.height < 0 || !HASH.test(B.hash)) return 'unverified';
    this.sawHead(B.height);
    this.nextLot = view.next ? Number(view.next.lot) : null;
    if (view.next === null) this.soldOut = true;
    // P5: the chaining proof at B, whatever the previous attempt's status.
    let acct: Account | null = null;
    const included = inclusions(rec);
    if (prev && included.length > 0) {
      acct = await read((s) =>
        this.deps.proofs.proveLineage(this.deps.chain, B, included, prev.nonce, s),
      );
      if (acct === null) return this.reorg();
    }
    // P6
    if (prev && classify) {
      const end = await this.judge(prev, await this.classify(prev, view, L, exact, read));
      if (end !== null) return end;
    }
    // P7: limits, with the counts now current, in the order `limit()` keeps too.
    const minted = count(rec, 'minted');
    if (minted >= terms.maxLots) return 'completed';
    const next = view.next;
    if (next === null) return 'sold-out';
    if (racesExhausted(rec)) return 'race-lost';
    if (rec.used >= terms.maxAttempts) return 'attempt-limit';
    if (this.deps.now() >= rec.deadline - MIN_ATTEMPT_MS) return this.deadlineReason();
    // Only a pass that was paced as an admission may reserve (a clock set back could reopen it).
    if (!admit) return this.limit();
    // P8: admission at B. M and H keep the caps independent of the node (lemma S).
    if (prev && !(B.height > prev.birth.height)) return this.reorg();
    const first = rec.attempts[0];
    if (first && view.held !== BigInt(first.held) + L * BigInt(minted)) return 'unverified';
    if (
      view.profile !== MINT_PROFILE ||
      view.lotSize !== L ||
      next.asset !== terms.asset ||
      next.profile !== MINT_PROFILE ||
      next.amount !== L ||
      !(next.lot >= 1n && next.lot <= BigInt(LOTS)) ||
      !samePlace(next.anchor, view.right)
    )
      return 'unverified';
    const F = next.fee;
    if (F > BigInt(terms.maxFeePerLot)) return 'fee-limit';
    if (minted + 1 > terms.maxLots) return 'completed';
    if (protocolBound(rec) + F + T > BigInt(terms.maxSpend)) return 'spend-limit';
    // The payment about to be signed must find its classification's calls free once it is in a
    // block. When this pass's classification used them, the next pass takes a fresh B once the
    // budget has them again.
    if (this.free() < CLASSIFY_CALLS) return null;
    // P9
    acct ??= await read((s) => this.deps.chain.account(B.hash, s));
    // Exactly our previous payment ran since the last birth: anything else is another installation.
    if (prev && acct.nonce !== prev.nonce + 1) return 'account-activity';
    const quote = await read(() => this.deps.prepare(view));
    if (quote.nativeFee !== T) return 'unverified';
    if (!quoteMatches(quote, next, B, rec.genesis)) return 'unverified';
    const c = quote.context;
    // A pool transaction of this account is ahead of the chain.
    if (c.nonce > acct.nonce) return 'account-activity';
    // The service read the pool before the block it was asked for.
    if (c.nonce < acct.nonce) this.transient();
    // Exact spendability where the payment executes: earlier payments are already in `free`, and
    // only this payment's worst case is subtracted.
    const E = quote.networkFee;
    const floor = acct.frozen > quote.existentialDeposit ? acct.frozen : quote.existentialDeposit;
    if (acct.free - floor < E * BigInt(rec.margin) + T + F) return 'insufficient-funds';
    await read(() => this.deps.recheck(quote));
    // P10: count the signature durably before the secret is touched.
    const lost10 = this.authority();
    if (lost10) return lost10;
    const attempt: MintAttempt = {
      n: rec.attempts.length + 1,
      status: 'reserved',
      lot: Number(next.lot),
      fee: String(F),
      anchor: { height: next.anchor.height, hash: next.anchor.hash, index: next.anchor.index },
      ticket: {
        signers: [next.ticket.signers[0], next.ticket.signers[1]],
        nonce: String(next.ticket.nonce),
      },
      minted: String(view.minted),
      held: String(view.held),
      birth: { height: B.height, hash: B.hash },
      nonce: c.nonce,
      intentId: quote.intentId,
      networkFee: String(E),
      reserve: { network: String(E * BigInt(rec.margin)), protocol: String(F + T) },
      hash: null,
      inclusion: null,
      finalized: false,
      doubt: false,
    };
    rec.attempts.push(attempt);
    rec.used += 1;
    this.reservedAt = this.deps.now();
    try {
      await this.deps.persist();
    } catch {
      attempt.status = 'cancelled';
      return 'unavailable';
    }
    this.notify();
    return this.sign(attempt, quote, B);
  }

  /** P2 for a released payment: undefined once it is recorded in a block of the tip's chain;
   * otherwise what the pass returns, null to look again after a pause or the reason to end. */
  private async follow(
    prev: MintAttempt,
    read: Reader,
  ): Promise<WalletEndReason | null | undefined> {
    const t = await read((s) => this.deps.chain.tip(s));
    this.sawHead(t.height);
    const rec = this.record;
    // No automatic branch switch: every recorded inclusion stays on the tip's chain.
    const kept = await read((s) =>
      this.deps.proofs.onAncestry(this.deps.chain, t, inclusions(rec), s),
    );
    if (!kept) return this.reorg();
    const fate = await read((s) =>
      this.deps.proofs.locatePayment(this.deps.chain, payment(prev), t, s),
    );
    switch (fate.kind) {
      case 'pending':
        // Only an uncertain release pauses: a sent payment is simply on its way.
        this.setPaused(prev.status === 'uncertain');
        return this.idle(INCLUSION_POLL_MS);
      case 'unprovable':
        return this.reorg();
      case 'replaced':
        prev.status = 'replaced';
        return 'account-activity';
      case 'dead':
        prev.status = 'dead';
        return this.reorg();
      case 'expired':
        prev.status = 'expired';
        return 'unverified';
      case 'included':
        if (!inWindow(prev, fate.at)) return 'unverified';
        prev.status = 'included';
        prev.inclusion = { height: fate.at.height, hash: fate.at.hash, index: fate.at.index };
        await this.write();
        return undefined;
      default:
        return 'unverified';
    }
  }

  /** P11-P15 for a reserved attempt. */
  private async sign(
    attempt: MintAttempt,
    quote: Quote,
    B: Block,
  ): Promise<WalletEndReason | null> {
    const rec = this.record;
    // P11
    const lost = this.authority();
    if (lost) return this.cancel(attempt, lost);
    let sign: Sign;
    try {
      const unlocking = invoke(() => this.deps.unlockSigner());
      sign = await untilAborted(unlocking, this.stopper.signal);
    } catch {
      return this.cancel(attempt, this.authority() ?? 'unverified');
    }
    // No await from this check to the signature.
    const lost11 = this.authority();
    const now = this.deps.now();
    if (lost11) return this.cancel(attempt, lost11);
    if (!(now < quote.expiresAt)) return this.cancel(attempt, 'unavailable');
    let bytes: Uint8Array;
    try {
      bytes = sign(quote.callHex, quote.context);
    } catch {
      return this.cancel(attempt, 'unverified');
    }
    // P12: the signature must say exactly what was reviewed, era included.
    let facts: SignedFacts;
    try {
      facts = this.deps.inspect(bytes);
      if (
        facts.scheme !== 'ml-dsa-87' ||
        facts.accountId !== rec.owner ||
        facts.callHex !== quote.callHex ||
        facts.nonce !== quote.context.nonce ||
        facts.tip !== 0n ||
        facts.eraHex !== this.deps.era(B.height) ||
        !HASH.test(facts.hash)
      )
        return this.cancel(attempt, 'unverified');
    } catch {
      return this.cancel(attempt, 'unverified');
    }
    // P13: the history cap is checked before the hash exists, so a hash always has its entry.
    if (this.deps.journalFull()) return this.cancel(attempt, 'capacity');
    this.deps.journalAdd({
      hash: facts.hash,
      owner: rec.owner,
      genesis: rec.genesis,
      nonce: attempt.nonce,
      intentId: attempt.intentId,
      createdAt: this.deps.now(),
      label: 'mintProgressive',
      status: 'signed-not-submitted',
      validUntil: B.height + ERA_PERIOD,
      session: rec.id,
      lot: attempt.lot,
      amount: rec.terms.lotAmount,
      symbol: rec.symbol,
      decimals: rec.decimals,
    });
    attempt.hash = facts.hash;
    attempt.status = 'signed';
    try {
      await this.deps.persist();
    } catch {
      return this.cancel(attempt, 'unavailable');
    }
    this.notify();
    const lost13 = this.authority();
    if (lost13) return this.cancel(attempt, lost13);
    // P14: uncertainty is durable before the bytes leave.
    attempt.status = 'uncertain';
    this.deps.journalStatus(facts.hash, 'broadcast-uncertain');
    try {
      await this.deps.persist();
    } catch {
      return this.cancel(attempt, 'unavailable');
    }
    const lost14 = this.authority();
    if (lost14) return this.cancel(attempt, lost14);
    this.released.add(attempt.n);
    let result: unknown;
    try {
      result = await this.deps.submit(attempt.intentId, facts.hash, bytes);
    } catch {
      result = 'broadcast-uncertain';
    }
    // P15
    const sent = result === 'submitted';
    attempt.status = sent ? 'sent' : 'uncertain';
    this.deps.journalStatus(facts.hash, sent ? 'submitted' : 'broadcast-uncertain');
    await this.write();
    return null;
  }

  /** Wx: an attempt whose bytes never left is cancelled, in the ledger and in history. */
  private cancel(a: MintAttempt, reason: WalletEndReason): WalletEndReason {
    if (!this.released.has(a.n) && ['reserved', 'signed', 'uncertain'].includes(a.status)) {
      a.status = 'cancelled';
      if (a.hash !== null) this.deps.journalStatus(a.hash, 'cancelled-before-broadcast');
    }
    return reason;
  }

  /** Why nothing is left to do, in P7's order: completion, a token an attested view showed sold
   * out, lost races beyond the retries, the signature cap, then time. */
  private limit(): WalletEndReason {
    const rec = this.record;
    if (count(rec, 'minted') >= rec.terms.maxLots) return 'completed';
    if (this.soldOut) return 'sold-out';
    if (racesExhausted(rec)) return 'race-lost';
    if (rec.used >= rec.terms.maxAttempts) return 'attempt-limit';
    return this.deadlineReason();
  }

  /** A recorded inclusion is no longer on the chain the session reads: the session ends, and every
   * verdict that rested on an inclusion not final yet is in doubt. */
  private reorg(): WalletEndReason {
    doubtOpen(this.record);
    return 'reorg';
  }

  /** A write that is not fatal: the in-memory record stands and the next write carries it. */
  private async write(): Promise<void> {
    try {
      await this.deps.persist();
    } catch {
      // Carried by the next save of any operation.
    }
    this.notify();
  }

  /**
   * The outcome of an included payment: decided at `view` when it can be, else at its exact
   * inclusion block, and at that block's attested parent when needed. `attestAt` gives null for a
   * block the witnesses no longer attest. No verdict uses the recorded position before it is proven
   * from the attested block that verdict reads: the headers down to it, its block's body and our
   * exact transaction at its index. A position the proof contradicts is `unverified`; node data
   * that fails the proof throws UNPROVEN through `read`.
   */
  private async classify(
    p: MintAttempt,
    view: AttestedAsset | null,
    L: bigint,
    attestAt: (block: Block) => Promise<AttestedAsset | null>,
    read: Reader,
  ): Promise<Outcome | typeof OUT_OF_REACH> {
    const pos = p.inclusion;
    if (pos === null) return 'unverified';
    const proven = (anchor: Block) =>
      read((s) =>
        this.deps.proofs.proveInclusion(
          this.deps.chain,
          { height: anchor.height, hash: anchor.hash },
          payment(p),
          { height: pos.height, hash: pos.hash, index: pos.index },
          s,
        ),
      );
    if (view) {
      if (!(await proven(view.block))) return 'unverified';
      if (classifyAt(p, view, L) === 'minted') return 'minted';
    }
    const x = await attestAt({ height: pos.height, hash: pos.hash });
    if (x === null) return OUT_OF_REACH;
    if (x.block.height !== pos.height || x.block.hash !== pos.hash) return 'unverified';
    // Proven from B above already, which X is on; otherwise from X itself.
    if (!view && !(await proven(x.block))) return 'unverified';
    // On the tip's chain, which this block is on, a token sold out stays sold out.
    if (x.next === null) this.soldOut = true;
    const outcome = classifyExact(p, x, L);
    if (outcome !== NEEDS_PARENT) return outcome;
    // The parent both witnesses signed for X, never a header from the node.
    const parent = { height: pos.height - 1, hash: x.parent };
    const y = await attestAt(parent);
    if (y === null) return OUT_OF_REACH;
    if (y.block.height !== parent.height || y.block.hash !== parent.hash) return 'unverified';
    const decided = classifyExact(p, x, L, y);
    return decided === NEEDS_PARENT ? 'unverified' : decided;
  }

  /** P6: saves the verdict on the included payment `p`. Returns why the session ends, or null when
   * it goes on. */
  private async judge(
    p: MintAttempt,
    outcome: Outcome | typeof OUT_OF_REACH,
  ): Promise<WalletEndReason | null> {
    if (outcome === 'unverified' || outcome === OUT_OF_REACH) {
      // It stays included, held at its worst case until history settles it; the settle task need
      // not ask the witnesses the same question again.
      this.unverifiedAt = p.inclusion;
      return 'unverified';
    }
    p.status = outcome;
    await this.write();
    return outcome === 'failed' || outcome === 'anomaly' ? outcome : null;
  }

  /** Marks recorded inclusions final; when the final chain's block at an inclusion's height is
   * another one, that payment and every later one are in doubt. Throttled. Returns whether the
   * record is reorganized. */
  private async refreshFinality(read: Reader): Promise<boolean> {
    const rec = this.record;
    // A payment in doubt is settled by history: its inclusion is no longer followed.
    const open = (): MintAttempt[] =>
      rec.attempts.filter((a) => a.inclusion !== null && !a.finalized && !a.doubt);
    if (open().length === 0) return rec.reorganized;
    const now = this.deps.now();
    if (now - this.finalityAt < FINALITY_REFRESH_MS) return rec.reorganized;
    this.finalityAt = now;
    const final = await read((s) => this.deps.chain.finalizedHead(s));
    this.finalized = final.height;
    let changed = false;
    for (const a of open()) {
      const at = a.inclusion;
      if (at === null || at.height > final.height) continue;
      const hash = await read((s) => this.deps.chain.canonicalAt(at.height, s));
      // History resolution may have replaced the inclusion meanwhile, or an earlier mismatch put
      // this payment in doubt.
      if (a.inclusion !== at || a.finalized || a.doubt) continue;
      if (hash === at.hash) a.finalized = true;
      else doubtFrom(rec, a);
      changed = true;
    }
    if (changed) await this.write();
    return rec.reorganized;
  }

  /** Ends the record. Never throws. */
  private async end(reason: WalletEndReason): Promise<void> {
    const rec = this.record;
    try {
      const last = lastOf(rec.attempts);
      if (last) this.cancel(last, reason);
    } catch {
      // The record still ends; a released payment is never cancelled here.
    }
    rec.state = 'ended';
    rec.reason = reason;
    rec.endedAt = this.deps.now();
    if (this.stopWith === null) this.stopWith = reason;
    this.stopper.abort();
    this.paused = false;
    try {
      await this.deps.persist();
    } catch {
      try {
        await this.deps.sleep(END_WRITE_RETRY_MS, new AbortController().signal);
        await this.deps.persist();
      } catch {
        // The in-memory record is ended; the next save of any operation writes it.
      }
    }
    this.notify();
    if (!NO_SETTLE.includes(reason)) this.settling = this.settle().catch(() => undefined);
  }

  // ---- Post-end settle task: read-only, no secret, no reservation, no signature -----------------

  /** Nothing left to follow: every payment is resolved and final, or in doubt and left to history. */
  private settledNow(): boolean {
    return this.record.attempts.every(
      (a) => a.doubt || (!isUnresolved(a) && (a.inclusion === null || a.finalized)),
    );
  }

  private async settle(): Promise<void> {
    const signal = this.settleStopper.signal;
    const until = (this.record.endedAt ?? this.deps.now()) + ENDED_RETENTION_MS;
    while (!signal.aborted && this.deps.now() < until && !this.settledNow()) {
      this.roundAt = this.deps.now();
      try {
        await this.settleRound(signal);
      } catch {
        // Silent: the next round tries again.
      }
      if (signal.aborted || this.settledNow()) return;
      await this.rest(INCLUSION_POLL_MS, signal);
    }
  }

  private async rest(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    const wake = new AbortController();
    const abort = () => wake.abort();
    signal.addEventListener('abort', abort, { once: true });
    this.wake = wake;
    try {
      await this.deps.sleep(ms, wake.signal);
    } finally {
      signal.removeEventListener('abort', abort);
      this.wake = null;
    }
  }

  private async settleRound(signal: AbortSignal): Promise<void> {
    const rec = this.record;
    const read: Reader = (fn) =>
      untilAborted(
        invoke(() => fn(signal)),
        signal,
      ).catch((error: unknown) => {
        if (unproven(error)) this.proofFailed = true;
        throw error;
      });
    // Once node data failed a proof, nothing the node shows is classified again: only finality,
    // which can only put verdicts in doubt, is still followed.
    if (this.proofFailed) {
      await this.refreshFinality(read);
      return;
    }
    const statusOf = (a: MintAttempt): AttemptStatus => a.status;
    // A payment in doubt is left to history.
    const last = lastOf(rec.attempts);
    const p = last?.doubt ? undefined : last;
    let tip: Block | null = null;
    if (p && p.hash !== null && (p.status === 'sent' || p.status === 'uncertain')) {
      const t = await read((s) => this.deps.chain.tip(s));
      tip = t;
      this.sawHead(t.height);
      const found = await read((s) =>
        this.deps.proofs.findInclusion(this.deps.chain, payment(p), t, s),
      );
      const now = statusOf(p);
      if (
        found.kind === 'included' &&
        inWindow(p, found.at) &&
        (now === 'sent' || now === 'uncertain')
      ) {
        p.status = 'included';
        p.inclusion = { height: found.at.height, hash: found.at.hash, index: found.at.index };
        await this.write();
      }
    }
    const at = p?.inclusion ?? null;
    if (p && at !== null && statusOf(p) === 'included' && !samePlace(this.unverifiedAt, at)) {
      const t = tip ?? (await read((s) => this.deps.chain.tip(s)));
      this.sawHead(t.height);
      if (
        this.reachable(at) &&
        (await read((s) => this.deps.proofs.onAncestry(this.deps.chain, t, [at], s)))
      ) {
        const L = BigInt(rec.terms.lotAmount);
        const wait = async (ms: number) => {
          await this.rest(ms, signal);
          signal.throwIfAborted();
        };
        const outcome = await this.classify(
          p,
          null,
          L,
          (block) => this.attestExact(block, wait, false, read),
          read,
        );
        // History may have resolved the attempt meanwhile; it then keeps that verdict.
        if (statusOf(p) === 'included' && p.inclusion === at) {
          if (outcome === 'unverified' || outcome === OUT_OF_REACH) this.unverifiedAt = at;
          else {
            p.status = outcome;
            await this.write();
          }
        }
      }
    }
    await this.refreshFinality(read);
  }
}

// ---- Stored ledger ------------------------------------------------------------------------------

class Invalid extends Error {}
function check(condition: unknown): asserts condition {
  if (!condition) throw new Invalid();
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  check(typeof value === 'object' && value !== null && !Array.isArray(value));
  const own = Object.keys(value);
  check(own.length === keys.length && keys.every((k) => Object.hasOwn(value, k)));
  return value as Record<string, unknown>;
}
const isCount = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const isDecimal = (v: unknown): v is string =>
  typeof v === 'string' && DECIMAL.test(v) && BigInt(v) <= MAX_U128;
const isHash = (v: unknown): v is string => typeof v === 'string' && HASH.test(v);
function isPlace(v: unknown, withIndex: boolean): boolean {
  const p = exact(v, withIndex ? ['height', 'hash', 'index'] : ['height', 'hash']);
  return isCount(p.height) && isHash(p.hash) && (!withIndex || isCount(p.index));
}
function isOrigin(v: unknown): boolean {
  if (typeof v !== 'string' || v.length > 200) return false;
  try {
    const url = new URL(v);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === v;
  } catch {
    return false;
  }
}

const RECORD_KEYS = [
  'id',
  'origin',
  'owner',
  'genesis',
  'terms',
  'digest',
  'runtime',
  'ticket',
  'margin',
  'symbol',
  'decimals',
  'approvedAt',
  'deadline',
  'state',
  'reason',
  'endedAt',
  'used',
  'reorganized',
  'attempts',
];
const ATTEMPT_KEYS = [
  'n',
  'status',
  'lot',
  'fee',
  'anchor',
  'ticket',
  'minted',
  'held',
  'birth',
  'nonce',
  'intentId',
  'networkFee',
  'reserve',
  'hash',
  'inclusion',
  'finalized',
  'doubt',
];

function checkAttempt(v: unknown, i: number, rec: Record<string, unknown>): MintAttempt {
  const a = exact(v, ATTEMPT_KEYS);
  check(a.n === i + 1 && isCount(a.n, 1, rec.used as number));
  check(STATUSES.includes(a.status as AttemptStatus));
  const status = a.status as AttemptStatus;
  check(isCount(a.lot, 1, LOTS));
  check(isDecimal(a.fee) && isDecimal(a.minted) && isDecimal(a.held) && isDecimal(a.networkFee));
  check(isPlace(a.anchor, true) && isPlace(a.birth, false));
  const t = exact(a.ticket, ['signers', 'nonce']);
  check(Array.isArray(t.signers) && t.signers.length === 2 && t.signers.every(isHash));
  check(isDecimal(t.nonce));
  check(isCount(a.nonce, 0, 0xffffffff));
  check(typeof a.intentId === 'string' && INTENT.test(a.intentId));
  const r = exact(a.reserve, ['network', 'protocol']);
  check(isDecimal(r.network) && isDecimal(r.protocol));
  check(a.hash === null ? status === 'reserved' || status === 'cancelled' : isHash(a.hash));
  const inclusion = a.inclusion;
  if (WITH_INCLUSION.includes(status)) check(inclusion !== null);
  else if (status !== 'settled') check(inclusion === null);
  check(typeof a.finalized === 'boolean' && (inclusion !== null || a.finalized === false));
  if (inclusion !== null) {
    check(isPlace(inclusion, true));
    const at = inclusion as Position;
    const birth = a.birth as Block;
    check(birth.height < at.height && at.height <= birth.height + ERA_PERIOD - 1);
  }
  // Only a payment that was signed and left the signing steps can be in doubt.
  check(typeof a.doubt === 'boolean');
  if (a.doubt) check(a.hash !== null && status !== 'reserved' && status !== 'signed');
  return v as MintAttempt;
}

/** Checks one stored record against its history. `raceRule`: the lost-race allowance applies to
 * it (`raceRuleChecked`). */
function checkRecord(
  v: unknown,
  transactions: readonly JournalLine[],
  raceRule: boolean,
): void {
  const r = exact(v, RECORD_KEYS);
  check(typeof r.id === 'string' && UUID.test(r.id));
  check(isOrigin(r.origin));
  check(isHash(r.owner) && isHash(r.genesis) && isHash(r.runtime) && isHash(r.digest));
  const terms = parseMintSessionTerms(r.terms);
  check(JSON.stringify(terms) === JSON.stringify(r.terms));
  check(isDecimal(r.ticket));
  check(isCount(r.margin, 1, 10));
  check(typeof r.symbol === 'string' && r.symbol.length <= 32);
  check(isCount(r.decimals, 0, 18));
  check(isCount(r.approvedAt) && isCount(r.deadline));
  check(r.state === 'running' || r.state === 'ended');
  const ended = r.state === 'ended';
  check(ended ? REASONS.includes(r.reason as WalletEndReason) : r.reason === null);
  check(ended ? isCount(r.endedAt) : r.endedAt === null);
  check(typeof r.reorganized === 'boolean');
  check(isCount(r.used, 0, terms.maxAttempts));
  check(Array.isArray(r.attempts) && r.attempts.length <= (r.used as number));
  const attempts = (r.attempts as unknown[]).map((a, i) => checkAttempt(a, i, r));
  check(r.reorganized === attempts.some((a) => a.doubt));
  let lostRaces = 0;
  for (let i = 1; i < attempts.length; i++) {
    const before = attempts[i - 1]!;
    const a = attempts[i]!;
    check(a.birth.height > before.birth.height);
    check(a.nonce === before.nonce + 1);
    // A session reserves again only after a lot or a lost race, and only while its lost races are
    // within the retries its terms allow (checked where `raceRuleChecked` says so).
    check(before.status === 'minted' || before.status === 'lost-race');
    if (before.status === 'lost-race') lostRaces += 1;
    check(!raceRule || lostRaces <= terms.maxAttempts - terms.maxLots);
  }
  for (const a of attempts) {
    if (a.status === 'settled') check(ended);
    if (a.hash === null) continue;
    const lines = transactions.filter((t) => t.hash === a.hash);
    check(lines.length === 1);
    const line = lines[0]!;
    check(
      line.owner === r.owner &&
        line.genesis === r.genesis &&
        line.nonce === a.nonce &&
        line.session === r.id,
    );
  }
  // Whatever history says later, the counters and spends the record shows stay within its terms,
  // and so do those of its verdicts as they admitted signatures, doubt aside.
  const rec = v as MintSessionRecord;
  parseMintSessionSnapshot(sessionSnapshot(rec, () => false));
  const ledger = rec.attempts.map((a) => ({ ...a, doubt: false }));
  parseMintSessionSnapshot(
    sessionSnapshot({ ...rec, reorganized: false, attempts: ledger }, () => false),
  );
}

/**
 * Whether a stored record is held to the lost-race allowance. Only a running record that a wallet
 * with the rule saved (every attempt carries `doubt`, which arrived with it): such a record over
 * the allowance is corrupt. An ended record never signs again, and wallets before the rule signed
 * after any number of lost races until maxAttempts. Their ended records gain `doubt` at the first
 * save after an update, so missing keys cannot tell them apart, and the allowance is never asked of
 * an ended record. A running record that lacks `doubt` was cut off under such a wallet; the load
 * ends it like any record no controller owns.
 */
function raceRuleChecked(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const { state, attempts } = v as { state?: unknown; attempts?: unknown };
  return (
    state === 'running' &&
    Array.isArray(attempts) &&
    attempts.every((a) => typeof a === 'object' && a !== null && Object.hasOwn(a, 'doubt'))
  );
}

/**
 * Records saved before attempts carried `doubt` get it: false, or true for every signed payment of
 * a record already marked reorganized, which never said which payments the reorganization touched.
 * Anything else is left for the checks to judge.
 */
function upgrade(value: unknown[]): void {
  for (const r of value) {
    if (typeof r !== 'object' || r === null) continue;
    const { reorganized, attempts } = r as { reorganized?: unknown; attempts?: unknown };
    if (!Array.isArray(attempts)) continue;
    for (const a of attempts) {
      if (typeof a !== 'object' || a === null || Array.isArray(a) || Object.hasOwn(a, 'doubt'))
        continue;
      const { hash, status } = a as { hash?: unknown; status?: unknown };
      (a as { doubt: boolean }).doubt =
        reorganized === true && hash !== null && status !== 'reserved' && status !== 'signed';
    }
  }
}

/**
 * Validates the stored ledger against its history, after giving records of an older wallet the
 * fields they lack. Throws `Error('Invalid mint session ledger')` and leaves the ledger as it was
 * stored; the wallet then archives it and keeps loading, since every liability is in history.
 */
export function validateMintSessions(
  value: unknown,
  transactions: readonly JournalLine[],
): asserts value is MintSessionRecord[] | undefined {
  try {
    if (value === undefined) return;
    check(Array.isArray(value) && value.length <= MAX_SESSION_RECORDS);
    // Checked on a copy: the ledger itself gets the missing fields only once every record passed.
    const records: unknown[] = structuredClone(value);
    const raceRule = records.map(raceRuleChecked);
    upgrade(records);
    records.forEach((r, i) => checkRecord(r, transactions, raceRule[i]!));
    upgrade(value);
  } catch {
    throw new Error('Invalid mint session ledger');
  }
}

/** Ends a running record that no controller owns. Attempts never released are cancelled (they
 * were reserved or signed, never marked uncertain); released ones stay and keep gating the account
 * through history. `used` never changes. */
function endUnowned(rec: MintSessionRecord, reason: WalletEndReason, now: number): void {
  rec.state = 'ended';
  rec.reason = reason;
  rec.endedAt = now;
  for (const a of rec.attempts)
    if (a.status === 'reserved' || a.status === 'signed') a.status = 'cancelled';
}

/** After a worker restart no session resumes: every running record ends `restarted`. History's own
 * restart rule cancels the signed entries. */
export function endOnRestart(records: MintSessionRecord[], now: number): boolean {
  let changed = false;
  for (const rec of records) {
    if (rec.state !== 'running') continue;
    endUnowned(rec, 'restarted', now);
    changed = true;
  }
  return changed;
}

/** At approval: running records of this account without a live controller (their end was never
 * saved) end `unavailable`, and the history entry of a signed attempt is cancelled with it. */
export function endStale(
  records: MintSessionRecord[],
  transactions: { hash: string; status: string }[],
  owner: string,
  genesis: string,
  now: number,
): boolean {
  let changed = false;
  for (const rec of records) {
    if (rec.state !== 'running' || rec.owner !== owner || rec.genesis !== genesis) continue;
    for (const a of rec.attempts) {
      if (a.status !== 'signed' || a.hash === null) continue;
      const line = transactions.find((t) => t.hash === a.hash);
      if (line?.status === 'signed-not-submitted') line.status = 'cancelled-before-broadcast';
    }
    endUnowned(rec, 'unavailable', now);
    changed = true;
  }
  return changed;
}

/**
 * Whether history's final entry for a resolved attempt tells another story than the ledger: a
 * payment the ledger places in a block that did not run there or had the other outcome, or one it
 * says never ran that did. Only what history states counts; a missing field is no evidence.
 */
function contradicts(a: MintAttempt, line: JournalLine): boolean {
  if (!FINAL_JOURNAL.includes(line.status)) return false;
  const ran = line.status === 'finalized';
  if (NEVER_RAN.includes(a.status)) return ran;
  const at = a.inclusion;
  if (at === null || a.status === 'settled') return false;
  if (!ran) return true;
  if (Number.isSafeInteger(line.height) && line.height !== at.height) return true;
  // A lot is a native success the protocol accepted; a right used without a lot, a native success
  // it rejected; a lost race or another failure, a native failure.
  const success = a.status === 'minted' || a.status === 'anomaly';
  if (typeof line.nativeSuccess === 'boolean' && line.nativeSuccess !== success) return true;
  const accepted = line.verdict === 'accepted';
  return typeof line.verdict === 'string' && accepted !== (a.status === 'minted');
}

/**
 * Ended records take history's final verdict for each payment they still count as unresolved.
 * A payment the session already classified keeps its verdict, which admitted the next signature,
 * whatever history says: when history finalized it otherwise (a reorganization the session no
 * longer watched), that payment and every later one are put in doubt, so the counts leave them out
 * and history gives their outcome. Nothing here adds a lot, a spend or a signature. Running records
 * belong to their controller.
 */
export function resolveFromJournal(
  records: MintSessionRecord[],
  transactions: readonly JournalLine[],
): boolean {
  let changed = false;
  for (const rec of records) {
    if (rec.state !== 'ended') continue;
    for (const a of rec.attempts) {
      if (a.hash === null) continue;
      const line = transactions.find((t) => t.hash === a.hash);
      if (!line) continue;
      if (!isUnresolved(a)) {
        if (!a.doubt && contradicts(a, line)) {
          doubtFrom(rec, a);
          changed = true;
        }
        continue;
      }
      if (line.status === 'finalized') a.status = 'settled';
      else if (NEVER_RAN_JOURNAL.includes(line.status)) {
        // History says it never ran: a block the node named was not its, so the session's record
        // of it is in doubt.
        if (a.inclusion !== null) doubtFrom(rec, a);
        a.status = line.status === 'expired' ? 'expired' : 'cancelled';
        a.inclusion = null;
        a.finalized = false;
      } else continue;
      changed = true;
    }
  }
  return changed;
}

/** An ended record whose every payment is final in history: it can be dropped. */
export function settledRecord(
  rec: MintSessionRecord,
  transactions: readonly JournalLine[],
): boolean {
  return (
    rec.state === 'ended' &&
    rec.attempts.every(
      (a) =>
        a.hash === null ||
        transactions.some((t) => t.hash === a.hash && FINAL_JOURNAL.includes(t.status)),
    )
  );
}

/** Drops settled records, oldest first, until one more fits. Returns the free slots left. */
export function pruneSettled(
  records: MintSessionRecord[],
  transactions: readonly JournalLine[],
): number {
  while (records.length >= MAX_SESSION_RECORDS) {
    const i = records.findIndex((r) => settledRecord(r, transactions));
    if (i < 0) break;
    records.splice(i, 1);
  }
  return Math.max(0, MAX_SESSION_RECORDS - records.length);
}
