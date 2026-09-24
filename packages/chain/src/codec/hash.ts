import { blake2b } from '@noble/hashes/blake2.js';
import { bytesToHex } from './bytes';

export const blake2_256 = (data: Uint8Array): Uint8Array => blake2b(data, { dkLen: 32 });
export const blake2_128 = (data: Uint8Array): Uint8Array => blake2b(data, { dkLen: 16 });
export const blake2_256Hex = (data: Uint8Array): string => bytesToHex(blake2_256(data));
