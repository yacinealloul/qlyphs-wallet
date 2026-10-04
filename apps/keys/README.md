# Qlyphs Keys

The Qlyphs Wallet served as a web page, at **https://keys.qlyphs.com**, for people who do not have the
browser extension. Dapps open it in a popup to connect an account and have transactions approved. It is
non-custodial: keys are generated, encrypted and used in your browser, and never leave it.

Qlyphs Keys is the extension wallet ([apps/extension](../extension/README.md)) built for the web.
It uses the same background and UI sources, unchanged. Only the browser glue is swapped: storage,
messaging, windows and passkeys. It is a Qlyphs product, not an official Quantus wallet.

- Network: **Quantus mainnet** only in production. Purchases and progressive lot mints are disabled, and so are mint sessions, until mainnet witness verification is validated; production builds reject `NATIVE_PQ_POLICY_FILE`.
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
 dapp page                                     keys.qlyphs.com
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
  One message from that origin is accepted without coming from the opener: the stop of a mint session
  that a dapp page sends as it leaves, which can only end that session (see [For dapps](#for-dapps)).
  Connecting opens the normal wallet UI in this same window: **Get started** when no wallet is saved,
  or **Unlock** for a locked wallet. Create or import an account and complete its backup, then review
  the site's connection request. An already unlocked wallet proceeds directly to the connection check.
  Wallet detection uses this Keys origin's storage in the current browser profile; an extension,
  another browser profile, or a different Keys origin has separate storage.
- **Wallet worker**: the extension's `background.ts` in a `SharedWorker` (a dedicated `Worker` where
  `SharedWorker` is missing). It holds the unlocked session and signs. Pages talk to it through
  `hub.ts`, which binds every message to the page or dapp port that really sent it.
- **Confirmations** open as a same-origin overlay inside the keys page. They are never opened from a
  URL chosen by a page. A review a dapp asked for always opens in that dapp's own popup, never in
  another dapp's popup or in the focused tab.
- **Connection setup** uses the same trusted wallet UI in an overlay. The connection page receives
  only a readiness signal, never wallet status or secrets. The original request resumes once after
  setup; the controller still checks the origin, account, network and existing permission or asks for
  consent. Closing or cancelling the connection discards it, including late setup responses.
- **Mint sessions** (development and test builds): a dapp's `requestMintSession` opens its review in
  that dapp's own popup overlay; after approval the overlay shows progress and Stop, as the
  extension's [wallet window](../extension/README.md#mint-sessions-development-and-test-builds) does,
  lost races and reorganizations included. Closing or reloading the popup or the overlay, locking or
  switching accounts stops signing. Leaving or reloading the dapp page stops it too when the stop that
  page sends as it leaves reaches the popup, which browsers do not guarantee (see
  [For dapps](#for-dapps)). Sessions are offered only in desktop Chromium-family browsers (Chrome,
  Edge, Brave and others) and desktop Firefox on Windows, macOS or Linux, with the wallet worker
  shared by every Keys page ([`src/session-browser.ts`](src/session-browser.ts)). Safari and every
  iOS browser, mobile browsers, VR browsers, ChromeOS and browsers without `SharedWorker` answer
  `capabilities` with `mintSessions: null` and refuse `requestMintSession` with
  `UNSUPPORTED_METHOD`, outcome `not-submitted`. Android browsers are refused even when they present
  a desktop identity (Chrome on Android XR or desktop Android devices, "Desktop site"): the user
  agent string, `navigator.platform` and, in Chromium, `navigator.userAgentData` must name the same
  desktop system. ChromeOS is refused for now because Chrome on desktop Android reports the same
  signals, and only asynchronous client hints could tell them apart.
- **Storage**: IndexedDB database `qlyphs-keys`. It holds the encrypted vault, account metadata and site
  grants, in the same formats as the extension. Every write uses strict durability, so a completed
  write, such as a payment recorded before it is sent, survives an operating system crash.
- **Updates**: the worker is shared by every keys page of this origin. When a page of another release
  connects to it, the worker stops any running mint session; the page asks you to close the other keys
  tabs and reload.

Reloading the only keys tab locks the wallet: the session lives in the worker, by design. It also stops
a running mint session.

## Security model

**What protects your keys**

- The recovery phrase is encrypted in the browser (PBKDF2-SHA256, 600,000 iterations, AES-GCM, fresh
  salt and IV). The optional passkey unlock uses WebAuthn PRF, HKDF-SHA256 and AES-GCM. Details and
  backup formats: [extension README, Recovery and migration](../extension/README.md#recovery-and-migration).
- Nothing secret crosses to a dapp. The popup protocol ([`src/protocol.ts`](src/protocol.ts)) carries
  public data only: accounts, network, signed transaction results, mint session snapshots and errors.
  Messages are capped at 8 KiB. There is no `signMessage`.
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
- `frame-ancestors 'none'` on `/connect` and `'self'` on `/` (wallet setup and confirmation overlays), plus
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

Use a persistent provider when the dapp should retain its public account display between popups:

```ts
import { createKeysProvider } from '@qlyphs/keys/sdk';

const provider = createKeysProvider({ origin: 'https://keys.qlyphs.com' });
button.onclick = () => {
  // The request opens the popup synchronously inside this user gesture.
  provider.request({ method: 'connect' }).then(console.log);
};
```

Creating this provider does not open a window. `connect`, `requestTransaction`, `requestMintSession` and
`disconnect` open or reuse the Keys popup, reopening it after closure. Call these methods directly from
a user gesture, before an `await`, so the browser can permit the popup. A blocked connection or
transaction popup rejects with `UNAVAILABLE`. These requests are sent once the popup page announces
itself. A dapp page that reuses a popup it has not seen announce itself, such as a page reloaded while
the popup stayed open, asks the popup page to announce itself again. If no popup page announces itself
within 30 seconds (for example the page that asks you to close other Keys tabs after an update), the
provider closes the popup. Closing a popup rejects pending requests with `DISCONNECTED`. Reloading it
rejects the requests its old page held with `CONTEXT_CHANGED` once the new page announces itself, and
the other requests wait for that page. It never retries a payment. Branch on `outcome`, never on
`CONTEXT_CHANGED` or `DISCONNECTED` alone: a `requestTransaction` or `requestMintSession` whose reply
is lost after it reached the popup has `outcome: 'unknown'`, whatever the code (`CONTEXT_CHANGED`,
`DISCONNECTED`, `TIMEOUT` or `ABORTED`), because it may have been approved and sent. A review always
opens in the popup of the dapp that asked for it.

`mintSession` and `stopMintSession` never open or wait for a popup: until a popup page has announced
itself to this provider, they return `null` without asking the wallet. That `null` does not prove
that no session runs: one started from an earlier page of the dapp keeps running in a popup that is
still open. A reloaded dapp page reads, follows and stops it again once one of the requests above
reuses that popup.

A mint session started through Keys is bound to the channel of the popup page. Closing or reloading
the popup stops it, and so does closing the dapp tab, which closes the popup. A reload or crash of
the dapp page does not close that channel. Instead, on `pagehide` (a reload, a navigation, or entering
the back/forward cache) the provider posts `stopMintSession` to the popup for the running session it
knows of: one it started, read or was told of through that popup. When the page reloads or
navigates, Chromium and Firefox deliver that message once the page has gone, without the window that
sent it, so the popup cannot check that its opener sent it. It accepts it anyway, because a stop only
removes authority, but only from the dapp origin it serves, while its own page is open and its opener
is a top-level window, only as exactly that request for the session its channel runs, and once per
session. It passes the stop on to the wallet and answers nothing; the session ends `cancelled`. This
remains best effort: a page that crashes sends nothing, and browsers do not guarantee to deliver a
message posted while a page leaves. The session then keeps running until the popup or its wallet
overlay closes or reloads, the wallet locks or the session's deadline passes. Once the popup page has
announced itself, the provider emits `mintSessionChanged` with each snapshot the wallet reports, and
`null` when the popup closes or reloads or its channel resets.

`accounts`, `network` and `state` read the last public snapshot, without opening or contacting the
wallet. The SDK caches connected public account/network data in the dapp's local storage, keyed by
Keys origin, so it can survive popup closure and page reload. It may be stale after a wallet lock,
revocation or network change. `connected: true` is a display hint, not proof of a live unlock, grant
or permission to sign. The wallet rechecks current permissions, network and approval for every write;
a received `UNAUTHORIZED` response or different network clears the saved connection. Do not use this
cache as an authentication credential.

For a provider whose interactive session ends with its popup, use `openKeysProvider` instead:

```ts
import { openKeysProvider } from '@qlyphs/keys/sdk';

button.onclick = () => {
  const provider = openKeysProvider({ origin: 'https://keys.qlyphs.com' });
  provider.request({ method: 'connect' }).then(console.log);
};
```

This opens the popup immediately. Closing it rejects pending and subsequent interactive requests with
`DISCONNECTED`; create another provider on the next click. Reloading it rejects the requests its old
page held with `CONTEXT_CHANGED`; the provider continues with the reloaded popup once its new page
announces itself. Its read methods use the same public snapshot mechanism while active, and its
in-memory account list clears on closure. The saved cache remains available to a later provider.

Both constructors accept `network` (`'development'` or `'mainnet'`): the network the Keys origin signs
for, used by `capabilities` until the wallet reports its own. The SDK otherwise assumes mainnet for any
HTTPS Keys origin other than the one it was built for, so a dapp that compiles the SDK from source and
uses an HTTPS test-network Keys origin passes `network: 'development'`:

```ts
const provider = createKeysProvider({ origin: 'https://keys.testnet.example', network: 'development' });
```

`capabilities().mintSessions` gives the session limits where sessions are offered, `null` where they
are not (every mainnet build, and browsers where Keys does not run sessions: see Mint sessions in
[How it works](#how-it-works)), and is absent on wallets older than mint sessions: test it for
truthiness. Where it is `null`, `requestMintSession` rejects with `UNSUPPORTED_METHOD` without opening
the popup. The adapter computes `capabilities` in the dapp from the network and from the dapp page's
own browser, judged from the same signals the wallet reads (the user agent string,
`navigator.platform` and, in Chromium, `navigator.userAgentData`), so a page in a per-tab desktop
mode gets `null` like the wallet. A truthy `mintSessions` is a hint: a Keys deployment that cannot
run sessions (for example one built without a witness policy, or older than the SDK) still refuses
with `not-submitted`, and so does the wallet when an override that also replaces
`navigator.platform`, such as developer tools emulation, made the page's answer differ; nothing is
signed then. Propose retries after lost races (`maxAttempts > maxLots`) only when the user asks for
them: with `maxAttempts === maxLots` the first lost race ends the session (`race-lost`).

Both constructors return the [`QlyphsProvider`](../../packages/provider/README.md) interface. The
extension's live state and Keys' cached state have different freshness guarantees; see the
[provider contract](../../docs/extension/PROVIDER.md#keys-popup-state). An explicit Keys `disconnect`
clears the local cache and attempts wallet revocation through the popup. If the browser blocks that
popup, local disconnection succeeds without proving that the wallet's stored grant was revoked.

The popup path and message channel are internal to the SDK: do not hardcode them.

Keys allows up to ten minutes for `connect`, including first-time setup and backup. A caller can
choose a shorter `timeoutMs` or abort with a signal. Transaction requests keep their 135-second
maximum, and connection consent still expires after two minutes once its review opens.
`requestMintSession` keeps the 135-second maximum and resolves when the session is approved. Wallet
creation never approves a connection or a transaction. If setup outlasts the connection, reconnect
to continue with the wallet already saved on this device.

Leaving the dapp cancels its pending requests and clears its queue; returning through the browser's
back/forward cache never replays them. A reusable `createKeysProvider` can start a new connection on
the next explicit request. An `openKeysProvider` session ends and needs a new instance. Cancellation
does not close the wallet window or undo a submitted transaction. Leaving the dapp also sends the stop
of a running mint session the page knows of, which takes effect when the browser delivers it (see
above); closing or reloading the popup always stops it.

Your origin must be on the build's allowlist (`QLYPHS_KEYS_DAPP_ORIGINS`; production:
`https://app.qlyphs.com` and `https://otc.qlyphs.com`). A demo dapp runs at http://localhost:4411 in development.

## Build and run

Node 24, pnpm 10.23.0, from the repository root after `pnpm install --frozen-lockfile`.

```sh
pnpm --filter @qlyphs/keys dev        # development build, served at http://localhost:4410 (+ demo on :4411)
pnpm --filter @qlyphs/keys typecheck
```

The development build targets a local node (`http://127.0.0.1:9955`) and indexer
(`http://127.0.0.1:4400`), and accepts only loopback HTTP origins. Those services must already be running separately; the public wallet export does not provide the indexer server. Do not import an account that
holds real funds into it.

Production build (what `deploy/keys.Dockerfile` runs):

```sh
cd apps/keys
QLYPHS_KEYS_PROFILE=production QLYPHS_KEYS_PINS=$PWD/../../deploy/mainnet/pins.json node build.mjs
node serve.mjs
```

Testnet build: a development network you run yourself, served in public. It signs with the
development profile, so it never signs for the mainnet genesis. It has no default endpoint: each one
is named, must be public HTTPS and may not be a mainnet service, a mainnet dapp or the mainnet keys
origin, so a testnet wallet keeps its own storage and passkeys. The API must allow the keys origin
(`NATIVE_EXTENSION_ORIGINS` in apps/native), and a witness policy must be that network's
development policy.

```sh
cd apps/keys
QLYPHS_KEYS_PROFILE=production QLYPHS_KEYS_NETWORK=testnet \
QLYPHS_KEYS_ORIGIN=https://keys.testnet.example \
QLYPHS_KEYS_API=https://indexer.testnet.example QLYPHS_KEYS_RPC=https://rpc.testnet.example \
QLYPHS_KEYS_EXPLORER=https://app.testnet.example \
QLYPHS_KEYS_DAPP_ORIGINS='["https://app.testnet.example"]' node build.mjs
```

| Variable | Meaning |
| --- | --- |
| `QLYPHS_KEYS_PROFILE` | `development` (default) or `production` (public HTTPS: mainnet or testnet) |
| `QLYPHS_KEYS_NETWORK` | `development`, `testnet`, `mainnet` or `switchable` (local only) |
| `QLYPHS_KEYS_PINS` | mainnet pins file (genesis, runtime, activation); required for mainnet |
| `QLYPHS_KEYS_ORIGIN` | where keys is served; default `https://keys.qlyphs.com` in a mainnet production build, required for testnet |
| `QLYPHS_KEYS_API`, `QLYPHS_KEYS_RPC`, `QLYPHS_KEYS_EXPLORER` | endpoint overrides; required for testnet |
| `NATIVE_PQ_POLICY_FILE` | reviewed public witness policy for development purchases and progressive lot mints only; rejected with mainnet or switchable |
| `NATIVE_PROGRESSIVE_FROM`, `NATIVE_PROGRESSIVE_V2_FROM` | the witnesses' activation heights of progressive-1000-v1 (tag 11) and -v2 (tag 12), checked with `NATIVE_PQ_POLICY_FILE`; unset when they have none |
| `QLYPHS_KEYS_DAPP_ORIGINS` | JSON array of 1 to 16 exact dapp origins; required for testnet |
| `QLYPHS_KEYS_SKIP_CORS_CHECK=1` | offline build; the CORS check must then be done by hand |
| `KEYS_PORT`, `KEYS_LISTEN`, `KEYS_HOST` | `serve.mjs` port, bind address and expected `Host` |

Any override changes the files, so the build no longer matches a published release.

## Publish a release

1. Bump `version` in `apps/keys/package.json` and merge to `main`.
2. From a clean checkout of that commit, run the Docker `release` build (above) and note the release hash.
3. Deploy that same commit using `deploy/keys.Dockerfile` from a clean checkout.
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
| `src/sdk.ts` | Dapp SDK: `createKeysProvider`, `openKeysProvider` |
| `src/connect.ts` | The `/connect` popup |
| `src/host.ts`, `src/hub.ts`, `src/web-browser.ts`, `src/page-browser.ts` | Pages ↔ wallet worker wiring (stand-in for the extension APIs) |
| `src/storage.ts` | `storage.local` on IndexedDB |
| `src/passkeys.ts` | WebAuthn PRF unlock on the keys origin |
| `src/protocol.ts` | Dapp ↔ popup wire contract |
| `src/session-browser.ts` | Which browsers run mint sessions |
| `public/` | `connect.html`, web-only CSS, demo dapp |

`dist/keys/BUILD.json` records the build: version, network, pins, SDK and its `.wasm` SHA-256,
endpoints, the dapp allowlist, and the key scheme and derivation path.

## License

[MIT](../../LICENSE). The bundled Quantus SDK and Geist fonts keep their own licenses, which ship
with every release as `QUANTUS-LICENSE.txt`, `GEIST-LICENSE.txt` and `THIRD-PARTY-LICENSES.txt`.
