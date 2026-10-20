/** Maps the wallet's own refusals to the public reason codes of packages/provider (reasons.ts). */
import {
  BUY_FUNDS_ERROR,
  FEE_FUNDS_ERROR,
  QLYPHS_FEE_ERROR,
  SALE_FEE_ERROR,
  SEND_FUNDS_ERROR,
  SEND_LOCKED_ERROR,
} from './send-balance.ts';
import { FEES_UNVERIFIED_ERROR } from './fee-copy.ts';
import { VAULT_MODULE_ERROR } from './vault.ts';
import { WRONG_NETWORK_ERROR } from './profile.ts';
import { QlyphsError, reasonText } from '../../../packages/provider/src/index.ts';
import type { FailureReason } from '../../../packages/provider/src/index.ts';

/**
 * Exact internal messages and the reason each one stands for. They are the fixed texts of the
 * wallet's checks (background, network reads, witness verification, the attestation cursor), never
 * text received from a service. A message missing here maps to no reason, and the site then sees
 * only the error code, as before reasons existed.
 */
const BY_MESSAGE: Readonly<Record<string, FailureReason>> = {
  // A wallet build that no longer matches the live one, or the indexer's protocol.
  'Wallet update pending. Reload the extension to finish updating.': 'wallet-outdated',
  'The wallet background does not support this request. Reload the extension to finish updating.':
    'wallet-outdated',
  'Unsupported UI operation': 'wallet-outdated',
  'Qlyphs Keys was updated; close its other tabs and windows': 'wallet-outdated',
  'Wallet and indexer run different protocol versions. Reload the extension, or restart the indexer.':
    'rules-mismatch',
  // Witness statements signed under other rules, policy, runtime or network than the pinned ones.
  'foreign policy/network/runtime/rules': 'rules-mismatch',
  'attestation network mismatch': 'network-mismatch',
  'Unsupported runtime; signing disabled': 'network-mismatch',
  'Incorrect network or protocol activation': 'network-mismatch',
  'Finalized checkpoint mismatch': 'network-mismatch',
  'Network configuration changed; reconnect explicitly': 'network-mismatch',
  'Mainnet is disabled': 'network-mismatch',
  'This wallet only works on Quantus mainnet': 'network-mismatch',
  // The attestation service refused, or sent something that is not a valid bundle.
  'attestation endpoint unavailable': 'witness-unavailable',
  'attestation response too large': 'witness-invalid',
  'attestation response limit': 'witness-invalid',
  'divergent state/challenge': 'witness-invalid',
  'divergent parent': 'witness-invalid',
  'duplicate/untrusted witness': 'witness-invalid',
  'unknown/revoked/expired key': 'witness-invalid',
  'invalid ML-DSA signature': 'witness-invalid',
  'witness count': 'witness-invalid',
  'one attestation per endpoint': 'witness-invalid',
  'snapshot required': 'witness-invalid',
  'proof too large': 'witness-invalid',
  'before activation': 'witness-invalid',
  'noncanonical snapshot': 'witness-invalid',
  'tip at another block': 'witness-invalid',
  'trust policy expired': 'policy-expired',
  'no live key for operator': 'policy-expired',
  'stale/future attestation': 'clock-skew',
  'Attestation checkpoint rollback or equivocation': 'attestation-rollback',
  'checkpoint/policy rollback': 'attestation-rollback',
  'checkpoint equivocation': 'attestation-rollback',
  'cannot open attestation cursor store': 'attestation-storage',
  'Corrupt attestation checkpoint': 'attestation-storage',
  'Cannot persist attestation checkpoint': 'attestation-storage',
  // Reservations (reserve purchases and offers).
  'not a finalized live reservation for buyer': 'reservation-unconfirmed',
  'Reservation is not finalized, expired or assigned to another buyer': 'reservation-unconfirmed',
  'Reservation cancelled or already settled': 'reservation-closed',
  'purchase differs from attested reservation': 'reservation-mismatch',
  'not canonical purchase': 'reservation-mismatch',
  'mint right is not finalized': 'not-final',
  'The next lot is not final yet; try again shortly': 'not-final',
  // Reads of the network.
  'Indexer is stale': 'network-catching-up',
  'RPC unavailable or invalid response': 'service-error',
  'Missing response': 'service-error',
  'Response too large': 'service-error',
  'Invalid amount from service': 'service-error',
  'Invalid reservation': 'service-error',
  'Invalid ticket': 'service-error',
  'Failed to fetch': 'unreachable',
  'NetworkError when attempting to fetch resource.': 'unreachable',
  // The review no longer matches the network or the request.
  'Account nonce changed; review again': 'state-changed',
  'Token sequence changed; review again': 'state-changed',
  'Reservation changed; review again': 'state-changed',
  'Review changed; approve the new request': 'state-changed',
  'Review block was reorganized': 'state-changed',
  'Review is too old; start again': 'state-changed',
  'Call changed after approval': 'state-changed',
  'Prepared call differs from requested action': 'state-changed',
  'Prepared at another block than the attested one': 'state-changed',
  'The lot must be signed on its attested block': 'state-changed',
  'lot is no longer the next lot in attested state': 'state-changed',
  'mint differs from the attested right': 'state-changed',
  'Account or network changed': 'state-changed',
  'Request context changed': 'state-changed',
  'Review expired': 'review-expired',
  'Review expired during verification': 'review-expired',
  'Review expired; start again': 'review-expired',
  'Request expired': 'review-expired',
  'Request expired or cancelled': 'review-expired',
  'Request cancelled': 'cancelled',
  'Request cancelled or session changed': 'cancelled',
  'Request no longer exists': 'cancelled',
  // The wallet's own state.
  'Wait for the previous operation to finalize. Unknown submissions are never recreated':
    'previous-pending',
  'Wait for the previous transaction finality; do not pay twice': 'previous-pending',
  'Too many mint sessions are still settling; try again once their payments are final':
    'previous-pending',
  'Another operation is pending; finish it before trying again': 'wallet-busy',
  'Another operation is pending': 'wallet-busy',
  'Another operation is awaiting approval': 'wallet-busy',
  'Too many outstanding requests': 'wallet-busy',
  'Wallet locked; unlock and request a new review': 'wallet-locked',
  'Wallet locked; approve again': 'wallet-locked',
  'Wallet locked; try again': 'wallet-locked',
  'Unlock wallet first': 'wallet-locked',
  'Connect this site first': 'not-connected',
  'Site permission revoked': 'not-connected',
  'Wrong account, network or permission': 'not-connected',
  'Save and acknowledge your recovery backup first': 'backup-required',
  'Confirmation window could not be opened': 'window-blocked',
  'Archive capacity reached; preserve history before continuing': 'history-full',
  'Local signature failed': 'signing-failed',
  'SDK signature output failed validation': 'signing-failed',
  'Bundled signing module could not be loaded': 'signing-failed',
  [VAULT_MODULE_ERROR]: 'signing-failed',
  // Funds and fees.
  [BUY_FUNDS_ERROR]: 'insufficient-funds',
  [SEND_FUNDS_ERROR]: 'insufficient-funds',
  [SEND_LOCKED_ERROR]: 'insufficient-funds',
  [FEE_FUNDS_ERROR]: 'insufficient-funds',
  [QLYPHS_FEE_ERROR]: 'fee-changed',
  [SALE_FEE_ERROR]: 'fee-changed',
  'Invalid cost estimate or unexpected platform fee': 'fee-changed',
  [FEES_UNVERIFIED_ERROR]: 'service-error',
  // This build cannot do it on this network.
  'Purchase disabled: trusted PQ witnesses are not configured': 'not-available',
  'Purchases disabled: no bundled PQ witness policy': 'not-available',
  'Trusted PQ witnesses are not configured': 'not-available',
  'Progressive mint disabled: no bundled PQ witness policy': 'not-available',
  'Progressive mint disabled: trusted PQ witnesses are not configured': 'not-available',
  'Progressive tokens are not enabled on mainnet': 'not-available',
  'Mint sessions are not available on this network': 'not-available',
};
/** What Chrome, Firefox and Safari say when fetch() could not reach a service. */
const FETCH_FAILURES = new Set([
  'Failed to fetch',
  'NetworkError when attempting to fetch resource.',
  'Load failed',
]);
const PATTERNS: readonly (readonly [RegExp, FailureReason])[] = [
  [/^Service refused request \(\d{3}\); check network and permissions$/, 'service-error'],
  [/^Lot \d{1,4} (is no longer the next lot; lot \d{1,4} is|was just taken; review again)$/, 'state-changed'],
];

/**
 * The reason behind `error`, read from the wallet's own message and error kind. The cause chain is
 * followed, because the background rethrows a refusal with its user wording and keeps the original
 * as `cause`. The message itself never leaves the wallet: only the code does.
 */
export function reasonOf(error: unknown): FailureReason | undefined {
  for (let e = error, depth = 0; e && depth < 4; e = (e as { cause?: unknown }).cause, depth++) {
    if (e instanceof QlyphsError && e.reason) return e.reason;
    if (!(e instanceof Error)) return undefined;
    const known = Object.hasOwn(BY_MESSAGE, e.message) ? BY_MESSAGE[e.message] : undefined;
    if (known) return known;
    if (e.message === WRONG_NETWORK_ERROR) return 'network-mismatch';
    for (const [pattern, reason] of PATTERNS) if (pattern.test(e.message)) return reason;
    if (e.name === 'TimeoutError') return 'timeout';
    // A body that is not JSON: a proxy or gateway error page instead of the service's answer.
    if (e instanceof SyntaxError) return 'service-error';
    // fetch() reports a refused, blocked or offline request as a TypeError with one of these browser
    // messages. Other TypeErrors are bugs, not the network, and get no reason.
    if (e instanceof TypeError && FETCH_FAILURES.has(e.message)) return 'unreachable';
  }
  return undefined;
}

/** What the wallet window shows for a reason: its sentence, then its code, which a user can quote
 * when asking for help. */
export const reasonLine = (reason: FailureReason): string => `${reasonText(reason)} Code: ${reason}.`;
