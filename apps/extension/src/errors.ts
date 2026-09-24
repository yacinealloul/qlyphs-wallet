import {
  BUY_FUNDS_ERROR,
  FEE_FUNDS_ERROR,
  QLYPHS_FEE_ERROR,
  SALE_FEE_ERROR,
  SEND_FUNDS_ERROR,
  SEND_LOCKED_ERROR,
} from './send-balance.ts';
import {
  QLYPH_AMOUNT_ERROR,
  QLYPH_MINT_ERROR,
  QLYPH_READ_ERROR,
  QLYPH_SIZE_ERROR,
  SYMBOL_READ_ERROR,
  SYMBOL_TAKEN_PATTERN,
} from './qlyph-errors.ts';
/** Only fixed, locally authored messages cross into the UI. SDK exceptions and
 * arbitrary server strings may contain input data and are deliberately hidden. */
import {
  VAULT_PASSWORD_ERROR,
  VAULT_MODULE_ERROR,
  VAULT_IDENTITY_ERROR,
  VAULT_DATA_ERROR,
} from './vault.ts';
import { MAINNET_BUILD } from './profile.ts';
// Mainnet talks to hosted services, not a local node. Both wordings are known-safe messages; the
// active network (fixed, or chosen in a switchable build) picks which one is shown.
const TIMEOUT_MAINNET = 'The Quantus network did not respond in time. Retry the connection.';
const TIMEOUT_DEV = 'Your local Quantus node did not respond in time. Retry the connection.';
const UNREACHABLE_MAINNET = 'Cannot reach the Quantus network. Check your connection and retry.';
const UNREACHABLE_DEV = 'Cannot reach your local Quantus node. Check that it is running, then retry.';
/** Internal refusals worded for people: the wallet never names its services. */
const REWORDED: Readonly<Record<string, string>> = {
  'Wallet and indexer run different protocol versions. Reload the extension, or restart the indexer.':
    'The wallet needs an update. Reload the extension.',
  'Indexer is stale': 'Network data is catching up. Try again in a moment.',
};
const FALLBACK_MAINNET = 'Wallet operation failed. Check permissions, password and your connection.';
const FALLBACK_DEV =
  'Wallet operation failed. Check permissions, password and the configured development network.';
const pick = (mainnet: string, dev: string) => (MAINNET_BUILD ? mainnet : dev);
const safe = new Set([
  SEND_FUNDS_ERROR,
  SEND_LOCKED_ERROR,
  FEE_FUNDS_ERROR,
  BUY_FUNDS_ERROR,
  QLYPHS_FEE_ERROR,
  SALE_FEE_ERROR,
  QLYPH_AMOUNT_ERROR,
  QLYPH_MINT_ERROR,
  QLYPH_READ_ERROR,
  QLYPH_SIZE_ERROR,
  SYMBOL_READ_ERROR,
  'Another operation is pending; finish it before trying again',
  'Save and acknowledge your recovery backup first',
  'Wait for the previous operation to finalize. Unknown submissions are never recreated',
  'Wallet locked; unlock and request a new review',
  'Review changed; approve the new request',
  'Review expired',
  'Review expired during verification',
  'Request cancelled',
  'Account or network changed',
  'Archive capacity reached; preserve history before continuing',

  'Wallet reset in progress. Try again.',
  'Reset requires one locked wallet and explicit confirmation',
  VAULT_PASSWORD_ERROR,
  VAULT_MODULE_ERROR,
  VAULT_IDENTITY_ERROR,
  VAULT_DATA_ERROR,
  'Enter a name of 1–32 characters',
  'This extension can hold up to 20 wallets',
  'This extension can hold up to 20 accounts',
  'Unlock and back up this wallet before adding an account',
  'Wallet locked; try again',
  'Saved account identity does not match its derivation',
  'Could not derive this account',
  'Could not derive the backup accounts',
  'Backup account identity mismatch',
  'This wallet is already added. Select it from your accounts.',
  'Wallet not found',
  'Unlock your wallet before renaming accounts',
  'Unlock your wallet before changing accounts',
  'Link your saved wallets first',
  'Invalid linked wallet',
  'Could not open linked wallet. Keep your backups.',
  'Finish the current operation before changing accounts',
  'Unlock and back up your current wallet before adding another',
  'Account changed. Refresh this wallet.',

  'Allow notifications in Chrome first',
  'Enable notifications first',
  'Notifications are blocked by your browser',
  'Open the wallet in a tab to use a passkey',
  'Unlock and back up your wallet before adding a passkey',
  'Passkey request expired. Try again.',
  'Passkey could not unlock this wallet. Use your password.',
  'No passkey is linked to this wallet',
  'Passkey does not match this wallet',

  'The wallet background does not support this request. Reload the extension to finish updating.',
  TIMEOUT_MAINNET,
  TIMEOUT_DEV,
  UNREACHABLE_MAINNET,
  UNREACHABLE_DEV,
  'This wallet only works on Quantus mainnet',
  'Mainnet is disabled',
  'Wallet update pending. Reload the extension to finish updating.',
  'Unsupported runtime; signing disabled',
  'Incorrect network or protocol activation',
  'Wallet and indexer run different protocol versions. Reload the extension, or restart the indexer.',
  'Indexer is stale',
  'Finalized checkpoint mismatch',
  'Network configuration changed; reconnect explicitly',
  'RPC unavailable or invalid response',
  'Bundled signing module could not be loaded',
  'Wallet locked; approve again',
  'Unlock wallet first',
  'Review expired; start again',
  'Review block was reorganized',
  'Review is too old; start again',
  'Account nonce changed; review again',
  'Token sequence changed; review again',
  'Reservation changed; review again',
  'Reservation cancelled or already settled',
  'Reservation is not finalized, expired or assigned to another buyer',
  'Prepared call differs from requested action',
  'Invalid cost estimate or unexpected platform fee',
  'Another operation is awaiting approval',
  'Wait for the previous transaction finality; do not pay twice',
  'Request no longer exists',
  'Request cancelled or session changed',
  'Request expired or cancelled',
  'Request context changed',
  'Site permission revoked',
  'Wrong confirmation window',
  'Approval must come from its extension confirmation window',
  'Request expired',
  'Password must contain 6–256 characters',
  'Cannot unlock: incorrect password, damaged backup or incompatible identity',
]);
export function uiError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (Object.hasOwn(REWORDED, message)) return REWORDED[message]!;
  if (message === 'Unsupported UI operation')
    return 'The wallet background does not support this request. Reload the extension to finish updating.';
  if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))
    return pick(TIMEOUT_MAINNET, TIMEOUT_DEV);
  if (
    safe.has(message) ||
    SYMBOL_TAKEN_PATTERN.test(message) ||
    /^Service refused request \(\d{3}\); check network and permissions$/.test(message)
  )
    return message;
  if (
    message === 'Failed to fetch' ||
    message === 'NetworkError when attempting to fetch resource.'
  )
    return pick(UNREACHABLE_MAINNET, UNREACHABLE_DEV);
  return pick(FALLBACK_MAINNET, FALLBACK_DEV);
}
