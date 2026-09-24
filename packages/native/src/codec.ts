/** Experimental QLYP-v1 wire protocol. Fixed-width integers use SCALE little endian;
 * vectors use canonical SCALE compact lengths. No JavaScript numbers for money.
 * Every payload starts with ASCII "QLYP" followed by the protocol version byte. The codec is
 * generic about fee values: the fee rules live in protocol.ts. */
export const PROTOCOL_VERSION = 1;
/** "QLYP" + version byte. Payloads with any other header (including v0) are not QLYP operations. */
export const PROTOCOL_HEADER = '0x514c5950' + PROTOCOL_VERSION.toString(16).padStart(2, '0');
export const MAX_U128 = (1n << 128n) - 1n;
export const MAX_U64 = (1n << 64n) - 1n;
export const MAX_PAYLOAD = 1024;
/** Every runtime batch the protocol reads has at most 3 calls. */
export const MAX_BATCH_CALLS = 3;
/** Tags 4..8 are RESERVED for the planned launchpad/AMM (docs/native/LAUNCHPAD-AMM.md: planned,
 * not part of the protocol). A payload carrying one of them is rejected, never interpreted. */
export const RESERVED_TAGS: readonly number[] = [4, 5, 6, 7, 8];
export const ZERO = '0x' + '00'.repeat(32);
/** INSCRIBE (tag 9, docs/native/INSCRIPTIONS.md §2): an ASCII media type of 3..64 bytes. */
export const INSCRIPTION_CONTENT_TYPE = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/;
export const MIN_CONTENT_TYPE_BYTES = 3;
export const MAX_CONTENT_TYPE_BYTES = 64;
/** True when `x` is a valid INSCRIBE content type (ASCII, 3..64 bytes, lowercase type/subtype). */
export function isContentType(x: unknown): x is string {
  return (
    typeof x === 'string' &&
    x.length >= MIN_CONTENT_TYPE_BYTES &&
    x.length <= MAX_CONTENT_TYPE_BYTES &&
    INSCRIPTION_CONTENT_TYPE.test(x)
  );
}
export type Id = string;
export type Operation =
  | { kind: 'deploy'; symbol: string; decimals: number; cap: bigint; limit: bigint; policy: 'open' | 'issuer' }
  | { kind: 'mint'; asset: Id; amount: bigint }
  | { kind: 'transfer'; asset: Id; amount: bigint; to: Id }
  | { kind: 'offer'; asset: Id; amount: bigint; buyer: Id; payout: Id; price: bigint; fee: bigint; feeTo: Id; expiry: number }
  /* Tags 4..8 are reserved (planned launchpad/AMM, not part of the protocol). */
  /* Qlyph inscriptions (docs/native/INSCRIPTIONS.md), tag 9. `content` is canonical lowercase hex
   * ("0x..."), at least 1 byte; the whole payload stays <= MAX_PAYLOAD. */
  | { kind: 'inscribe'; contentType: string; content: string };

export interface Envelope { genesis: Id; sequence: bigint; op: Operation }
export function requireThat(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
export function fromHex(s: string, length?: number): Uint8Array {
  requireThat(typeof s === 'string' && /^0x(?:[0-9a-f]{2})*$/.test(s), 'non-canonical hex');
  const b = Uint8Array.from(s.slice(2).match(/../g) ?? [], x => parseInt(x, 16));
  requireThat(length === undefined || b.length === length, 'wrong byte length');
  return b;
}
export const hex = (b: Uint8Array): string => '0x' + Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
export const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out;
};
export function uint(v: bigint, n: number): Uint8Array {
  requireThat(typeof v === 'bigint' && v >= 0n && v < (1n << BigInt(8 * n)), 'integer out of range');
  return Uint8Array.from({ length: n }, (_, i) => Number((v >> BigInt(8 * i)) & 255n));
}
export function compact(v: bigint): Uint8Array {
  requireThat(typeof v === 'bigint' && v >= 0n && v <= MAX_U128, 'compact out of range');
  if (v < 64n) return uint(v << 2n, 1);
  if (v < 16384n) return uint((v << 2n) | 1n, 2);
  if (v < (1n << 30n)) return uint((v << 2n) | 2n, 4);
  let n = 4; while (v >= (1n << BigInt(8 * n))) n++;
  return concat(Uint8Array.of(((n - 4) << 2) | 3), uint(v, n));
}
const vec = (b: Uint8Array) => concat(compact(BigInt(b.length)), b);
export class Reader {
  at = 0;
  data: Uint8Array;
  constructor(data: Uint8Array) { this.data = data; }
  bytes(n: number): Uint8Array {
    requireThat(Number.isSafeInteger(n) && n >= 0 && this.at + n <= this.data.length, 'truncated input');
    const b = this.data.slice(this.at, this.at + n); this.at += n; return b;
  }
  int(n: number): bigint { return this.bytes(n).reduce((v, b, i) => v | (BigInt(b) << BigInt(8 * i)), 0n); }
  small(n: number): number { return Number(this.int(n)); }
  id(n = 32): Id { return hex(this.bytes(n)); }
  compact(): bigint {
    const start = this.at; const tag = this.small(1); let v: bigint;
    if ((tag & 3) === 0) v = BigInt(tag >> 2);
    else if ((tag & 3) === 1) v = (BigInt(tag) | (this.int(1) << 8n)) >> 2n;
    else if ((tag & 3) === 2) v = (BigInt(tag) | (this.int(3) << 8n)) >> 2n;
    else { const n = (tag >> 2) + 4; requireThat(n <= 16, 'compact too wide'); v = this.int(n); }
    requireThat(hex(this.data.slice(start, this.at)) === hex(compact(v)), 'non-canonical compact'); return v;
  }
  vector(max = MAX_PAYLOAD): Uint8Array {
    const n = this.compact(); requireThat(n <= BigInt(max), 'vector too large'); return this.bytes(Number(n));
  }
  end(): void { requireThat(this.at === this.data.length, 'trailing bytes'); }
}
export const assetId = (creator: Id, sequence: bigint): Id => hex(concat(fromHex(creator, 32), uint(sequence, 8)));
export function encode(e: Envelope): Uint8Array {
  const p = e.op; const parts = [fromHex(PROTOCOL_HEADER), fromHex(e.genesis, 32), uint(e.sequence, 8)];
  const positive = (n: bigint) => { requireThat(n > 0n, 'amount must be positive'); return uint(n, 16); };
  const symbol = (x: string) => { requireThat(typeof x === 'string' && /^[A-Z0-9]{1,12}$/.test(x), 'invalid symbol'); return vec(new TextEncoder().encode(x)); };
  if (p.kind === 'deploy') {
    requireThat(Number.isInteger(p.decimals) && p.decimals >= 0 && p.decimals <= 18, 'invalid decimals');
    requireThat(p.policy === 'open' || p.policy === 'issuer', 'invalid policy');
    requireThat(p.limit <= p.cap, 'mint limit exceeds cap');
    parts.push(Uint8Array.of(0), symbol(p.symbol), Uint8Array.of(p.decimals), positive(p.cap), positive(p.limit), Uint8Array.of(p.policy === 'open' ? 0 : 1));
  } else if (p.kind === 'inscribe') {
    requireThat(isContentType(p.contentType), 'invalid content type');
    const content = fromHex(p.content);
    requireThat(content.length >= 1, 'empty inscription content');
    parts.push(Uint8Array.of(9), vec(new TextEncoder().encode(p.contentType)), vec(content));
  } else {
    requireThat(['mint', 'transfer', 'offer'].includes(p.kind), 'unknown operation');
    parts.push(Uint8Array.of(p.kind === 'mint' ? 1 : p.kind === 'transfer' ? 2 : 3), fromHex(p.asset, 40), positive(p.amount));
    if (p.kind === 'transfer') parts.push(fromHex(p.to, 32));
    if (p.kind === 'offer') {
      requireThat(Number.isInteger(p.expiry) && p.expiry >= 0 && p.expiry <= 0xffffffff, 'invalid expiry');
      requireThat(p.price + p.fee <= MAX_U128, 'payment overflow');
      requireThat(p.fee !== 0n || p.feeTo === ZERO, 'zero fee must use zero feeTo');
      parts.push(fromHex(p.buyer, 32), fromHex(p.payout, 32), positive(p.price), uint(p.fee, 16), fromHex(p.feeTo, 32), uint(BigInt(p.expiry), 4));
    }
  }
  const out = concat(...parts); requireThat(out.length <= MAX_PAYLOAD, 'payload too large'); return out;
}
export function decode(data: Uint8Array): Envelope {
  requireThat(data.length <= MAX_PAYLOAD, 'payload too large');
  const r = new Reader(data); requireThat(r.id(5) === PROTOCOL_HEADER, 'unknown protocol/version');
  const genesis = r.id(); const sequence = r.int(8); const tag = r.small(1); let op: Operation;
  const symbol = () => new TextDecoder('utf-8', { fatal: true }).decode(r.vector(12));
  if (tag === 0) {
    const sym = symbol();
    const decimals = r.small(1), cap = r.int(16), limit = r.int(16), policy = r.small(1);
    requireThat(policy <= 1, 'invalid policy'); op = { kind: 'deploy', symbol: sym, decimals, cap, limit, policy: policy ? 'issuer' : 'open' };
  } else if (tag === 9) {
    const contentType = new TextDecoder('utf-8', { fatal: true }).decode(r.vector(MAX_CONTENT_TYPE_BYTES));
    requireThat(isContentType(contentType), 'invalid content type');
    const content = r.vector();
    requireThat(content.length >= 1, 'empty inscription content');
    op = { kind: 'inscribe', contentType, content: hex(content) };
  } else {
    requireThat(!RESERVED_TAGS.includes(tag), 'reserved operation');
    requireThat(tag <= 3, 'unknown operation'); const asset = r.id(40), amount = r.int(16);
    if (tag === 1) op = { kind: 'mint', asset, amount };
    else if (tag === 2) op = { kind: 'transfer', asset, amount, to: r.id() };
    else op = { kind: 'offer', asset, amount, buyer: r.id(), payout: r.id(), price: r.int(16), fee: r.int(16), feeTo: r.id(), expiry: r.small(4) };
  }
  r.end(); const e = { genesis, sequence, op };
  requireThat(hex(encode(e)) === hex(data), 'non-canonical operation'); return e;
}
/** Call indices of runtime 152 / tx6, unchanged on mainnet 153 (apps/native/scripts/mainnet-compat.mjs). Unsupported calls are not interpreted. */
export type Call =
  | { kind: 'remark'; payload: string; event: boolean }
  | { kind: 'propose'; multisig: Id; call: Call; expiry: number }
  | { kind: 'approve'; multisig: Id; proposal: number; call: Call }
  | { kind: 'pay'; to: Id; amount: bigint }
  | { kind: 'batch'; calls: Call[] };
export function callBytes(c: Call): Uint8Array {
  switch (c.kind) {
    case 'remark': return concat(Uint8Array.of(0, c.event ? 7 : 0), vec(fromHex(c.payload)));
    case 'pay': return concat(Uint8Array.of(2, 3, 0), fromHex(c.to, 32), compact(c.amount));
    case 'propose': return concat(Uint8Array.of(19, 1), fromHex(c.multisig, 32), vec(callBytes(c.call)), uint(BigInt(c.expiry), 4));
    case 'approve': return concat(Uint8Array.of(19, 2), fromHex(c.multisig, 32), uint(BigInt(c.proposal), 4), vec(callBytes(c.call)));
    case 'batch': requireThat(c.calls.length <= MAX_BATCH_CALLS && c.calls.every(x => x.kind !== 'batch'), 'unsupported batch'); return concat(Uint8Array.of(9, 2), compact(BigInt(c.calls.length)), ...c.calls.map(callBytes));
  }
}
export function parseCall(data: Uint8Array, depth = 0): Call {
  requireThat(depth <= 3 && data.length <= 4096, 'call limit'); const r = new Reader(data);
  function read(inBatch = false): Call {
    const pallet = r.small(1), tag = r.small(1);
    if (pallet === 0 && (tag === 0 || tag === 7)) return { kind: 'remark', payload: hex(r.vector()), event: tag === 7 };
    if (pallet === 2 && tag === 3) { requireThat(r.small(1) === 0, 'unsupported address'); return { kind: 'pay', to: r.id(), amount: r.compact() }; }
    if (pallet === 19 && (tag === 1 || tag === 2)) {
      const multisig = r.id(); const proposal = tag === 2 ? r.small(4) : 0;
      const call = parseCall(r.vector(2048), depth + 1);
      return tag === 1 ? { kind: 'propose', multisig, call, expiry: r.small(4) } : { kind: 'approve', multisig, proposal, call };
    }
    if (pallet === 9 && tag === 2) {
      requireThat(depth === 0 && !inBatch, 'nested batch'); const n = r.compact();
      requireThat(n <= BigInt(MAX_BATCH_CALLS), 'batch too large');
      const calls = Array.from({ length: Number(n) }, () => read(true)); requireThat(calls.every(c => c.kind !== 'batch'), 'nested batch');
      return { kind: 'batch', calls };
    }
    throw new Error('unsupported call');
  }
  const out = read(); r.end(); requireThat(hex(callBytes(out)) === hex(data), 'non-canonical call'); return out;
}
