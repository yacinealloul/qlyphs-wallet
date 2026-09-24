/** Browser worker / future extension entrypoint. Trust pins MUST be compiled into
 * the installed wallet, not accepted from an API response or from a page message. */
import { fromHex, hex, requireThat } from '../../../packages/native/src/codec.ts';
import { verifyBundle, verifiedPurchase, policy, cursorValue } from '../src/pq/checkpoint.ts';
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
  verifiedPurchase(callHex, owner, verified.state);
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
