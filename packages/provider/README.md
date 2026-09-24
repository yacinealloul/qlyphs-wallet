# @qlyphs/provider

Private, browser-neutral public contract for Qlyphs Wallet discovery, requests,
projected state/events, exact error codes and cancellation metadata. Network-agnostic:
the wallet reports its pinned network (`'mainnet' | 'development'`) and genesis, and an
application must check them against its own deployment. No keys, browser globals at
import time, React or RPC client.

`window.qlyphs.version` remains `1` for existing callers; `protocolVersion: 2`
feature-detects additive capabilities and events. Build with
`pnpm --filter @qlyphs/provider build`. The package emits ESM JavaScript and declarations.
Applications normally use the connector from `@qlyphs/sdk` instead of implementing
transport, lifecycle, validation and transaction tracking themselves.

See [contract](../../docs/extension/PROVIDER.md) and SDK.
