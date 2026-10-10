# Qlyphs provider: v1 compatibility, additive protocol v2

`window.qlyphs` is a Qlyphs-owned interface, not an official Quantus API
or an established wallet standard. The immutable property is injected only into
compiled allowed origins and top-level documents: loopback HTTP on development, public HTTPS on mainnet. Private browser-owned
extension UI and background code remain the signing boundary. A web page cannot
authenticate the provider against hostile scripts executing in that same page.

## Public contract and compatibility

```ts
interface QlyphsProvider {
  readonly version: 1; // preserved for existing `version === 1` clients
  readonly protocolVersion?: 2;
  request(input: { method: string; params?: unknown }, options?: {
    signal?: AbortSignal; timeoutMs?: number;
  }): Promise<unknown>;
  on?<E extends WalletEvent>(event: E, listener: WalletListener<E>): () => void;
  removeListener?<E extends WalletEvent>(event: E, listener: WalletListener<E>): void;
}
```

Canonical types and errors are in [`@qlyphs/provider`](../../packages/provider/README.md).
The web wallet exposes the same interface through [`createKeysProvider` and `openKeysProvider`](../../apps/keys/README.md#for-dapps), with the cached-state behavior described below.
The original `connect`, `accounts`, `network`, `disconnect`, `requestTransaction`
names/envelopes remain supported. `capabilities` and `state` are additive. `requestMintSession`,
`mintSession`, `stopMintSession` and the `mintSessionChanged` event are additive too, on builds
that can run sessions (see [Mint sessions](#mint-sessions)), mainnet included. Old providers
without protocolVersion/events work with explicit SDK `refresh` calls; they are not
claimed to provide events or reliable cancellation. Do not branch on error text.

`qlyphs:initialized` announces delayed injection. Discovery does not connect a site.
`capabilities` describes method/event support, the selected network and cancellation;
arbitrary RPC and persistent signing are explicitly false. `mintSessions` gives this build's mint
session limits. It is `null` where sessions are unavailable (a build without a witness policy, a pinned runtime
or, on mainnet, the reviewed activation; an extension outside desktop Windows, macOS or Linux; and
Qlyphs Keys in a browser where it does not run them) and absent on wallets older than this feature; test it for
truthiness. A mint session is bounded: one token, a lot count, a Qlyphs fee cap per lot, a cap on
Qlyphs fees and native tickets, a signature count and at most five minutes inside one unlock. It is not persistent signing, which stays false.

For the injected extension provider, `connect` explicitly requests disclosure of the current account for this origin.
An existing compatible grant can return without another connect confirmation, but
never authorizes a signature. `accounts` exposes only the current authorized account,
or `[]` when unapproved, locked, unconfigured or disconnected. Hidden accounts, names,
HD paths, counts, session deadlines and grant lists are never sent. `network` returns
the pinned public manifest (`network: 'development' | 'mainnet'`) or null, never an endpoint-selection mechanism.

The extension’s `state` returns `{ accounts, network, connected }` projected by the privileged controller
for this document, and establishes state delivery. `stateChanged` carries that same
projection. `accountsChanged` and `networkChanged` are emitted for actual projected
changes. `disconnect` emits a generic context-change payload when an existing projected
connection disappears; it does not disclose why a previously unapproved site is locked.
Subscriptions return idempotent cleanup functions, also removable via `removeListener`.
The SDK subscribes before reading state so initial-state/event races fail closed.

In the extension, selecting an unapproved account emits an empty account list, not an implicit grant.
Selecting an already approved account updates its projection. `disconnect` and private
wallet revocation remove the origin's grants across saved account records and invalidate
its pending requests. Another origin remains independently authorized. A failed durable
revocation write returns an error; the live controller fails closed, but the caller must
not claim successful persistence across a subsequent restart.

## Keys popup state

The Keys SDK implements the same methods with a cached public snapshot in the dapp. `accounts`,
`network` and `state` read that snapshot without contacting the wallet. A connected snapshot is saved
in the dapp's local storage for the Keys origin. It may outlive a popup, a page reload or the wallet's
unlock, and may be stale after revocation or a network change. Empty locked-wallet events do not
clear a previously connected snapshot. These are display values, not authentication or signing authority.

`createKeysProvider` opens or reuses a popup on `connect`, `requestTransaction`,
`requestMintSession` or `disconnect` and can reopen after closure. `openKeysProvider` opens
immediately; closure ends its interactive session and clears its in-memory accounts, but preserves
the saved cache for a later provider. Both require user gestures for opening popups. These requests
are sent once the popup page announces itself. A dapp page that reuses a popup it has not seen
announce itself (a page reloaded while the popup stayed open) asks the popup page to announce itself
again, and the provider closes a popup whose page does not announce itself within 30 seconds.
Closure rejects pending requests with `DISCONNECTED`, without replaying writes. Reloading the popup
ends its channel too: once the new page announces itself, the requests its old page held reject
with `CONTEXT_CHANGED` and the other requests go to it; a new page that never announces itself gets
the popup closed, and then they all reject with `DISCONNECTED`. `mintSession` and `stopMintSession`
never wait: until a popup page has announced itself to the provider, they return `null` without
asking the wallet, and the provider passes on no `mintSessionChanged` snapshot. A forwarded
`requestTransaction` or `requestMintSession` whose reply is lost has an unknown outcome; any other
forwarded request whose reply is lost has none. The code says what ended the wait; the outcome says
whether a write may have been sent. `CONTEXT_CHANGED`, `DISCONNECTED`, `TIMEOUT` and `ABORTED` can
each end a forwarded write whose reply was lost, with `outcome: 'unknown'`, so branch on `outcome`,
never on `CONTEXT_CHANGED` or `DISCONNECTED` alone.

A mint session started through Keys is bound to the channel of the popup page: closing or reloading
the popup stops it. A reload or crash of the dapp page does not close that channel. A page that
leaves sends the stop of the running session it knows of, which ends it `cancelled` when the browser
delivers it (see [Lifecycle](#lifecycle-limits-and-cancellation)); a crash sends nothing. Otherwise
the session can keep running until the popup or its wallet window closes or reloads, the wallet locks
or its deadline passes. A `null` read therefore does not prove that no session runs. A reloaded dapp
page reads, follows and stops that session again once one of the requests above reuses the popup and
its page has announced itself.
`createKeysProvider` and `openKeysProvider` accept `network` to describe the keys origin's network
before the wallet reports it.

The wallet still checks the current origin grant, account, network, unlock session and approval before
signing. A received `UNAUTHORIZED` error or state for a different genesis clears the cached connection.
State events describe changes the adapter has observed, not a continuously live view while its popup
is closed. Never treat `connected: true` as evidence that a transaction will be authorized.

Keys `disconnect` clears the dapp cache immediately and attempts wallet revocation in the popup. If
the browser blocks that popup, the method completes local disconnection without proving durable
revocation in the wallet. Applications must distinguish clearing their display from deleting a
wallet-side grant. See [the Keys integration examples](../../apps/keys/README.md#for-dapps).

## Transaction request

```ts
const [account] = await window.qlyphs.request({ method: 'connect' });
const submitted = await window.qlyphs.request({ method: 'requestTransaction', params: {
  owner: account.owner, genesis: account.genesis,
  command: { kind: 'sendQtc', to: recipientAccountIdHex, amount: '100000000000' },
}});
// submitted.hash is extension-computed; status may be broadcast-uncertain.
// This is NOT a claim of inclusion, successful dispatch, QLYP acceptance or finality.
```

The envelope remains exactly `{ owner, genesis, command }`. Base-unit values are decimal
strings (0.1 QTC is 100000000000 base units, 12 decimals). Account IDs are
full 32-byte hexadecimal IDs; assets are full 40-byte IDs, never tickers. Commands are
`sendQtc`, `deploy`, `mint`, `transfer`, `pair`, `sell`, `buy`, `cancel`, `inscribe`,
`deployProgressive`, `deployProgressiveV2` and `mintProgressive` from
[`packages/native/src/commands.ts`](../../packages/native/src/commands.ts). No second dapp encoder is required.
`mintProgressive` is `{ kind, asset, lot, profile? }` with `lot` a JSON integer from 1 to 1000:
the lot the dapp showed its user, and `profile` the lot fee profile it priced it with,
`progressive-1000-v1` (the default) or `progressive-1000-v2`. The wallet signs it only when fresh
attested state names that same lot as the next one of a token on that profile, so a price the dapp
displayed can never turn into another.

Every write requires a private confirmation: one per transaction request, or one per mint session
for a bounded series of lot payments ([below](#mint-sessions)). Each signature still uses
canonical-byte reconstruction, real fee/deposit estimates and live origin/account/network/epoch/
runtime/nonce/sequence/ticket checks; a transaction request and an extension mint session also
require the live requesting document, while a Keys mint session requires the live popup channel.
Purchases, progressive lot mints and mint sessions require compiled PQ trust pins (a witness policy)
and fail-closed attestation checks; a build without a policy, which includes every switchable build,
refuses all three. Mainnet progressive tokens, lot mints and mint sessions start at block 212,250. Where the build has a [fee schedule](PROTOCOL-FEES.md), as every mainnet
build does, `deploy`, `deployProgressive`, `deployProgressiveV2` and `inscribe` also require a
verified tip attestation: their Qlyphs fee is a 25 USD target converted at the attested on-chain
rate (on mainnet below block 212,250, the fixed legacy fee), capped by the wallet's compiled ceiling
(1 QTC), and a blocked symbol (`BTC ETH QLYPHS QTC USDC USDT`) is refused. A mainnet build without
the witness policy refuses these four; `mint` keeps its fixed 0.01 QTC fee. No signRaw,
arbitrary bytes, caller RPC, permanent signing grant, Qlyphs fee other than the one the wallet
computes itself, or mainnet activation is exposed. A payment is never retried automatically, with
one bounded exception inside an approved mint session whose terms allow retries
(`maxAttempts > maxLots`): when a lot payment failed on chain because that lot's right was used
first (a lost race), the wallet may sign one new payment for the lot that attested state then
names, counted against the session's signature limit, at most `maxAttempts - maxLots` times. It never
re-signs or re-broadcasts a payment whose outcome is uncertain.

## Mint sessions

Mainnet and development builds, with the same limits. The Qlyphs Keys adapter offers them on development
builds only for now ([Keys](../../apps/keys/README.md)). A mint session lets a dapp ask for up to N lots of one
progressive token in a single private review. After approval the wallet signs separate lot
payments, one at a time, each built and checked like a single `mintProgressive` lot, until N lots are
in a block, a limit is reached, the user stops it or its context ends.

```ts
const caps = await window.qlyphs.request({ method: 'capabilities' });
if (!caps.mintSessions) throw new Error('This wallet cannot run mint sessions');
const session = await window.qlyphs.request({ method: 'requestMintSession', params: {
  owner: account.owner, genesis: account.genesis,
  terms: {
    asset: assetIdHex,               // full 40-byte asset ID
    profile: 'progressive-1000-v2',
    lotAmount: lotSize,              // token base units per lot, as the dapp displayed it
    maxLots: 10,                     // N: lots in a block before the session completes
    maxAttempts: 15,                 // signatures it may ever produce: here 5 retries after lost races
    maxFeePerLot: '20000000000',     // highest Qlyphs fee of any lot it may pay (0.02 QTC)
    maxSpend: '500000000000',        // cap on Qlyphs fees plus native tickets (0.5 QTC)
    maxDurationSeconds: 300,
  },
}});
// session.state === 'running': approval, not completion. Follow mintSessionChanged.
```

**Parameters.** `requestMintSession` takes exactly `{ owner, genesis, terms }`, and `terms` exactly
the eight keys above: `asset` in lowercase hexadecimal; `profile` only `progressive-1000-v2`;
`lotAmount` a canonical positive decimal; `maxLots` an integer from 1 to 25; `maxAttempts` an
integer from `maxLots` to `maxLots + min(maxLots, 10)`; `maxFeePerLot` a canonical positive decimal
of QTC base units, at most 440000000000 (0.44 QTC, the highest v2 lot fee); `maxSpend` a canonical
positive decimal of QTC base units below 2^128; `maxDurationSeconds` an integer from 30 to 300.
`mintSession` takes no params. `stopMintSession` takes exactly `{ session }`, the session's UUID.
Malformed input is `INVALID_REQUEST`. Before the review opens the wallet also refuses, with
`VERIFICATION_FAILED`, a token that is not on the v2 profile, a lot size other than `lotAmount`, a
next lot priced above `maxFeePerLot`, a `maxSpend` that does not cover one lot, an unresolved
payment of the account and unavailable witnesses or service.

**What the approval binds.** The review shows, and the approval binds, the session ID, the origin,
the account, the genesis, the asset, the v2 profile, the lot size, N, the signature limit, the Qlyphs
fee cap per lot, the protocol spend cap, the duration, and the runtime and witness policy identity.
It also shows the range of lots the fee cap allows, what a lost race does under these terms, the
network fee estimate and the history space the session may use. A changed review cannot be approved.

**Results and observation.** `requestMintSession` resolves when the user approves, with a running
snapshot (all counters 0). It never waits for the session to end. `mintSession` returns the snapshot
of the session created through the same live channel (with the extension, the same document; with
Keys, the same popup page), also after the session ended, while that channel lives and the origin
keeps its grant; anything else gets `null`. `mintSessionChanged` carries that same projection
whenever it changes, only to the creating channel, and `null` when the provider's channel resets
(with Keys, also when the popup closes or reloads).
`stopMintSession` asks the wallet to stop the session if this channel may see it and returns its
snapshot (`stopping` or `ended`) or `null`. It only removes authority: it is idempotent and safe to
retry. A snapshot carries the terms, `state` (`running`, `paused`, `stopping`, `ended`), `end`, the
verified lots in a block and final (`lots`), signatures used, verified lost races and payments in
doubt (`attempts.used`, `attempts.lostRaces`, `attempts.unresolved`), the protocol spend (exact), the
protocol amount that may still be charged, a network fee estimate, the payment the session still
follows (`pending`) and the last one it no longer follows (`last`). It never carries the signing
deadline, account names, other accounts or anything about the wallet window. Counts are provisional
until final.

**Reorganizations and doubt.** `reorganized: true` says that a recorded inclusion left the chain the
wallet reads, or that the wallet's history finalized one of the session's payments otherwise than the
session recorded it. The payments this can affect (every inclusion not yet final, or the contradicted
payment and every later one that may have been sent) are then in doubt, for good: they leave `lots`,
`attempts.lostRaces` and `spent.protocol`; their status reads `unresolved`, and they count in
`attempts.unresolved`, until their history entry is final, then `settled`. The wallet's Activity
gives their result. Their Qlyphs fee and ticket stay in `spent.reserved` until then, clamped so that
`spent.protocol + spent.reserved` never exceeds `maxSpend`, which no chain can. Their network fee
stays in `spent.networkEstimate` until then; once history is final, a payment that never ran counts
nothing there and one that ran counts its estimate, doubted or not. Verified lots outside the doubt
still count, final ones as final. The verdict that admitted each signature is kept and
admission never reads the doubt: a reorganization or the wallet's history never adds a lot, a spend
or a signature; it only moves payments from the verified counts to `unresolved` or `settled`. A
running session that sees a recorded inclusion leave its chain ends (`unverified`) and signs nothing
more.

Every snapshot holds these invariants, which `parseMintSessionSnapshot` checks: `end` is `null` exactly while
`state` is not `ended`; `lots.finalized <= lots.included <= maxLots`; `attempts.used <= maxAttempts`;
`lots.included + attempts.lostRaces + attempts.unresolved <= attempts.used`; `attempts.unresolved` is
0 unless `reorganized`; `spent.protocol + spent.reserved <= maxSpend`; `pending` is `signed`,
`uncertain`, `sent` or `included`, never `unresolved`.

**Chaining.** The wallet signs the next payment only after it proves the previous one's block on the
ancestry of the block the next one is born at, a block both witnesses attest, with the account nonce
past it there, and only when both witnesses attest that the account holds exactly the lots the
session counted. Each lot, its fee and
its right come from a fresh attestation by both witnesses at the wallet node's best block, never from
the dapp or the service.

**Inclusion proofs.** The wallet's node only proposes where a payment sits. Before any outcome uses
that position, the wallet proves it from a block both witnesses attested: every header from that
block down to the inclusion block must hash (Poseidon2, as Quantus does) to the hash its child
names, the inclusion block's body must match its header's extrinsics root exactly, and the payment's
own signed bytes (their blake2_256, the hash the wallet recorded) must be the extrinsic at the
reported index. Walks stop at 512 headers and bodies at the runtime's 5 MiB block limit. Node data
that fails a check ends the session `unverified` and is never retried; a node that does not answer
ends it `unavailable` after the usual retries; neither falls back to the node's word. Still the
node's word, and used only to stop or wait: account nonces and balances, its best and finalized
blocks, canonical hashes (so a lot's `finalized` flag), and where the search for a payment starts.

**Outcomes and the lost-race rule.** Each payment's outcome comes from attested state at the block
that included it, at its proven position. It is minted when the lot's right is anchored at that payment, the minted amount
advanced and the account received one lot. The last lot leaves no right to place its use at the
payment's position, and the wallet does not take its node's word for whose use it was, so a session
never counts the last lot itself: it ends `unverified` with that payment held at its worst case in
`spent.reserved`, and the wallet's history (Activity) gives its result. A payment is a lost race
when the right was used before it, by another buyer's
mint or by a transaction that only used the right, and the account received nothing: it failed on
chain and the user paid its network fee only. `maxAttempts - maxLots` is how many lost races the
session retries: after each, it may sign one new payment for the lot that attested state then names,
counted against `maxAttempts`, and the next lost race ends it with `race-lost`. With `maxAttempts === maxLots` the first lost race ends it. Ask for retries only when
the user chose them. A payment whose broadcast is uncertain pauses the session until the wallet's
node shows it in a block, and ends it once the finalized chain no longer holds its birth block or its
era has ended; it is never re-signed or re-broadcast. Any other failure, and any outcome or chain
state the wallet cannot verify, stops the session.

**Spend.** Qlyphs fees and native tickets are capped exactly by `maxFeePerLot` and `maxSpend`: the
fees come from attested state and the native ticket charge is pinned for the runtime. The caps also
hold when the wallet's node misreports blocks: such a node can stop a session, never make it exceed
N lots or `maxSpend`. Network fees are estimates and are not part of the cap; each lost race also
costs one. Other buyers can move the next lot during the review and the session, so a session may pay
for later lots than the review showed first, but never for one priced above `maxFeePerLot`.

**Stop.** Stop ends signing at once. It cannot cancel a payment already sent: that payment stays valid
until its era ends, 256 blocks after the block it was born at, and can still be included after the
session ended. The session counts it in `lots.included` only if the wallet classifies it while it
still follows the session's payments, which it does for a limited time after the end and not across
a wallet restart (including a suspended extension worker), update, reset or network switch; otherwise
Activity shows its outcome. After a session ends, each of its payments that may have been sent keeps
blocking the account under the uncertain-record rule until history shows it final or expired,
whatever the session recorded for it.

**What ends a session.** Stop in the wallet; `stopMintSession`; closing or reloading the wallet
window; locking; switching or adding accounts; revoking or disconnecting the site; a wallet restart or
update; the deadline; any limit; and the loss of the creating channel. With the extension that is any
URL change of the dapp tab, including in-app navigation (`history.pushState`, hash changes), or
closing the tab. With Keys it is closing or reloading the popup, or closing the dapp tab; leaving or
reloading the dapp page sends a `stopMintSession` instead, which takes effect only when the browser
delivers it (see [Lifecycle](#lifecycle-limits-and-cancellation)). A session
never resumes: after any end, including a restart, a new review is required. A dapp must not start
another session automatically.

**End values.** `end` is `null` until `state` is `ended`, then one of: `completed` (N lots in a
block), `stopped` (ended in the wallet, including closing its window), `cancelled`
(`stopMintSession`), `deadline`, `locked`, `context-changed` (account, network, reset, revocation,
restart, update or channel loss), `race-lost` (one lost race more than the retries), `attempt-limit`,
`spend-limit`, `fee-limit` (the next lot costs more than `maxFeePerLot`), `sold-out`, `failed`,
`unverified` (an outcome, balance, nonce, block, reorganization or signing context the wallet could
not verify), `insufficient-funds` and `unavailable`. When several limits hold at once, the end is the
first of `completed`, `sold-out`, `race-lost`, `attempt-limit`, then the deadline (`deadline`, or
`locked` when the unlock deadline came first). These values never name the wallet window or which
context changed.

**Limits.** N is at most 25, signatures at most `N + min(N, 10)`, and the duration 30 to 300 seconds.
The signing deadline is the earlier of the approved duration and the absolute five-minute unlock
deadline, fixed at approval; nothing extends it, and approval is refused when less than 30 seconds of
it remain. History must have room for `maxLots + maxAttempts` entries. While a session runs it holds
the wallet: other requests get `BUSY`, and only one session runs at a time.

**Availability.** `capabilities().mintSessions` is truthy only on builds that can run sessions:
a compiled witness policy, a runtime whose ticket charge the wallet pins (the development runtime and
Quantus mainnet runtime 153), on mainnet the reviewed progressive activation, and for the extension
a desktop system (Windows, macOS or Linux, from `runtime.getPlatformInfo()`; Firefox for Android and
ChromeOS are refused). Where it is `null`
the methods and event are not listed and `requestMintSession` fails with `UNSUPPORTED_METHOD`,
`outcome: 'not-submitted'`. Older wallets omit the field and refuse the unknown method before
signing (`UNSUPPORTED_METHOD` or `INVALID_REQUEST`, also not submitted). The Keys adapter always
answers `capabilities` in the dapp, from a network (the one the wallet last reported, else the
declared one, else the one assumed for the keys origin), never from the deployment itself: there a
truthy value is a hint, and a Keys deployment that cannot run sessions (for example one built without
a witness policy, or older than the SDK) still refuses (`not-submitted`). Keys runs sessions only in
desktop Chromium-family browsers and desktop Firefox on Windows, macOS or Linux, with its wallet
worker in a `SharedWorker`: elsewhere (Safari and every iOS browser, mobile browsers, VR browsers,
ChromeOS, the dedicated-worker fallback) the wallet reports `mintSessions: null` and refuses
`requestMintSession` with `UNSUPPORTED_METHOD`, `not-submitted`. Android browsers are refused even
when they present a desktop identity (Chrome on Android XR or desktop Android devices, "Desktop
site"). ChromeOS is refused for now because Chrome on desktop Android reports the same signals, and
only asynchronous client hints could tell them apart. The gate requires the user agent string,
`navigator.platform` and, in Chromium, `navigator.userAgentData` to name the same desktop system,
and refuses any disagreement. The adapter reads the same signals for the dapp page and reports `null`
in such a browser, so a page in a per-tab desktop mode gets `null` like the wallet. Only an override
that also replaces `navigator.platform`, such as developer tools emulation, can make the two differ;
the wallet then still refuses with `UNSUPPORTED_METHOD`, `not-submitted`. A Chromium page without
`userAgentData`, such as an insecure non-loopback `http` page, is refused too. No mainnet build runs
mint sessions.

**Errors.** The wallet refuses a session only before it starts, and its refusals are
`not-submitted`: invalid terms, unauthorized account, unavailable, busy, verification failure,
rejection, expiry or a context change. Closing the wallet window, or reloading it after approving,
before the session starts is such a context change. An abort, timeout or channel loss after the
request was forwarded is `outcome: 'unknown'`: a session may have been approved and may have signed
payments before it stopped. Check the wallet window and Activity, and do not start another session
automatically. Once sent, `mintSession` and `stopMintSession` fail with no outcome, whatever the
reply says; the provider's own refusals before sending say `not-submitted`, as for every method (see
[Stable errors](#stable-errors)).

## Lifecycle, limits and cancellation

Browser-supplied origin/tab/top-frame/live document and port bindings remain mandatory;
page-supplied identity/origin claims do not replace them. Navigation, pagehide, lock,
revocation, account changes, lost ports and stale confirmation windows invalidate
pending approvals. BFCache pageshow or reload creates a fresh read channel. A worker
restart always begins locked and pending approvals are never restored from storage.

For the injected extension provider, port loss clears public identity and rejects pending requests. The relay attempts one
read-only recovery, and later focus/read/pageshow may reopen it; it never replays a
connection prompt, signing request or payment. No background keepalive loop extends an
unlock session. A mint session's wallet window polls the wallet about once a second while it is
open. This keeps the session running only as long as the window, never extends the unlock deadline,
and signing stops within ten seconds of the polls stopping. After the end, the window polls every
4 seconds, for at most 30 minutes, while a payment's outcome can still change. Normal browser worker
suspension is expected, not bypassed.

The Keys web provider cancels pending requests on dapp `pagehide`, including
navigation into BFCache. It sends best-effort cancellation for outstanding forwarded
requests, clears its queue and does not replay them after restoration. A reusable
`createKeysProvider` can reopen only for a new explicit request; the eager
`openKeysProvider` ends and requires a new instance. The wallet window remains open
because a dispatched transaction may already be submitting; its outcome stays
uncertain until checked. If a mint session the page knows of is running, Keys also
posts `stopMintSession` for it to the popup on `pagehide`. When the page reloads or navigates,
Chromium and Firefox deliver that message once the page has gone, without a source window, so
the popup cannot check that its opener sent it. It accepts this one anyway, because a stop
only removes authority: only from the dapp origin it serves, while its own page is active and
its opener is a top-level window, only as exactly `{ id, method: 'stopMintSession', params:
{ session } }` for the session its wallet channel runs, within the 8 KiB limit, and once per
session. It passes it on to the wallet under an id of its own and answers nothing; the session
ends `cancelled`. The popup ignores every other message without a source, cancellations
included. Delivery is not guaranteed: a crashed page sends nothing, and a browser may drop a
message posted from `pagehide`. The session then stays bound to the popup (see
[Mint sessions](#mint-sessions)).

Limits remain 8 KiB per request, 8 outstanding requests, per-document rate limiting,
and a 120-second privileged approval lifetime. Public requests default to and accept
at most 135 seconds, except `connect`, whose `timeoutMs` may be up to 600,000 ms to
allow wallet setup before approval. The extension provider still defaults to 135
seconds; the Keys web provider defaults to ten minutes for `connect`. This additional
setup time never extends an approval after it has opened. The SDK caps discovery at
three seconds and the public-state refresh after connection at 135 seconds.
`requestMintSession` keeps the 135-second maximum: it resolves when the session is approved.
The memory-only unlock lifetime remains an absolute five minutes. Applications cannot
extend it. Abort/timeout sends a best-effort cancellation bound to the original live
document request. It can invalidate an unapproved request but cannot roll back a
signature or transaction already in progress. Writes stopped after dispatch therefore
have `outcome: 'unknown'`; preserve history and do not retry automatically.

## Stable errors

Errors are Error-compatible and expose `code`, sanitized `message`, and optional
`outcome: 'not-submitted' | 'unknown'`. Codes: `USER_REJECTED`, `UNAUTHORIZED`,
`INVALID_REQUEST`, `UNSUPPORTED_METHOD`, `BUSY`, `CONTEXT_CHANGED`, `DISCONNECTED`,
`TIMEOUT`, `ABORTED`, `VERIFICATION_FAILED`, `UNAVAILABLE`, `INVALID_RESPONSE`,
`NETWORK_MISMATCH`. Privileged details, secrets and raw exception stacks are not returned.
A definite refusal before signing may say not-submitted; a lost reply must not. The provider's own
refusals before it sends a request (an unsupported method, an invalid `timeoutMs`, an abort before
dispatch, too many pending requests or an oversized request) say `not-submitted` for every method,
session reads included.
`VERIFICATION_FAILED` can represent a private runtime/fee/PQ/setup check without
revealing its internals; inspect the extension's private visible state. Mint sessions add no
error code: why a session ended is the closed `end` value of its snapshot.

For follow-up inspect transaction status and the configured explorer for the selected network. Inclusion,
native success, protocol acceptance, finalized settlement and uncertain outcomes remain
separate. Existing persisted uncertain records continue to block unsafe fresh nonces,
including after a mint session ends.

## Network and origin configuration

The extension's default provider origins are:

| Build | Exact allowed origins |
| --- | --- |
| Development | the compiled API origin (default `http://127.0.0.1:4400`), `http://127.0.0.1:4401`, `http://127.0.0.1:4402`, `http://127.0.0.1:4403`, `http://localhost:3001`, `http://localhost:3101` |
| Mainnet | `https://app.qlyphs.com`, `https://otc.qlyphs.com` |
| Switchable | both sets; only the selected network's origins may connect |

`QLYPHS_EXTENSION_DAPP_ORIGINS` accepts 1–16 distinct exact origins at build time: loopback HTTP in
development, public HTTPS on mainnet. A switchable build refuses endpoint and origin overrides.
Content and controller both enforce exact origin/port checks because browser match patterns cannot
restrict ports. The allowlist only permits requesting connection; each origin must still receive its
own explicit account grant. RPC/API/PQ targets remain fixed separately.

Qlyphs Keys has its own allowlist (`QLYPHS_KEYS_DAPP_ORIGINS`): production defaults to
`https://app.qlyphs.com` and `https://otc.qlyphs.com`; development defaults to the API origin, `http://127.0.0.1:4400`, ports
4401–4403 on `127.0.0.1`, `http://localhost:3001`, `http://127.0.0.1:3001`, and its demo at
`http://localhost:4411`. Inspect `BUILD.json` for the exact origins of an installed build.

Applications must check the returned network and genesis against their intended deployment before
requesting a transaction. A dapp cannot switch networks, replace pins or supply a witness policy.
