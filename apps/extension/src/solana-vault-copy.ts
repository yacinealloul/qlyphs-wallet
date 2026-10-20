/** Solana vault wording shared by the background and the UI: the refusals a window may show. No
 * signing code, so the UI bundle can import it. */
export const SOLANA_VAULT_FORMAT_ERROR = 'This vault authorization is not one this wallet signs';
export const SOLANA_VAULT_KEY_ERROR = 'This vault does not belong to the active account';
export const SOLANA_VAULT_WINDOW_ERROR =
  'This vault authorization is not valid from now: it starts later, has expired or lasts too long';
export const SOLANA_VAULT_SLOT_ERROR = 'Could not read the current Solana slot; try again';
export const SOLANA_VAULT_ERRORS: readonly string[] = [
  SOLANA_VAULT_FORMAT_ERROR,
  SOLANA_VAULT_KEY_ERROR,
  SOLANA_VAULT_WINDOW_ERROR,
  SOLANA_VAULT_SLOT_ERROR,
];
