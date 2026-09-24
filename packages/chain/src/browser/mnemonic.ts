/** BIP39 handling. The wasm has no RNG, so generation uses `@scure/bip39` over WebCrypto. */
import { generateMnemonic as generate, validateMnemonic as validate } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { ChainError } from '../errors';

export const normalizeMnemonic = (mnemonic: string): string =>
  mnemonic.trim().toLowerCase().split(/\s+/).join(' ');

/** 24 words (256 bits of entropy). */
export const generateMnemonic = (): string => generate(wordlist, 256);

export const validateMnemonic = (mnemonic: string): boolean =>
  typeof mnemonic === 'string' && validate(normalizeMnemonic(mnemonic), wordlist);

export function requireMnemonic(mnemonic: string): string {
  if (!validateMnemonic(mnemonic)) {
    throw new ChainError('INVALID_MNEMONIC', 'The vault mnemonic is not a valid BIP39 phrase');
  }
  return normalizeMnemonic(mnemonic);
}

export function requireEscrowIndex(index: number): number {
  if (!Number.isInteger(index) || index < 0 || index > 0x7fff_ffff) {
    throw new ChainError('INVALID_ARGUMENT', 'Escrow index must be an integer in 0..2^31-1');
  }
  return index;
}
