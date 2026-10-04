# @qlyphs/provider

Browser-neutral public contract for Qlyphs Wallet discovery, requests,
projected state/events, exact error codes and cancellation metadata. Network-agnostic:
the wallet reports its pinned network (`'mainnet' | 'development'`) and genesis, and an
application must check them against its own deployment. No keys, browser globals at
import time, React or RPC client.

`window.qlyphs.version` remains `1` for existing callers; `protocolVersion: 2`
feature-detects additive capabilities and events. Development wallets also advertise bounded mint
sessions (`requestMintSession`, `mintSession`, `stopMintSession`, `mintSessionChanged`, `mintSessions`
in capabilities; absent on older wallets, `null` where unavailable); types and validators
(`parseMintSessionTerms`, `parseMintSessionSnapshot`) are exported. The snapshot parser accepts exact
keys and closed value lists only, so a dapp built with an older version rejects snapshots that carry
newer ones; the current version knows the end value `race-lost`, the payment status `unresolved`
and `attempts.unresolved`. Build with `pnpm --filter @qlyphs/provider build`. The package emits ESM JavaScript and declarations.
For the web wallet, use [`createKeysProvider` or `openKeysProvider`](../../apps/keys/README.md#for-dapps).
Keys read methods expose a cached public snapshot; unlike live extension state, it may remain connected
after the wallet locks or its popup closes. This cache never grants signing authority. See
[Keys popup state](../../docs/extension/PROVIDER.md#keys-popup-state).
For extension requests, follow the [provider contract](../../docs/extension/PROVIDER.md).
