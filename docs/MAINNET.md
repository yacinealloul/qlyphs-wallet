# Wallet mainnet pins and limits

Qlyphs Wallet and Qlyphs Keys support Quantus mainnet only when the build includes reviewed pins.
Production Keys builds require mainnet. Development builds target local chains. The pins identify a
network and protocol activation anchor; they are not a claim that a deployed service is available or
that the live chain still runs the same runtime.

## Build with the committed pins

From the repository root, after `pnpm install --frozen-lockfile`:

```sh
QLYPHS_EXTENSION_NETWORK=mainnet QLYPHS_EXTENSION_PINS="$PWD/deploy/mainnet/pins.json" \
NATIVE_PQ_POLICY_FILE="$PWD/deploy/mainnet/witness-policy.json" \
  pnpm --filter @qotc/wallet-extension build
QLYPHS_KEYS_PROFILE=production QLYPHS_KEYS_PINS="$PWD/deploy/mainnet/pins.json" \
NATIVE_PQ_POLICY_FILE="$PWD/deploy/mainnet/witness-policy.json" \
  pnpm --filter @qlyphs/keys build
```

The production Keys build checks CORS access from `https://keys.qlyphs.com` to its configured services
and needs network access. For release reproduction, use the [Keys Docker procedure](../apps/keys/README.md#2-rebuild-it-yourself-docker).

[`deploy/mainnet/pins.json`](../deploy/mainnet/pins.json) contains:

| Field | Meaning |
| --- | --- |
| `genesis` | exact Quantus mainnet genesis hash |
| `runtime.specVersion` | runtime specification version |
| `runtime.transactionVersion` | transaction version |
| `runtime.codeHash` | runtime code fingerprint |
| `activation.height`, `activation.hash` | finalized anchor immediately before QLYP processing starts |

The activation anchor itself is excluded: the first interpreted block is `activation.height + 1`.
Mainnet profiles require the known mainnet genesis and an activation height after genesis. The
wallet checks its pinned network and runtime before signing; a runtime change requires reviewed pins
and a rebuilt release. Do not substitute unreviewed values merely to bypass a mismatch.

Default mainnet endpoints are `https://indexer.qlyphs.com` for public asset data,
`https://rpc1-mainnet.quantus.com` for RPC, and `https://qlyphs.com/explorer` for external explorer
links. Endpoint overrides change the build bytes and must be reviewed with the pins. The wallet
trusts the configured services for public views; it does not run a full node or a consensus light client.

## Witness policy, fees and identity limits

[`deploy/mainnet/witness-policy.json`](../deploy/mainnet/witness-policy.json) is the reviewed mainnet
witness policy: the public keys of the two witnesses, bound to the pins and to the mainnet rules of
this release (`rulesHash`). A mainnet build accepts `NATIVE_PQ_POLICY_FILE` only when the policy
matches both; switchable builds reject it. With the policy, a token purchase needs attestations from
both witnesses, at any height. A mainnet build without it refuses purchases, progressive lot mints,
token creation and inscriptions. Mint sessions run on mainnet with the same limits as on
development builds, only in builds with the witness policy and the reviewed activation.

The [fee schedule](extension/PROTOCOL-FEES.md) and progressive-1000-v2 run on mainnet from block
212,250: progressive tokens and their lot mints start there. Earlier wallet releases refuse every
rate-derived operation (token creation, progressive token creation and inscriptions) on mainnet
("Qlyphs fees are not active on mainnet yet."). The current wallet signs token creation and
inscriptions only from a verified tip attestation from both witnesses, at every height: below block
212,250 at the fixed legacy fees (1 QTC per creation, 0.1 QTC per inscription), from it at the fee
converted at the attested on-chain rate. Until block 212,250 the protocol reads such an operation
from any client at those legacy fees, as before the fee schedule. For the schedule's grace window after that height it still
reads one signed before it with a mortal era within the bounds of the fee schedule, section 6.3.
After the grace window the legacy amount is no longer accepted as a transition amount: it remains
accepted only if it equals an amount allowed by the current or previous grid; otherwise the
operation is rejected and its fee kept. Minting keeps its fixed 0.01 QTC fee and needs no rate, and is possible
only once a token exists. QTC sends and ordinary token transfers are
unchanged; their normal network and review checks still apply.

Accounts use ML-DSA-87 with the pinned SDK and derivation `m/44'/189189'/account'/0'/0'`. Importing the
same phrase into a wallet that uses another scheme or derivation path may produce another address.
Verify the address before transferring assets.

Switchable local builds separate network state, but their explicit carry action can reuse the same
phrases and addresses from development on mainnet. They do not guarantee independent keys between
networks. See [switching networks](../apps/extension/README.md#switching-between-mainnet-and-development)
and the [security model](extension/SECURITY.md).
