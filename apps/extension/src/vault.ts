/** Versioned authenticated vault. No browser storage, messaging or signing here.
 * v1 is the existing web-wallet format. v2 raises the work factor; both bind the
 * same legacy ML-DSA-87 derivation. JS strings cannot be reliably zeroized. */
import { fromHex, hex, requireThat } from '../../../packages/native/src/codec.ts';
import type { NetworkProfile } from '../../native/src/network.ts';
import { buildGenesis, requireBuildGenesis } from './profile.ts';
export const PATH = "m/44'/189189'/0'/0'/0'";
export const VAULT_PASSWORD_ERROR = 'Cannot unlock: incorrect password or damaged backup';
export const VAULT_MODULE_ERROR = 'Password accepted, but the wallet signing module failed. Reload the extension and try again.';
export const VAULT_IDENTITY_ERROR = 'Password accepted, but the saved wallet identity does not match. Keep your backup and use the compatible wallet version.';
export const VAULT_DATA_ERROR = 'Password accepted, but the recovery data is invalid. Use a valid backup.';
export interface Identity { owner: string; address: string }
export interface Vault extends Identity {
  version: 1 | 2; genesis: string; scheme: 'ml-dsa-87'; path: string;
  salt: string; iv: string; iterations: number; cipher: string;
}
export type Derive = (phrase: string) => Promise<Identity>;
const work = (version: 1 | 2) => version === 1 ? 310000 : 600000;
const buffer = (b: Uint8Array): ArrayBuffer => new Uint8Array(b).buffer;
function aad(v: Vault): Uint8Array {
  // Keep this order: it is part of the v1 web-backup compatibility contract.
  return new TextEncoder().encode(JSON.stringify({version:v.version,genesis:v.genesis,
    scheme:v.scheme,path:v.path,owner:v.owner,address:v.address}));
}
/** `profile` defaults to the active network; carrying a wallet across networks names its source. */
export function validateVault(input: unknown, genesis: string, profile?: NetworkProfile): Vault {
  requireThat(input && typeof input === 'object' && !Array.isArray(input), 'Invalid backup');
  const v = input as Vault;
  const fields = ['version','genesis','scheme','path','owner','address','salt','iv','iterations','cipher'];
  requireThat(Object.keys(v).length === fields.length && fields.every(k => Object.hasOwn(v,k)), 'Invalid backup fields');
  requireThat((v.version === 1 || v.version === 2) && v.genesis === genesis && buildGenesis(genesis, profile)
    && v.scheme === 'ml-dsa-87' && v.path === PATH && v.iterations === work(v.version), 'Unsupported backup or network');
  fromHex(genesis,32); fromHex(v.owner,32); fromHex(v.salt,16); fromHex(v.iv,12);
  requireThat(typeof v.address === 'string' && v.address.length > 0 && v.address.length < 80, 'Invalid address');
  requireThat(typeof v.cipher === 'string' && v.cipher.length >= 34 && v.cipher.length <= 2048, 'Invalid ciphertext');
  fromHex(v.cipher);
  return {...v};
}
async function key(password: string, v: Vault): Promise<CryptoKey> {
  requireThat(typeof password === 'string' && password.length >= 6 && password.length <= 256, 'Password must contain 6–256 characters');
  const raw = new TextEncoder().encode(password);
  try {
    const base = await crypto.subtle.importKey('raw',buffer(raw),'PBKDF2',false,['deriveKey']);
    return await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:buffer(fromHex(v.salt)),iterations:v.iterations},
      base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  } finally { raw.fill(0); }
}
export async function encryptVault(phrase: string, password: string, genesis: string,
  derive: Derive, version: 1 | 2 = 2): Promise<Vault> {
  requireThat(typeof phrase === 'string' && phrase.length <= 512, 'Invalid recovery phrase');
  fromHex(genesis,32); requireBuildGenesis(genesis);
  const who = await derive(phrase);
  const v: Vault = {version,genesis,scheme:'ml-dsa-87',path:PATH,...who,
    salt:hex(crypto.getRandomValues(new Uint8Array(16))),iv:hex(crypto.getRandomValues(new Uint8Array(12))),
    iterations:work(version),cipher:''};
  const clear = new TextEncoder().encode(phrase);
  try {
    const k = await key(password,v);
    v.cipher = hex(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:buffer(fromHex(v.iv)),
      additionalData:buffer(aad(v))},k,buffer(clear))));
    return validateVault(v,genesis);
  } finally { clear.fill(0); }
}
export async function decryptVault(input: unknown, password: string, genesis: string, derive: Derive,
  profile?: NetworkProfile): Promise<Uint8Array> {
  const v = validateVault(input,genesis,profile);
  const k = await key(password,v);
  let clear: Uint8Array;
  try {
    clear = new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:buffer(fromHex(v.iv)),
      additionalData:buffer(aad(v))},k,buffer(fromHex(v.cipher))));
  } catch {
    throw Error(VAULT_PASSWORD_ERROR);
  }
  try {
    let phrase: string;
    try { phrase = new TextDecoder('utf-8',{fatal:true}).decode(clear); }
    catch { throw Error(VAULT_DATA_ERROR); }
    let who: Identity;
    try { who = await derive(phrase); }
    catch {
      // SDK errors can contain secret input. Only this fixed diagnostic crosses
      // the message boundary; authenticated decryption already proved the password.
      throw Error(VAULT_MODULE_ERROR);
    }
    requireThat(who.owner === v.owner && who.address === v.address, VAULT_IDENTITY_ERROR);
    return clear;
  } catch (error) {
    clear.fill(0);
    throw error;
  }
}
/** Deadline and epoch are checked after asynchronous unlock and before signing.
 * No method called by a dapp refreshes the deadline. Restart creates a locked session. */
export class SecretSession {
  private bytes: Uint8Array | null = null;
  private until = 0;
  epoch = 0;
  private readonly now: () => number;
  private readonly ttl: number;
  constructor(now: () => number = Date.now, ttl = 300000) { this.now=now; this.ttl=ttl; }
  lock(): void { this.bytes?.fill(0); this.bytes=null; this.until=0; this.epoch++; }
  get unlocked(): boolean {
    if (this.bytes && this.now() >= this.until) this.lock();
    return this.bytes !== null;
  }
  /** Cancel account-bound work without extending the installation's unlock deadline. */
  invalidate(): void { void this.unlocked; this.epoch++; }
  install(clear: Uint8Array, expectedEpoch: number): void {
    requireThat(expectedEpoch === this.epoch,'Unlock cancelled');
    this.bytes?.fill(0); this.bytes=clear.slice(); this.until=this.now()+this.ttl;
  }
  phrase(expectedEpoch: number): string {
    requireThat(this.unlocked && expectedEpoch === this.epoch,'Wallet locked; approve again');
    return new TextDecoder().decode(this.bytes!);
  }
}
