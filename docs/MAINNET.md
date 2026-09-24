# Qlyphs on Quantus mainnet

Status (2026-09-24): **prepared, not activated.** Qlyphs OTC (`otc.qlyphs.com`) already runs on
mainnet; this page is about the QLYP protocol stack: indexer (`apps/native`), Qlyphs Wallet
(`apps/extension`), SDK/provider and the app at `app.qlyphs.com`.

## The lock

Every part of the stack takes a network profile (`packages/native/src/network.ts`):

- **development** (default): any `--dev` chain, genesis ≠ mainnet, activation at block 0, runtime
  pinned to the dev fingerprint (spec 152). Nothing changes for local work.
- **mainnet**: only with a pins file. `mainnetProfile()` refuses it unless the genesis is Quantus
  mainnet, the runtime (spec, tx version, code hash) is given, and the activation block is after
  genesis. There is no built-in default, so a build or service without pins cannot reach mainnet.

```json
{
  "genesis": "0xfb5487c0be6ae4ade2d41d16e50465129861636c2b8d61fa94d7a19631626fba",
  "runtime": { "specVersion": 153, "transactionVersion": 6, "codeHash": "0x78389c85…15ec56" },
  "activation": { "height": <block>, "hash": "<its hash>" }
}
```

`deploy/mainnet/pins.example.json` has the checked genesis and runtime; its activation is zero, so
it is refused until the real block is filled in.

| Part | Mainnet switch |
|---|---|
| Indexer | `NATIVE_NETWORK=mainnet NATIVE_MAINNET_PINS=pins.json NATIVE_RPC_URL=https://rpc1-mainnet.quantus.com NATIVE_PUBLIC_ORIGIN=https://app.qlyphs.com`. HTTPS is required, the faucet and PQ witnesses are refused. |
| Wallet | `QLYPHS_EXTENSION_NETWORK=mainnet QLYPHS_EXTENSION_PINS=pins.json pnpm --filter @qotc/wallet-extension build`. HTTPS origins only (defaults: app.qlyphs.com, rpc1-mainnet.quantus.com, qlyphs.com/explorer), no dev `key`, Firefox id `wallet@qlyphs.com`. |
| SDK/provider | Accept `network: 'mainnet'` only with `mainnetEnabled: true` and a manifest activated after genesis. Apps pass `expectedGenesis` and check `status.network`. |

## Checked on 2026-09-24

`node apps/native/scripts/mainnet-compat.mjs https://rpc1-mainnet.quantus.com` (read-only):
mainnet runs **spec 153**, transaction version 6, code hash `0x78389c85…15ec56`. The call indices
the codec writes (system.remark/remark_with_event, balances.transfer_keep_alive, utility.batch_all,
multisig.propose/approve) and the signed-extension layout (Era, nonce, tip, metadata-hash mode;
spec, tx, genesis, era block, metadata hash) are the same as on the dev runtime. Run it again
before writing the pins.

## Before activation

1. **Node.** For now the wallet and the indexer use Quantus's public RPC
   `https://rpc1-mainnet.quantus.com` (undocumented, no availability guarantee, and the wallet
   trusts it for balances, nonces and runtime checks). Later: our own node behind
   `https://rpc.qlyphs.com` with `--rpc-methods safe`, TLS and rate limiting. Switching means a new
   wallet build (`QLYPHS_EXTENSION_RPC`) and `NATIVE_RPC_URL`.
2. **Activation block.** Pick a block after the spec 153 upgrade, announce it, and fill in the pins
   with its hash. QLYP ignores every remark before it.
3. **Read-only dry run.** Run the indexer in mainnet mode against our node from the activation block
   and check that nothing unexpected is indexed. QLYP has never run on a real network before.
4. **Indexer deploy.** Behind `app.qlyphs.com/api`, persistent volume for the SQLite database,
   `NATIVE_EXTENSION_ORIGINS` set to the store extension ids.
5. **Wallet release.** Mainnet build with the pins, then Chrome Web Store and Firefox Add-ons
   submission (`apps/extension/store/LISTING.md`, `docs/extension/DISTRIBUTION.md`): privacy
   policy on qlyphs.com, support contact, WASM provenance and licences, store ids added to the
   indexer.
6. **App.** `apps/platform` on `app.qlyphs.com`, configured for mainnet (it runs locally against the
   dev network today).
7. **Explorer.** `apps/web` reads the QLYP indexer only as `network: 'development'`
   (`apps/web/src/app/api/explorer/route.ts`, `src/lib/explorer/qlyph.ts`); a mainnet indexer now
   reports `mainnet`, so the web explorer needs the matching change.
8. **Security review** of the wallet and the indexer before real funds.

## Known limits at launch

- **Purchases stay off.** They need two post-quantum witness attestations (`docs/native/pq`), and
  witness snapshots refuse mainnet until they are validated there. Create, mint, transfer and
  inscribe work without them.
- **Runtime upgrades stop signing.** Any new Quantus runtime halts the indexer and disables signing
  in the wallet ("Unsupported runtime") until the compat check passes again, new pins are written
  and a new wallet version passes store review. Open decision: keep pinning the code hash (safest,
  slowest) or pin spec/tx versions plus the compat check (faster releases).
- **Accounts.** The wallet derives ML-DSA-87 at `m/44'/189189'/0'/0'/0'` (SDK 0.3.1). The official
  Quantus wallet now defaults to ML-DSA-65 at another path, so the same phrase gives a different
  address there. Say so wherever import/export is offered.
- The embedded web wallet in `apps/native/web` stays development-only.
