/** Minimal SCALE primitives: just what the Quantus escrow flow needs. */
import { ChainError } from '../errors';
import { concatBytes } from './bytes';

export const U32_MAX = 0xffff_ffffn;
export const U64_MAX = (1n << 64n) - 1n;
export const U128_MAX = (1n << 128n) - 1n;

function assertRange(value: bigint, max: bigint, what: string): void {
  if (value < 0n || value > max) {
    throw new ChainError('INVALID_ARGUMENT', `${what} out of range: ${value}`);
  }
}

export function uintLe(value: bigint | number, byteLength: number): Uint8Array {
  let v = BigInt(value);
  assertRange(v, (1n << BigInt(8 * byteLength)) - 1n, `u${8 * byteLength}`);
  const out = new Uint8Array(byteLength);
  for (let i = 0; i < byteLength; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export const u32Le = (v: bigint | number): Uint8Array => uintLe(v, 4);
export const u64Le = (v: bigint | number): Uint8Array => uintLe(v, 8);
export const u128Le = (v: bigint | number): Uint8Array => uintLe(v, 16);

/** SCALE compact integer (up to u128, which is all the runtime uses here). */
export function compactEncode(value: bigint | number): Uint8Array {
  const v = BigInt(value);
  assertRange(v, U128_MAX, 'compact');
  if (v < 1n << 6n) return Uint8Array.of(Number(v << 2n));
  if (v < 1n << 14n) return uintLe((v << 2n) | 1n, 2);
  if (v < 1n << 30n) return uintLe((v << 2n) | 2n, 4);
  let byteLength = 4;
  while (v >> BigInt(8 * byteLength) > 0n) byteLength++;
  return concatBytes(Uint8Array.of(((byteLength - 4) << 2) | 3), uintLe(v, byteLength));
}

/** Length-prefixed byte string (`Vec<u8>` / `Bytes`). */
export const bytesEncode = (bytes: Uint8Array): Uint8Array =>
  concatBytes(compactEncode(bytes.length), bytes);

/** Sequential reader. Every read is bounds-checked and throws `INVALID_CALL` on truncated input. */
export class ScaleReader {
  private offset = 0;

  constructor(private readonly data: Uint8Array) {}

  get remaining(): number {
    return this.data.length - this.offset;
  }

  get position(): number {
    return this.offset;
  }

  bytes(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.remaining) {
      throw new ChainError('INVALID_CALL', 'Unexpected end of SCALE input');
    }
    const out = this.data.slice(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }

  u8(): number {
    return this.bytes(1)[0] ?? 0;
  }

  private uint(byteLength: number): bigint {
    const b = this.bytes(byteLength);
    let v = 0n;
    for (let i = byteLength - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[i] ?? 0);
    return v;
  }

  u32(): number {
    return Number(this.uint(4));
  }

  u64(): bigint {
    return this.uint(8);
  }

  u128(): bigint {
    return this.uint(16);
  }

  bool(): boolean {
    const b = this.u8();
    if (b > 1) throw new ChainError('INVALID_CALL', `Invalid SCALE bool: ${b}`);
    return b === 1;
  }

  /** Rejects non-canonical encodings, as the runtime does when it re-encodes proposed calls. */
  compact(): bigint {
    const first = this.u8();
    const mode = first & 3;
    if (mode === 0) return BigInt(first >> 2);
    if (mode === 1) {
      const v = (BigInt(first) | (BigInt(this.u8()) << 8n)) >> 2n;
      if (v < 1n << 6n) throw new ChainError('INVALID_CALL', 'Non-canonical compact integer');
      return v;
    }
    if (mode === 2) {
      const rest = this.bytes(3);
      const raw =
        BigInt(first) |
        (BigInt(rest[0] ?? 0) << 8n) |
        (BigInt(rest[1] ?? 0) << 16n) |
        (BigInt(rest[2] ?? 0) << 24n);
      const v = raw >> 2n;
      if (v < 1n << 14n) throw new ChainError('INVALID_CALL', 'Non-canonical compact integer');
      return v;
    }
    const byteLength = (first >> 2) + 4;
    if (byteLength > 16) throw new ChainError('INVALID_CALL', 'Compact integer wider than u128');
    const v = this.uint(byteLength);
    const minimum = byteLength === 4 ? 1n << 30n : 1n << BigInt(8 * (byteLength - 1));
    if (v < minimum) throw new ChainError('INVALID_CALL', 'Non-canonical compact integer');
    return v;
  }

  compactLength(): number {
    const v = this.compact();
    if (v > BigInt(this.remaining)) {
      throw new ChainError('INVALID_CALL', 'SCALE length prefix exceeds the input');
    }
    return Number(v);
  }

  lengthPrefixedBytes(): Uint8Array {
    return this.bytes(this.compactLength());
  }

  assertEnd(what: string): void {
    if (this.remaining !== 0) {
      throw new ChainError('INVALID_CALL', `${this.remaining} trailing byte(s) after ${what}`);
    }
  }
}
