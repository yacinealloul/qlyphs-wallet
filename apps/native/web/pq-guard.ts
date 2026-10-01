/** Browser worker / future extension entrypoint. Trust pins MUST be compiled into
 * the installed wallet, not accepted from an API response or from a page message. */
import { fromHex, hex, requireThat } from '../../../packages/native/src/codec.ts';
import { progressiveLot } from '../../../packages/native/src/protocol.ts';
import type { ProgressiveLot, State } from '../../../packages/native/src/protocol.ts';
import {
  verifyBundle,
  verifyTipBundle,
  verifiedPurchase,
  policy,
  cursorValue,
} from '../src/pq/checkpoint.ts';
import type { Policy, Cursor } from '../src/pq/checkpoint.ts';
import { boundedJson } from '../src/pq/transport.ts';
declare const QLYPHS_PQ_POLICY: Policy | null;
const pins: Policy | null = typeof QLYPHS_PQ_POLICY === 'undefined' ? null : QLYPHS_PQ_POLICY;
export const pqConfigured = pins !== null;
const DB = 'qlyphs-qpa-highwater-v1';
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('cursors');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(new Error('cannot open attestation cursor store'));
  });
}
export async function authorizePurchase(
  callHex: string,
  owner: string,
  genesis: string,
  endpoint = new URL('/api/attestations', self.location.href).href,
): Promise<Cursor> {
  requireThat(pins, 'Purchase disabled: trusted PQ witnesses are not configured');
  return attested(owner, genesis, endpoint, (s) => verifiedPurchase(callHex, owner, s));
}
/** The terms a review shows for a progressive mint, all read from both witnesses' attestation of
 * the state at `block`, a recent best block. The mint is then signed with an era born exactly at
 * that block: it can only execute on chains that contain the attested state, where its right is
 * either still current or already used. */
export interface AttestedLot {
  lot: ProgressiveLot;
  symbol: string;
  decimals: number;
  cap: bigint;
  minted: bigint;
  creator: string;
  block: { height: number; hash: string };
}
/** Wait before the one new try when the witnesses cannot attest the best block yet. */
const RETRY_MS = 1000;
/** Terms of lot `lot` from both witnesses' attestation of the wallet's best block, `latest()`. If
 * they cannot attest it (a block they have not imported yet, a busy witness), one more try a second
 * later on the best block then; never on an older block, whose right may already be used. A lot
 * that the attested state shows as taken is refused at once. */
export async function attestedLot(
  owner: string,
  genesis: string,
  asset: string,
  lot: number,
  latest: () => Promise<{ height: number; hash: string }>,
  endpoint = new URL('/api/attestations/tip', self.location.href).href,
): Promise<AttestedLot> {
  requireThat(pins, 'Progressive mint disabled: trusted PQ witnesses are not configured');
  const p = policy(pins);
  requireThat(p.genesis === genesis, 'attestation network mismatch');
  fromHex(owner, 32);
  // Only a wallet-owned call site supplies the endpoint; never accept it from a dapp.
  const base = new URL(endpoint);
  requireThat(
    !base.username && !base.password && !base.search && !base.hash,
    'invalid attestation endpoint',
  );
  for (let attempt = 0; ; attempt++) {
    const block = await latest();
    fromHex(block.hash, 32);
    const challenge = hex(crypto.getRandomValues(new Uint8Array(32)));
    const url = new URL(base);
    url.searchParams.set('block', block.hash);
    url.searchParams.set('challenge', challenge);
    let s: State;
    try {
      s = verifyTipBundle(await boundedJson(url.href), p, challenge, block);
    } catch (error) {
      if (attempt > 0) throw error;
      await new Promise((r) => setTimeout(r, RETRY_MS));
      continue;
    }
    const next = progressiveLot(s, genesis, asset);
    requireThat(
      next.lot === BigInt(lot),
      `Lot ${lot} is no longer the next lot; lot ${next.lot} is`,
    );
    const a = s.assets.get(asset)!;
    return {
      lot: next,
      symbol: a.definition.symbol,
      decimals: a.definition.decimals,
      cap: a.definition.cap,
      minted: a.minted,
      creator: a.creator,
      block: { height: block.height, hash: block.hash },
    };
  }
}
/** Verify a fresh bundle from every required witness, run `check` on its state, then record the
 * checkpoint as this wallet's high-water mark. */
async function attested(
  owner: string,
  genesis: string,
  endpoint: string,
  check: (s: State) => void,
): Promise<Cursor> {
  requireThat(pins, 'Trusted PQ witnesses are not configured');
  const p = policy(pins);
  requireThat(p.genesis === genesis, 'attestation network mismatch');
  fromHex(owner, 32);
  const challenge = hex(crypto.getRandomValues(new Uint8Array(32)));
  // Only a wallet-owned call site supplies the endpoint; never accept it from a dapp.
  const url = new URL(endpoint);
  requireThat(
    !url.username && !url.password && !url.search && !url.hash,
    'invalid attestation endpoint',
  );
  url.searchParams.set('challenge', challenge);
  const proof = await boundedJson(url.href);
  // Expensive verification happens before the IndexedDB transaction, whose lifetime is short.
  const verified = verifyBundle(proof, p, challenge, null);
  check(verified.state);
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('cursors', 'readwrite'),
        store = tx.objectStore('cursors');
      const name = p.genesis + ':' + p.rulesHash;
      const r = store.get(name);
      let reason = 'Cannot persist attestation checkpoint';
      r.onsuccess = () => {
        let old: Cursor | undefined;
        try {
          old = r.result === undefined ? undefined : cursorValue(r.result);
        } catch {
          reason = 'Corrupt attestation checkpoint';
          tx.abort();
          return;
        }
        const next = verified.cursor;
        if (
          old &&
          (next.policyVersion < old.policyVersion ||
            next.height < old.height ||
            (next.height === old.height &&
              (next.blockHash !== old.blockHash || next.stateRoot !== old.stateRoot)))
        ) {
          reason = 'Attestation checkpoint rollback or equivocation';
          tx.abort();
          return;
        }
        store.put(next, name);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error(reason));
      tx.onabort = () => reject(new Error(reason));
    });
  } finally {
    db.close();
  }
  // Persistence must not extend a signed claim beyond its original lifetime.
  verifyBundle(proof, p, challenge, verified.cursor);
  return verified.cursor;
}
