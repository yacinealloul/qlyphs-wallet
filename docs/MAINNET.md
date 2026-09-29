# Wallet mainnet pins and limits

Qlyphs Wallet and Qlyphs Keys support Quantus mainnet only when the build includes reviewed pins.
Production Keys builds require mainnet. Development builds target local chains. The pins identify a
network and protocol activation anchor; they are not a claim that a deployed service is available or
that the live chain still runs the same runtime.

## Build with the committed pins

From the repository root, after `pnpm install --frozen-lockfile`:

```sh
QLYPHS_EXTENSION_NETWORK=mainnet QLYPHS_EXTENSION_PINS="$PWD/deploy/mainnet/pins.json" \
  pnpm --filter @qotc/wallet-extension build
QLYPHS_KEYS_PROFILE=production QLYPHS_KEYS_PINS="$PWD/deploy/mainnet/pins.json" \
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

Default mainnet endpoints are `https://app.qlyphs.com` for public asset data,
`https://rpc1-mainnet.quantus.com` for RPC, and `https://qlyphs.com/explorer` for external explorer
links. Endpoint overrides change the build bytes and must be reviewed with the pins. The wallet
trusts the configured services for public views; it does not run a full node or a consensus light client.

## Purchase and identity limits

Mainnet and switchable builds reject `NATIVE_PQ_POLICY_FILE` and refuse token purchases. Witness
verification has not been validated for mainnet. QTC sends, token creation, minting, inscriptions and
ordinary token transfers do not use the purchase policy; their normal network and review checks
still apply.

Accounts use ML-DSA-87 with the pinned SDK and derivation `m/44'/189189'/account'/0'/0'`. Importing the
same phrase into a wallet that uses another scheme or derivation path may produce another address.
Verify the address before transferring assets.

Switchable local builds separate network state, but their explicit carry action can reuse the same
phrases and addresses from development on mainnet. They do not guarantee independent keys between
networks. See [switching networks](../apps/extension/README.md#switching-between-mainnet-and-development)
and the [security model](extension/SECURITY.md).
