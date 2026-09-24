/** Notifications never contain balances, addresses, token names, or signing actions. */
export interface NotificationTransaction {
  hash: string;
  status: string;
  nativeSuccess?: boolean | null;
  verdict?: string | null;
  notified?: string;
}
export function notificationOutcome(
  tx: NotificationTransaction,
): 'finalized' | 'failed' | 'expired' | undefined {
  if (tx.status === 'expired') return 'expired';
  if (tx.status !== 'finalized') return undefined;
  if (tx.nativeSuccess === false || tx.verdict?.startsWith('rejected')) return 'failed';
  if (tx.nativeSuccess === true) return 'finalized';
  return undefined;
}
export function notificationText(outcome: ReturnType<typeof notificationOutcome>) {
  return {
    title:
      outcome === 'failed'
        ? 'Qlyphs · Operation failed'
        : outcome === 'expired'
          ? 'Qlyphs · Operation expired'
          : 'Qlyphs · Operation finalized',
    message: 'Open the transaction in Qlyphs Explorer to review the result. No action is taken automatically.',
  };
}
export function notificationCandidates(txs: NotificationTransaction[]) {
  return txs.filter((tx) => notificationOutcome(tx) && !tx.notified);
}
