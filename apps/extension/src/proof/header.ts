/** Quantus block headers: strict decoding of a node's JSON and the Poseidon2 block hash. */
import {
  compact,
  concat,
  fromHex,
  hex,
  requireThat,
} from '../../../../packages/native/src/codec.ts';
import { bytesToDigestLossy, bytesToFelts, hashToBytes } from './poseidon2.ts';

// Port of qp-header from the Quantus chain repository, primitives/header/src/lib.rs, identical at
// tags v1.0.1 (development runtime, spec 152) and v1.0.2-Qm (mainnet, spec 153); "lib.rs" line
// numbers below refer to it. Digest items are those of sp-runtime 45.0.0 (src/generic/digest.rs)
// in the SCALE encoding of parity-scale-codec 3.7.5, the versions the chain builds with.

/** Digest bytes the block hash commits (lib.rs:55). A pre-runtime item with a 32-byte payload and
 * a 64-byte seal, the digest of every mined block, encode to exactly this. */
export const DIGEST_LOGS_SIZE = 110;
/** Highest block that may carry one RuntimeEnvironmentUpdated item past the window (lib.rs:80). */
export const LEGACY_DIGEST_CUTOFF = 1_000_000;

/**
 * A block header. Hashes are 0x-prefixed lower-case hex, and `digest` is the SCALE encoding of the
 * digest, the bytes the hash reads. Of a 111-byte legacy digest the hash does not commit the last
 * byte.
 */
export interface Header {
  parentHash: string;
  number: number;
  stateRoot: string;
  extrinsicsRoot: string;
  zkTreeRoot: string;
  digest: string;
}

const INVALID = 'Invalid block header';
const HASH = /^0x[0-9a-f]{64}$/;
/** A block number as the node prints it: minimal lower-case hex of a u32 (lib.rs:176-185). */
const NUMBER = /^0x(?:0|[1-9a-f][0-9a-f]{0,7})$/;
const BYTES = /^0x(?:[0-9a-f]{2})+$/;
const U32_MAX = 0xffff_ffff;
/** Longest digest encoding the window rule accepts (lib.rs:71). */
const MAX_DIGEST = DIGEST_LOGS_SIZE + 1;

/** Item kinds of DigestItemType (sp-runtime src/generic/digest.rs:203-209). */
const OTHER = 0;
const CONSENSUS = 4;
const SEAL = 5;
const PRE_RUNTIME = 6;
const RUNTIME_ENVIRONMENT_UPDATED = 8;

/**
 * The block hash (lib.rs:283-350): Poseidon2 over the parent hash as four elements, the number as
 * one, the state, extrinsics and ZK tree roots as four each, then the digest zero-padded or cut to
 * DIGEST_LOGS_SIZE bytes in the 4-bytes-per-element encoding. Like the node, it hashes a digest of
 * any length; decodeHeader is what refuses digests the hash does not fully commit. It costs six
 * permutations, about a quarter of a millisecond in Node on a laptop.
 *
 * A root enters as four 8-byte words taken mod p, so a root with a word w below 2^32 - 1 hashes
 * like the same root with w + p in its place (lib.rs:288-297). The parent hash and ZK tree root are
 * Poseidon outputs, whose words are always below p. The state and extrinsics roots are Blake2
 * outputs: use them only to check Blake2 proofs, which no such alias satisfies.
 */
export function hashHeader(header: Header): string {
  const { number } = header;
  requireThat(Number.isInteger(number) && number >= 0 && number <= U32_MAX, `${INVALID}: number`);
  const digest = new Uint8Array(DIGEST_LOGS_SIZE);
  digest.set(fromHex(header.digest).subarray(0, DIGEST_LOGS_SIZE));
  return hex(
    hashToBytes([
      ...bytesToDigestLossy(fromHex(header.parentHash, 32)),
      BigInt(number),
      ...bytesToDigestLossy(fromHex(header.stateRoot, 32)),
      ...bytesToDigestLossy(fromHex(header.extrinsicsRoot, 32)),
      ...bytesToDigestLossy(fromHex(header.zkTreeRoot, 32)),
      ...bytesToFelts(digest),
    ]),
  );
}

/**
 * The header of a chain_getHeader response, refused unless it is exactly what a node of this chain
 * prints and a header the chain can contain. The node's own JSON decoder is more lenient: it also
 * takes upper-case or unprefixed hex, leading zeros, unknown digest keys and bytes after a digest
 * item, which it drops. No node prints those, so they are refused rather than interpreted.
 */
export function decodeHeader(json: unknown): Header {
  const header = exact(json, [
    'parentHash',
    'number',
    'stateRoot',
    'extrinsicsRoot',
    'zkTreeRoot',
    'digest',
  ]);
  const { number } = header;
  requireThat(typeof number === 'string' && NUMBER.test(number), `${INVALID}: number`);
  const height = parseInt(number.slice(2), 16);
  return {
    parentHash: hashField(header.parentHash),
    number: height,
    stateRoot: hashField(header.stateRoot),
    extrinsicsRoot: hashField(header.extrinsicsRoot),
    zkTreeRoot: hashField(header.zkTreeRoot),
    digest: hex(encodeDigest(exact(header.digest, ['logs']).logs, height)),
  };
}

/** The header in `json` if it hashes to `hash`, a block hash from a source the caller trusts. */
export function verifyHeader(json: unknown, hash: string): Header {
  requireThat(typeof hash === 'string' && HASH.test(hash), 'Invalid block hash');
  const header = decodeHeader(json);
  requireThat(hashHeader(header) === hash, 'Block header does not match the block hash');
  return header;
}

/** A JSON object with exactly these own keys. */
function exact<K extends string>(value: unknown, keys: readonly K[]): Record<K, unknown> {
  requireThat(typeof value === 'object' && value !== null && !Array.isArray(value), INVALID);
  requireThat(
    Reflect.ownKeys(value).length === keys.length && keys.every((k) => Object.hasOwn(value, k)),
    `${INVALID}: unexpected fields`,
  );
  return value as Record<K, unknown>;
}

function hashField(value: unknown): string {
  requireThat(typeof value === 'string' && HASH.test(value), `${INVALID}: hash`);
  return value;
}

/**
 * The SCALE encoding of a digest from its logs, each the hex of one encoded item: the item count
 * as a compact integer, then the items. The digest must pass the node's window rule.
 */
function encodeDigest(logs: unknown, height: number): Uint8Array {
  requireThat(Array.isArray(logs), `${INVALID}: digest`);
  // Every item takes at least one byte, so a longer list cannot pass the window rule; refusing it
  // first bounds the work an oversized response causes.
  requireThat(logs.length <= MAX_DIGEST, `${INVALID}: digest too long`);
  const count = compact(BigInt(logs.length));
  const items = [count];
  let size = count.length;
  let updates = 0;
  for (const log of logs) {
    requireThat(
      typeof log === 'string' && log.length <= 2 + 2 * MAX_DIGEST && BYTES.test(log),
      `${INVALID}: digest item`,
    );
    const item = fromHex(log);
    size += item.length;
    requireThat(size <= MAX_DIGEST, `${INVALID}: digest too long`);
    if (itemKind(item) === RUNTIME_ENVIRONMENT_UPDATED) updates++;
    items.push(item);
  }
  requireThat(
    committed(size, updates, height, logs.length),
    `${INVALID}: a ${size}-byte digest is outside the hash window`,
  );
  return concat(...items);
}

/**
 * check_digest_commitment_window (lib.rs:105-120), which the node applies to every block it
 * imports: the digest encodes to exactly DIGEST_LOGS_SIZE bytes or, up to LEGACY_DIGEST_CUTOFF, to
 * one byte more with exactly one RuntimeEnvironmentUpdated item. The genesis block is built from
 * the chain spec rather than imported, with no digest items, so that shape passes at height 0.
 */
function committed(size: number, updates: number, height: number, items: number): boolean {
  if (height === 0 && items === 0) return true;
  if (size === DIGEST_LOGS_SIZE) return true;
  return size === DIGEST_LOGS_SIZE + 1 && updates === 1 && height <= LEGACY_DIGEST_CUTOFF;
}

/** The kind of one encoded digest item, refusing what DigestItem::decode refuses
 * (sp-runtime src/generic/digest.rs:299-320) and any byte after the item. */
function itemKind(item: Uint8Array): number {
  const kind = item[0];
  if (kind === RUNTIME_ENVIRONMENT_UPDATED) {
    requireThat(item.length === 1, `${INVALID}: digest item`);
    return kind;
  }
  // PreRuntime, Consensus and Seal carry a 4-byte consensus engine id before their payload.
  let payload: number;
  if (kind === OTHER) payload = 1;
  else if (kind === CONSENSUS || kind === SEAL || kind === PRE_RUNTIME) payload = 5;
  else throw new Error(`${INVALID}: digest item kind`);
  const [length, start] = compactU32(item, payload);
  requireThat(start + length === item.length, `${INVALID}: digest item length`);
  return kind;
}

/** The Compact<u32> at `at` and the offset after it, refusing non-minimal encodings as
 * parity-scale-codec 3.7.5 does (src/compact.rs:521-558). */
function compactU32(bytes: Uint8Array, at: number): [value: number, next: number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const has = (width: number) =>
    requireThat(at + width <= bytes.length, `${INVALID}: truncated digest item`);
  has(1);
  const prefix = view.getUint8(at);
  switch (prefix & 3) {
    case 0:
      return [prefix >> 2, at + 1];
    case 1:
      has(2);
      return minimal(view.getUint16(at, true) >> 2, 2 ** 6, at + 2);
    case 2:
      has(4);
      return minimal(view.getUint32(at, true) >>> 2, 2 ** 14, at + 4);
    default:
      // Of the big-integer forms only the prefix 0b11, followed by four bytes, fits a u32.
      requireThat(prefix === 3, `${INVALID}: length beyond u32`);
      has(5);
      return minimal(view.getUint32(at + 1, true), 2 ** 30, at + 5);
  }
}

/** A compact value that no shorter form could hold, as the codec requires. */
function minimal(value: number, min: number, next: number): [value: number, next: number] {
  requireThat(value >= min, `${INVALID}: non-minimal length`);
  return [value, next];
}
