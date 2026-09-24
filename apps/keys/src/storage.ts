/** storage.local on IndexedDB, one record per key like chrome.storage. The wallet worker owns every
 * write; keys pages only read the network choice (config.ts `loadNetwork`, switchable builds). */
let opened: Promise<IDBDatabase> | undefined;
const database = () =>
  (opened ??= new Promise<IDBDatabase>((ok, no) => {
    const r = indexedDB.open('qlyphs-keys', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('local');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error ?? Error('Wallet storage unavailable'));
  }).catch((e) => {
    opened = undefined;
    throw e;
  }));
const done = (tx: IDBTransaction) =>
  new Promise<void>((ok, no) => {
    tx.oncomplete = () => ok();
    tx.onerror = tx.onabort = () => no(tx.error ?? Error('Wallet storage failed'));
  });
export async function get(keys: string | string[] | null): Promise<Record<string, unknown>> {
  const tx = (await database()).transaction('local', 'readonly'),
    store = tx.objectStore('local'),
    out: Record<string, unknown> = {};
  if (keys === null) {
    const all = store.getAll(),
      names = store.getAllKeys();
    await done(tx);
    names.result.forEach((k, i) => (out[String(k)] = all.result[i]));
    return out;
  }
  const reads = (typeof keys === 'string' ? [keys] : keys).map((k) => [k, store.get(k)] as const);
  await done(tx);
  for (const [k, r] of reads) if (r.result !== undefined) out[k] = r.result;
  return out;
}
export async function set(items: Record<string, unknown>): Promise<void> {
  const tx = (await database()).transaction('local', 'readwrite'),
    store = tx.objectStore('local');
  for (const [k, v] of Object.entries(items)) store.put(v, k);
  await done(tx);
}
