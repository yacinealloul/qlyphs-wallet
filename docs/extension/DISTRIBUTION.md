# Packaging and store distribution

The extension is not published in the browser stores yet. Store packages use a mainnet build with
reviewed pins; development and switchable builds are for local installation only. Mainnet purchases
remain disabled. See [mainnet notes](../MAINNET.md).

## Build profiles

| | Mainnet | Development (default) |
| --- | --- | --- |
| Command | `QLYPHS_EXTENSION_NETWORK=mainnet QLYPHS_EXTENSION_PINS="$PWD/deploy/mainnet/pins.json" pnpm --filter @qotc/wallet-extension build` | `pnpm --filter @qotc/wallet-extension build` |
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
their bytes. Never include browser profiles, dependency directories, debug traces, credentials or
mnemonic backups. Load the build directories unpacked when testing.

## Store submission

1. Build mainnet twice with identical inventories. Check network, pins and HTTPS origins in `BUILD.json`.
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

`NATIVE_PQ_POLICY_FILE` is accepted only by development builds. A compatible reviewed public policy
is required to purchase there; without one the wallet refuses purchases. Mainnet and switchable
builds reject this variable and keep purchases disabled until mainnet witnesses are validated.
Private signing keys and passphrases must never enter the build context. Policy rotations require
reviewed releases; `BUILD.json` records a policy, but does not independently audit it.

[The provider contract](PROVIDER.md#network-and-origin-configuration) lists the exact default dapp
origins. `QLYPHS_EXTENSION_DAPP_ORIGINS` can replace them with 1–16 exact allowed origins in a single
network build. This changes connection eligibility, not account permissions or signing authority.
It does not change API/RPC/PQ targets. Switchable builds refuse origin and endpoint overrides.
