/** Presentation of a transaction's lifecycle. Pure: status comes only from the background history. */
export type TxStage = 'signing' | 'approval' | 'sent' | 'included' | 'finalized' | 'failed';
export interface ProgressTx {
  hash: string;
  label: string;
  status: string;
  createdAt?: number;
  height?: number;
  nativeSuccess?: boolean | null;
  verdict?: string | null;
}

export function txStage(tx: ProgressTx): TxStage {
  if (
    tx.nativeSuccess === false ||
    !!tx.verdict?.startsWith('rejected') ||
    ['expired', 'cancelled-before-broadcast'].includes(tx.status)
  )
    return 'failed';
  if (tx.status === 'finalized') return tx.nativeSuccess === true ? 'finalized' : 'included';
  if (tx.status === 'included') return 'included';
  return 'sent';
}

/** Completed steps out of Sent → In a block → Finalized. */
export function stageStep(stage: TxStage): number {
  return { signing: 0, approval: 0, sent: 1, included: 2, finalized: 3, failed: 0 }[stage];
}

export function stageDone(stage: TxStage): boolean {
  return stage === 'finalized' || stage === 'failed';
}

export interface ChainHeights {
  head: number;
  finalized: number;
  at: number;
}
export interface Finality {
  /** Blocks until the transaction's block is final. */
  remaining: number;
  /** 0..1 share of the finality window already covered. */
  progress: number;
  /** Estimated milliseconds, when the block rate is known. */
  eta?: number;
}
/** Blocks per millisecond over the observed samples, once there is enough signal. */
export function blockRate(samples: readonly ChainHeights[]): number | undefined {
  if (samples.length < 2) return undefined;
  const first = samples[0]!,
    last = samples[samples.length - 1]!;
  const blocks = last.head - first.head,
    ms = last.at - first.at;
  return ms >= 15_000 && blocks > 0 ? blocks / ms : undefined;
}
export function finality(
  tx: ProgressTx,
  chain: ChainHeights | undefined,
  rate?: number,
): Finality | undefined {
  if (!chain || !Number.isSafeInteger(tx.height)) return undefined;
  const window = Math.max(1, chain.head - chain.finalized);
  const remaining = Math.max(0, tx.height! - chain.finalized);
  return {
    remaining,
    progress: Math.min(1, Math.max(0, 1 - remaining / window)),
    ...(rate ? { eta: remaining / rate } : {}),
  };
}
export function formatEta(ms: number): string {
  if (ms < 60_000) return 'under a minute';
  const minutes = Math.round(ms / 60_000);
  return minutes < 60 ? `~${minutes} min` : `~${Math.round(minutes / 60)} h`;
}

export function stageText(
  stage: TxStage,
  tx?: ProgressTx,
  final?: Finality,
): { title: string; detail: string } {
  switch (stage) {
    case 'signing':
      return { title: 'Sending…', detail: 'Signing and sending to the network' };
    case 'approval':
      return { title: 'Waiting for approval', detail: 'Confirm in the Qlyphs window' };
    case 'sent':
      return {
        title: 'Sending…',
        detail:
          tx?.status === 'broadcast-uncertain' || tx?.status === 'unknown'
            ? 'Checking that the network received it'
            : 'Waiting for a block',
      };
    case 'included':
      // The funds have moved; what is left is the network's finality depth.
      return {
        title: 'Transaction sent',
        detail: !final
          ? 'In a block · waiting for finality'
          : final.remaining === 0
            ? 'Final in a moment'
            : final.eta !== undefined
              ? `Final in ${formatEta(final.eta)} · ${final.remaining} blocks`
              : `Final after ${final.remaining} more blocks`,
      };
    case 'finalized':
      return { title: 'Transaction confirmed', detail: 'Final on Quantus' };
    case 'failed':
      return {
        title: tx?.status === 'expired' ? 'Transaction expired' : 'Transaction failed',
        detail:
          tx?.status === 'expired' || tx?.status === 'cancelled-before-broadcast'
            ? 'It was never included. Nothing was sent.'
            : 'The network rejected it. Only the network fee was charged.',
      };
  }
}

/** The transaction the wallet should follow: the newest unfinished one from the last 30 minutes. */
export function trackedTransaction<T extends ProgressTx>(
  txs: readonly T[],
  now: number,
  after = 0,
): T | undefined {
  return txs
    .filter((tx) => (tx.createdAt ?? 0) > Math.max(after, now - 30 * 60_000))
    .filter((tx) => !stageDone(txStage(tx)))
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
}
