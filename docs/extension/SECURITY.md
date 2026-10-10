# Wallet architecture and threat model

## Reused protocol, not a new chain

The extension imports the active QLYP-v1 command parser, canonical encoders, Quantus address/extrinsic codec and pinned WASM glue from this repository. It changes neither token consensus rules nor the QLYP-v1 fee rules: creating a token and inscribing a Quark cost a 25 USD target converted at the on-chain rate of the [fee schedule](PROTOCOL-FEES.md) (the fixed legacy fees of 1 QTC and 0.1 QTC without a schedule and before it; on mainnet the schedule runs from block 212,250, and below it this wallet signs both at the legacy fees from both witnesses' tip attestation), mint 0.01 QTC, lot n of a progressive token 0.1 to 0.5 QTC (progressive-1000-v1) or 0.01 to 0.44 QTC (progressive-1000-v2) by tier, 1% sale fee paid by the buyer, all to the fixed Qlyphs fee account. `sendQtc` is a native transfer, not a token purchase. Purchases require finalized bilateral reservations and canonical batch settlement.

## Privilege boundaries

The MAIN-world provider and isolated content script are untrusted inputs. They carry typed intents and public responses only. The browser-owned background context alone opens the encrypted vault, reconstructs operations and calls the packaged official signer. Only the extension's `ui.html` can access privileged UI messages. Confirmation requests have background-generated UUIDs and are bound to their extension window; website fields claiming an origin are ignored.

Connection grants identify origin, owner and genesis and disclose accounts only. Actual signing repeats live-document/permission/account/epoch/network/nonce/sequence/ticket checks (for a Keys mint session, the live popup channel in place of the live document). A rejected, expired or consumed request cannot authorize another operation. Top-frame-only injection is reinforced by checking browser sender frame ID. Same-origin hostile script can manipulate its own public page/provider responses, but cannot approve a privileged request or obtain signing material.

Chrome runs an MV3 module service worker. Firefox runs its supported MV3 module background scripts with an event-page lifecycle, not a service worker. Both execute the same controller. All executable JS and WASM are in the installation package; no remote code, eval, dynamically generated function, analytics or crash-report integration is enabled. CSP permits packaged WASM compilation, not generic JavaScript eval.

## Vault and recovery

Vault v2 uses Web Crypto AES-256-GCM with fresh random 16-byte salt and 12-byte IV. PBKDF2-HMAC-SHA256 has 600,000 iterations. The choice provides a built-in, reviewable cross-browser implementation without another WASM cryptographic dependency; it is not a claim that PBKDF2 is memory-hard or superior to Argon2id. Passwords require 6–256 characters. Authenticated metadata binds version, genesis, scheme, path, owner and address. Legacy v1 decryption uses its original 310,000 iterations and exact metadata ordering. Restored mnemonics are rederived and compared to the authenticated identity before migration.

The password is not persisted. `storage.local` contains encrypted vault data and public manifests/grants/transaction records; `storage.sync` is never used. Chrome storage access is restricted to trusted contexts where supported. Decrypted UTF-8 bytes are memory-only and wiped at lock. Browser process isolation and JavaScript garbage collection do **not** guarantee zeroization of all string copies or protect against a compromised OS, debugger or malicious privileged extension update.

The legacy scheme remains ML-DSA-87 at `m/44'/189189'/0'/0'/0'`. Changing SDK, glue, derivation or signature schema requires explicit compatibility vectors and migration review. Build fails when the installed official SDK is not 0.3.1. The lockfile binds the dependency tree. No automatic import of web-page secrets occurs.

## Lifecycle, concurrency, and uncertain broadcasts

Unlocking establishes an absolute five-minute deadline. Privileged signing checks the deadline and session epoch at actual use; alarms are only a supplementary cleanup mechanism. Dapp traffic cannot extend the deadline. A terminated background starts locked and never reconstructs an unlocked session from storage. Pending approvals are memory-only and are invalidated on loss of their context. A mint session's signing deadline is the earlier of its approved duration and this unlock deadline, fixed at approval; re-entering the password does not extend it.

A mutex serializes transaction preparation/signing for the account. Saved unresolved transactions prevent the next nonce. One exception exists: a running mint session may sign its next lot payment while its previous payment is in a block but not final, only after the wallet proves that payment's block on the ancestry of the block the next payment is born at, from headers that hash to the hash both witnesses attest for that block, with the account nonce there past it, and only when both witnesses attest, at that block, the account's token balance the session expects. A session never signs while one of its payments is outside a block or its outcome is not yet verified, and after it ends each of its payments that may have been sent blocks the account under this rule until history shows it final or expired, whatever the session recorded for it. The wallet computes and persists the signed transaction hash, intent, nonce and mortal validity boundary before network submission. It then persists an uncertain-broadcast state before touching the submission API. Neither restart nor a lost response automatically signs or pays again. Public history reconciles against the configured service. The wallet does not treat a lost reply as proof of submission failure. A never-broadcast record can be cancelled safely; an ambiguous record needs observed finality or validity expiry before a new operation. This conservative design favors blocking over duplicate payment.

### Mint sessions

A mint session (mainnet and development builds, same limits) signs up to a bounded number of lot payments after one private approval. Its ledger persists, for each attempt, the transaction hash, nonce, birth block (height and hash), lot, ticket, reservation, status and inclusion block, never the phrase or the signed bytes. The session's signature counter is written before each signature and never decreases, so a crash can over-count signatures, never under-count them. Each attempt follows one order: reserve, sign, persist the hash with its history entry, persist the uncertain-broadcast state, then release the bytes exactly once; a stop observed before release leaves the bytes unsent and the attempt cancelled. An uncertain broadcast is never repeated. Every exit of the session loop, including an unexpected error, records the session's end. A worker restart ends the session and never resumes it; attempts reserved or signed but not yet marked uncertain become cancelled, and those marked uncertain, sent or included keep blocking the account through their history entries. A ledger that fails validation at load is archived exactly as it was stored and replaced by an empty one, while the history journal, which holds every liability, is still validated and keeps gating the account. A ledger saved before payments could be in doubt gets that flag at load: set on every payment that went past signing in a record already marked reorganized, clear otherwise.

Signing stops on lock, account switch, account derivation or addition, network switch, wallet reset, site revocation or disconnection, the wallet window closing or reloading, the dapp channel ending (any URL change or closure of the extension dapp tab; closure or reload of the Keys popup, or closure of the dapp tab), a worker restart, a wallet update, Stop, the dapp's `stopMintSession` and the deadline. The first reason recorded wins, and every stop is checked synchronously right before signing and right before release. The wallet window renews a ten-second lease about once a second; if it stops answering, signing stops when the lease expires. Closing or reloading the wallet window while the approval is still being saved cancels the approval, so its session never starts; a close or reload the wallet learns of only after the save stops the session as it stops a running one. While a session runs, the extension listens for updates: an available update stops the session and reloads the extension so the update installs at once. One controller runs per installation, and while it lives the wallet refuses other transactions and sessions. There is no coordination with other installations holding the same account (another browser profile, device or the web wallet) beyond the nonce and balance checks that stop the session when they observe such activity. The extension runs sessions only where `runtime.getPlatformInfo()` reports desktop Windows, macOS or Linux (not Android, so not Firefox for Android, and not ChromeOS), and offers none until it knows. On mainnet a session also needs the compiled witness policy, the reviewed progressive activation and the ticket charge pinned for runtime 153 (0.003 QTC); it never signs a tip. Qlyphs Keys runs sessions only in desktop Chromium-family browsers and desktop Firefox on Windows, macOS or Linux, with its wallet worker in a `SharedWorker` that every Keys page of the origin shares; elsewhere (WebKit and every iOS browser, mobile browsers including Android browsers that present a desktop identity, VR browsers, ChromeOS, the dedicated-worker fallback) its wallet neither offers nor serves them. The gate refuses any disagreement between the user agent string, `navigator.platform` and `navigator.userAgentData`.

## Explicit trust model

The extension still trusts the configured full node for consensus and runtime execution.
Displayed balances, metadata, history and fee estimates rely on the configured API and remain
unsigned/provisional. It does not run an independent full node, indexer or light client inside the browser.

Development **purchases** and **progressive lot mints** additionally require QPA1 agreement from
every compiled witness operator, and so do **token creation and inscriptions** once a fee schedule
is active: their fee comes from the rate in a tip attestation of both witnesses (see the Qlyphs fee
paragraph below). A lot mint uses a tip attestation: both witnesses sign the state at
the best block X of the wallet's node (with one more try on a fresh best block, never an older
one), under a statement domain of its own, so it can never
stand in for a finalized checkpoint. The review's token, lot number, amount, Qlyphs fee and mint
right come from that state, not from the API. The wallet derives the call from it and asks the API
to prepare the lot at X; the prepared call and block must match exactly. It signs with a mortal era
born exactly at X: the payment is valid only on chains that contain the attested
state, where the right is current or already used, and a reorganization that drops X only makes it
invalid. Right before signing the context must still be X. A lot taken in between is refused
before signing when the API's live view shows it; one taken after signing makes the transaction
fail on chain before its payment, so only the network fee is spent.
Mint sessions take each lot from fresh tip attestations without a lot expectation: the next lot is whatever attested state names, within the approved terms. A payment's outcome comes from attested state at its inclusion block: minted (the right is anchored at the payment, the minted amount advanced and the account received the lot), lost race (the right was used before the payment, by another buyer's mint or a transaction that only used it, and the account received nothing), or anything else, which stops the session. The last lot leaves no right to place its use at the payment's position, and the wallet does not take its node's word for whose use it was, so a session never counts the last lot itself: it ends `unverified` with that payment held at its worst case, and the wallet's history (Activity) gives its result. A lost race beyond the retries the terms allow (`maxAttempts - maxLots`) ends the session (`race-lost`), so with no retry the first one does. No outcome uses the position the wallet's node reports for a payment until the wallet proves it from a block both witnesses attested: each header down to the inclusion block hashes (Poseidon2) to the hash its child names, the block's body matches its header's extrinsics root exactly, and the payment's signed bytes are the extrinsic at that index. Node data that fails a check ends the session `unverified` for good, a node that does not answer ends it `unavailable`, and neither falls back to the node's word, so a misreported position cannot turn another buyer's settlement into a counted lot or admit another signature. Account nonces and balances, the best and finalized blocks and canonical hashes remain the node's claims, used only to stop or wait; the lot and spend caps still rest only on attested balances and on the fixed fee of each signed payment. A recorded inclusion that leaves the node's chain ends a running session. Neither a reorganization nor the service's reported status can add authority: when one contradicts what the session recorded (an inclusion that left the chain, or a final status in the wallet's history that differs from the recorded outcome), the payments it can affect are put in doubt for good. The verdict that admitted the next signature is kept and admission never reads the doubt; the doubted payments only leave the verified counts and show as unresolved, then settled once final in history, whose Activity entry gives their result, and their Qlyphs fees and tickets stay reserved until then. The stored ledger check refuses a record whose doubt and reorganized flag disagree or that reserved a payment after its retries were used up (only for a running record saved under the lost-race rule: an ended record never signs again, and wallets before the rule signed until maxAttempts, so ended records are not held to the retry count, and a running record without doubt flags, cut off under such a wallet, loads and is ended like any record no controller owns), and it checks the caps both with the doubt and as if nothing were in doubt.
The extension background owns the random challenge, fixed aggregation endpoint, public trust pins
and IndexedDB high-water cursor. It verifies signatures, network/activation/rules/runtime, bounded
lifetime, same finalized snapshot, rollback/equivocation rules and exact purchase bytes before
using the signing key. After waiting it repeats cancellation, account, permission, session epoch
and deadline checks. Trust pins are not accepted from page messages, storage or API responses.
A development package without a compiled policy refuses purchases, lot mints, and creation and inscriptions priced by a fee schedule. A mainnet build accepts only a policy that matches its pins and the reviewed mainnet rules (`deploy/mainnet/witness-policy.json`); switchable builds reject a policy. Missing/divergent/invalid attestations never
fall back to the unsigned view or an ordinary QTC payment.

Witnesses are attestations by configured operators, not a proof of honest computation. Witness operators remain dependent on their full nodes, metadata and rules; collusion or
compromise of all trusted signers can lie. An authentic state digest alone is not a consensus state
proof. A malicious privileged extension update can replace this entire verification boundary.
Trust-key rotation and revocation require a reviewed rebuilt wallet and trusted update distribution.
Old clients do not learn new revocations automatically. Post-quantum transaction and witness signatures
do not make browser-store or update authentication post-quantum.

Fee quotes are estimates tied to the runtime and review block, not a signed fee cap. The confirmation separates native network fee, non-refundable native charge, refundable native deposit and the Qlyphs fee. The Qlyphs fee is paid only to the fixed Qlyphs fee account defined in the shared protocol code; a call carrying any other fee amount or recipient is invalid under the protocol, and the wallet recomputes the fee itself and refuses to sign when the service quotes a different amount. Where the fee comes from depends on the operation:

- **Mint, progressive lots and purchases.** The fee is a protocol constant rather than a configurable value: 0.01 QTC per mint, 0.1 to 0.5 QTC (v1) or 0.01 to 0.44 QTC (v2) per progressive lot by its number, 1% of the price on a purchase, rounded up.
- **Create and inscribe (contract change in fees-1).** The fee is no longer a protocol constant. It comes from an attested, bounded, delayed on-chain rate, capped by a compiled wallet ceiling (`WALLET_MAX_RATE`, 25 USD per QTC: at most 1 QTC per DEPLOY or INSCRIBE). The rate is QLYP state, posted by a Qlyphs operator key within fixed bounds (5 to 5,000 USD per QTC), by at most ×5/4 per change and at least `delay` blocks before it applies; a sentinel or guardian key can cancel a pending rate or freeze the operator. The wallet reads the rate only from a tip attestation that both witnesses sign, prices the operation at that block, signs with an era born at that block (period 256, tip 0), and thereby never loses a fee to a rate change ([fee schedule, section 6](PROTOCOL-FEES.md#6-overlap-bound-and-no-fee-loss-guarantee)). The ceiling bounds what colluding witnesses or a compromised operator key can make this wallet pay.

The wallet refuses to sign a create or inscribe when: no verified tip attestation is available ("Fees cannot be verified right now."); the symbol is one of the six blocked tickers `BTC ETH QLYPHS QTC USDC USDT` ("This ticker is reserved and cannot be deployed."); the symbol is taken at the attested block; the signer is the Qlyphs fee account or a current or pending fee role; the service's quoted fee differs from the local fee; the signing context is not born at the attested block, in number and hash; the fee is above the ceiling ("Fee above this wallet's limit; update the wallet."); the witnesses' rules fingerprint differs from the build's; the era is immortal or its period is not 256; the attested state has no fee schedule where the network has no legacy fees; or the network is mainnet before its reviewed fee schedule activation ("Qlyphs fees are not active on mainnet yet."). Every deploy shows that a competing deploy of the same symbol included first keeps the fee. A rejection whose fee was paid is shown as "Qlyphs fee kept".

In a mint session, Qlyphs fees and native ticket charges are capped exactly (attested fees and a native charge pinned for the runtime); network fees are estimates, reserved at twice the service's estimate for a payment not yet in a block, and are not part of the cap.

## Validation and remaining limits

Build and typecheck instructions are in [the extension README](../../apps/extension/README.md#local-verification).
The public export contains wallet code and reproducible release tooling; the separate installed-browser
integration environment is not included. A passing build does not establish transaction-lifecycle,
hostile-browser, hardware-authenticator or operating-system notification coverage. Those claims need
results for the exact release, browser, SDK and network tested.

Independent security review and store review remain outstanding. Long history and asset pagination
have explicit limits. The configured node and unsigned data service remain material trust assumptions.
No arbitrary-byte signer, bridge or AMM interface is exposed. Derived accounts use the pinned Quantus
HD derivation on the selected network.

## Primary references checked during implementation

- Chrome lifecycle: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- Chrome messaging: https://developer.chrome.com/docs/extensions/develop/concepts/messaging
- Chrome CSP: https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy
- Firefox background: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background
- OWASP password storage: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- Official Quantus docs/source: https://docs.quantus.com/ and https://github.com/Quantus-Network/quantus-wasm

Documentation can evolve; runtime behavior is ultimately checked against the exact packaged browser/SDK and CI evidence, not a version label alone.

## Derived accounts and network separation

A switchable build keeps separate network manifests, grants and histories. Its explicit carry action
can reuse development phrases and addresses on mainnet, re-encrypting vault metadata for that genesis.
Network separation does not imply independent private keys; phrase compromise affects every network
where that phrase is reused.

An independent wallet owns a v1/v2 authenticated root vault at index 0. Derived account records share that encrypted vault and carry a public index and identity; they never store raw private keys. The background verifies the derived identity against the decrypted phrase on password/passkey unlock and same-wallet account switching. It signs with the selected account index and checks the parsed signer against the reviewed owner before broadcast. All account selections invalidate pending approvals and rotate the session epoch without extending the common unlock deadline. Both same-wallet and cross-wallet selections retain installation access, and both are blocked during signing. Dapps cannot derive accounts or extend an unlock session.

Grouped backup v3 keeps public account metadata alongside the original encrypted vault. All account identities are rederived before restoration; names are public, and no permissions or passkeys are imported. Metadata is not an authenticated substitute for deriving the actual identity. A failed persistence operation rolls back the account selection and records. Legacy vault cryptography, index-0 addresses and independent wallet boundaries are preserved.

### Installation access

The first root wallet authenticates the local installation. Independent root phrases are additionally encrypted in local access envelopes with AES-256-GCM, fresh 32-byte HKDF salts and 12-byte IVs. HKDF-SHA256 derives a domain-separated wrapping key from the first root’s high-entropy mnemonic. Authenticated context binds the anchor owner, target owner/address, genesis and extension origin. The original password vaults remain unchanged for portable backup recovery. The access envelopes are excluded from backups. Compromise of the unlocked installation or first root together with its local access envelopes grants access to all linked wallets; this is deliberately one authentication boundary.

A legacy installation links a separately protected root only after verifying its old password and identity. Partial linking cannot sign or manage accounts. The final unlock validates linked roots and derived identities. Failed storage writes restore in-memory metadata; explicit locking cancels pending authentication by epoch. The common root remains in the existing zeroized, expiring memory session; selected independent roots are decrypted on use and temporary byte buffers are cleared. No plaintext password, phrase or wrapping key is persisted. Account switches never reinstall the session or renew its deadline. The first root’s existing passkey envelope authenticates the same installation access.

## Multi-application developer provider

The additive provider protocol keeps `version: 1` compatibility and advertises v2
capabilities. Allowed origins (loopback HTTP on development, public HTTPS on mainnet) are compiled separately from fixed RPC/API/PQ
pins; being injected does not grant account access. The controller projects each live
document's state independently, only after durable approval and only for the unlocked
selected account. It never sends account names/counts, hidden identities, derivation
paths, session details or other origins' grants. Disconnect/revoke spans saved accounts
for the named origin, preserving independent applications. Stale async results are
bound to the original document, account/epoch and grant revision.

MAIN-world events are untrusted transport, never a source of privileged authorization.
Port loss/pagehide clears public identity and invalidates requests; reconnect reads
state only. Abort cancellation targets an existing request on the same document and
never implies rollback after signing starts. Existing persisted uncertain-broadcast
nonce blocking and all HD, backup, session and PQ boundaries remain in force. SDK
public reads remain unsigned and cannot configure extension RPCs. See
[the provider contract](PROVIDER.md).
