/** Mint session reads on the wallet's own node: accounts, proven block ancestry and payment inclusion. */
import { fromHex, hex, requireThat } from '../../../packages/native/src/codec.ts';
import { encodeEra } from '../../../packages/chain/src/codec/extrinsic.ts';
import { blake2_128 } from '../../../packages/chain/src/codec/hash.ts';
import { ScaleReader } from '../../../packages/chain/src/codec/scale.ts';
import { rpc } from './network.ts';
import { PROFILE } from './profile.ts';
import { finalHeight, finalityDepth } from '../../native/src/network.ts';
import {
  type Block,
  type BlockSource,
  MAX_WALK,
  type Position,
  provenAncestry,
  provenBody,
  provenHeader,
  proveInclusion as provenAt,
} from './proof/inclusion.ts';

export { MAX_WALK, UNPROVEN } from './proof/inclusion.ts';
export type { Block, Position };

/** Response cap of one block body. A signed payment is about 7.3 KB, so a busy block outgrows the
 * 1 MiB cap every other read keeps; the runtime's 5 MiB block limit is twice that in hex. */
export const BLOCK_BODY_CAP = 16 * 1024 * 1024;
/** Mortal era period of every payment the wallet signs (`validateContext` in network.ts). */
const ERA_PERIOD = 256;
/** twox128("System") ++ twox128("Account"). */
const SYSTEM_ACCOUNT = '0x26aa394eea5630e07c48ae0c9558cef7b99d880ec681799c0cf30e8886371da9';
const INVALID = 'RPC unavailable or invalid response';
const HASH = /^0x[0-9a-f]{64}$/;

/** An account at one block: the nonce its next transaction needs and the balances that bound what
 * it can spend. */
export interface Account {
  nonce: number;
  free: bigint;
  frozen: bigint;
}
/** A signed payment as the session recorded it, with the block its era was born at. */
export interface Payment {
  hash: string;
  nonce: number;
  birth: Block;
}
/** What the wallet's node shows about a payment on one chain. */
export type Search =
  | { kind: 'included'; at: Position }
  | { kind: 'pending' } // its nonce is unused there: it can still be included
  | { kind: 'replaced' } // another transaction used its nonce
  | { kind: 'unprovable' }; // its window starts above that block, or more than MAX_WALK below
/** A payment that is not included can also never be: its birth block left the finalized chain
 * (dead), or its era ended there with the nonce unused (expired). */
export type Fate = Search | { kind: 'dead' } | { kind: 'expired' };

/**
 * Reads of the session account's chain through the wallet's pinned node. Headers and bodies are
 * raw: the proofs below check every header against the Poseidon2 hash its child or a trusted
 * caller names, and every body against its header's extrinsics root, so ancestry and positions are
 * as good as the block hash a walk starts from. Account state, the best and finalized blocks and
 * canonical hashes stay the node's claims: callers use them only to stop or to wait, and a
 * session's caps never rest on them. Each read takes the session's stop signal and aborts its
 * request with it.
 */
export interface ChainReads extends BlockSource {
  /** The node's best block. */
  tip(signal: AbortSignal): Promise<Block>;
  /** The block that counts as final, by the rule the indexer follows (finalityDepth): the node's
   * finalized block, or the block that many below the best one when that is newer. */
  finalizedHead(signal: AbortSignal): Promise<Block>;
  /** The node's canonical hash at `height`, null when it has no block there. */
  canonicalAt(height: number, signal: AbortSignal): Promise<string | null>;
  /** The account's System.Account entry at block `at`. */
  account(at: string, signal: AbortSignal): Promise<Account>;
}

const isHeight = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

/** Node bytes, whatever the hex case: only hashes are compared as text. */
function bytes(value: unknown): Uint8Array {
  requireThat(typeof value === 'string', INVALID);
  try {
    return fromHex(value.toLowerCase());
  } catch {
    throw Error(INVALID);
  }
}

/** `AccountInfo { nonce, consumers, providers, sufficients: u32, data: { free, reserved, frozen,
 * flags: u128 } }`; an account the chain does not store has nonce 0 and nothing to spend. */
function decodeAccount(raw: unknown): Account {
  if (raw === null) return { nonce: 0, free: 0n, frozen: 0n };
  try {
    const r = new ScaleReader(bytes(raw));
    const nonce = r.u32();
    r.bytes(12);
    const free = r.u128();
    r.u128();
    return { nonce, free, frozen: r.u128() };
  } catch {
    throw Error(INVALID);
  }
}

/** Era bytes of a payment born at `height`. They encode only the period and the birth height; the
 * birth block's hash is part of the signed payload instead. */
export const era = (height: number): string =>
  hex(encodeEra({ kind: 'mortal', period: ERA_PERIOD, blockNumber: height, blockHash: '' }));

/** Chain reads for `owner`, a 32-byte account id. */
export function chainReads(owner: string): ChainReads {
  // System.Account is keyed by Blake2_128Concat of the account id.
  const key = SYSTEM_ACCOUNT + hex(blake2_128(fromHex(owner, 32))).slice(2) + owner.slice(2);
  const reads: ChainReads = {
    tip: async (signal) => block(await rpc<unknown>('chain_getBlockHash', [], { signal }), signal),
    async finalizedHead(signal) {
      const node = await block(await rpc<unknown>('chain_getFinalizedHead', [], { signal }), signal);
      const depth = finalityDepth(PROFILE.network);
      if (depth === null) return node;
      // Read after the node's finalized block, so the best block is never below it.
      const best = await reads.tip(signal);
      requireThat(best.height >= node.height, INVALID);
      const height = finalHeight(best.height, node.height, depth);
      if (height === node.height) return node;
      // The final block is proven an ancestor of the best one, not taken from the node's word.
      const hash = (await provenAncestry(reads, best, height, signal))?.get(height);
      requireThat(hash !== undefined, INVALID);
      return { height, hash: hash! };
    },
    async canonicalAt(height, signal) {
      requireThat(isHeight(height), 'Invalid block range');
      const hash = await rpc<unknown>('chain_getBlockHash', [height], { signal });
      // Some nodes name an unknown height with the zero hash instead of null.
      if (hash === null || (typeof hash === 'string' && /^0x0+$/.test(hash))) return null;
      requireThat(typeof hash === 'string' && HASH.test(hash), INVALID);
      return hash;
    },
    async account(at, signal) {
      requireThat(HASH.test(at), 'Invalid block hash');
      return decodeAccount(await rpc<unknown>('state_getStorage', [key, at], { signal }));
    },
    header: (hash, signal) => rpc<unknown>('chain_getHeader', [hash], { signal }),
    async body(hash, signal) {
      const answer = await rpc<{ block?: { extrinsics?: unknown } } | null>(
        'chain_getBlock',
        [hash],
        { signal, max: BLOCK_BODY_CAP },
      );
      return answer?.block?.extrinsics;
    },
  };
  /** A block the node names, with the height of its proven header. */
  async function block(hash: unknown, signal: AbortSignal): Promise<Block> {
    requireThat(typeof hash === 'string' && HASH.test(hash), INVALID);
    return { height: (await provenHeader(reads, hash, signal)).number, hash };
  }
  return reads;
}

/** Hashes by height on `from`'s ancestry for heights `low..from.height`, each proven by the
 * headers above it from `from.hash`; null when `low` is above `from` or more than MAX_WALK below
 * it (not provable). */
export function ancestry(
  reads: ChainReads,
  from: Block,
  low: number,
  signal: AbortSignal,
): Promise<Map<number, string> | null> {
  return provenAncestry(reads, from, low, signal);
}

/** True when each of `blocks` is the block at its height on `from`'s proven ancestry. Run over a
 * session's recorded inclusions from the node's best block, this is the reorganization watch; from
 * an attested block, it proves that the recorded inclusions are on the attested chain. */
export async function onAncestry(
  reads: ChainReads,
  from: Block,
  blocks: readonly Block[],
  signal: AbortSignal,
): Promise<boolean> {
  if (blocks.length === 0) return true;
  const map = await provenAncestry(reads, from, Math.min(...blocks.map((b) => b.height)), signal);
  return map !== null && blocks.every((b) => map.get(b.height) === b.hash);
}

/**
 * The chaining proof at block `at`, an attested block where the next payment would be born: every
 * recorded inclusion is on `at`'s proven ancestry, and the account's nonce at `at` is past `nonce`,
 * the previous payment's. Returns the account at `at` when both hold, else null. The nonce is the
 * node's claim: it can only refuse, the ancestry is what admits.
 */
export async function proveLineage(
  reads: ChainReads,
  at: Block,
  inclusions: readonly Block[],
  nonce: number,
  signal: AbortSignal,
): Promise<Account | null> {
  if (!(await onAncestry(reads, at, inclusions, signal))) return null;
  const account = await reads.account(at.hash, signal);
  return account.nonce > nonce ? account : null;
}

/**
 * Whether payment `p` is the extrinsic at `at` on the chain that ends at `anchor`, a block both
 * witnesses attested: the headers from `anchor` down to `at` hash to the hashes their children
 * name, the body of `at` matches its header's extrinsics root, and `p`'s hash is the extrinsic at
 * exactly `at.index`. Throws UNPROVEN when node data fails a check; read errors pass through.
 */
export function proveInclusion(
  reads: ChainReads,
  anchor: Block,
  p: Payment,
  at: Position,
  signal: AbortSignal,
): Promise<boolean> {
  return provenAt(reads, anchor, p.hash, at, signal);
}

/**
 * Where payment `p` is on `tip`'s chain, from proven headers and bodies below the node's best
 * block. The position is a candidate only: the node chose the starting block and the nonces that
 * steer the search, so a verdict proves it again from an attested block (`proveInclusion`). Its
 * nonce was exactly `p.nonce` at its birth block, and it can only execute in the ERA_PERIOD - 1
 * blocks after it: the first block of that window whose account nonce is past `p.nonce` either
 * holds `p` or a transaction that replaced it.
 */
export async function findInclusion(
  reads: ChainReads,
  p: Payment,
  tip: Block,
  signal: AbortSignal,
): Promise<Search> {
  if ((await reads.account(tip.hash, signal)).nonce <= p.nonce) return { kind: 'pending' };
  const map = await provenAncestry(reads, tip, p.birth.height + 1, signal);
  if (!map) return { kind: 'unprovable' };
  const hashAt = (height: number): string => {
    const hash = map.get(height);
    requireThat(hash, INVALID);
    return hash;
  };
  const used = async (height: number) =>
    (await reads.account(hashAt(height), signal)).nonce > p.nonce;
  let low = p.birth.height + 1;
  let high = Math.min(tip.height, p.birth.height + ERA_PERIOD - 1);
  // Used only after the payment's last valid block: something else took the nonce.
  if (high < tip.height && !(await used(high))) return { kind: 'replaced' };
  // A nonce never decreases along one chain, so the first block that used it is a binary search.
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (await used(middle)) high = middle;
    else low = middle + 1;
  }
  const index = (await provenBody(reads, hashAt(high), signal)).indexOf(p.hash);
  return index < 0
    ? { kind: 'replaced' }
    : { kind: 'included', at: { height: high, hash: hashAt(high), index } };
}

/** `findInclusion` at `tip`; while the payment is pending there, also whether it can still ever be
 * included, judged on the final chain (`finalizedHead`). */
export async function locatePayment(
  reads: ChainReads,
  p: Payment,
  tip: Block,
  signal: AbortSignal,
): Promise<Fate> {
  const found = await findInclusion(reads, p, tip, signal);
  if (found.kind !== 'pending') return found;
  const final = await reads.finalizedHead(signal);
  if (final.height >= p.birth.height) {
    const hash = await reads.canonicalAt(p.birth.height, signal);
    requireThat(hash !== null, INVALID);
    if (hash !== p.birth.hash) return { kind: 'dead' };
  }
  // The wallet history's `validUntil` rule: expired once the finalized height passes birth + period.
  if (final.height > p.birth.height + ERA_PERIOD) {
    if ((await reads.account(final.hash, signal)).nonce <= p.nonce) return { kind: 'expired' };
    return findInclusion(reads, p, final, signal);
  }
  return { kind: 'pending' };
}
