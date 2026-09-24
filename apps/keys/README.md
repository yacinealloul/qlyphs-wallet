# Qlyphs Keys

The Qlyphs Wallet served as a web page, at **https://keys.qlyphs.com**, for people who do not have the
browser extension. Dapps open it in a popup to connect an account and have transactions approved. It is
non-custodial: keys are generated, encrypted and used in your browser, and never leave it.

Qlyphs Keys is the extension wallet ([apps/extension](../extension/README.md)) built for the web.
It uses the same background and UI sources, unchanged. Only the browser glue is swapped: storage,
messaging, windows and passkeys. It is a Qlyphs product, not an official Quantus wallet.

- Network: **Quantus mainnet** only (the production build refuses anything else).
- Accounts: ML-DSA-87 (post-quantum), derivation `m/44'/189189'/0'/0'/0'`, official
  `@quantus-network/wasm@0.3.1` SDK, whose `.wasm` hash is recorded in `BUILD.json`.
- Every release can be rebuilt from this repository and checked byte for byte against the live site
  ([Verify a release](#verify-a-release)).

## Contents

- [How it works](#how-it-works)
- [Security model](#security-model)
- [Verify a release](#verify-a-release)
- [For dapps](#for-dapps)
- [Build and run](#build-and-run)
- [Publish a release](#publish-a-release)
- [Files](#files)

## How it works

```
 dapp page (otc.qlyphs.com)                    keys.qlyphs.com
 ┌──────────────────────────┐   window.open    ┌───────────────────────────┐
 │ openKeysProvider()       │ ───────────────▶ │ /connect?origin=<dapp>    │ popup
 │  (apps/keys/src/sdk.ts)  │ ◀─ postMessage ─▶ │  checks event.origin      │
 └──────────────────────────┘  exact origins   └────────────┬──────────────┘
                                                            │ same-origin port
                                                ┌───────────▼──────────────┐
                                                │ wallet worker            │ SharedWorker
                                                │ extension background.ts  │ keys, signing
                                                │ storage: IndexedDB       │
                                                └───────────▲──────────────┘
                                                            │
                                                ┌───────────┴──────────────┐
                                                │ /  the wallet (full tab) │ confirmations
                                                │ extension ui.ts          │ in an overlay
                                                └──────────────────────────┘
```

- **`/`**: the wallet in a full tab: create, import, unlock, send, settings.
- **`/connect?origin=<dapp origin>`**: the popup a dapp opens. It only talks to its opener, and only
  when the opener's origin is on the build's allowlist (`dappOrigins` in `BUILD.json`). The origin
  it trusts is the browser-supplied `MessageEvent.origin`, compared exactly, never a value the dapp sends.
- **Wallet worker**: the extension's `background.ts` in a `SharedWorker` (a dedicated `Worker` where
  `SharedWorker` is missing). It holds the unlocked session and signs. Pages talk to it through
  `hub.ts`, which binds every message to the page or dapp port that really sent it.
- **Confirmations** open as a same-origin overlay inside the keys page. They are never opened from a
  URL chosen by a page.
- **Storage**: IndexedDB database `qlyphs-keys`. It holds the encrypted vault, account metadata and site
  grants, in the same formats as the extension.

Reloading the only keys tab locks the wallet: the session lives in the worker, by design.

## Security model

**What protects your keys**

- The recovery phrase is encrypted in the browser (PBKDF2-SHA256, 600,000 iterations, AES-GCM, fresh
  salt and IV). The optional passkey unlock uses WebAuthn PRF, HKDF-SHA256 and AES-GCM. Details and
  backup formats: [extension README, Recovery and migration](../extension/README.md#recovery-and-migration).
- Nothing secret crosses to a dapp. The popup protocol ([`src/protocol.ts`](src/protocol.ts)) carries
  public data only: accounts, network, signed transaction results and errors. Messages are capped at
  8 KiB. There is no `signMessage`.
- Every signature is shown and approved in the wallet's own confirmation UI. A dapp only makes requests.
- The endpoints are fixed at build time and recorded in `BUILD.json`: the RPC (`rpc`), the indexer
  (`api`), the explorer and the dapp allowlist. A website cannot change them.

**What the server sends, and how the browser is locked down** (`serve.mjs`)

- Only the files of the release are served. At startup the server checks every file against
  `SHA256SUMS.txt` and refuses to start if anything differs, is missing or was added.
- Content-Security-Policy on the pages: `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'`.
  No inline scripts, no third-party scripts, no `eval`. The build also fails on `eval`,
  `new Function` or dynamic `import()` in any bundle. `connect-src` lists only this origin, the RPC
  and the indexer. So the files in `SHA256SUMS.txt` are all the code the page can run.
- `frame-ancestors 'none'` on `/connect` and `'self'` on `/` (the confirmation overlay only), plus
  `nosniff`, `no-referrer`, `no-store`, HSTS, and a `Permissions-Policy` that turns off camera,
  microphone and geolocation.

**Limits you should know**

- A web wallet downloads its code on every visit. The release checks below prove what the site
  served *to you, when you checked*. They cannot prove that a different visitor received the same
  bytes. The browser extension does not have this limit: its code is installed once and updated
  through the store. Prefer the extension for large amounts.
- Keys live in this browser profile. Clearing site data for keys.qlyphs.com deletes the wallet.
  Keep your recovery phrase or an encrypted backup outside the browser.
- Passkeys are bound to the `keys.qlyphs.com` origin.

## Verify a release

Every release is a fixed set of files, and the build is deterministic: the same commit always
produces the same bytes. Two values identify a release:

- **`SHA256SUMS.txt`**: one SHA-256 per served file, in the standard `shasum -a 256` format. It is served
  at https://keys.qlyphs.com/SHA256SUMS.txt.
- **The release hash**: the SHA-256 of `SHA256SUMS.txt` itself. It names the whole release in one value.
  The build prints it, and every response carries it in the `x-qlyphs-release` header. Each GitHub
  release of Qlyphs Keys (tag `keys-v<version>`) publishes it.

SHA-256 only. MD5 and SHA-1 are broken for this purpose: someone can craft two different files with
the same MD5.

### 1. Check the live site (1 minute, Node 18+)

```sh
node apps/keys/verify.mjs https://keys.qlyphs.com --expect <release hash from the GitHub release>
```

It downloads `SHA256SUMS.txt`, hashes every listed file as served, checks the page's CSP only
allows those same-origin scripts, and compares the release hash with the one you pass. The last line
is either `All checks passed` or the list of what failed. Exit code `0` means every check passed.

The same checks with standard tools:

```sh
curl -s https://keys.qlyphs.com/SHA256SUMS.txt | shasum -a 256   # = release hash
curl -s https://keys.qlyphs.com/ui.js | shasum -a 256             # = the ui.js line
```

Pages are served on clean paths: `ui.html` at `/` and `connect.html` at `/connect`. Every other file is
served at `/<name>`.

### 2. Rebuild it yourself (Docker)

This proves the published release comes from this source, with no trust in us:

```sh
git clone https://github.com/yacinealloul/qlyphs-wallet && cd qlyphs-wallet
git checkout keys-v<version>
docker build -f deploy/keys.Dockerfile --target release --output type=local,dest=keys-release .
shasum -a 256 keys-release/SHA256SUMS.txt                     # = release hash
node apps/keys/verify.mjs https://keys.qlyphs.com --local keys-release
```

`--local` compares your `SHA256SUMS.txt`, line by line, with the one the site serves. The build uses
the locked dependency tree (`pnpm install --frozen-lockfile`) and the mainnet pins committed in
`deploy/mainnet/pins.json`. During the build, the mainnet indexer and RPC must answer a CORS preflight
for `https://keys.qlyphs.com`, so the build needs network access.

If a check fails, do not use the site, and report it (see [Publish a release](#publish-a-release)).

## For dapps

```ts
import { openKeysProvider } from '@qlyphs/keys/sdk';

button.onclick = () => {
  // Synchronously inside the click handler, or the browser blocks the popup.
  const provider = openKeysProvider({ origin: 'https://keys.qlyphs.com' });
  provider.request({ method: 'connect' }).then(console.log);
};
```

`openKeysProvider` returns the same `QlyphsProvider` interface as the extension
(`packages/provider`). A dapp can support both with one code path. A
blocked popup rejects with `UNAVAILABLE`. A closed popup ends the session with `DISCONNECTED`: open a
new provider on the next click. The popup path and message channel are internal to the SDK: do not
hardcode them.

Your origin must be on the build's allowlist (`QLYPHS_KEYS_DAPP_ORIGINS`; production:
`https://otc.qlyphs.com`). A demo dapp runs at http://localhost:4411 in development.

## Build and run

Node 24, pnpm 10.23.0, from the repository root after `pnpm install --frozen-lockfile`.

```sh
pnpm --filter @qlyphs/keys dev        # development build, served at http://localhost:4410 (+ demo on :4411)
pnpm --filter @qlyphs/keys typecheck
```

The development build targets a local node (`http://127.0.0.1:9955`) and indexer
(`http://127.0.0.1:4400`), and accepts only loopback HTTP origins. Do not import an account that
holds real funds into it.

Production build (what `deploy/keys.Dockerfile` runs):

```sh
cd apps/keys
QLYPHS_KEYS_PROFILE=production QLYPHS_KEYS_PINS=$PWD/../../deploy/mainnet/pins.json node build.mjs
node serve.mjs
```

| Variable | Meaning |
| --- | --- |
| `QLYPHS_KEYS_PROFILE` | `development` (default) or `production` (public HTTPS, mainnet only) |
| `QLYPHS_KEYS_NETWORK` | `development`, `mainnet` or `switchable` (local only) |
| `QLYPHS_KEYS_PINS` | mainnet pins file (genesis, runtime, activation); required for mainnet |
| `QLYPHS_KEYS_ORIGIN` | where keys is served; default `https://keys.qlyphs.com` in production |
| `QLYPHS_KEYS_API`, `QLYPHS_KEYS_RPC`, `QLYPHS_KEYS_EXPLORER` | endpoint overrides |
| `QLYPHS_KEYS_DAPP_ORIGINS` | JSON array of 1 to 16 exact dapp origins |
| `QLYPHS_KEYS_SKIP_CORS_CHECK=1` | offline build; the CORS check must then be done by hand |
| `KEYS_PORT`, `KEYS_LISTEN`, `KEYS_HOST` | `serve.mjs` port, bind address and expected `Host` |

Any override changes the files, so the build no longer matches a published release.

## Publish a release

1. Bump `version` in `apps/keys/package.json` and merge to `main`.
2. From a clean checkout of that commit, run the Docker `release` build (above) and note the release hash.
3. Deploy that same commit (Railway service `keys`, `deploy/keys.Dockerfile`, from a clean checkout).
4. Run `node apps/keys/verify.mjs https://keys.qlyphs.com --local keys-release`. It must pass.
5. Tag the commit `keys-v<version>` and create a GitHub release. Its notes contain the release hash
   and attach `SHA256SUMS.txt`.

Report a mismatch or a vulnerability privately, through GitHub's **Report a vulnerability** button
(repository Security tab). Do not open a public issue for it.

## Files

| Path | Role |
| --- | --- |
| `build.mjs` | Bundles the extension sources for the web, writes `dist/keys`, `BUILD.json`, `SHA256SUMS.txt` |
| `serve.mjs` | Dependency-free static server: release self-check, clean paths, CSP and headers |
| `verify.mjs` | Checks a live site against a release |
| `src/sdk.ts` | Dapp SDK: `openKeysProvider` |
| `src/connect.ts` | The `/connect` popup |
| `src/host.ts`, `src/hub.ts`, `src/web-browser.ts`, `src/page-browser.ts` | Pages ↔ wallet worker wiring (stand-in for the extension APIs) |
| `src/storage.ts` | `storage.local` on IndexedDB |
| `src/passkeys.ts` | WebAuthn PRF unlock on the keys origin |
| `src/protocol.ts` | Dapp ↔ popup wire contract |
| `public/` | `connect.html`, web-only CSS, demo dapp |

`dist/keys/BUILD.json` records the build: version, network, pins, SDK and its `.wasm` SHA-256,
endpoints, the dapp allowlist, and the key scheme and derivation path.

## License

[MIT](../../LICENSE). The bundled Quantus SDK and Geist fonts keep their own licenses, which ship
with every release as `QUANTUS-LICENSE.txt`, `GEIST-LICENSE.txt` and `THIRD-PARTY-LICENSES.txt`.
