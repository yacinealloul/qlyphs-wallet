/** Block ancestry and transaction positions proven from a trusted block hash, over node data. */
import { fromHex, hex, requireThat } from '../../../../packages/native/src/codec.ts';
import { blake2_256Hex } from '../../../../packages/chain/src/codec/hash.ts';
import { P } from './goldilocks.ts';
import { type Header, verifyHeader } from './header.ts';
import { MAX_BODY_BYTES, MAX_EXTRINSICS, extrinsicsRoot } from './trie.ts';

/*
 * The node supplies headers and bodies; nothing here believes them. A walk starts from a hash the
 * caller trusts and keeps only headers that hash (Poseidon2, as the chain does) to the hash their
 * child names as parent. A body counts only when its extrinsics root equals the proven header's
 * field exactly, and a transaction is identified by the blake2_256 of its encoded bytes.
 */

/** Longest header walk: a five-minute session at one-second blocks spans 300 blocks. */
export const MAX_WALK = 512;
/** Error text of every node answer that fails a proof. Retrying never turns it into evidence. */
export const UNPROVEN = 'Block data does not match the attested chain';
/** Proven headers kept per source: two full walks, so a new tip reaches cached headers soon. */
const HEADER_CACHE = 2 * MAX_WALK;
/** Proven bodies kept per source, as their transaction hashes. */
const BODY_CACHE = 4;
const HASH = /^0x[0-9a-f]{64}$/;
const BYTES = /^0x(?:[0-9a-fA-F]{2})*$/;

export interface Block {
  height: number;
  hash: string;
}
/** An extrinsic's place: its block and its index among that block's extrinsics. */
export interface Position extends Block {
  index: number;
}
/** Raw node answers; every one is checked before use. */
export interface BlockSource {
  /** The node's `chain_getHeader` answer for `hash`. */
  header(hash: string, signal: AbortSignal): Promise<unknown>;
  /** The `extrinsics` list of the node's `chain_getBlock` answer for `hash`. */
  body(hash: string, signal: AbortSignal): Promise<unknown>;
}

const headers = new WeakMap<BlockSource, Map<string, Header>>();
const bodies = new WeakMap<BlockSource, Map<string, string[]>>();

function cached<T>(store: WeakMap<BlockSource, Map<string, T>>, source: BlockSource) {
  let map = store.get(source);
  if (!map) store.set(source, (map = new Map()));
  return map;
}
function remember<T>(map: Map<string, T>, key: string, value: T, limit: number): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > limit) map.delete(map.keys().next().value!);
}
/** Runs a check over node data; any refusal becomes UNPROVEN. */
function proof<T>(check: () => T): T {
  try {
    return check();
  } catch {
    throw new Error(UNPROVEN);
  }
}
const isHeight = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

/** A block hash as a Poseidon2 output encodes it: four little-endian words, each below p. Any
 * other encoding of the same elements would hash alike, so only this one is followed. */
function canonical(hash: string): boolean {
  const bytes = fromHex(hash, 32);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [0, 8, 16, 24].every((at) => view.getBigUint64(at, true) < P);
}

/** The header of block `hash`, proven to hash to it. Read errors pass through unchanged. */
export async function provenHeader(
  source: BlockSource,
  hash: string,
  signal: AbortSignal,
): Promise<Header> {
  requireThat(typeof hash === 'string' && HASH.test(hash), 'Invalid block hash');
  signal.throwIfAborted();
  const cache = cached(headers, source);
  const known = cache.get(hash);
  if (known) {
    remember(cache, hash, known, HEADER_CACHE);
    return known;
  }
  const json = await source.header(hash, signal);
  signal.throwIfAborted();
  const header = proof(() => {
    const h = verifyHeader(json, hash);
    requireThat(h.number === 0 || canonical(h.parentHash), UNPROVEN);
    return h;
  });
  remember(cache, hash, header, HEADER_CACHE);
  return header;
}

/**
 * Hashes by height on `from`'s ancestry for heights `low..from.height`, each proven from
 * `from.hash` by the headers above it; null when `low` is above `from` or more than MAX_WALK below
 * it. The hash at `low` is the one its proven child names; the header at `low` is not read.
 */
export async function provenAncestry(
  source: BlockSource,
  from: Block,
  low: number,
  signal: AbortSignal,
): Promise<Map<number, string> | null> {
  requireThat(
    isHeight(from.height) && typeof from.hash === 'string' && HASH.test(from.hash) && isHeight(low),
    'Invalid block range',
  );
  if (low > from.height || from.height - low > MAX_WALK) return null;
  const map = new Map([[from.height, from.hash]]);
  let { height, hash } = from;
  while (height > low) {
    const header = await provenHeader(source, hash, signal);
    if (header.number !== height) throw new Error(UNPROVEN);
    height -= 1;
    hash = header.parentHash;
    map.set(height, hash);
  }
  return map;
}

/** The transaction hashes of block `hash`, in block order, from a body proven against the block's
 * proven header. Read errors pass through unchanged. */
export async function provenBody(
  source: BlockSource,
  hash: string,
  signal: AbortSignal,
): Promise<string[]> {
  const header = await provenHeader(source, hash, signal);
  const cache = cached(bodies, source);
  const known = cache.get(hash);
  if (known) {
    remember(cache, hash, known, BODY_CACHE);
    return known;
  }
  const raw = await source.body(hash, signal);
  signal.throwIfAborted();
  const hashes = proof(() => {
    requireThat(Array.isArray(raw) && raw.length <= MAX_EXTRINSICS, UNPROVEN);
    // Hex length bounds the decoded size before anything is decoded.
    let chars = 0;
    for (const x of raw) {
      requireThat(typeof x === 'string' && BYTES.test(x), UNPROVEN);
      chars += x.length - 2;
      requireThat(chars <= 2 * MAX_BODY_BYTES, UNPROVEN);
    }
    const body = (raw as string[]).map((x) => fromHex(x.toLowerCase()));
    requireThat(hex(extrinsicsRoot(body)) === header.extrinsicsRoot, UNPROVEN);
    return body.map(blake2_256Hex);
  });
  remember(cache, hash, hashes, BODY_CACHE);
  return hashes;
}

/**
 * Whether transaction `tx` (blake2_256 of its encoded bytes, lowercase hex) is the extrinsic at
 * `at`, in a block on the chain that ends at `anchor`, a block the caller trusts. False when the
 * proven chain says otherwise, or when `at` is above `anchor` or more than MAX_WALK below it.
 * Throws UNPROVEN when node data fails a check, and passes read errors through.
 */
export async function proveInclusion(
  source: BlockSource,
  anchor: Block,
  tx: string,
  at: Position,
  signal: AbortSignal,
): Promise<boolean> {
  requireThat(typeof tx === 'string' && HASH.test(tx), 'Invalid extrinsic hash');
  if (
    !isHeight(at.height) ||
    typeof at.hash !== 'string' ||
    !HASH.test(at.hash) ||
    !Number.isSafeInteger(at.index) ||
    at.index < 0
  )
    return false;
  const chain = await provenAncestry(source, anchor, at.height, signal);
  if (chain === null || chain.get(at.height) !== at.hash) return false;
  const hashes = await provenBody(source, at.hash, signal);
  return hashes.indexOf(tx) === at.index;
}
