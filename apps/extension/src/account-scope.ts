/** Messages from an old popup must never silently act on a newly selected wallet. */
export const ACCOUNT_SCOPED_ACTIONS = new Set([
  'unlock',
  'ack',
  'backup',
  'locked-backup',
  'wallet-reset',
  'recovery',
  'revoke',
  'transact',
  'passkey-begin',
  'passkey-remove',
  'account-create',
  'account-derive',
  'account-import',
  'account-restore',
]);
