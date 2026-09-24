# Packaging and store distribution

Status: store listings are not published and Quantus mainnet is not activated yet
([MAINNET.md](../MAINNET.md)). A published package is always a mainnet build; the development build is
for local use only and must not be submitted.

## Build flavours

| | Mainnet | Development (default) |
|---|---|---|
| Command | `QLYPHS_EXTENSION_NETWORK=mainnet QLYPHS_EXTENSION_PINS=/abs/pins.json pnpm --filter @qotc/wallet-extension build` | `pnpm --filter @qotc/wallet-extension build` |
| Pins | required (genesis, runtime, activation block); the build fails without them | taken from the local node at first use, after review |
| Origins | https only; defaults `https://app.qlyphs.com` (app and API), `https://rpc1-mainnet.quantus.com`, `https://qlyphs.com/explorer` | loopback HTTP only (`127.0.0.1:4400`, `:9955`, `localhost:3000/explorer`) |
| Manifest name | "Qlyphs Wallet" | identifies a development wallet |
| Chrome ID | assigned by the Chrome Web Store; no `key` in the manifest | stabilized by the committed **public** development key (not a signing key) |
| Firefox ID | `wallet@qlyphs.com` | `wallet-dev@qlyphs.com` |

Obtain and check the pins with `node apps/native/scripts/mainnet-compat.mjs https://rpc1-mainnet.quantus.com`
(read-only; verifies call indices and the signing layout, then prints the pins). The activation block is
chosen at launch. Purchases additionally need the reviewed public witness policy
(`NATIVE_PQ_POLICY_FILE`, below). Firefox temporary installation does not establish a signed
distributable add-on.

## Reproduce packages

Use the committed Node/pnpm versions and `pnpm install --frozen-lockfile`, then build `@qotc/wallet-extension`. `dist/chrome` and `dist/firefox` contain the separate manifests, local bundles, packaged WASM, icons, CSS, HTML, license notices and `BUILD.json`. The build rejects an unvalidated SDK version and unexpected dynamic-code constructs. CI builds twice and compares sorted SHA-256 output inventories. This proves repeatability in that environment, not a reproducible build of the upstream WASM from Rust sources.

For deterministic ZIPs without browser profiles or test secrets, run `python3 apps/extension/package.py` from the repository root after a successful build. Archives use a fixed timestamp and sorted names; `SHA256SUMS` identifies their bytes. Load directories unpacked for testing. Never include `.data`, browser profiles, node_modules, debug traces, credentials or mnemonic backups in an archive.

## Store submission checklist

1. Mainnet build with the launch pins (`QLYPHS_EXTENSION_NETWORK=mainnet`, `QLYPHS_EXTENSION_PINS`),
   built twice with identical inventories; `BUILD.json` shows the mainnet network, pins and https origins.
2. The Chrome manifest has no `key`; the Firefox manifest has the ID `wallet@qlyphs.com`.
3. After the store assigns the Chrome ID, add `chrome-extension://<store id>` (and the Firefox
   `moz-extension://` origin if required) to the indexer's `NATIVE_EXTENSION_ORIGINS` on
   `app.qlyphs.com`, and restart it.
4. Security and functional gaps in SECURITY.md closed, with exact successful installed-browser evidence.
5. Listing copy, privacy policy and permission justifications name the hosts contacted:
   `app.qlyphs.com` (indexer API) and `rpc1-mainnet.quantus.com` (node RPC).

Supply reviewers the human-readable source commit, locked dependencies, build instructions, tool versions, bundled WASM/glue provenance and license notices. Mozilla may require original source and build steps for generated/compiled code. Do not claim store acceptance before it happens.

Review all transitive bundled licenses using the esbuild metafile and actual resolved packages, including Quantus and the noble/scure families. Preserve required copyright/license notices. A package's metadata field is not a replacement for its full license. The upstream SDK binary and vendored glue should be traced to their official source/tag; independently reproducing and auditing the WASM is a release gate. The repository/product owner must determine their own license and brand rights; this implementation does not assign a license to their private product.

Prepare store icons and screenshots, a support contact and a privacy policy explaining that public addresses and requested operations are disclosed to `app.qlyphs.com` and `rpc1-mainnet.quantus.com`. No analytics or telemetry is installed. Reassess the Firefox data-collection declarations for these hosted services before submission. Ask only necessary permissions. Mainnet host permissions should cover only those two hosts; development host patterns are loopback-scoped, and because browser match patterns do not express ports, exact origin/port checks remain enforced in code and server configuration. Do not broaden to `<all_urls>` or accept arbitrary Origin/Host values to solve integration errors.

Keep Chrome MV3 service-worker and Firefox supported event-page builds distinct. Validate minimum supported browser versions, especially MAIN-world content injection and packaged WASM CSP, using real installed extensions. Store signing and update channels belong to the authorized release, not to a development branch. Recheck current policies at submission, not merely at code authoring.

Primary policies and tooling:
- https://developer.chrome.com/docs/webstore/program-policies/
- https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code
- https://extensionworkshop.com/documentation/publish/add-on-policies/
- https://extensionworkshop.com/documentation/publish/source-code-submission/
- https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/
- https://playwright.dev/docs/chrome-extensions

## QPA1 policy packaging

A build without a witness policy disables purchases, on mainnet as in development. Operator-specific builds must
embed the reviewed public policy via `NATIVE_PQ_POLICY_FILE`. Distribute policy rotations and
revocations through the trusted extension release process. Do not ship CI fixture keys or
their public pins as a production trust ceremony. The two deterministic builds must use the
same explicit policy. Read `BUILD.json` for the policy version and rules fingerprint; it is a
build record, not an independent audit. Private keys/passphrases never belong in the build context.

## Dapp origin allowlist

Development provider injection includes the native API origin plus `http://127.0.0.1:4401`
and `http://127.0.0.1:4402` for the two SDK examples; the mainnet build defaults to
`https://app.qlyphs.com`.
`QLYPHS_EXTENSION_DAPP_ORIGINS` optionally supplies a JSON array of 1–16 distinct exact
origins at build time (loopback HTTP in development, https on mainnet). It changes injection/connection eligibility, not
account permissions or signing authority. `BUILD.json` records these origins and
provider protocol version. Browser match patterns omit port specificity; runtime
checks still enforce exact ports. Network host permissions and API/RPC/PQ trust pins
are not widened to application-selected targets. Build/package verification covers the additional provider code
under the same local-code/CSP and deterministic inventory constraints.
