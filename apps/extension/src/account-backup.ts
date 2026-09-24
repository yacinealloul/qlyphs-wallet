/** Public account metadata accompanies the encrypted phrase. Every identity is
 * re-derived after decryption; backup metadata is never trusted for signing. */
import { fromHex, requireThat } from '../../../packages/native/src/codec.ts';
import { validateVault } from './vault.ts';
import type { Vault, Identity } from './vault.ts';
import { accountName, MAX_ACCOUNTS, recordIdentity, walletRecords } from './accounts.ts';
import type { AccountBook } from './accounts.ts';

export interface BackupAccount extends Identity {
  index: number;
  name: string;
}
export interface WalletBackup {
  version: 3;
  vault: Vault;
  accounts: BackupAccount[];
  selected: number;
}
export function exportWallet(book: AccountBook): Vault | WalletBackup {
  requireThat(book.vault, 'Wallet not found');
  const accounts = walletRecords(book)
    .map((a) => ({ ...recordIdentity(a), index: a.derived?.index ?? 0, name: a.name }))
    .sort((a, b) => a.index - b.index);
  if (accounts.length === 1) return book.vault!;
  return { version: 3, vault: book.vault!, accounts, selected: book.derived?.index ?? 0 };
}
export function parseWalletBackup(input: unknown, genesis: string): WalletBackup {
  const value = input as WalletBackup;
  if (value?.version !== 3) {
    const vault = validateVault(input, genesis);
    return {
      version: 3,
      vault,
      accounts: [{ index: 0, name: 'Account 1', owner: vault.owner, address: vault.address }],
      selected: 0,
    };
  }
  requireThat(
    Object.keys(value).length === 4 &&
      ['version', 'vault', 'accounts', 'selected'].every((k) => Object.hasOwn(value, k)),
    'Invalid wallet backup',
  );
  const vault = validateVault(value.vault, genesis);
  requireThat(
    Array.isArray(value.accounts) &&
      value.accounts.length > 0 &&
      value.accounts.length <= MAX_ACCOUNTS,
    'Invalid backup accounts',
  );
  const owners = new Set<string>();
  const accounts = value.accounts.map((a, i) => {
    requireThat(a && a.index === i && Object.keys(a).length === 4, 'Invalid backup account index');
    fromHex(a.owner, 32);
    requireThat(
      !owners.has(a.owner) &&
        typeof a.address === 'string' &&
        a.address.length > 0 &&
        a.address.length < 80,
      'Invalid backup account',
    );
    owners.add(a.owner);
    return { index: i, name: accountName(a.name), owner: a.owner, address: a.address };
  });
  requireThat(
    accounts[0]!.owner === vault.owner && accounts[0]!.address === vault.address,
    'Backup root identity mismatch',
  );
  requireThat(
    Number.isSafeInteger(value.selected) && value.selected >= 0 && value.selected < accounts.length,
    'Invalid selected account',
  );
  return { version: 3, vault, accounts, selected: value.selected };
}
export async function verifyBackupAccounts(
  backup: WalletBackup,
  phrase: string,
  derive: (phrase: string, index: number) => Promise<Identity>,
): Promise<void> {
  for (const a of backup.accounts) {
    let who: Identity;
    try {
      who = await derive(phrase, a.index);
    } catch {
      throw Error('Could not derive the backup accounts');
    }
    requireThat(
      who.owner === a.owner && who.address === a.address,
      'Backup account identity mismatch',
    );
  }
}
