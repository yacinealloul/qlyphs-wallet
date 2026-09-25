<div align="center">

# Qlyphs Wallet

**A non-custodial, post-quantum wallet for [Quantus](https://quantus.com).**
Every release can be rebuilt from this repository and checked byte for byte against the live site.

[keys.qlyphs.com](https://keys.qlyphs.com) · [Releases](../../releases) · [Security model](apps/keys/README.md#security-model) · [Verify a release](#verify-that-keysqlyphscom-runs-this-code)

![license MIT](https://img.shields.io/badge/license-MIT-blue) ![signatures ML-DSA-87](https://img.shields.io/badge/signatures-ML--DSA--87-6f42c1) ![builds reproducible](https://img.shields.io/badge/builds-reproducible-2ea44f) ![Node 24](https://img.shields.io/badge/node-24-339933)

</div>

---

## Why

Quantus is a post-quantum chain: accounts sign with ML-DSA (Dilithium), not ECDSA or sr25519. The
wallets people already use cannot hold those keys or build signed Quantus transactions, so Quantus had
no wallet that runs in the browser for dapps to use.

Qlyphs Wallet fills that gap. Keys are generated, encrypted and used in your browser, and never leave
it. You do not have to trust us about the code either: the site you load is proven to be the code in
this repository.

## Two forms, one wallet

| | What it is | Source |
| --- | --- | --- |
| **[keys.qlyphs.com](https://keys.qlyphs.com)** | The wallet as a web page, for people without the extension. Dapps open it in a popup to connect and approve transactions. | [`apps/keys`](apps/keys/README.md) |
| **Browser extension** | Chrome (MV3) and Firefox. Its code is installed once, so it is the safer choice for large amounts. | [`apps/extension`](apps/extension/README.md) |

Both run the same wallet code: the same vault, signing and UI. Only the browser glue differs
(storage, messaging, windows, passkeys).

## Highlights

- **Post-quantum accounts.** ML-DSA-87 keys derived at `m/44'/189189'/0'/0'/0'` with the official
  `@quantus-network/wasm` SDK. The hash of its `.wasm` is recorded in every build.
- **Non-custodial.** The recovery phrase is encrypted in the browser with PBKDF2-SHA256 (600,000
  iterations) and AES-GCM. You can also unlock with a passkey (WebAuthn PRF + HKDF + AES-GCM).
- **Dapps never get anything secret.** The popup protocol sends only public data: accounts, network,
  signed transaction results and errors. Messages are capped at 8 KiB, and there is no `signMessage`.
  Every signature is shown and approved in the wallet's own UI.
- **Locked-down page.** `default-src 'none'`, no inline or third-party scripts, and no `eval`. The build
  fails if any bundle uses `eval`, `new Function` or a dynamic `import()`. The RPC, indexer and dapp
  allowlist are fixed at build time. The server refuses to start if any file differs from the release.
- **Verifies before it pays.** Before a purchase, the wallet checks two separately keyed ML-DSA-87
  attestations of the finalized reservation. It also recomputes the Qlyphs fee itself, and refuses to
  sign if the service asks for a different one.
- **Mainnet is pinned.** Mainnet builds compile in the chain's genesis, runtime and activation pins
  ([`deploy/mainnet/pins.json`](deploy/mainnet/pins.json)). They refuse any other network.

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
                                                │ keys, signing            │
                                                │ storage: IndexedDB       │
                                                └───────────▲──────────────┘
                                                            │
                                                ┌───────────┴──────────────┐
                                                │ /  the wallet (full tab) │ confirmations
                                                └──────────────────────────┘
```

The popup only talks to its opener, and only when the opener's origin is on the build's allowlist.
The origin it checks is the browser's `MessageEvent.origin`, compared exactly, never a value the dapp
sends. Dapps talk to either form of the wallet through one interface,
[`QlyphsProvider`](packages/provider).

## Verify that keys.qlyphs.com runs this code

The build is deterministic: the same commit always produces the same bytes. Each release publishes a
**release hash**, the SHA-256 of the list of SHA-256 hashes of every file the site serves. You can find
it in the [GitHub release](../../releases) and in the Actions run for its tag.

```sh
# 1. The live site serves exactly the published release (Node 18+, no install)
node apps/keys/verify.mjs https://keys.qlyphs.com --expect <release hash>

# 2. That release is what this source builds (Docker)
git checkout keys-v<version>
docker build -f deploy/keys.Dockerfile --target release --output type=local,dest=keys-release .
node apps/keys/verify.mjs https://keys.qlyphs.com --local keys-release
```

Both commands must end with `All checks passed`. The `Reproduce keys release` GitHub Action runs the
same rebuild on a clean runner for every commit and tag. For what these checks prove and what they do
not, see [Verify a release](apps/keys/README.md#verify-a-release).

## Build

You need Node 24 and pnpm 10.23.0.

```sh
pnpm install --frozen-lockfile
pnpm build:keys          # development web wallet in apps/keys/dist (serve: pnpm --filter @qlyphs/keys serve)
pnpm build:extension     # development extension in apps/extension/dist
```

Development builds target a local Quantus node. For mainnet build flags and pins, see the
[keys README](apps/keys/README.md#build-and-run) and the [extension README](apps/extension/README.md#build).

## Repository layout

| Path | What |
| --- | --- |
| `apps/keys` | keys.qlyphs.com: web build, static server, dapp SDK, release verifier |
| `apps/extension` | the browser extension, and the wallet code keys reuses (vault, signing, UI) |
| `packages/provider` | the `QlyphsProvider` interface dapps use with either form |
| `packages/chain`, `packages/native`, `packages/sdk`, `packages/shared`, `apps/native` | only the modules the wallet imports: Quantus codecs, QTC formatting, post-quantum checkpoint verification |
| `deploy/keys.Dockerfile` | the exact build that serves keys.qlyphs.com |
| `deploy/mainnet/pins.json` | the Quantus mainnet genesis, runtime and activation pins |
| `docs/` | [mainnet notes](docs/MAINNET.md), [extension security model](docs/extension/SECURITY.md), [provider contract](docs/extension/PROVIDER.md), [store packaging](docs/extension/DISTRIBUTION.md) |

This repository mirrors the wallet part of the private Qlyphs monorepo. The mirror is regenerated
automatically on every change and keeps the same paths, so the builds are byte-identical. Each commit
message names the source commit it was exported from.

## Status and limits

These are stated plainly so you don't have to guess.

- The extension is not in the Chrome Web Store or Firefox Add-ons yet. For now, load a build unpacked.
- Token purchases stay refused on mainnet until the post-quantum witnesses are validated there
  ([MAINNET.md](docs/MAINNET.md)). Sending QTC works.
- A web wallet downloads its code on every visit. A release check proves what the site served *to you,
  when you checked*. It cannot prove what another visitor received.
- Keys live in your browser profile, so clearing site data deletes the wallet. Keep your recovery phrase
  or an encrypted backup outside the browser.
- The wallet has not had an independent security audit yet.

## Security

To report a vulnerability, or a file whose hash does not match a release, contact us privately: see
[SECURITY.md](SECURITY.md).

## License

MIT. A [Qlyphs](https://qlyphs.com) product, not an official Quantus wallet.
