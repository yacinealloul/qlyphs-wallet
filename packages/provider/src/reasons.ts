/** Why a wallet refused or failed a request: a fixed list of public reason codes and their wording. */

/** `now`: a new request can succeed as it is. `after-action`: it can once the user does what the
 * text says. `no`: it cannot until something changes outside this request (a wallet update, another
 * reservation). */
export type ReasonRetry = 'now' | 'after-action' | 'no';

/**
 * Every reason a wallet may report. The wallet picks one from its own local checks; nothing in a
 * code or its text comes from a remote service or from the request. The texts are written for the
 * person using the site and never say whether anything was sent: the error's `outcome` does.
 */
export const FAILURE_REASONS = Object.freeze({
  'wallet-outdated': {
    retry: 'after-action',
    text: 'The wallet was updated while it was open. Close all its tabs and windows, then try again.',
  },
  'rules-mismatch': {
    retry: 'no',
    text: 'The wallet and the network services follow different protocol rules. Update the wallet, then try again.',
  },
  'network-mismatch': {
    retry: 'no',
    text: 'The wallet is set to a different network than this site.',
  },
  'witness-unavailable': {
    retry: 'now',
    text: 'The network verification service did not answer. Try again in a minute.',
  },
  'witness-invalid': {
    retry: 'no',
    text: 'The network verification did not check out, so the wallet stopped.',
  },
  'policy-expired': {
    retry: 'no',
    text: 'The verification keys built into this wallet have expired. Update the wallet.',
  },
  'clock-skew': {
    retry: 'after-action',
    text: "This device's clock looks wrong. Set it to the correct time, then try again.",
  },
  'attestation-rollback': {
    retry: 'no',
    text: 'The network reported an older state than this wallet has already seen, so the wallet stopped.',
  },
  'attestation-storage': {
    retry: 'after-action',
    text: 'The wallet could not use its browser storage. Allow site data for the wallet, then try again.',
  },
  'reservation-unconfirmed': {
    retry: 'now',
    text: 'Your reservation is not final on the network yet, or it is about to expire. Wait a few blocks, then try again.',
  },
  'reservation-closed': {
    retry: 'no',
    text: 'This reservation was cancelled, settled or has expired.',
  },
  'reservation-mismatch': {
    retry: 'no',
    text: 'This purchase does not match your reservation.',
  },
  'not-final': {
    retry: 'now',
    text: 'This is not final on the network yet. Wait a few blocks, then try again.',
  },
  'previous-pending': {
    retry: 'now',
    text: 'Your previous transaction is not final yet. Wait for it to finish, then try again.',
  },
  'wallet-busy': {
    retry: 'now',
    text: 'The wallet is busy with another request. Finish it, then try again.',
  },
  'network-catching-up': {
    retry: 'now',
    text: 'Network data is catching up. Try again in a moment.',
  },
  'service-error': {
    retry: 'now',
    text: 'A network service answered with an error. Try again in a moment.',
  },
  unreachable: {
    retry: 'now',
    text: 'The network could not be reached. Check your connection, then try again.',
  },
  timeout: {
    retry: 'now',
    text: 'The network did not answer in time. Try again.',
  },
  'state-changed': {
    retry: 'now',
    text: 'The network changed while you were reviewing. Review again.',
  },
  'review-expired': {
    retry: 'now',
    text: 'The review expired. Start again from the site.',
  },
  cancelled: {
    retry: 'now',
    text: 'The request was cancelled. Start again from the site.',
  },
  'insufficient-funds': {
    retry: 'after-action',
    text: 'Not enough available QTC for this transaction and its fees.',
  },
  'fee-changed': {
    retry: 'now',
    text: 'The fee for this transaction changed. Review again.',
  },
  'wallet-locked': {
    retry: 'after-action',
    text: 'The wallet is locked. Unlock it, then try again.',
  },
  'not-connected': {
    retry: 'after-action',
    text: 'This site is not connected to the wallet account. Connect it, then try again.',
  },
  'backup-required': {
    retry: 'after-action',
    text: 'Back up your recovery phrase in the wallet first.',
  },
  'window-blocked': {
    retry: 'after-action',
    text: 'The wallet window could not open. Allow pop-ups for this site, then try again.',
  },
  'history-full': {
    retry: 'after-action',
    text: "The wallet's history is full. Archive older entries, then try again.",
  },
  'signing-failed': {
    retry: 'no',
    text: 'The wallet could not sign this transaction.',
  },
  'not-available': {
    retry: 'no',
    text: 'This wallet cannot do this on this network.',
  },
} as const satisfies Record<string, { retry: ReasonRetry; text: string }>);

export type FailureReason = keyof typeof FAILURE_REASONS;
export const FAILURE_REASON_CODES = Object.freeze(Object.keys(FAILURE_REASONS) as FailureReason[]);

/** The value as a known reason, or undefined: anything else is dropped, never reflected. */
export function failureReason(value: unknown): FailureReason | undefined {
  return typeof value === 'string' && Object.hasOwn(FAILURE_REASONS, value)
    ? (value as FailureReason)
    : undefined;
}
/** The plain-English sentence for a reason. */
export const reasonText = (reason: FailureReason): string => FAILURE_REASONS[reason].text;
/** Whether a new request can succeed, possibly after the action the text names. A write whose
 * outcome is unknown is never retryable: it may already be on the network. */
export const reasonRetryable = (reason: FailureReason, outcome?: string): boolean =>
  outcome !== 'unknown' && FAILURE_REASONS[reason].retry !== 'no';
