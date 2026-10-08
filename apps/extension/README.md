# Qlyphs Wallet

Non-custodial browser extension (Chrome MV3, Firefox) for Quantus: it holds ML-DSA-87 keys, sends QTC and
signs Qlyphs operations (Quarks, fair-mint tokens, bilateral token sales) for the Qlyphs app. Version
**0.6.0**. A Qlyphs product, not an official Quantus wallet. QLYP-v1 assets are an indexed token overlay,
not runtime-native `pallet_assets` balances; the bilateral market is not an AMM or open-taker order book.

Mainnet builds require reviewed network pins. Purchases, token creation, inscriptions, lot mints and
mint sessions on mainnet also require the reviewed mainnet witness policy compiled in; progressive
tokens and their lot mints start at block 208,500 ([MAINNET.md](../../docs/MAINNET.md)). The store
release is mainnet only; it has no network switch.
The development build is for local chains only; do not import an account holding real funds into it.

**Fees.** QLYP-v1 charges a Qlyphs fee, paid to the Qlyphs fee account in the same signed extrinsic:
creating a token (any allowed symbol) and inscribing a Quark each cost a 25 USD target converted at
the on-chain rate of the [fee schedule](../../docs/extension/PROTOCOL-FEES.md) (0.25 QTC at 100 USD per
QTC); 0.01 QTC per mint, fixed; per lot of a progressive token 0.1 to 0.5 QTC
(progressive-1000-v1, 300 QTC for all 1,000 lots) or 0.01 to 0.44 QTC (progressive-1000-v2, 210 QTC
in all) by lot number; and 1% (rounded up, paid by the
buyer) of the QTC price of any token sale. The wallet reads the rate from a tip attestation of both
witnesses, signs at that attested block so a rate change cannot cost the fee, and refuses a fee
above its compiled ceiling (1 QTC per creation or inscription) and the six blocked tickers
`BTC ETH QLYPHS QTC USDC USDT`. Before a fee schedule is active, the protocol keeps the legacy fees
(1 QTC per creation, 0.1 QTC per inscription). Mainnet keeps them below block 208,500, where the
schedule starts; a mainnet build signs either only from a tip attestation of both witnesses, so a build
without the witness policy refuses both. A progressive lot also burns the runtime's multisig fee
(0.03 QTC on the pinned development runtime) for its one-shot mint right. Token transfers and plain QTC sends carry no Qlyphs fee. The
wallet recomputes the expected fee itself and refuses to sign when the service asks for a different one.
Network fees come on top.

## Install

- **Mainnet:** from the [Chrome Web Store](https://chromewebstore.google.com/detail/qlyphs-wallet/eoolpkpilfjhehiomelomiahllmgpgjd).
  Firefox Add-ons does not list it yet; load a mainnet build (see Build).
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

**Mainnet.** Requires reviewed genesis, runtime and activation pins. The repository contains
[`deploy/mainnet/pins.json`](../../deploy/mainnet/pins.json); see [mainnet notes](../../docs/MAINNET.md)
for their meaning and limits. Without an explicit pins file the mainnet build fails.

```sh
QLYPHS_EXTENSION_NETWORK=mainnet QLYPHS_EXTENSION_PINS="$PWD/deploy/mainnet/pins.json" \
NATIVE_PQ_POLICY_FILE="$PWD/deploy/mainnet/witness-policy.json" \
  pnpm --filter @qotc/wallet-extension build
```

The mainnet build accepts only https origins and defaults to indexer API `https://indexer.qlyphs.com`, RPC
`https://rpc1-mainnet.quantus.com` and explorer `https://qlyphs.com/explorer`. Its manifest is named "Qlyphs
Wallet", carries no development `key` (the store assigns the Chrome ID) and uses the Firefox ID
`wallet@qlyphs.com`. The configured service must accept the installed extension’s exact origin.
A mainnet build accepts `NATIVE_PQ_POLICY_FILE` only when the policy matches the pins and the reviewed
mainnet rules (`rulesHash`), and refuses the rules inputs `NATIVE_PROGRESSIVE_FROM`,
`NATIVE_PROGRESSIVE_V2_FROM` and `NATIVE_FEE_SCHEDULE`. Without a policy it refuses purchases, lot
mints, token creation and inscriptions. Switchable builds reject `NATIVE_PQ_POLICY_FILE`.

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
`QLYPHS_EXTENSION_OUTPUT` (default `dist`), `NATIVE_PQ_POLICY_FILE` and the rules inputs
`NATIVE_PROGRESSIVE_FROM`, `NATIVE_PROGRESSIVE_V2_FROM` and `NATIVE_FEE_SCHEDULE` (below). The API, RPC and explorer are
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
other network's stored wallet (`wallet` for development, `wallet:mainnet` for mainnet). Network
pins, site grants and transaction history remain separate.

The explicit **Use development wallet** action on mainnet can reuse development recovery phrases
and derived addresses. It re-encrypts available wallets for the mainnet genesis; development grants,
passkeys and history are not copied. Linked wallets, or wallets opened by the supplied password, can
be carried; inaccessible wallets stay on development. This separates network state, not key identity.
A recovery phrase exposed during development is equally exposed if reused for mainnet funds.

## Development network

Development builds expect compatible local services at the compiled API and RPC origins. The
public wallet export contains the wallet and its shared client modules; it does not contain a runnable
indexer server, faucet or hosted explorer. Building the wallet does not start those services.
The exact dapp origin and port must match the build's allowlist. The configured service must also
accept the installed extension's origin; Firefox assigns a profile-specific `moz-extension://` origin.

Explorer links (menu, activity and notifications) open the configured web explorer, with the selected
network in the URL. Set `QLYPHS_EXTENSION_EXPLORER` when building if the default development explorer
is not available. Do not expose an unauthenticated development RPC publicly.

## Balances and transaction review

Send checks exclude frozen QTC and reserve estimated fees and the minimum account balance before opening a review and again before signing. A token transfer also requires QTC for fees. Creating a token, minting, inscribing and buying also reserve the Qlyphs fee (and, for a purchase, the price), and the review shows it as a separate **Qlyphs fee** row included in the estimated total. Pending or uncertain submissions continue to block another send until finality or verified expiry; the wallet displays the reason rather than silently retrying. An approved mint session is the only exception, for its own lot payments (see [Mint sessions](#mint-sessions)).

The headline QTC balance reflects the current on-chain balance, including receipts before finality.
The send form separately reports spendable funds and those still waiting for finality. Visible wallets
refresh automatically (about 16 seconds when idle, 4 seconds while settling) and when the page regains
focus; slow refreshes are allowed to finish. Successful inclusion is displayed as **Confirmed** in the
receipt and Activity. Actual finality remains in the background journal and governs send checks.
On mainnet a block counts as final once it is 20 blocks below the node's best block, or finalized
by the node itself if that comes first; development keeps the node's own finality. The indexer, the
witnesses and the wallet share this rule (`finalityDepth` in `packages/native/src/network.ts`), and the
wallet refuses an indexer whose final height differs from its own by more than 3 blocks.

Recovery confirmation keeps the acknowledgement, file-storage advice and both actions visible in
short popups and sidebars.

## Connection and use

Open an allowed dapp and click **Connect wallet**. If Qlyphs is locked, the extension first shows only the unlock screen; the site review appears after unlocking. Unlocking never approves a connection. **Cancel request** dismisses a locked request without granting access. Approve the site in the extension-owned window. Create/mint tokens, inscribe Quarks and arrange bilateral sales in the web app; inspect and approve each operation in the extension. The popup also sends QTC and transfers displayed tokens. The site receives an account and submitted transaction hash, never a phrase or password. Qlyphs Keys provides a separate web-wallet connection using the same provider contract. A dapp can also request a mint session: up to N lot payments for one token after one review, with progress and Stop in the same window.

A five-minute absolute unlock deadline is not extended by dapp messages. Browser suspension or a background restart locks the wallet sooner. After a restart, reopen the wallet, unlock explicitly, reload/reconnect the dapp if necessary, and inspect saved history. Unknown submission outcomes must not be treated as failures or retried with a new nonce. A mint session stops signing when this deadline passes.

## Post-quantum purchase and lot-mint verification

Purchases and progressive lot mints require QPA1 attestations in the extension's
privileged background, or in the wallet worker for Qlyphs Keys. The wallet creates its own
challenge, verifies both configured ML-DSA-87 witnesses against compiled public pins, checks the
finalized reservation against the exact purchase bytes, and persists its authenticated high-water
checkpoint in wallet-owned IndexedDB. A lot mint uses a tip attestation of its node's best block
instead, with one more try on a fresh best block and never an older one: its review takes the token, lot number, amount and fee from that state. The
wallet derives the call itself and requires the service's intent, prepared at that same block, to
match it exactly. It signs with an era born at that block, so the payment can only execute where
the attested right exists. A tip attestation never moves the high-water checkpoint. A dapp cannot supply keys, an
endpoint, a policy or a `verified` flag. The signing session is checked again after asynchronous
verification.

**Without a compiled witness policy, purchases and lot mints are refused.** That is every switchable
build, which rejects a policy because one policy cannot serve both networks, and any mainnet or
development build made without one. A mainnet build takes only the reviewed mainnet policy, and its
lot mints start at block 208,500; mint sessions run there too, within the same limits as on
development builds (see [Mint sessions](#mint-sessions)). QTC sends, legacy
mint and ordinary transfers do not require this policy. Token creation and inscriptions require it
wherever the build has a fee schedule, as every mainnet build does: the wallet verifies a tip
attestation of both witnesses, prices the operation from that attested state (the attested `current`
rate, or on mainnet below block 208,500 the legacy fee), and signs with an era born exactly at that
block. A rejection whose fee was paid (for example a symbol claimed first by
another deploy) shows "Qlyphs fee kept".

### Mint sessions

A dapp can ask for up to N lots of one progressive-1000-v2 token (N at most 25) in one review. The
review shows the lot count, the signature limit, the Qlyphs fee cap per lot, the maximum protocol
spend, when signing stops, the lots the fee cap allows, the network fee estimate and the history
space it uses. The signature limit S is N plus the R retries the dapp asked for (R at most
`min(N, 10)`): with none it reads "Up to N · stops if another buyer takes a lot first", otherwise
"Up to S · at most R retries after lost races". After approval the same window shows progress and a
Stop button. If the wallet is slow to confirm the start, the window keeps asking until the session
shows, the wallet refuses or the review expires, so a started session is never left without its
progress and Stop. Closing or reloading the window after approving stops
the session, or cancels its start if the wallet has not started it yet.

- **One payment at a time.** Each lot is an ordinary lot payment, attested by both witnesses at the
  node's best block and checked like a single lot. The next payment is signed only once the wallet's
  own node shows the previous one in the chain the next one is born on, the account nonce is past it,
  and both witnesses attest that the account holds exactly the lots counted so far.
- **Lost races.** If the lot's right is used before the payment, by another buyer's mint or by a
  transaction that only uses the right, that payment fails on chain and only its network fee is
  spent; the progress row "Lost races" counts them. While retries remain, the wallet signs one
  payment for the lot that is next then, never above the fee cap and within the signature limit.
  After R lost races the next one ends the session (with no retry, the first one does), quietly
  rather than as an error: "Stopped: the lot’s right was used by another transaction first. Its
  payment cost only its network fee." Any other failure, or anything the wallet cannot verify, stops
  the session. That includes a payment whose block the witnesses no longer attest by the time the
  wallet can check it; its Qlyphs fee and ticket then stay reserved until history settles it. An
  uncertain broadcast pauses the session until the payment is found in a block; it is never sent
  again.
- **Reorganizations.** If a block the session recorded leaves the chain, signing stops. Then, or when
  history later finalizes a payment otherwise than the session recorded, the payments this can
  affect are in doubt for good. The counts keep only verified payments (lots that stayed final count
  as final); an Unresolved row says "outcome being reconciled after a reorganization · check
  Activity", their Qlyphs fee and ticket stay under "may still be charged", and the window keeps
  following them until history settles them, for at most 30 minutes after the end. A payment in
  doubt is never shown as minted or as costing only its network fee, so a completed session that is
  later reorganized reads "Signing ended once N lots were in a block, then the chain reorganized."
  The window's status line is read out to screen readers when a reorganization is found after the
  end and each time the number of payments being reconciled changes. Nothing in history gives the
  session more lots, spend or signatures.
- **Spend.** Qlyphs fees and native tickets never exceed the maximum protocol spend, even if the
  wallet's node misreports blocks. Network fees are estimates; the wallet reserves twice the estimate
  for a payment that is not yet in a block and checks the account balance at each payment's block.
  Other buyers can move the next lot, so the session may pay for later lots than the first one shown,
  never one priced above the fee cap.
- **Stop.** Stop ends signing at once but cannot cancel a payment already sent: it stays valid until
  its era ends, 256 blocks after the block it was born at, and can still land. The session counts it
  only if the wallet classifies it while it still follows the session's payments: for a limited time
  after the end, and not across a wallet restart, update, reset or network switch (Chrome may suspend
  the extension's background once this window is closed). Otherwise Activity shows its outcome. The
  account stays blocked for other operations until the session's payments are final or expired.
  After the end, the window keeps following the session, for at most 30 minutes, while a payment can
  still be included, a lot is not final, a Qlyphs fee and ticket may still be charged, a payment is
  in doubt, or a lost race is not known final yet (a lost race before a final lot is final). After a
  lost race with no lot after it, the window therefore follows that payment for the full 30 minutes.
  Once no payment can still be included and no reorganization was found, the wallet's tracker card
  reads "Signing stopped · lots becoming final", or "Signing stopped · payments becoming final" with
  no step lit when no lot is in a block.
- **What stops signing.** Stop; the wallet locking or reaching the session deadline; closing or
  reloading this window; switching, deriving or adding an account; revoking the site or the site
  asking to stop; a wallet restart; and any page change of the dapp tab, even inside the site (a link, `history.pushState` or a
  hash change), or closing that tab. Keep the window open and stay on the site's page. A session never
  resumes after it stops.
- **Updates.** While a session runs the extension listens for updates. An available update stops the
  session and reloads the extension so the update installs at once: Firefox would otherwise keep
  the old version of an extension that listens for updates until the browser restarts. No listener
  is registered when no session runs, so updates then install as usual.

**Where sessions run.** The same limits apply on mainnet and development builds. A build offers
sessions (`capabilities().mintSessions` not `null`) only when all of these hold, and otherwise
refuses every session method with `UNSUPPORTED_METHOD` before reading or signing anything:

- it carries a witness policy (on mainnet, the reviewed
  [`deploy/mainnet/witness-policy.json`](../../deploy/mainnet/witness-policy.json));
- the runtime's native ticket charge is pinned in the wallet: 0.03 QTC on the development runtime,
  0.003 QTC on Quantus mainnet runtime 153 (the code hash in
  [`deploy/mainnet/pins.json`](../../deploy/mainnet/pins.json)). A service quoting another charge is
  refused at review;
- on mainnet, the reviewed activation of progressive mints is compiled in, as a single lot mint
  requires; before block 208,500 no token can take a session;
- the browser runs on desktop Windows, macOS or Linux, as `runtime.getPlatformInfo()` reports it.
  Firefox for Android, ChromeOS and any other system are refused, and sessions stay off until the
  system is known.

A session never signs a payment with a tip, pays only progressive-1000-v2 lots, never resumes after
a restart or a reorganization, and never counts a token's final lot itself.

For a development environment with compatible witness services, compile their reviewed public policy:

```sh
NATIVE_PQ_POLICY_FILE=/absolute/path/to/public-policy.json pnpm --filter @qotc/wallet-extension build
```

The build rejects policies for another rules fingerprint, runtime or activation. The rules
fingerprint includes the witnesses' rules inputs, so build with the same values the witnesses use:

| Variable | Meaning |
| --- | --- |
| `NATIVE_PROGRESSIVE_FROM`, `NATIVE_PROGRESSIVE_V2_FROM` | activation heights of progressive-1000-v1 (tag 11) and -v2 (tag 12); unset when the witnesses have none |
| `NATIVE_FEE_SCHEDULE` | the witnesses' fee schedule, as strict JSON of a `FeeRules` object ([fee schedule, section 4](../../docs/extension/PROTOCOL-FEES.md#4-activation-model)), or unset for none. Refused for mainnet builds, whose schedule is compiled into the reviewed release. Part of `rulesHash`, so the build compares it with the witness policy |

The wallet fetches attestations from its fixed API origin, never an endpoint supplied by a dapp. Witness private keys do
not belong in the build or the wallet. No insecure purchase fallback is supplied.

API balances/history remain provisional, unsigned views. QPA1 authenticates operator claims
and requires agreement, not a consensus proof or a guarantee against operator collusion.
Changing/revoking trusted keys needs a reviewed rebuilt extension and trusted update distribution.
Old clients do not learn new revocations automatically. Clearing the browser profile clears
its high-water history but never permits a key supplied by the API to become trusted.

## Recovery and migration

The exact legacy account is **ML-DSA-87, `m/44'/189189'/0'/0'/0'`**, using the locked official `@quantus-network/wasm@0.3.1`. Existing web-wallet version-1 backups retain their original AES-GCM authenticated metadata and PBKDF2-SHA256/310,000-iteration decoding. Successful restoration rewrites an authenticated version-2 vault with a fresh salt/IV and PBKDF2-SHA256/600,000 iterations; identity is checked before accepting it. The original backup is not modified. Version-2 backups are for this extension; the older web wallet does not yet read them.

An encrypted backup **and its password**, or the correct mnemonic on the same network/schema/path, are needed. Browser uninstall/profile deletion can remove local storage. Keep recovery material outside the browser. Do not export a phrase into the dapp or attach it to a bug report. The extension cannot reset a forgotten password without recovery material.

For a single locked wallet, **Forgot password? Start fresh** downloads its encrypted backup and requires acknowledgement before resetting. The reset archives the full encrypted wallet state in local extension storage and starts creation of a different wallet; it does not recover the old password, identity or assets. A failed archive/reset write keeps the active wallet unchanged. The action is unavailable while unlocked, from confirmation windows, during transaction approval, or when multiple wallets are saved.

## Local verification

```sh
pnpm --filter @qotc/wallet-extension typecheck
pnpm --filter @qlyphs/keys typecheck
pnpm --filter @qotc/wallet-extension build
```

The public export includes the code needed to build and typecheck the wallets. Installed-browser
integration tests depend on a separate development environment and are not included. A successful
build or typecheck is not evidence of an installed-browser lifecycle test or an independent audit.

## Boundaries

Up to 20 accounts across independent wallets, with separate pinned state for each compiled network. The initial popup displays at most the first 100 indexer asset records, with an explicit overflow message; use a compatible dapp for further pages. Submitted-operation history is capped at 200 records and stops new operations at capacity rather than silently removing unresolved records. A compatible explorer supplies broader chain activity.

See the [provider contract](../../docs/extension/PROVIDER.md), [security model](../../docs/extension/SECURITY.md), and [distribution guide](../../docs/extension/DISTRIBUTION.md). There is no independent security audit yet.

## Wallet UI

The 0.4.0 layout adapts [Metamask Clone (Crypto Wallet) (Community)](https://www.figma.com/design/EF6iqylcMYhf3UFN9rfFBv/Metamask-Clone--Crypto-Wallet---Community-?node-id=6008-20): AccountInfo (`6008:5`), Tabs (`6120:1423`), unlock (`6217:4315`) and transaction request (`6218:7198`). The reference contains extension approval/unlock components; the dashboard is an adaptation for Qlyphs. Qlyphs colors, fonts, mark and existing icons are retained. No MetaMask/Ethereum branding, new UI dependency, external asset request or unsupported wallet action is introduced. Reviews use a plain transaction heading and amount, a full recipient address with Copy, exact fee estimates and an estimated QTC total for native sends. Zero-value ancillary fees, signing-account details and the raw payload use explicit disclosures; nonzero fees and deposits stay visible. No decorative trust badge is shown. Reject/Approve remain outside the internally scrolling details at every supported size.

Network identity comparison is independent of JSON key order, including after Chrome reloads persisted storage. Real changes to genesis, runtime or activation remain blocked. A mismatch triggers an automatic read-only comparison of saved and connected genesis, runtime and activation. If the saved network is available again, balances must pass another pinned-network check before the alert clears. Otherwise the warning distinguishes a different chain from changed runtime/configuration, with full details available. Diagnostics validate the local services without repinning the wallet; genuine mismatches remain blocked. Verification errors retain their sanitised cause and failing stage. The UI compares its version with the background worker, flags partial updates, and offers Reload extension without deleting storage or replacing the saved network; reloading locks the wallet.

Chrome opens a native side panel by default, keeping the wallet visible when switching web tabs. Settings → Open wallet in switches between the side panel and the popup, and persists across browser worker restarts. Chrome controls the resizable panel width; the layout adapts to the available width and full browser height. Firefox retains the popup.

The popup requests 360 × 600 pixels and fits the height Chrome actually provides on smaller screens. The outer shell stays fixed: each active view scrolls internally, while the header and wallet navigation remain visible. The preview also fits the browser viewport without page scrolling. Across Assets, Activity and Settings, the balance and quick actions scroll away naturally while the navigation stays pinned with a soft edge fade. All three share a viewport capped at the available panel height, so long lists remain scrollable without growing the popup or adding nested scroll areas; the expand button opens a dedicated wallet tab. It uses Qlyphs / Quantus Void & Flare colors and bundled Geist fonts. The unlock screen uses a static rounded Qlyphs emblem and a compact password form. Onboarding separates wallet choice, creation, phrase import and encrypted-backup restoration into compact screens with a fixed bottom action. Recovery starts with a privacy reminder, shows 12 numbered words per page, then asks for explicit acknowledgement. Core steps fit 360 × 498 and 360 × 600 popups without scrolling; content-only scrolling remains available for zoom and unusually short panels. Back navigation preserves drafts within a method and clears secrets when leaving it. Pointer transitions are subtle and interruptible; keyboard and reduced-motion navigation are immediate. No media, font or artwork is fetched remotely.

Activity includes an **Explorer** button and per-transaction links to the configured external web explorer. Transaction links include the selected network and full transaction hash. The menu opens that explorer with a network filter. These pages provide public chain information and never approve wallet requests.

Transfer and receive screens use mobile-sized layouts: 44 px fields, 48 px primary actions, compact headings and a fixed bottom action. Only the form content scrolls when errors or a short viewport need extra room. Send offers one asset selector: native QTC and held assets are distinguished by their identifiers. The Swap shortcut is disabled and labelled Coming soon until an exchange flow is implemented. Asset rows preselect their token; changing assets clears the amount while preserving the recipient. The selected symbol, available balance, token decimals and exact command stay consistent through the approval screen, which shows the full asset ID for tokens and fees in QTC. An asset that disappears on refresh remains explicitly unavailable instead of silently switching to QTC. Full addresses, exact quantities and the approval step remain intact. Sidebar wallet content is capped at 420 px.

The wallet displays native/token balances rounded to at most three decimal places, with exact values on hover and positive dust shown as <0.001. Transfer entry and transaction reviews retain full precision. It includes session-local balance hiding, a receive QR encoding the full address, dedicated send/transfer views, activity status, site permissions, backup/recovery, and readable transaction approvals. Public metadata is always inserted as text. Private recovery words are removed when acknowledged, locked or the page closes. Passkey and notification controls are available only to the extension interface; dapps gain no new signing or key-access capability.

Optional passkeys unlock a separate local encrypted envelope using WebAuthn PRF, HKDF-SHA256 and AES-GCM. Setup and removal require the wallet password. Authentication runs in a dedicated extension tab so Chrome closing its toolbar popup does not interrupt the ceremony. A PRF-compatible authenticator is required; unsupported authenticators leave password access intact. The passkey envelope is bound to this wallet and extension origin, is local to this browser profile, and is excluded from encrypted backup exports. Keep the existing password and recovery material: syncing a passkey alone does not restore the wallet in another profile.

Chrome desktop notifications are off by default and request the optional `notifications` permission only when enabled. They report known finalization, failure or expiry of operations submitted by this wallet, with generic text that omits addresses and balances. They do not monitor incoming transfers or send email/Google account messages. Checks run about once a minute while the browser is running. Clicking a transaction notification opens that transaction in the configured external web explorer; it never approves a transaction. The delivery ledger suppresses duplicates across worker restarts and skips old completed operations on enable. Because it is persisted before delivery, a crash or OS suppression can lose an alert; saved wallet history remains the source of truth.

Platform references: [Chrome popup sizing](https://developer.chrome.com/docs/extensions/reference/api/action), [WebAuthn PRF](https://www.w3.org/TR/webauthn-3/#prf-extension), and [Chrome notifications](https://developer.chrome.com/docs/extensions/reference/api/notifications).

Display references: [MetaMask display modes](https://support.metamask.io/configure/wallet/language-settings-and-display/) and [Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel).

Motion: tabs update immediately with a retargetable, critically damped selection indicator and a short content fade. Keyboard navigation and reduced motion skip these animations. Balances and navigation stay fixed. Slow actions show local progress after 150 ms; fast actions avoid spinner flashes, and navigation remains available during reads. Copy confirmation appears on its control without covering balances. Native disclosures animate only where the browser supports intrinsic-size transitions.

Hover states use one palette per control, enabled only for fine pointers with hover support. Asset rows keep the same padding on hover and press; selected options retain their accent. Focus and disabled states take precedence.

`public/controls.css` owns interaction colors for both the wallet and explorer in the `controls` cascade layer; view layouts live in the preceding `views` layer. Keep new control variants in that shared file so rest, hover and press cannot fall back to conflicting view styles. Account option menus support arrow keys, Home/End, Escape and Tab. Transfer validation occupies the existing label row, keeps invalid borders visible through focus/hover, and blocks invalid amounts or addresses before requesting a review.

Onboarding uses short, keyboard-accessible screens, local BIP39 validation and backup schema/network checks before password entry. A failed backup password can be retried without choosing the file again. Recovery drafts remain only in the active view and are cleared on success, leaving the method, or closing the page.

### Wallets and derived accounts

The account name opens management while unlocked. **Add account** derives the next ML-DSA-87 account at `m/44'/189189'/account'/0'/0'` with the pinned official Quantus SDK. It reuses the wallet's encrypted root phrase and password, without generating or displaying another recovery phrase. Accounts are grouped by wallet and retain separate site grants and history. **Add another wallet** creates or imports an independent recovery phrase. Its password protects its portable backup file; local access uses the installation’s common unlock. The installation limit is 20 accounts in total.

Legacy accounts keep index 0 and their exact address. Independent wallets keep their identities, backups, site grants and transaction histories. Storage becomes version 3 when derived accounts are added. A single password or passkey unlocks the installation, regardless of the selected account. Switching accounts or independent wallets verifies the target identity and cancels pending reviews without locking or extending the absolute deadline. In-flight signing/key operations block switching. Signing uses the selected account's derivation index and verifies the resulting signer before submission. Privileged UI requests carry the expected account.

A multi-account JSON export contains the encrypted root vault plus public account indices, names, identities and the selected index. Restoration re-derives every identity before persisting anything. Legacy v1/v2 single-account backups remain supported. These v3 grouped backups require this extension; they are not the official mobile wallet's backup format. With just the recovery phrase, import the wallet and use **Add account** in order to recreate its previous addresses; names and site permissions are not recovered from a phrase. Back up each independent wallet separately. The public derivation metadata can be edited by someone with file access, so it is always verified against the decrypted phrase; it grants no signing authority.

The normal unlock screen contains the welcome title and password form, with no account selector. The first saved wallet’s password becomes the installation password. Existing wallets with that password link automatically; wallets with different passwords require their old password once before common access is enabled. Failed linking writes can be retried without replacing an existing password vault. Newly added wallets are linked while the installation is unlocked. Password-protected backups retain their original passwords and remain independently portable; exporting a wallet does not export installation links. Keep each wallet’s backup password with its recovery records. Locking, expiry and worker restart close access to every wallet. Existing passkeys on the first wallet become installation passkeys; enroll an installation passkey from Settings to replace a passkey previously attached only to another wallet.