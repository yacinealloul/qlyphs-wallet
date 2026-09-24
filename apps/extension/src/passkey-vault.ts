/** Optional local unlock envelope. The password vault remains the recovery/export format.
 * A WebAuthn PRF output is key material, never an authentication boolean.
 */
import { fromHex, hex, requireThat } from '../../../packages/native/src/codec.ts';
import type { Vault, Derive } from './vault.ts';
import { buildGenesis } from './profile.ts';
export interface PasskeyVault {
  version: 1;
  credentialId: string;
  salt: string;
  iv: string;
  cipher: string;
  owner: string;
  address: string;
  genesis: string;
  origin: string;
}
const bytes = (value: Uint8Array) => new Uint8Array(value).buffer;
function aad(v: PasskeyVault) {
  return new TextEncoder().encode(
    JSON.stringify({
      version: v.version,
      credentialId: v.credentialId,
      salt: v.salt,
      owner: v.owner,
      address: v.address,
      genesis: v.genesis,
      origin: v.origin,
    }),
  );
}
export function validatePasskey(input: unknown, vault: Vault, origin: string): PasskeyVault {
  requireThat(
    input && typeof input === 'object' && !Array.isArray(input),
    'Invalid passkey envelope',
  );
  const v = input as PasskeyVault;
  const fields = [
    'version',
    'credentialId',
    'salt',
    'iv',
    'cipher',
    'owner',
    'address',
    'genesis',
    'origin',
  ];
  requireThat(
    Object.keys(v).length === fields.length && fields.every((k) => Object.hasOwn(v, k)),
    'Invalid passkey envelope',
  );
  requireThat(
    v.version === 1 &&
      v.owner === vault.owner &&
      v.address === vault.address &&
      v.genesis === vault.genesis &&
      buildGenesis(v.genesis) &&
      v.origin === origin,
    'Passkey belongs to a different wallet or extension',
  );
  requireThat(
    typeof v.credentialId === 'string' &&
      v.credentialId.length >= 4 &&
      v.credentialId.length <= 2050,
    'Invalid passkey credential',
  );
  fromHex(v.credentialId);
  fromHex(v.salt, 32);
  fromHex(v.iv, 12);
  requireThat(
    typeof v.cipher === 'string' && v.cipher.length >= 34 && v.cipher.length <= 2048,
    'Invalid passkey envelope',
  );
  fromHex(v.cipher);
  return { ...v };
}
async function key(prf: Uint8Array, v: PasskeyVault): Promise<CryptoKey> {
  requireThat(prf.byteLength === 32, 'Passkey encryption is unavailable');
  const base = await crypto.subtle.importKey('raw', bytes(prf), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: bytes(fromHex(v.salt)),
      info: bytes(new TextEncoder().encode('qlyphs/passkey-unlock/v1')),
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
export async function wrapPasskey(
  clear: Uint8Array,
  prf: Uint8Array,
  vault: Vault,
  origin: string,
  credentialId: string,
  salt: string,
): Promise<PasskeyVault> {
  const v: PasskeyVault = {
    version: 1,
    credentialId,
    salt,
    iv: hex(crypto.getRandomValues(new Uint8Array(12))),
    cipher: '0x' + '00'.repeat(16),
    owner: vault.owner,
    address: vault.address,
    genesis: vault.genesis,
    origin,
  };
  validatePasskey(v, vault, origin);
  const k = await key(prf, v);
  v.cipher = hex(
    new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: bytes(fromHex(v.iv)), additionalData: bytes(aad(v)) },
        k,
        bytes(clear),
      ),
    ),
  );
  return validatePasskey(v, vault, origin);
}
export async function unwrapPasskey(
  input: unknown,
  prf: Uint8Array,
  vault: Vault,
  origin: string,
  derive: Derive,
): Promise<Uint8Array> {
  let clear: Uint8Array | undefined;
  try {
    const v = validatePasskey(input, vault, origin),
      k = await key(prf, v);
    clear = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: bytes(fromHex(v.iv)), additionalData: bytes(aad(v)) },
        k,
        bytes(fromHex(v.cipher)),
      ),
    );
    const identity = await derive(new TextDecoder('utf-8', { fatal: true }).decode(clear));
    requireThat(
      identity.owner === vault.owner && identity.address === vault.address,
      'Passkey identity mismatch',
    );
    return clear;
  } catch {
    clear?.fill(0);
    throw Error('Passkey could not unlock this wallet. Use your password.');
  }
}
