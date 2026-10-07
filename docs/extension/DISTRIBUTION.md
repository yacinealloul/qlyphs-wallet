# Packaging and store distribution

The extension is published in the Chrome Web Store; it is not listed on Firefox Add-ons yet. Store
packages use a mainnet build with reviewed pins and the reviewed mainnet witness policy, and have no
network switch; development and switchable builds are for local installation only. See
[mainnet notes](../MAINNET.md).

## Build profiles

| | Mainnet | Development (default) |
| --- | --- | --- |
| Command | `QLYPHS_EXTENSION_NETWORK=mainnet QLYPHS_EXTENSION_PINS="$PWD/deploy/mainnet/pins.json" NATIVE_PQ_POLICY_FILE="$PWD/deploy/mainnet/witness-policy.json" pnpm --filter @qotc/wallet-extension build` | `pnpm --filter @qotc/wallet-extension build` |
| Pins | required genesis, runtime and activation anchor | reviewed from the local network at first use |
| API / RPC | `https://indexer.qlyphs.com` / `https://rpc1-mainnet.quantus.com` | `http://127.0.0.1:4400` / `http://127.0.0.1:9955` |
| Explorer | `https://qlyphs.com/explorer` | `http://localhost:3000/explorer` |
| Manifest | Qlyphs Wallet; no development Chrome `key` | development identity with a committed public key |
| Firefox ID | `wallet@qlyphs.com` | `wallet-dev@qlyphs.com` |

Run commands from the repository root. The committed [pins](../../deploy/mainnet/pins.json) describe
the reviewed release network; their presence does not prove the live runtime still matches. Runtime
or genesis mismatch blocks signing. Firefox temporary installation does not create a signed,
permanently distributable add-on.

## Reproduce packages

Use Node 24, pnpm 10.23.0 and `pnpm install --frozen-lockfile`, then build the extension. Its
`dist/chrome` and `dist/firefox` directories contain separate manifests, local bundles, packaged WASM,
icons, CSS, HTML, license notices and `BUILD.json`. The build rejects an unvalidated SDK version and
unexpected dynamic-code constructs. Compare sorted SHA-256 inventories from two clean builds made
with the same source, dependency lockfile, pins and environment overrides. This verifies repeatability
of those outputs; it does not reproduce the upstream WASM from Rust source.

For deterministic archives after a successful build:

```sh
python3 apps/extension/package.py
```

ZIPs in `apps/extension/dist/packages` use fixed timestamps and sorted names; `SHA256SUMS` identifies
their bytes. A mainnet build gives the store packages `qlyphs-wallet-chrome-<version>.zip` and
`qlyphs-wallet-firefox-<version>.zip`, a development build `qlyphs-wallet-<browser>-development.zip`;
a switchable build is refused. Never include browser profiles, dependency directories, debug traces, credentials or
mnemonic backups. Load the build directories unpacked when testing.

## Store submission

1. Build mainnet twice with identical inventories. Check network, pins and HTTPS origins in `BUILD.json`,
   and that `pqPolicyVersion` is set and `pqPolicySHA256` equals the SHA-256 of
   `deploy/mainnet/witness-policy.json` (`shasum -a 256 deploy/mainnet/witness-policy.json`).
   Run `web-ext lint` on `dist/firefox`.
2. Confirm the Chrome manifest has no development `key` and Firefox uses `wallet@qlyphs.com`.
3. Verify the configured service accepts the installed extension's exact browser origin. Browser
   identities differ between local installations and store packages.
4. Complete the security and installed-browser validation for the exact release. A successful build
   alone does not demonstrate that lifecycle tests passed.
5. Supply source, locked dependencies, build steps, tool versions, bundled WASM provenance and license
   notices. Listing copy, privacy policy and permission explanations must identify the contacted hosts.

The default mainnet API and RPC hosts are `indexer.qlyphs.com` and `rpc1-mainnet.quantus.com`. Public
addresses and requested operations are sent to those services. The explorer opens separately in a
tab. No analytics or telemetry is installed. Ask only for necessary permissions, and retain exact
origin/port checks even where browser host patterns cannot express ports. Do not broaden permissions
to `<all_urls>` to resolve integration errors.

Review actual bundled dependency licenses, not just package metadata. Preserve copyright and license
notices. Validate Chrome MV3 worker and Firefox event-page behavior in real installed browsers,
including packaged WASM and CSP. Recheck store policies when submitting:

- [Chrome Web Store policies](https://developer.chrome.com/docs/webstore/program-policies/)
- [Chrome remote-code rules](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code)
- [Firefox add-on policies](https://extensionworkshop.com/documentation/publish/add-on-policies/)
- [Firefox source submission](https://extensionworkshop.com/documentation/publish/source-code-submission/)

## Purchase policy and dapp origins

`NATIVE_PQ_POLICY_FILE` compiles a reviewed public witness policy; `BUILD.json` records its version,
`rulesHash` and the SHA-256 of the file (`pqPolicySHA256`). Without one the wallet refuses
purchases, lot mints and mint sessions, and, wherever the build has a fee schedule (every mainnet build), token
creation and inscriptions. A mainnet build accepts only a policy that matches its pins and the
reviewed mainnet rules (`rulesHash`): the committed `deploy/mainnet/witness-policy.json`. A
development build accepts only one that matches its rules inputs and the development runtime.
Switchable builds reject the variable.
Private signing keys and passphrases must never enter the build context. Policy rotations require
reviewed releases; `BUILD.json` records a policy, but does not independently audit it.

[The provider contract](PROVIDER.md#network-and-origin-configuration) lists the exact default dapp
origins. `QLYPHS_EXTENSION_DAPP_ORIGINS` can replace them with 1–16 exact allowed origins in a single
network build. This changes connection eligibility, not account permissions or signing authority.
It does not change API/RPC/PQ targets. Switchable builds refuse origin and endpoint overrides.
