/** Quantus addresses (SS58, prefix 189, `qz…`) from 32-byte account ids, without polkadot.js. */
import { blake2b } from '@noble/hashes/blake2.js';

// Same output as `encodeAccountId` in ./address.ts, for bundles that do not carry polkadot.js
// (the extension's background) and for code loaded straight by Node.

/** `QUANTUS_SS58_PREFIX` of @qotc/shared, packed on two bytes as `sp-core` does above 63. */
const PREFIX = Uint8Array.of(((189 & 0xfc) >> 2) | 0x40, (189 >> 8) | ((189 & 0x03) << 6));
const SS58_PRE = new TextEncoder().encode('SS58PRE');
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  return '1'.repeat(zeros) + out;
}

/** The address the wallet shows for an account id. */
export function quantusAddress(accountId: Uint8Array): string {
  if (accountId.length !== 32) throw new Error('An account id is 32 bytes');
  const body = new Uint8Array([...PREFIX, ...accountId]);
  const checksum = blake2b(new Uint8Array([...SS58_PRE, ...body]), { dkLen: 64 }).subarray(0, 2);
  return base58(new Uint8Array([...body, ...checksum]));
}
