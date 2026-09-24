/** Local installation access. Backups retain their own portable password vaults.
 * A domain-separated key derived from the first wallet wraps independent roots.
 * No password or plaintext recovery material is persisted here.
 */
import { fromHex, hex, requireThat } from '../../../packages/native/src/codec.ts';
import type { Vault, Derive } from './vault.ts';
import { VAULT_IDENTITY_ERROR, VAULT_MODULE_ERROR } from './vault.ts';

export interface LinkedWallet {
  version: 1;
  salt: string;
  iv: string;
  cipher: string;
}
export interface WalletAccess {
  owner: string;
  wallets: Record<string, LinkedWallet>;
}
const bytes = (value: Uint8Array) => new Uint8Array(value).buffer;
const context = (anchor: Vault, target: Vault, origin: string) =>
  new TextEncoder().encode(
    JSON.stringify({
      purpose: 'qlyphs/installation-access/v1',
      anchor: anchor.owner,
      owner: target.owner,
      address: target.address,
      genesis: target.genesis,
      origin,
    }),
  );
export function validateLinkedWallet(value: LinkedWallet): void {
  requireThat(
    value && value.version === 1 && Object.keys(value).length === 4,
    'Invalid linked wallet',
  );
  fromHex(value.salt, 32);
  fromHex(value.iv, 12);
  requireThat(
    typeof value.cipher === 'string' && value.cipher.length >= 34 && value.cipher.length <= 2048,
    'Invalid linked wallet',
  );
  fromHex(value.cipher);
}
async function key(root: Uint8Array, salt: string, info: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', bytes(root), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: bytes(fromHex(salt)), info: bytes(info) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
export async function linkWallet(
  root: Uint8Array,
  clear: Uint8Array,
  anchor: Vault,
  target: Vault,
  origin: string,
): Promise<LinkedWallet> {
  requireThat(
    anchor.genesis === target.genesis && anchor.owner !== target.owner,
    'Invalid linked wallet',
  );
  const info = context(anchor, target, origin);
  const value: LinkedWallet = {
    version: 1,
    salt: hex(crypto.getRandomValues(new Uint8Array(32))),
    iv: hex(crypto.getRandomValues(new Uint8Array(12))),
    cipher: '',
  };
  const k = await key(root, value.salt, info);
  value.cipher = hex(
    new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: bytes(fromHex(value.iv)), additionalData: bytes(info) },
        k,
        bytes(clear),
      ),
    ),
  );
  return value;
}
export async function openLinkedWallet(
  value: LinkedWallet,
  root: Uint8Array,
  anchor: Vault,
  target: Vault,
  origin: string,
  derive: Derive,
): Promise<Uint8Array> {
  validateLinkedWallet(value);
  const info = context(anchor, target, origin),
    k = await key(root, value.salt, info);
  let clear: Uint8Array;
  try {
    clear = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: bytes(fromHex(value.iv)), additionalData: bytes(info) },
        k,
        bytes(fromHex(value.cipher)),
      ),
    );
  } catch {
    throw Error('Could not open linked wallet. Keep your backups.');
  }
  try {
    let who;
    try {
      who = await derive(new TextDecoder('utf-8', { fatal: true }).decode(clear));
    } catch {
      throw Error(VAULT_MODULE_ERROR);
    }
    requireThat(who.owner === target.owner && who.address === target.address, VAULT_IDENTITY_ERROR);
    return clear;
  } catch (error) {
    clear.fill(0);
    throw error;
  }
}
