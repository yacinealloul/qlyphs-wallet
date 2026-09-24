# Qlyphs Wallet

The open-source code of the Qlyphs Wallet, a non-custodial post-quantum wallet for
[Quantus](https://quantus.com) (QTC). It comes in two forms:

- **[keys.qlyphs.com](https://keys.qlyphs.com)**: the wallet as a web page, for people without the
  extension. Dapps open it in a popup. Source: [`apps/keys`](apps/keys/README.md).
- **Browser extension** (Chrome, Firefox). Source: [`apps/extension`](apps/extension/README.md).

Both use the same wallet code. Keys are generated, encrypted and used in your browser, and never
leave it. Accounts are ML-DSA-87, derived with the official `@quantus-network/wasm` SDK.

MIT licensed. A Qlyphs product, not an official Quantus wallet.

## Check that keys.qlyphs.com runs this code

Every keys.qlyphs.com release is built deterministically: the same commit always produces the same
bytes. Each release publishes a **release hash**, the SHA-256 of the list of the SHA-256 of every
served file. The hash is shown in the [GitHub release](../../releases) and in the Actions run of its tag.

```sh
# 1. The live site serves exactly the published release (Node 18+, no install)
node apps/keys/verify.mjs https://keys.qlyphs.com --expect <release hash>

# 2. That release is what this source builds (Docker)
git checkout keys-v<version>
docker build -f deploy/keys.Dockerfile --target release --output type=local,dest=keys-release .
node apps/keys/verify.mjs https://keys.qlyphs.com --local keys-release
```

Both must end with `All checks passed`. The GitHub Action `Reproduce keys release` runs the same
rebuild on a clean runner for every commit and tag. What the checks prove, and their limits:
[apps/keys/README.md, Verify a release](apps/keys/README.md#verify-a-release).

## What is in this repository

| Path | What |
| --- | --- |
| `apps/keys` | keys.qlyphs.com: web build, static server, dapp SDK, release verifier |
| `apps/extension` | the browser extension, and the wallet code keys reuses (vault, signing, UI) |
| `packages/provider` | the `QlyphsProvider` interface dapps use with either form |
| `packages/chain`, `packages/native`, `packages/sdk`, `packages/shared`, `apps/native` | only the modules the wallet imports: Quantus codecs, QTC formatting, post-quantum checkpoint verification |
| `deploy/keys.Dockerfile` | the exact build that serves keys.qlyphs.com |
| `deploy/mainnet/pins.json` | the Quantus mainnet genesis, runtime and activation pins compiled into mainnet builds |
| `docs/` | mainnet notes, extension security model, provider contract, store packaging |

This repository mirrors the wallet part of the private Qlyphs monorepo. The mirror is regenerated
automatically on every change and keeps the same paths, so the builds are byte-identical. Each commit
message names the source commit it was exported from.

## Build

Node 24 and pnpm 10.23.0:

```sh
pnpm install --frozen-lockfile
pnpm build:keys          # development web wallet in apps/keys/dist (serve: pnpm --filter @qlyphs/keys serve)
pnpm build:extension     # development extension in apps/extension/dist
```

Development builds target a local Quantus node. Mainnet build flags and pins:
[apps/keys/README.md](apps/keys/README.md#build-and-run), [apps/extension/README.md](apps/extension/README.md#build).

## Security

Report a vulnerability, or a file whose hash does not match a release, privately: see [SECURITY.md](SECURITY.md).
