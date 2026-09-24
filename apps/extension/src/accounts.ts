/** Accounts share their wallet's encrypted root phrase. Legacy records are index 0. */
import { fromHex, requireThat } from '../../../packages/native/src/codec.ts';
import { validateVault } from './vault.ts';
import type { Vault, Identity } from './vault.ts';
import { validatePasskey } from './passkey-vault.ts';
import type { PasskeyVault } from './passkey-vault.ts';
export const MAX_ACCOUNTS = 20;
export interface DerivedAccount extends Identity {
  index: number;
}
export interface StoredAccount {
  vault: Vault;
  derived?: DerivedAccount;
  name: string;
  accountIndex: number;
  backed: boolean;
  grants: Record<string, { owner: string; genesis: string }>;
  passkey?: PasskeyVault;
}
export interface AccountBook {
  vault?: Vault;
  derived?: DerivedAccount;
  name?: string;
  accountIndex?: number;
  backed: boolean;
  grants: StoredAccount['grants'];
  passkey?: PasskeyVault;
  otherAccounts: StoredAccount[];
}
export function recordIdentity(record: Pick<StoredAccount, 'vault' | 'derived'>): Identity {
  const { owner, address } = record.derived ?? record.vault;
  return { owner, address };
}
export function walletRecords(book: AccountBook): StoredAccount[] {
  return records(book).filter((a) => a.vault.owner === book.vault?.owner);
}
export function nextDerivation(book: AccountBook): number {
  return Math.max(0, ...walletRecords(book).map((a) => a.derived?.index ?? 0)) + 1;
}
/** Passkey removal applies to the wallet, including all of its derived accounts. */
export function setWalletPasskey(book: AccountBook, passkey?: PasskeyVault): void {
  const targets = [book, ...book.otherAccounts.filter((a) => a.vault.owner === book.vault?.owner)];
  for (const target of targets) {
    if (passkey) target.passkey = passkey;
    else delete target.passkey;
  }
}
export function accountName(input: unknown): string {
  requireThat(typeof input === 'string', 'Enter a name of 1–32 characters');
  const name = (input as string).trim();
  requireThat(
    name.length > 0 && name.length <= 32 && !/[\p{Cc}\p{Cf}]/u.test(name),
    'Enter a name of 1–32 characters',
  );
  return name;
}
export function activeRecord(book: AccountBook): StoredAccount {
  requireThat(book.vault, 'No wallet selected');
  return {
    vault: book.vault!,
    ...(book.derived ? { derived: book.derived } : {}),
    name: book.name!,
    accountIndex: book.accountIndex!,
    backed: book.backed,
    grants: book.grants,
    ...(book.passkey ? { passkey: book.passkey } : {}),
  };
}
export function records(book: AccountBook): StoredAccount[] {
  return [...(book.vault ? [activeRecord(book)] : []), ...book.otherAccounts].sort(
    (a, b) => a.accountIndex - b.accountIndex,
  );
}
export function activate(book: AccountBook, next: StoredAccount): void {
  book.vault = next.vault;
  if (next.derived) book.derived = next.derived;
  else delete book.derived;
  book.name = next.name;
  book.accountIndex = next.accountIndex;
  book.backed = next.backed;
  book.grants = next.grants;
  if (next.passkey) book.passkey = next.passkey;
  else delete book.passkey;
}
export function addAccount(book: AccountBook, vault: Vault, backed: boolean): void {
  const all = records(book);
  requireThat(all.length < MAX_ACCOUNTS, 'This extension can hold up to 20 accounts');
  requireThat(
    !all.some((a) => a.vault.owner === vault.owner),
    'This wallet is already added. Select it from your accounts.',
  );
  const index = Math.max(0, ...all.map((a) => a.accountIndex)) + 1;
  if (book.vault) book.otherAccounts.push(activeRecord(book));
  activate(book, { vault, backed, name: `Account ${index}`, accountIndex: index, grants: {} });
}
export function addDerivedAccount(book: AccountBook, identity: Identity, index: number): void {
  const all = records(book);
  requireThat(book.vault && book.backed, 'Back up this wallet first');
  requireThat(all.length < MAX_ACCOUNTS, 'This extension can hold up to 20 accounts');
  requireThat(
    Number.isSafeInteger(index) && index === nextDerivation(book) && index < MAX_ACCOUNTS,
    'Invalid account derivation',
  );
  requireThat(
    !all.some((a) => recordIdentity(a).owner === identity.owner),
    'This account is already added',
  );
  const previous = activeRecord(book);
  book.otherAccounts.push(previous);
  activate(book, {
    vault: previous.vault,
    derived: { owner: identity.owner, address: identity.address, index },
    backed: true,
    name: `Account ${index + 1}`,
    accountIndex: Math.max(...all.map((a) => a.accountIndex)) + 1,
    grants: {},
    ...(previous.passkey ? { passkey: previous.passkey } : {}),
  });
}
export function selectAccount(book: AccountBook, owner: string): void {
  if (book.vault && recordIdentity(activeRecord(book)).owner === owner) return;
  const index = book.otherAccounts.findIndex((a) => recordIdentity(a).owner === owner);
  requireThat(index >= 0, 'Wallet not found');
  const previous = activeRecord(book),
    next = book.otherAccounts[index]!;
  book.otherAccounts[index] = previous;
  activate(book, next);
}
export function validateAccounts(
  book: AccountBook,
  genesis: string | undefined,
  origin: string,
): void {
  requireThat(
    Array.isArray(book.otherAccounts) && book.otherAccounts.length < MAX_ACCOUNTS,
    'Invalid saved accounts',
  );
  requireThat(book.vault || !book.otherAccounts.length, 'Invalid saved accounts');
  const all = records(book),
    owners = new Set<string>(),
    indices = new Set<number>();
  for (const a of all) {
    requireThat(genesis, 'Missing network configuration');
    validateVault(a.vault, genesis!);
    accountName(a.name);
    if (a.derived) {
      const d = a.derived;
      requireThat(
        Number.isSafeInteger(d.index) && d.index > 0 && d.index < MAX_ACCOUNTS,
        'Invalid account derivation',
      );
      fromHex(d.owner, 32);
      requireThat(
        typeof d.address === 'string' && d.address.length > 0 && d.address.length < 80,
        'Invalid account address',
      );
      const root = all.find((r) => !r.derived && r.vault.owner === a.vault.owner);
      requireThat(
        root &&
          Object.keys(a.vault).every(
            (k) => a.vault[k as keyof Vault] === root.vault[k as keyof Vault],
          ),
        'Missing or inconsistent wallet root',
      );
      requireThat(
        all.filter((r) => r.vault.owner === a.vault.owner && r.derived?.index === d.index)
          .length === 1,
        'Duplicate account derivation',
      );
    }
    const owner = recordIdentity(a).owner;
    requireThat(
      Number.isSafeInteger(a.accountIndex) && a.accountIndex > 0 && typeof a.backed === 'boolean',
      'Invalid saved account',
    );
    requireThat(!owners.has(owner) && !indices.has(a.accountIndex), 'Duplicate saved account');
    owners.add(owner);
    indices.add(a.accountIndex);
    requireThat(
      a.grants && typeof a.grants === 'object' && !Array.isArray(a.grants),
      'Invalid site permissions',
    );
    for (const grant of Object.values(a.grants))
      requireThat(grant?.owner === owner && grant.genesis === genesis, 'Invalid site permissions');
    if (a.passkey) validatePasskey(a.passkey, a.vault, origin);
  }
}
