/** Keys stores the wallet in this origin's IndexedDB, which a browser may evict as "best effort" storage
 * (low disk, or Safari after seven days without a visit). Once a wallet exists, the top-level page asks
 * for persistent storage, at most once per page load. Before that there is nothing to keep, and Firefox
 * would show its permission prompt to a visitor who has no wallet. */
export interface StorageManagerLike {
  persisted?(): Promise<boolean>;
  persist?(): Promise<boolean>;
}

/** The record the wallet worker writes at setup (background.ts WALLET_KEY). */
export const WALLET_RECORD = 'wallet';

export function persistOnceWalletExists(
  storage: StorageManagerLike | undefined,
  read: (key: string) => Promise<Record<string, unknown>>,
): () => Promise<boolean> {
  let asked = false;
  return async () => {
    if (asked || !storage?.persist || !storage.persisted) return false;
    try {
      if (await storage.persisted()) return (asked = true);
      if ((await read(WALLET_RECORD))[WALLET_RECORD] === undefined) return false;
      asked = true;
      return await storage.persist();
    } catch {
      // Storage unavailable (private window, blocked site data): the wallet behaves as before.
      return false;
    }
  };
}
