import { QlyphsError } from '../../provider/src/index.ts';
import type { PublicErrorCode } from '../../provider/src/index.ts';
import type {
  SubmittedTransaction,
  TransactionCommand,
  TransactionReceipt,
} from '../../native/src/public.ts';
import { IndexerClient } from './indexer.ts';
import { asTransactionHash, explorerUrl } from './identifiers.ts';
import { immutable } from './validation.ts';
import { sleep } from './async.ts';
export interface TransactionObservation {
  readonly hash: string;
  readonly submission: 'acknowledged' | 'uncertain' | 'unknown';
  readonly inclusion: { readonly height: number; readonly finalized: boolean } | null;
  readonly native: 'unknown' | 'success' | 'failure';
  readonly qlyp: 'unknown' | 'not-applicable' | 'accepted' | 'rejected';
  readonly verdict: string | null;
  readonly settlement: 'not-applicable' | 'unknown' | 'settled' | 'released';
  readonly finalized: boolean;
  readonly result: 'pending' | 'success' | 'failure' | 'uncertain' | 'expired';
  readonly receipt: TransactionReceipt | null;
  readonly explorerUrl: string;
  readonly observedAt: number;
}
export interface TrackingOptions {
  command?: TransactionCommand;
  explorerBaseUrl: string;
  signal?: AbortSignal;
  /** Overall tracking deadline, not a transaction validity deadline. */
  timeoutMs?: number;
  intervalMs?: number;
}
export class TrackingError extends QlyphsError {
  readonly lastObservation: TransactionObservation;
  constructor(code: PublicErrorCode, observation: TransactionObservation) {
    super(
      code,
      'Tracking stopped; the transaction outcome may still be unknown. Resume reading the saved hash, never resend automatically.',
      'unknown',
    );
    this.name = 'TrackingError';
    this.lastObservation = observation;
  }
}
function base(
  input: SubmittedTransaction | string,
  options: TrackingOptions,
): TransactionObservation {
  const hash = asTransactionHash(typeof input === 'string' ? input : input.hash);
  return immutable({
    hash,
    submission:
      typeof input === 'string'
        ? 'unknown'
        : input.status === 'submitted'
          ? 'acknowledged'
          : 'uncertain',
    inclusion: null,
    native: 'unknown',
    qlyp: ['sendQtc', 'pair'].includes(options.command?.kind ?? '') ? 'not-applicable' : 'unknown',
    verdict: null,
    settlement:
      options.command?.kind === 'buy' || options.command?.kind === 'cancel'
        ? 'unknown'
        : 'not-applicable',
    finalized: false,
    result: 'pending',
    receipt: null,
    explorerUrl: explorerUrl(options.explorerBaseUrl, { kind: 'transaction', id: hash }),
    observedAt: Date.now(),
  });
}
/** Async iteration owns no timer while suspended/yielded; return/break cleans up naturally.
 * Only GET requests are repeated. Never signs, prepares or submits an operation. */
export async function* trackTransaction(
  client: IndexerClient,
  input: SubmittedTransaction | string,
  options: TrackingOptions,
): AsyncGenerator<TransactionObservation, TransactionObservation, void> {
  const timeout = options.timeoutMs ?? 120_000,
    interval = options.intervalMs ?? 1_000;
  if (
    !Number.isSafeInteger(timeout) ||
    timeout <= 0 ||
    timeout > 86_400_000 ||
    !Number.isSafeInteger(interval) ||
    interval < 50 ||
    interval > 60_000
  )
    throw new QlyphsError('INVALID_REQUEST', 'Invalid tracking deadline or polling interval');
  const deadline = Date.now() + timeout;
  let last = base(input, options);
  const stopped = () => {
    if (options.signal?.aborted) throw new TrackingError('ABORTED', last);
    if (Date.now() >= deadline) throw new TrackingError('TIMEOUT', last);
  };
  stopped();
  yield last;
  for (;;) {
    stopped();
    try {
      const receipt = await client.transaction(last.hash, {
        signal: options.signal,
        timeoutMs: Math.max(1, Math.min(15_000, deadline - Date.now())),
      });
      stopped();
      const finalized = receipt.status === 'finalized';
      const qlyp =
        receipt.verdict === 'accepted'
          ? 'accepted'
          : receipt.verdict?.startsWith('rejected: ')
            ? 'rejected'
            : ['sendQtc', 'pair'].includes(options.command?.kind ?? '')
              ? 'not-applicable'
              : 'unknown';
      // Retain already-observed inclusion and dispatch even when the subsequent
      // finalized reservation read is unavailable or cancelled.
      last = immutable({
        ...last,
        receipt,
        inclusion: receipt.height === undefined ? null : { height: receipt.height, finalized },
        native:
          receipt.nativeSuccess === null
            ? 'unknown'
            : receipt.nativeSuccess
              ? 'success'
              : 'failure',
        qlyp,
        verdict: receipt.verdict,
        finalized,
        result: finalized ? 'uncertain' : 'pending',
        observedAt: Date.now(),
      });
      let settlement: TransactionObservation['settlement'] = last.settlement;
      // Unlike ticket.finalized (creation), finalizedTicket reflects the actual persisted checkpoint.
      if (finalized && (options.command?.kind === 'buy' || options.command?.kind === 'cancel')) {
        const ticket = await client.ticket(options.command.ticket, {
          signal: options.signal,
          timeoutMs: Math.max(1, Math.min(15_000, deadline - Date.now())),
        });
        stopped();
        const state =
          ticket.finalizedHeight >= (receipt.height ?? Infinity) ? ticket.finalizedTicket : null;
        settlement =
          state?.status === 'settled' && state.settlement === last.hash
            ? 'settled'
            : state?.status === 'released'
              ? 'released'
              : 'unknown';
      }
      const protocolSuccess =
        options.command?.kind === 'buy'
          ? settlement === 'settled'
          : options.command?.kind === 'cancel'
            ? settlement === 'released'
            : qlyp === 'accepted' || qlyp === 'not-applicable';
      const failure =
        receipt.nativeSuccess === false ||
        qlyp === 'rejected' ||
        (options.command?.kind === 'buy' && settlement === 'released');
      const result =
        receipt.status === 'expired'
          ? 'expired'
          : finalized
            ? failure
              ? 'failure'
              : receipt.nativeSuccess === true && protocolSuccess
                ? 'success'
                : 'uncertain'
            : receipt.status === 'indexer-unavailable'
              ? 'uncertain'
              : 'pending';
      last = immutable({
        ...last,
        receipt,
        inclusion: receipt.height === undefined ? null : { height: receipt.height, finalized },
        native:
          receipt.nativeSuccess === null
            ? 'unknown'
            : receipt.nativeSuccess
              ? 'success'
              : 'failure',
        qlyp,
        verdict: receipt.verdict,
        settlement,
        finalized,
        result,
        observedAt: Date.now(),
      });
      yield last;
      if (finalized || receipt.status === 'expired') return last;
    } catch (error) {
      if (error instanceof TrackingError) throw error;
      stopped();
      if (
        error instanceof QlyphsError &&
        ['INVALID_RESPONSE', 'NETWORK_MISMATCH', 'INVALID_REQUEST'].includes(error.code)
      )
        throw new TrackingError(error.code, last);
      // Read outages are observations, not evidence of transaction failure.
      last = immutable({ ...last, result: 'uncertain', observedAt: Date.now() });
      yield last;
    }
    stopped();
    try {
      await sleep(Math.min(interval, Math.max(1, deadline - Date.now())), options.signal);
    } catch {
      stopped();
      throw new TrackingError('ABORTED', last);
    }
  }
}
export async function waitForTransaction(
  client: IndexerClient,
  input: SubmittedTransaction | string,
  options: TrackingOptions & { onUpdate?: (observation: TransactionObservation) => void },
): Promise<TransactionObservation> {
  let latest = base(input, options);
  for await (const observation of trackTransaction(client, input, options)) {
    latest = observation;
    options.onUpdate?.(observation);
  }
  return latest;
}
