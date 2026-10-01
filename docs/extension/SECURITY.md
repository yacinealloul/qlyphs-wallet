# Wallet architecture and threat model

## Reused protocol, not a new chain

The extension imports the active QLYP-v1 command parser, canonical encoders, Quantus address/extrinsic codec and pinned WASM glue from this repository. It changes neither token consensus rules nor the QLYP-v1 fee rules (deploy 1 QTC, mint 0.01 QTC, lot n of a progressive token 0.1 to 0.5 QTC (progressive-1000-v1) or 0.01 to 0.44 QTC (progressive-1000-v2) by tier, inscription 0.1 QTC, 1% sale fee paid by the buyer, all to the fixed Qlyphs fee account). `sendQtc` is a native transfer, not a token purchase. Purchases require finalized bilateral reservations and canonical batch settlement.

## Privilege boundaries

The MAIN-world provider and isolated content script are untrusted inputs. They carry typed intents and public responses only. The browser-owned background context alone opens the encrypted vault, reconstructs operations and calls the packaged official signer. Only the extension's `ui.html` can access privileged UI messages. Confirmation requests have background-generated UUIDs and are bound to their extension window; website fields claiming an origin are ignored.

Connection grants identify origin, owner and genesis and disclose accounts only. Actual signing repeats live-document/permission/account/epoch/network/nonce/sequence/ticket checks. A rejected, expired or consumed request cannot authorize another operation. Top-frame-only injection is reinforced by checking browser sender frame ID. Same-origin hostile script can manipulate its own public page/provider responses, but cannot approve a privileged request or obtain signing material.

Chrome runs an MV3 module service worker. Firefox runs its supported MV3 module background scripts with an event-page lifecycle, not a service worker. Both execute the same controller. All executable JS and WASM are in the installation package; no remote code, eval, dynamically generated function, analytics or crash-report integration is enabled. CSP permits packaged WASM compilation, not generic JavaScript eval.

## Vault and recovery

Vault v2 uses Web Crypto AES-256-GCM with fresh random 16-byte salt and 12-byte IV. PBKDF2-HMAC-SHA256 has 600,000 iterations. The choice provides a built-in, reviewable cross-browser implementation without another WASM cryptographic dependency; it is not a claim that PBKDF2 is memory-hard or superior to Argon2id. Passwords require 6–256 characters. Authenticated metadata binds version, genesis, scheme, path, owner and address. Legacy v1 decryption uses its original 310,000 iterations and exact metadata ordering. Restored mnemonics are rederived and compared to the authenticated identity before migration.

The password is not persisted. `storage.local` contains encrypted vault data and public manifests/grants/transaction records; `storage.sync` is never used. Chrome storage access is restricted to trusted contexts where supported. Decrypted UTF-8 bytes are memory-only and wiped at lock. Browser process isolation and JavaScript garbage collection do **not** guarantee zeroization of all string copies or protect against a compromised OS, debugger or malicious privileged extension update.

The legacy scheme remains ML-DSA-87 at `m/44'/189189'/0'/0'/0'`. Changing SDK, glue, derivation or signature schema requires explicit compatibility vectors and migration review. Build fails when the installed official SDK is not 0.3.1. The lockfile binds the dependency tree. No automatic import of web-page secrets occurs.

## Lifecycle, concurrency, and uncertain broadcasts

Unlocking establishes an absolute five-minute deadline. Privileged signing checks the deadline and session epoch at actual use; alarms are only a supplementary cleanup mechanism. Dapp traffic cannot extend the deadline. A terminated background starts locked and never reconstructs an unlocked session from storage. Pending approvals are memory-only and are invalidated on loss of their context.

A mutex serializes transaction preparation/signing for the account. Saved unresolved transactions prevent the next nonce. The wallet computes and persists the signed transaction hash, intent, nonce and mortal validity boundary before network submission. It then persists an uncertain-broadcast state before touching the submission API. Neither restart nor a lost response automatically signs or pays again. Public history reconciles against the configured service. The wallet does not treat a lost reply as proof of submission failure. A never-broadcast record can be cancelled safely; an ambiguous record needs observed finality or validity expiry before a new operation. This conservative design favors blocking over duplicate payment.

## Explicit trust model

The extension still trusts the configured full node for consensus and runtime execution.
Displayed balances, metadata, history and fee estimates rely on the configured API and remain
unsigned/provisional. It does not run an independent full node, indexer or light client inside the browser.

Development **purchases** and **progressive lot mints** additionally require QPA1 agreement from
every compiled witness operator. A lot mint uses a tip attestation: both witnesses sign the state at
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
The extension background owns the random challenge, fixed aggregation endpoint, public trust pins
and IndexedDB high-water cursor. It verifies signatures, network/activation/rules/runtime, bounded
lifetime, same finalized snapshot, rollback/equivocation rules and exact purchase bytes before
using the signing key. After waiting it repeats cancellation, account, permission, session epoch
and deadline checks. Trust pins are not accepted from page messages, storage or API responses.
A development package without a compiled policy refuses purchases and lot mints. Mainnet and switchable builds reject a policy and disable both pending mainnet witness validation. Missing/divergent/invalid attestations never
fall back to the unsigned view or an ordinary QTC payment.

Witnesses are attestations by configured operators, not a proof of honest computation. Witness operators remain dependent on their full nodes, metadata and rules; collusion or
compromise of all trusted signers can lie. An authentic state digest alone is not a consensus state
proof. A malicious privileged extension update can replace this entire verification boundary.
Trust-key rotation and revocation require a reviewed rebuilt wallet and trusted update distribution.
Old clients do not learn new revocations automatically. Post-quantum transaction and witness signatures
do not make browser-store or update authentication post-quantum.

Fee quotes are estimates tied to the runtime and review block, not a signed fee cap. The confirmation separates native network fee, non-refundable native charge, refundable native deposit and the Qlyphs fee. The Qlyphs fee is the QLYP-v1 protocol fee (1 QTC per deploy, 0.01 QTC per mint, 0.1 to 0.5 QTC (v1) or 0.01 to 0.44 QTC (v2) per progressive lot by its number, 0.1 QTC per inscription, 1% of the price on a purchase, rounded up), a protocol constant rather than a configurable value: it is paid only to the fixed Qlyphs fee account defined in the shared protocol code, a call carrying any other fee amount or recipient is invalid under the protocol, and the wallet recomputes the fee itself and refuses to sign when the service quotes a different amount.

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
