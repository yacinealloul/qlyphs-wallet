/** Small byte helpers. Hex strings produced here are always lower-case and 0x-prefixed. */
import { ChainError } from '../errors';

const HEX_RE = /^(0x)?([0-9a-fA-F]{2})*$/;

export function hexToBytes(hex: string): Uint8Array {
  if (typeof hex !== 'string' || !HEX_RE.test(hex)) {
    throw new ChainError('INVALID_ARGUMENT', 'Expected an even-length hex string');
  }
  const body = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(body.slice(2 * i, 2 * i + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '0x';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Bytewise lexicographic order: what Rust's `Vec<AccountId32>::sort()` does. */
export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Canonical form used when comparing call bytes coming from different sources. */
export const normalizeHex = (hex: string): string => bytesToHex(hexToBytes(hex));
