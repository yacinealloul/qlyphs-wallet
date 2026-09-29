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
names/envelopes remain supported. `capabilities` and `state` are additive. Old providers
without protocolVersion/events work with explicit SDK `refresh` calls; they are not
claimed to provide events or reliable cancellation. Do not branch on error text.

`qlyphs:initialized` announces delayed injection. Discovery does not connect a site.
`capabilities` describes method/event support, the selected network and cancellation;
arbitrary RPC and persistent signing are explicitly false.

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

`createKeysProvider` opens or reuses a popup on `connect`, `requestTransaction` or `disconnect` and
can reopen after closure. `openKeysProvider` opens immediately; closure ends its interactive session
and clears its in-memory accounts, but preserves the saved cache for a later provider. Both require
user gestures for opening popups. Closure rejects pending requests without replaying writes. A
forwarded transaction whose result is lost retains an unknown outcome.

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
`sendQtc`, `deploy`, `mint`, `transfer`, `pair`, `sell`, `buy`, `cancel`, `inscribe` from
[`packages/native/src/commands.ts`](../../packages/native/src/commands.ts). No second dapp encoder is required.

Every write requires a separate private confirmation, canonical-byte reconstruction,
real fee/deposit estimate and live document/origin/account/network/epoch/runtime/nonce/
sequence/ticket checks. Development purchases require compiled PQ trust pins and fail-closed
attestation checks. Mainnet and switchable builds currently reject witness policies and refuse purchases. No signRaw, arbitrary bytes, caller RPC, permanent signing grant,
fee other than the fixed QLYP-v1 Qlyphs fee, automatic payment retry or mainnet activation is exposed.

## Lifecycle, limits and cancellation

Browser-supplied origin/tab/top-frame/live document and port bindings remain mandatory;
page-supplied identity/origin claims do not replace them. Navigation, pagehide, lock,
revocation, account changes, lost ports and stale confirmation windows invalidate
pending approvals. BFCache pageshow or reload creates a fresh read channel. A worker
restart always begins locked and pending approvals are never restored from storage.

For the injected extension provider, port loss clears public identity and rejects pending requests. The relay attempts one
read-only recovery, and later focus/read/pageshow may reopen it; it never replays a
connection prompt, signing request or payment. No background keepalive loop extends an
unlock session. Normal browser worker suspension is expected, not bypassed.

Limits remain 8 KiB per request, 8 outstanding requests, per-document rate limiting,
120-second privileged approval lifetime and at most 135 seconds for the public request.
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
A definite refusal before signing may say not-submitted; a lost reply must not.
`VERIFICATION_FAILED` can represent a private runtime/fee/PQ/setup check without
revealing its internals; inspect the extension's private visible state.

For follow-up inspect transaction status and the configured explorer for the selected network. Inclusion,
native success, protocol acceptance, finalized settlement and uncertain outcomes remain
separate. Existing persisted uncertain records continue to block unsafe fresh nonces.

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
`https://otc.qlyphs.com`; development defaults to the API origin, `http://127.0.0.1:4400`, ports
4401–4403 on `127.0.0.1`, `http://localhost:3001`, `http://127.0.0.1:3001`, and its demo at
`http://localhost:4411`. Inspect `BUILD.json` for the exact origins of an installed build.

Applications must check the returned network and genesis against their intended deployment before
requesting a transaction. A dapp cannot switch networks, replace pins or enable mainnet purchases.
