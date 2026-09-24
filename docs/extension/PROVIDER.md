# Qlyphs provider: v1 compatibility, additive protocol v2

`window.qlyphs` is a Qlyphs-owned development interface, not an official Quantus API
or an established wallet standard. The immutable property is injected only into
compiled allowed loopback origins and top-level documents. Private browser-owned
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

Canonical types and errors are in `@qlyphs/provider`. Integrations should use
`@qlyphs/sdk`, which validates responses and offers typed methods.
The original `connect`, `accounts`, `network`, `disconnect`, `requestTransaction`
names/envelopes remain supported. `capabilities` and `state` are additive. Old providers
without protocolVersion/events work with explicit SDK `refresh` calls; they are not
claimed to provide events or reliable cancellation. Do not branch on error text.

`qlyphs:initialized` announces delayed injection. Discovery does not connect a site.
`capabilities` describes method/event support, development network and cancellation;
arbitrary RPC and persistent signing are explicitly false.

`connect` explicitly requests disclosure of the current account for this origin.
An existing compatible grant can return without another connect confirmation, but
never authorizes a signature. `accounts` exposes only the current authorized account,
or `[]` when unapproved, locked, unconfigured or disconnected. Hidden accounts, names,
HD paths, counts, session deadlines and grant lists are never sent. `network` returns
the pinned public development manifest or null, never an endpoint-selection mechanism.

`state` returns `{ accounts, network, connected }` projected by the privileged controller
for this document, and establishes state delivery. `stateChanged` carries that same
projection. `accountsChanged` and `networkChanged` are emitted for actual projected
changes. `disconnect` emits a generic context-change payload when an existing projected
connection disappears; it does not disclose why a previously unapproved site is locked.
Subscriptions return idempotent cleanup functions, also removable via `removeListener`.
The SDK subscribes before reading state so initial-state/event races fail closed.

Selecting an unapproved account emits an empty account list, not an implicit grant.
Selecting an already approved account updates its projection. `disconnect` and private
wallet revocation remove the origin's grants across saved account records and invalidate
its pending requests. Another origin remains independently authorized. A failed durable
revocation write returns an error; the live controller fails closed, but the caller must
not claim successful persistence across a subsequent restart.

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
strings (0.1 development QTC is 100000000000 base units, 12 decimals). Account IDs are
full 32-byte hexadecimal IDs; assets are full 40-byte IDs, never tickers. Commands are
`sendQtc`, `deploy`, `mint`, `transfer`, `pair`, `sell`, `buy`, `cancel` from
`packages/native/src/commands.ts`; the former `apps/native/src/commands.ts` re-exports
that implementation for compatibility. No second dapp encoder is required.

Every write requires a separate private confirmation, canonical-byte reconstruction,
real fee/deposit estimate and live document/origin/account/network/epoch/runtime/nonce/
sequence/ticket checks. Purchases preserve compiled PQ trust pins and fail-closed
attestation checks. No signRaw, arbitrary bytes, caller RPC, permanent signing grant,
fee other than the fixed QLYP-v1 Qlyphs fee, automatic payment retry or mainnet activation is exposed.

## Lifecycle, limits and cancellation

Browser-supplied origin/tab/top-frame/live document and port bindings remain mandatory;
page-supplied identity/origin claims do not replace them. Navigation, pagehide, lock,
revocation, account changes, lost ports and stale confirmation windows invalidate
pending approvals. BFCache pageshow or reload creates a fresh read channel. A worker
restart always begins locked and pending approvals are never restored from storage.

Port loss clears public identity and rejects pending requests. The relay attempts one
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

For follow-up use SDK read-only tracking and development explorer links. Inclusion,
native success, protocol acceptance, finalized settlement and uncertain outcomes remain
separate. Existing persisted uncertain records continue to block unsafe fresh nonces.

## Development origin configuration

Default injection origins are native port 4400 and example ports 4401/4402 on 127.0.0.1.
`QLYPHS_EXTENSION_DAPP_ORIGINS` accepts 1–16 distinct exact loopback HTTP origins at
build time; custom API origin behavior follows `apps/extension/build.mjs`. Content and
controller both enforce exact origin/port checks because browser match patterns cannot
restrict ports. The allowlist only permits requesting connection; each origin must
still receive its own explicit account grant. RPC/API/PQ targets remain fixed separately.
No remote host, store publication or public deployment is part of this interface change.
