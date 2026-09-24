# Qlyphs Wallet

Non-custodial browser extension (Chrome MV3, Firefox) for Quantus: it holds ML-DSA-87 keys, sends QTC and
signs Qlyphs operations (Quarks, fair-mint tokens, bilateral token sales) for the Qlyphs app. Version
**0.5.1**. A Qlyphs product, not an official Quantus wallet. QLYP-v1 assets are an indexed token overlay,
not runtime-native `pallet_assets` balances; the bilateral market is not an AMM or open-taker order book.

Status: mainnet builds are prepared but mainnet is not activated yet, and purchases stay refused on
mainnet until the post-quantum witnesses are validated there ([MAINNET.md](../../docs/MAINNET.md)).
The development build is for local chains only; do not import an account holding real funds into it.

**Fees.** QLYP-v1 charges a Qlyphs fee, paid to the Qlyphs fee account in the same signed extrinsic:
1 QTC to create a token, 0.01 QTC per mint, 0.1 QTC per inscription, and 1% (rounded up, paid by the
buyer) of the QTC price of any token sale. Token transfers and plain QTC sends carry no Qlyphs fee. The
wallet recomputes the expected fee itself and refuses to sign when the service asks for a different one.
Network fees come on top.

## Install

- **Mainnet:** from the Chrome Web Store and Firefox Add-ons once published (not yet). Until then,
  load a mainnet build unpacked (see Build).
- **Development:** load the default build unpacked against a local node (see Development network).

Chrome: open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select
`apps/extension/dist/chrome`. After replacing files in that directory, click **Reload** on the extension
card, then click the toolbar icon to open the side panel. The locked header or Settings → About shows the
version; refreshing a web page does not reload an installed extension. Do not remove the extension to
update it (removal deletes local wallet storage).

Firefox: open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select
`apps/extension/dist/firefox/manifest.json`. A temporary installation is not store signing or
permanent distribution.

On first use the network review shows the actual genesis, runtime and QLYP activation. Check them
before pinning. Create a wallet and save its recovery material privately, or import a compatible phrase
or restore an encrypted backup. New transactions require an unlocked wallet and recovery acknowledgement.

## Build

Node 24, pnpm **10.23.0**, Python 3 for ZIP packaging, and the locked workspace
(`pnpm install --frozen-lockfile`), from the repository root.

**Mainnet.** Requires a pins file (genesis, runtime, activation block; format and how to obtain it in
[MAINNET.md](../../docs/MAINNET.md), checked with `node apps/native/scripts/mainnet-compat.mjs <rpc>`).
Without pins the mainnet build fails.

```sh
QLYPHS_EXTENSION_NETWORK=mainnet QLYPHS_EXTENSION_PINS=/absolute/path/pins.json \
  pnpm --filter @qotc/wallet-extension build
```

The mainnet build accepts only https origins and defaults to app/API `https://app.qlyphs.com`, RPC
`https://rpc1-mainnet.quantus.com` and explorer `https://qlyphs.com/explorer`. Its manifest is named "Qlyphs
Wallet", carries no development `key` (the store assigns the Chrome ID) and uses the Firefox ID
`wallet@qlyphs.com`. The indexer must list the resulting extension origin in `NATIVE_EXTENSION_ORIGINS`.
Purchases also need `NATIVE_PQ_POLICY_FILE` (see Post-quantum purchase verification).

**Development** (no env): the default build, unchanged. It accepts only loopback HTTP origins, defaults
to API `http://127.0.0.1:4400`, RPC `http://127.0.0.1:9955` and explorer `http://localhost:3000/explorer`,
uses the committed **public** development key for a stable Chrome ID
(`hnbehkbocninnepohoponooocfhdjjpf`; no private key is included or required) and the Firefox ID
`wallet-dev@qlyphs.com`.

```sh
pnpm --filter @qotc/wallet-extension build
```

Build-time overrides: `QLYPHS_EXTENSION_API`, `QLYPHS_EXTENSION_RPC`, `QLYPHS_EXTENSION_EXPLORER`,
`QLYPHS_EXTENSION_DAPP_ORIGINS` (JSON array of 1–16 exact origins allowed for provider injection),
`QLYPHS_EXTENSION_OUTPUT` (default `dist`) and `NATIVE_PQ_POLICY_FILE`. The API, RPC and explorer are
developer-configured trust sources recorded in `BUILD.json`; a website cannot change them.
`python3 apps/extension/package.py` writes deterministic ZIPs to `dist/packages/`. Packaging and store
gates: [DISTRIBUTION.md](../../docs/extension/DISTRIBUTION.md).

## Switching between mainnet and development

`QLYPHS_EXTENSION_NETWORK=switchable` compiles both networks in one build, each with its default
endpoints and pins (mainnet still requires `QLYPHS_EXTENSION_PINS`; endpoint overrides are refused).
It is not a store build: it keeps the development identity, so it installs over a development
wallet and keeps its data.

```sh
QLYPHS_EXTENSION_NETWORK=switchable QLYPHS_EXTENSION_PINS=/path/to/pins.json \
  pnpm --filter @qotc/wallet-extension build
```

It opens on mainnet. The user switches in Settings, on the welcome screen, or next to a connection
error; no page can switch it. Switching locks the wallet, disconnects every site and loads the
other network's wallet: each network keeps its own (`wallet` for development, `wallet:mainnet`),
so nothing created or signed for one is ever used on the other.

## Development network

```sh
pnpm --filter @qotc/native-app build
pnpm --filter @qotc/wallet-extension build
# Terminal 1: the verified official Quantus v1.0.1 development binary
quantus-node --dev --base-path /tmp/qlyphs-wallet-chain --rpc-port 9955
# Terminal 2:
cd apps/native
NATIVE_DEV_FAUCET=1 \
NATIVE_EXTENSION_ORIGINS=chrome-extension://hnbehkbocninnepohoponooocfhdjjpf \
node dist/server.mjs
```

Visit **http://127.0.0.1:4400**, not `localhost`. The public application origin, build-time dapp origin
and API Host must agree exactly. Do not expose the unauthenticated development node RPC publicly.
Use the dapp's developer faucet for test QTC. Native QTC balances are queried from the node through the
API; token balances are interpreted by the configured indexer.

Firefox assigns a profile-specific `moz-extension://<UUID>` origin. Take it from the add-on's
**Manifest URL** on the debugging page, add it to the server's comma-separated
`NATIVE_EXTENSION_ORIGINS` and restart only the API process, keeping its database and chain.

Explorer links (menu, activity and notifications) open the web explorer in `apps/web`; run
`pnpm --filter @qotc/web dev` alongside the native service, or set `QLYPHS_EXTENSION_EXPLORER` to a
hosted explorer configured for the same indexer.

Send checks exclude frozen QTC and reserve estimated fees and the minimum account balance before opening a review and again before signing. A token transfer also requires QTC for fees. Creating a token, minting, inscribing and buying also reserve the Qlyphs fee (and, for a purchase, the price), and the review shows it as a separate **Qlyphs fee** row included in the estimated total. Pending or uncertain submissions continue to block another send until finality or verified expiry; the wallet displays the reason rather than silently retrying.

## Connection and use

Open the native app and click **Connect wallet**. If Qlyphs is locked, the extension first shows only the unlock screen; the site review appears after unlocking. Unlocking never approves a connection. **Cancel request** dismisses a locked request without granting access. Approve the site in the extension-owned window. Create/mint tokens, inscribe Quarks and arrange bilateral sales in the web app; inspect and approve each operation in the extension. The popup also sends QTC and transfers displayed tokens. The site receives an account and submitted transaction hash, never a phrase or password. The original embedded web wallet remains available separately.

A five-minute absolute unlock deadline is not extended by dapp messages. Browser suspension or a background restart locks the wallet sooner. After a restart, reopen the wallet, unlock explicitly, reload/reconnect the dapp if necessary, and inspect saved history. Unknown submission outcomes must not be treated as failures or retried with a new nonce.

## Post-quantum purchase verification

Purchases require the same QPA1 attestations in the extension's privileged background
that the embedded web wallet requires in its signing worker. The extension creates its own
challenge, verifies both configured ML-DSA-87 witnesses against compiled public pins, checks
the finalized reservation against the exact purchase bytes, and persists its authenticated
high-water checkpoint in extension-owned IndexedDB. A dapp cannot supply keys, an endpoint,
a policy or a `verified` flag. The signing session is checked again after asynchronous verification.

**Builds without a witness policy cannot buy tokens** (development and mainnet alike). Native QTC sends,
creation, mint, inscription and ordinary transfers remain available.
No insecure purchase fallback is supplied. Configure the two private witness services using
`docs/native/pq/README.md`, then compile the extension with their operator-reviewed PUBLIC policy:

```sh
NATIVE_PQ_POLICY_FILE=/absolute/path/to/public-policy.json pnpm --filter @qotc/wallet-extension build
```

The build rejects policies for another installed rules fingerprint, runtime or activation.
The native API must aggregate both witnesses via `NATIVE_ATTESTORS`; its exact extension-origin
allowlist remains required. The extension fetches from its fixed API origin, not an endpoint
suggested by the page. It does not need witness secrets or direct witness host permissions.

API balances/history remain provisional, unsigned views. QPA1 authenticates operator claims
and requires agreement, not a consensus proof or a guarantee against operator collusion.
Changing/revoking trusted keys needs a reviewed rebuilt extension and trusted update distribution.
Old clients do not learn new revocations automatically. Clearing the browser profile clears
its high-water history but never permits a key supplied by the API to become trusted.

## Recovery and migration

The exact legacy account is **ML-DSA-87, `m/44'/189189'/0'/0'/0'`**, using the locked official `@quantus-network/wasm@0.3.1`. Existing web-wallet version-1 backups retain their original AES-GCM authenticated metadata and PBKDF2-SHA256/310,000-iteration decoding. Successful restoration rewrites an authenticated version-2 vault with a fresh salt/IV and PBKDF2-SHA256/600,000 iterations; identity is checked before accepting it. The original backup is not modified. Version-2 backups are for this extension; the older web wallet does not yet read them.

An encrypted backup **and its password**, or the correct mnemonic on the same network/schema/path, are needed. Browser uninstall/profile deletion can remove local storage. Keep recovery material outside the browser. Do not export a phrase into the dapp or attach it to a bug report. The extension cannot reset a forgotten password without recovery material.

For a single locked wallet, **Forgot password? Start fresh** downloads its encrypted backup and requires acknowledgement before resetting. The reset archives the full encrypted wallet state in local extension storage and starts creation of a different wallet; it does not recover the old password, identity or assets. A failed archive/reset write keeps the active wallet unchanged. The action is unavailable while unlocked, from confirmation windows, during transaction approval, or when multiple wallets are saved.

## Tests and evidence

```sh
pnpm --filter @qotc/wallet-extension typecheck
pnpm --filter @qotc/wallet-extension test
# Start a distinct real dev node on 9956; the harness owns loopback ports 4400/4410/9955.
pnpm --filter @qotc/wallet-extension exec playwright install --with-deps chromium firefox
EXTENSION_BROWSER=chrome NATIVE_TEST_RPC_URL=http://127.0.0.1:9956 \
pnpm --filter @qotc/wallet-extension e2e
# Firefox also requires geckodriver on PATH. CI pins version and archive checksum.
EXTENSION_BROWSER=firefox NATIVE_TEST_RPC_URL=http://127.0.0.1:9956 \
pnpm --filter @qotc/wallet-extension e2e
```

To run the full lifecycle without occupying an existing development app’s ports, start a separate real Quantus dev node on 19956 and use an isolated build:

```sh
QLYPHS_EXTENSION_OUTPUT=dist-e2e \
QLYPHS_EXTENSION_API=http://127.0.0.1:14400 \
QLYPHS_EXTENSION_RPC=http://127.0.0.1:19955 \
pnpm --filter @qotc/wallet-extension build
WALLET_BUILD_DIR=dist-e2e WALLET_TEST_BACKEND=http://127.0.0.1:14410 \
EXTENSION_BROWSER=chrome NATIVE_TEST_RPC_URL=http://127.0.0.1:19956 \
pnpm --filter @qotc/wallet-extension e2e
```

This preserves the default `dist` build and the app on 4400/9955. The harness creates its own temporary database, profiles and test wallets. The node remains owned by the caller. Finality is checked against the real chain and can take several minutes per operation.

The Chromium test loads the actual extension in persistent profiles. Firefox uses geckodriver's native temporary-add-on installation endpoint with real Firefox, not a web page pretending to be an extension. The harness provisions ephemeral ML-DSA witness keys and rebuilds the tested extension with
public pins, starting the TypeScript and Python witnesses. By default both read the same real
development node; `NATIVE_SECOND_RPC_URL` can point the second witness at a separately started,
peered node. This is not a claim that two organizations operate them. The separate PQ workflow
also tests two actual full nodes. All accounts are ephemeral test accounts. Fault-injection proxies alter selected responses only in negative tests; successful transfers and purchases use the real node and indexer.

The installed extension must reject altered signatures/states, replayed challenges, missing
witnesses and a validly signed conflicting witness before any submission. It also locks during
a delayed attestation to check the asynchronous signing race. Then the same reservation is
purchased on the actual chain and the real seller/token balances are checked.

CI records the exact source commit, typecheck/test/build logs, repeated build hashes, browser version, node version, public transaction hashes/heights and sanitized screenshots. A build or a unit test is not evidence that the installed-browser lifecycle passed. Read each job's result and `results.json`; no successful end-to-end claim is implied by this README.

## Boundaries

Up to 20 accounts across independent wallets, and one pinned network per installation. The initial popup displays at most the first 100 indexer asset records, with an explicit overflow message; use the native app for further pages. Submitted-operation history is capped at 200 records and stops new operations at capacity rather than silently removing unresolved records. The native app supplies broader chain activity.

See `docs/extension/PROVIDER.md`, `docs/extension/SECURITY.md`, and `docs/extension/DISTRIBUTION.md`. There is no independent security audit yet.

## Wallet UI and preview

The 0.4.0 layout adapts [Metamask Clone (Crypto Wallet) (Community)](https://www.figma.com/design/EF6iqylcMYhf3UFN9rfFBv/Metamask-Clone--Crypto-Wallet---Community-?node-id=6008-20): AccountInfo (`6008:5`), Tabs (`6120:1423`), unlock (`6217:4315`) and transaction request (`6218:7198`). The reference contains extension approval/unlock components; the dashboard is an adaptation for Qlyphs. Qlyphs colors, fonts, mark and existing icons are retained. No MetaMask/Ethereum branding, new UI dependency, external asset request or unsupported wallet action is introduced. Reviews use a plain transaction heading and amount, a full recipient address with Copy, exact fee estimates and an estimated QTC total for native sends. Zero-value ancillary fees, signing-account details and the raw payload use explicit disclosures; nonzero fees and deposits stay visible. No decorative trust badge is shown. Reject/Approve remain outside the internally scrolling details at every supported size.

Network identity comparison is independent of JSON key order, including after Chrome reloads persisted storage. Real changes to genesis, runtime or activation remain blocked. A mismatch triggers an automatic read-only comparison of saved and connected genesis, runtime and activation. If the saved network is available again, balances must pass another pinned-network check before the alert clears. Otherwise the warning distinguishes a different chain from changed runtime/configuration, with full details available. Diagnostics validate the local services without repinning the wallet; genuine mismatches remain blocked. Verification errors retain their sanitised cause and failing stage. The UI compares its version with the background worker, flags partial updates, and offers Reload extension without deleting storage or replacing the saved network; reloading locks the wallet.

Chrome opens a native side panel by default, keeping the wallet visible when switching web tabs. Settings → Open wallet in switches between the side panel and the popup, and persists across browser worker restarts. Chrome controls the resizable panel width; the layout adapts to the available width and full browser height. Firefox retains the popup.

The popup requests 360 × 600 pixels and fits the height Chrome actually provides on smaller screens. The outer shell stays fixed: each active view scrolls internally, while the header and wallet navigation remain visible. The preview also fits the browser viewport without page scrolling. Across Assets, Activity and Settings, the balance and quick actions scroll away naturally while the navigation stays pinned with a soft edge fade. All three share a viewport capped at the available panel height, so long lists remain scrollable without growing the popup or adding nested scroll areas; the expand button opens a dedicated wallet tab. It uses Qlyphs / Quantus Void & Flare colors and bundled Geist fonts. The unlock screen uses a static rounded Qlyphs emblem and a compact password form. Onboarding separates wallet choice, creation, phrase import and encrypted-backup restoration into compact screens with a fixed bottom action. Recovery starts with a privacy reminder, shows 12 numbered words per page, then asks for explicit acknowledgement. Core steps fit 360 × 498 and 360 × 600 popups without scrolling; content-only scrolling remains available for zoom and unusually short panels. Back navigation preserves drafts within a method and clears secrets when leaving it. Pointer transitions are subtle and interruptible; keyboard and reduced-motion navigation are immediate. No media, font or artwork is fetched remotely.

Activity includes an **Explorer** button and per-transaction links into the bundled read-only explorer. It shows saved wallet history, accepts a transaction hash, verifies the saved network, and displays indexed status, block identifiers, signer, decoded events and the encoded call. Finalized block hashes are checked against the node. Unknown/pending transactions are never presented as confirmed; network or block verification errors hide transaction results. Explorer pages can only request public manifest/history data from the background and cannot invoke wallet operations. It reads the indexer configured at build time, not the public Quantus explorer.

Transfer and receive screens use mobile-sized layouts: 44 px fields, 48 px primary actions, compact headings and a fixed bottom action. Only the form content scrolls when errors or a short viewport need extra room. Send offers one asset selector: native QTC and held assets are distinguished by their identifiers. The Swap shortcut is disabled and labelled Coming soon until an exchange flow is implemented. Asset rows preselect their token; changing assets clears the amount while preserving the recipient. The selected symbol, available balance, token decimals and exact command stay consistent through the approval screen, which shows the full asset ID for tokens and fees in QTC. An asset that disappears on refresh remains explicitly unavailable instead of silently switching to QTC. Full addresses, exact quantities and the approval step remain intact. Sidebar wallet content is capped at 420 px.

The wallet displays native/token balances rounded to at most three decimal places, with exact values on hover and positive dust shown as <0.001. Transfer entry and transaction reviews retain full precision. It includes session-local balance hiding, a receive QR encoding the full address, dedicated send/transfer views, activity status, site permissions, backup/recovery, and readable transaction approvals. Public metadata is always inserted as text. Private recovery words are removed when acknowledged, locked or the page closes. Passkey and notification controls are available only to the extension interface; dapps gain no new signing or key-access capability.

Optional passkeys unlock a separate local encrypted envelope using WebAuthn PRF, HKDF-SHA256 and AES-GCM. Setup and removal require the wallet password. Authentication runs in a dedicated extension tab so Chrome closing its toolbar popup does not interrupt the ceremony. A PRF-compatible authenticator is required; unsupported authenticators leave password access intact. The passkey envelope is bound to this wallet and extension origin, is local to this browser profile, and is excluded from encrypted backup exports. Keep the existing password and recovery material: syncing a passkey alone does not restore the wallet in another profile.

Chrome desktop notifications are off by default and request the optional `notifications` permission only when enabled. They report known finalization, failure or expiry of operations submitted by this wallet, with generic text that omits addresses and balances. They do not monitor incoming transfers or send email/Google account messages. Checks run about once a minute while the browser is running. Clicking a transaction notification opens Activity; it never approves a transaction. The delivery ledger suppresses duplicates across worker restarts and skips old completed operations on enable. Because it is persisted before delivery, a crash or OS suppression can lose an alert; saved wallet history remains the source of truth.

```sh
pnpm --filter @qotc/wallet-extension build
pnpm --filter @qotc/wallet-extension test:ui
pnpm --filter @qotc/wallet-extension test:explorer
pnpm --filter @qotc/wallet-extension test:popup
pnpm --filter @qotc/wallet-extension test:sidebar
pnpm --filter @qotc/wallet-extension preview:ui
# Open http://127.0.0.1:4180 — explicitly labelled simulated UI, no node required.
# Optional, against the node/indexer configured in the build:
pnpm --filter @qotc/wallet-extension test:ui:live
WALLET_POPUP_ACCOUNT=1 pnpm --filter @qotc/wallet-extension test:popup
python3 apps/extension/package.py
```

`test:ui` covers browser interactions, exact amount validation, QR decoding, clipboard, keyboard/focus, recovery gating, expired approvals, stale/empty/offline states, narrow layouts, reduced motion, passkey routing, notification permission refusal and automated WCAG A/AA checks under the packaged content security policy. It writes safe fixture screenshots to `dist/ui-evidence`. It is not a chain transaction test. `test:sidebar` opens the actual native Chromium side panel through a user gesture, checks its geometry and persistence across tabs, and verifies display preferences across a background worker restart. `test:popup` opens and reopens the actual Chromium toolbar popup and checks its width, available height and internal scrolling. `test:ui:live` loads the real Chromium extension in a temporary profile, configures the local network, creates and unlocks an ephemeral wallet, reads balances and checks reception; it sends no transactions. It uses a CDP virtual authenticator to verify PRF enrollment, unlock after a worker restart, incorrect-key rejection, removal, unsupported-authenticator handling and password fallback. Physical Touch ID/security-key compatibility and OS notification delivery require device testing. The existing `e2e` suite remains the full chain lifecycle test.

The preview and all fixtures live under `test/`; they are excluded from both extension bundles and ZIPs. Do not enter real recovery material into the preview. The development Chrome ZIP is written to `dist/packages/qlyphs-wallet-chrome-development.zip`.

Interaction reference: [Phantom’s receive flow](https://help.phantom.com/articles/receive-tokens-in-phantom-4406393831187). Brand and motion sources: `docs/palette.css`, `packages/ui/src/components/logo.tsx`, `apps/web/src/components/brand-sculpture.tsx`, and `docs/brand/video/film.html`.

Platform references: [Chrome popup sizing](https://developer.chrome.com/docs/extensions/reference/api/action), [WebAuthn PRF](https://www.w3.org/TR/webauthn-3/#prf-extension), and [Chrome notifications](https://developer.chrome.com/docs/extensions/reference/api/notifications).

Display references: [MetaMask display modes](https://support.metamask.io/configure/wallet/language-settings-and-display/) and [Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel).

Motion: tabs update immediately with a retargetable, critically damped selection indicator and a short content fade. Keyboard navigation and reduced motion skip these animations. Balances and navigation stay fixed. Slow actions show local progress after 150 ms; fast actions avoid spinner flashes, and navigation remains available during reads. Copy confirmation appears on its control without covering balances. Native disclosures animate only where the browser supports intrinsic-size transitions.

`pnpm --filter @qotc/wallet-extension test:motion` stress-tests rapid reversals, resizing, local loading, keyboard/focus, disclosure interruptions and reduced motion. Safe fixture recordings and screenshots are saved to `test-results/motion/`; they contain no wallet secrets.

Hover states use one palette per control, enabled only for fine pointers with hover support. Asset rows keep the same padding on hover and press; selected options retain their accent. Focus and disabled states take precedence. `pnpm --filter @qotc/wallet-extension test:hover` verifies geometry, selected/focus/disabled styles and touch behavior at narrow and popup widths, with screenshots in `test-results/hover/`.

`public/controls.css` owns interaction colors for both the wallet and explorer in the `controls` cascade layer; view layouts live in the preceding `views` layer. Keep new control variants in that shared file so rest, hover and press cannot fall back to conflicting view styles. Account option menus support arrow keys, Home/End, Escape and Tab. Transfer validation occupies the existing label row, keeps invalid borders visible through focus/hover, and blocks invalid amounts or addresses before requesting a review. `pnpm --filter @qotc/wallet-extension test:interactions` audits foreground, borders, composite fills and geometry across views, plus menu keyboard behavior and validation layout; safe screenshots are saved to `test-results/interactions/`.

Onboarding uses short, keyboard-accessible screens, local BIP39 validation and backup schema/network checks before password entry. A failed backup password can be retried without choosing the file again. Recovery drafts remain only in the active view and are cleared on success, leaving the method, or closing the page.

`pnpm --dir apps/extension test:onboarding:live` verifies creation, failed-password retry, restoration and phrase import in disposable Chrome profiles against the local development services. It sends no transactions and never accesses the installed user wallet.

### Wallets and derived accounts

The account name opens management while unlocked. **Add account** derives the next ML-DSA-87 account at `m/44'/189189'/account'/0'/0'` with the pinned official Quantus SDK. It reuses the wallet's encrypted root phrase and password, without generating or displaying another recovery phrase. Accounts are grouped by wallet and retain separate site grants and history. **Add another wallet** creates or imports an independent recovery phrase. Its password protects its portable backup file; local access uses the installation’s common unlock. The installation limit is 20 accounts in total.

Legacy accounts keep index 0 and their exact address. Independent wallets keep their identities, backups, site grants and transaction histories. Storage becomes version 3 when derived accounts are added. A single password or passkey unlocks the installation, regardless of the selected account. Switching accounts or independent wallets verifies the target identity and cancels pending reviews without locking or extending the absolute deadline. In-flight signing/key operations block switching. Signing uses the selected account's derivation index and verifies the resulting signer before submission. Privileged UI requests carry the expected account.

A multi-account JSON export contains the encrypted root vault plus public account indices, names, identities and the selected index. Restoration re-derives every identity before persisting anything. Legacy v1/v2 single-account backups remain supported. These v3 grouped backups require this extension; they are not the official mobile wallet's backup format. With just the recovery phrase, import the wallet and use **Add account** in order to recreate its previous addresses; names and site permissions are not recovered from a phrase. Back up each independent wallet separately. The public derivation metadata can be edited by someone with file access, so it is always verified against the decrypted phrase; it grants no signing authority.

`pnpm --dir apps/extension test:accounts:live` checks legacy migration, independent-wallet creation/import, renaming, common unlock and separate backup passwords, one-time legacy linking, history/site isolation, duplicate rejection, stale UI requests and worker restart. `pnpm --dir apps/extension test:accounts:hd` checks same-phrase derivation against the official SDK, password reuse, same-wallet switching, restart, failed storage writes, tampered identity rejection, grouped backup restoration and phrase recovery. Both use disposable Chrome profiles and send no transactions. Unit tests additionally sign offline for several derivation indices.

The normal unlock screen contains the welcome title and password form, with no account selector. The first saved wallet’s password becomes the installation password. Existing wallets with that password link automatically; wallets with different passwords require their old password once before common access is enabled. Failed linking writes can be retried without replacing an existing password vault. Newly added wallets are linked while the installation is unlocked. Password-protected backups retain their original passwords and remain independently portable; exporting a wallet does not export installation links. Keep each wallet’s backup password with its recovery records. Locking, expiry and worker restart close access to every wallet. Existing passkeys on the first wallet become installation passkeys; enroll an installation passkey from Settings to replace a passkey previously attached only to another wallet.

`pnpm --dir apps/extension test:connection:live` verifies sequential unlock/review, rejection of locked approvals, explicit connection consent and cancellation in a disposable Chrome profile. It sends no transactions.
