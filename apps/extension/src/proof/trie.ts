/** The extrinsics root a Quantus block header commits to, and where an extrinsic sits in a body. */
import { requireThat } from '../../../../packages/native/src/codec.ts';
import { concatBytes } from '../../../../packages/chain/src/codec/bytes.ts';
import { blake2_256, blake2_256Hex } from '../../../../packages/chain/src/codec/hash.ts';
import { compactEncode } from '../../../../packages/chain/src/codec/scale.ts';

/*
 * The runtime (quantus-runtime, specs 152 and 153) computes the root in frame_system's `finalize` as
 * `BlakeTwo256::ordered_trie_root(extrinsics, StateVersion::V0)`: its runtime version declares
 * `system_version: 1`, and system versions 0 and 1 commit to extrinsics with state version 0. That
 * is sp-trie's `LayoutV0`, a radix-16 trie without extension nodes, keyed by the SCALE compact
 * encoding of each extrinsic's index, whose leaves hold the encoded extrinsics inline at any size.
 * This is a port of the closed form the node runs: `trie_root_no_extension` of trie-root 0.18.0,
 * writing nodes with the `TrieStream` of sp-trie 42.0.1.
 */

/** The runtime's block length limit (`System.BlockLength`): the extrinsics of one block total at
 * most 5 MiB, so a larger body is no block. */
export const MAX_BODY_BYTES = 5 * 1024 * 1024;
/** Each extrinsic costs at least the runtime's base weight of 767 µs and a block's transactions
 * share 6 s, so a block holds fewer than 8,000 of them besides its inherents; the cap leaves twice
 * that in case the runtime's weights change. */
export const MAX_EXTRINSICS = 16_384;

const TOO_LARGE = 'Block body too large';
/** Node header prefixes in their top two bits; the low six bits count the partial key's nibbles. */
const LEAF = 0b01 << 6;
const BRANCH = 0b10 << 6;
/** A child node shorter than a hash is embedded in its parent; a longer one is referenced by hash. */
const HASH_BYTES = 32;
const EMPTY_TRIE = Uint8Array.of(0);
const HASH = /^0x[0-9a-f]{64}$/;

/** An extrinsic and its key: its index in compact SCALE, split into nibbles, high nibble first. */
interface Entry {
  key: number[];
  value: Uint8Array;
}

/** Refuses what no Quantus block can hold before spending memory or time on it. */
function checkBody(extrinsics: readonly Uint8Array[]): void {
  requireThat(Array.isArray(extrinsics), 'Invalid block body');
  requireThat(extrinsics.length <= MAX_EXTRINSICS, TOO_LARGE);
  let size = 0;
  for (const x of extrinsics) {
    requireThat(x instanceof Uint8Array, 'Invalid block body');
    size += x.length;
    requireThat(size <= MAX_BODY_BYTES, TOO_LARGE);
  }
}

/** The SCALE byte order of keys, which is the trie's order. Two compact encodings of different
 * lengths already differ in their first byte (its low bits name the length), so no key is a prefix
 * of another: no branch ever holds a value, and every branch sits where its keys first differ. */
function byKey(a: Entry, b: Entry): number {
  for (let i = 0; i < a.key.length && i < b.key.length; i++) {
    const d = a.key[i]! - b.key[i]!;
    if (d !== 0) return d;
  }
  return a.key.length - b.key.length;
}

/** A node's header and partial key `key[from..to]`. A compact index has at most five bytes, so
 * the nibble count always fits the header's low six bits (sp-trie extends it past 62). An odd
 * nibble goes first, alone in its byte. */
function nodeStart(prefix: number, key: readonly number[], from: number, to: number): Uint8Array {
  const odd = (to - from) % 2;
  const out = [prefix | (to - from)];
  if (odd) out.push(key[from]!);
  for (let i = from + odd; i < to; i += 2) out.push((key[i]! << 4) | key[i + 1]!);
  return Uint8Array.from(out);
}

/** How a parent holds a child: SCALE bytes of the node itself when short, else of its hash. */
function childRef(node: Uint8Array): Uint8Array {
  const held = node.length < HASH_BYTES ? node : blake2_256(node);
  return concatBytes(compactEncode(held.length), held);
}

/** The node over entries `lo..hi` (sorted, sharing their first `cursor` nibbles). */
function encodeNode(entries: readonly Entry[], lo: number, hi: number, cursor: number): Uint8Array {
  const first = entries[lo]!;
  if (hi - lo === 1) {
    return concatBytes(
      nodeStart(LEAF, first.key, cursor, first.key.length),
      compactEncode(first.value.length),
      first.value,
    );
  }
  // Sorted keys share exactly the prefix of their first and last.
  const last = entries[hi - 1]!.key;
  let split = cursor;
  while (split < last.length && first.key[split] === last[split]) split++;
  let bitmap = 0;
  const children: Uint8Array[] = [];
  for (let i = lo; i < hi;) {
    const nibble = entries[i]!.key[split]!;
    let j = i + 1;
    while (j < hi && entries[j]!.key[split] === nibble) j++;
    bitmap |= 1 << nibble;
    children.push(childRef(encodeNode(entries, i, j, split + 1)));
    i = j;
  }
  return concatBytes(
    nodeStart(BRANCH, first.key, cursor, split),
    Uint8Array.of(bitmap & 0xff, bitmap >> 8),
    ...children,
  );
}

/**
 * The extrinsics root of a block whose body is `extrinsics`, each as its exact SCALE encoding (the
 * bytes `chain_getBlock` returns, length prefix included). Equal to the header's `extrinsicsRoot`
 * exactly when the body is the one the header commits to. Throws on a body over the limits.
 */
export function extrinsicsRoot(extrinsics: readonly Uint8Array[]): Uint8Array {
  checkBody(extrinsics);
  if (extrinsics.length === 0) return blake2_256(EMPTY_TRIE);
  const entries = extrinsics
    .map((value, index): Entry => ({
      key: Array.from(compactEncode(index)).flatMap((b) => [b >> 4, b & 0x0f]),
      value,
    }))
    .sort(byKey);
  return blake2_256(encodeNode(entries, 0, entries.length, 0));
}

/**
 * The first index in `extrinsics` of an extrinsic whose blake2_256 is `hash` (lowercase 0x hex, as
 * the wallet records its transactions), or null when the body does not hold it. Throws on a body
 * over the limits. It trusts the body: check it against a header with `extrinsicsRoot` first.
 */
export function extrinsicIndex(extrinsics: readonly Uint8Array[], hash: string): number | null {
  checkBody(extrinsics);
  requireThat(typeof hash === 'string' && HASH.test(hash), 'Invalid extrinsic hash');
  const index = extrinsics.findIndex((x) => blake2_256Hex(x) === hash);
  return index < 0 ? null : index;
}
