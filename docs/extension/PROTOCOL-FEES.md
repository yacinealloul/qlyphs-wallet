# QLYP fee schedule (fees-1)

This is the public specification of the QLYP-v1 fee schedule, version fees-1: how the Qlyphs fees of
token creation and inscriptions are priced, who can change the price, within which bounds and with
how much notice, and what a wallet checks before it signs. It is implemented in
[`packages/native/src/fee-schedule.ts`](../../packages/native/src/fee-schedule.ts) and
[`packages/native/src/tickers.ts`](../../packages/native/src/tickers.ts), and read by every QLYP
indexer and witness. The key words MUST, MUST NOT and SHOULD are normative.

**Status.** Implemented in code. The activation release sets the mainnet schedule from block 188,500,
the same height as the progressive-1000-v2 activation. Below that height mainnet
reads deploys and inscriptions at the fixed legacy fees exactly as before (section 5.5), and Qlyphs
wallets refuse to sign them.

## 1. Summary

- **One price on chain.** `rate` is the number of QTC base units (10^-12 QTC) worth 1 USD. At
  100 USD per QTC, `rate = 10_000_000_000`.
- **Everything else is code.** The USD targets, the existential-deposit floor, the rate bounds and
  the list of blocked tickers are compiled constants, bound into the witnesses' rules fingerprint
  (`rulesHash`). No key can change them; a change is a rules release.
- **Rate-derived fees.** Creating a token (tags 0, 11 and 12) and inscribing a Quark (tag 9) each
  cost a 25 USD target, converted at the on-chain rate. Every allowed symbol costs the same,
  whatever its length. Six symbols are blocked and cannot be deployed.
- **MINT is fixed.** A plain MINT (tag 1) keeps its fixed fee of 0.01 QTC (`MINT_FEE`) and the
  exact-fee rule at every height, on every network and at every rate. It needs no rate.
- **Two governance tags.** Tag 13 FEE_RATE (operator) and tag 14 FEE_ADMIN (guardian; CANCEL and
  FREEZE also by a sentinel, CANCEL also by the operator), each a direct `remark_with_event` from a
  pinned Quantus account, authenticated by its native ML-DSA-87 extrinsic signature. Tag 15 is
  reserved.
- **Public notice and a bounded step.** A new rate applies at least `delay` blocks after it is
  posted, and moves by at most ×5/4 or ×4/5 per change.
- **No fee lost to a rate change.** At most two rates are acceptable at any height: the current one
  and, for `grace` blocks after a change, the previous one. A wallet that prices at an attested block
  and gives its transaction era a birth at that same block never loses its fee to a rate change
  (section 8).
- **Unchanged:** the MINT fee, the 1% sale fee and OFFER, progressive lot fees (fixed QTC amounts
  per profile), mint sessions and their per-lot fee bound, TRANSFER, the Qlyphs fee account and the
  shape of the fee batch. User payloads (tags 0, 1, 9, 11 and 12) are byte for byte unchanged.

## 2. Units, constants and the fee formula

QTC has 12 decimals. Constants are identical on every network.

| Name | Value | Meaning |
|---|---|---|
| `ED` | `1_000_000_000` | 0.001 QTC, the Quantus existential deposit; the minimum of every rate-derived fee |
| `RATE_MIN` | `200_000_000` (2e8) | QTC = 5,000 USD |
| `RATE_MAX` | `200_000_000_000` (2e11) | QTC = 5 USD |
| `STEP_NUM / STEP_DEN` | `5 / 4` | a new rate is within ×4/5 .. ×5/4 of the current one |
| `LEGACY_DEPLOY_FEE` | `1_000_000_000_000` | 1 QTC; DEPLOY without a schedule, before it and in its legacy window (section 5.3) |
| `LEGACY_INSCRIBE_FEE` | `100_000_000_000` | 0.1 QTC; INSCRIBE in the same cases |
| `MINT_FEE` | `10_000_000_000` | 0.01 QTC; the fixed MINT fee, unchanged by fees-1 |

USD targets of the rate-derived fees, in US cents (`FEE_TARGETS_CENTS`):

| Class | Cents | Target |
|---|---|---|
| DEPLOY, any allowed symbol (1 to 12 characters) | `2_500` | 25 USD, flat |
| INSCRIBE (Quark) | `2_500` | 25 USD, flat; content size and type do not change it |

"DEPLOY" means tags 0 (DEPLOY), 11 (PROGRESSIVE DEPLOY) and 12 (PROGRESSIVE DEPLOY V2), and any later
tag that claims a symbol in the shared namespace. MINT has no USD target.

### 2.1 Rate canonicity

`checkRate(r)` holds when:

1. `r` is an integer and `RATE_MIN ≤ r ≤ RATE_MAX`;
2. `r` has at most 3 significant decimal digits: with `d` the number of decimal digits of `r`,
   `r mod 10^(d − 3) = 0`.

Since `r ≥ 2e8` has at least 9 digits, `r` is a multiple of `10^6`, so every fee below is an exact
integer and no implementation can round differently. `10_000_000_000` and `12_300_000_000` are
canonical; `12_340_000_000` is not.

### 2.2 Fee

```
isFeeBearing(kind)  := kind ∈ {deploy, mint, inscribe, deployProgressive, deployProgressiveV2}
isRateDerived(kind) := kind ∈ {deploy, inscribe, deployProgressive, deployProgressiveV2}

centsFor(op):                                    // rate-derived kinds only
  op claims a symbol s:  s ∈ BLOCKED → error 'symbol blocked';  otherwise → 2_500
  inscribe            →  2_500

fee(op, rate)   := max(ED, centsFor(op) * rate / 100)              // exact integer
legacyFee(kind) := LEGACY_DEPLOY_FEE | LEGACY_INSCRIBE_FEE         // rate-derived kinds only
mint fee        := MINT_FEE                                        // every height, every rate
```

| Class | `RATE_MIN` 2e8 (QTC = 5,000 USD) | 1e10 (QTC = 100 USD) | `RATE_MAX` 2e11 (QTC = 5 USD) |
|---|---|---|---|
| DEPLOY (any allowed symbol) | 0.005 QTC | 0.25 QTC | 5 QTC |
| INSCRIBE | 0.005 QTC | 0.25 QTC | 5 QTC |

Neither reaches the `ED` floor inside the rate bounds; the floor stays in the formula as a guard.
The largest possible rate-derived fee is 5 QTC. MINT is 0.01 QTC at every rate.

## 3. Blocked tickers

```
BTC ETH QLYPHS QTC USDC USDT
```

`BLOCKED` is fixed at these six symbols. They are the impersonations that would mislead users most:
the two base assets (`BTC`, `ETH`), the two main stablecoins (`USDC`, `USDT`), and Qlyphs and its
currency (`QLYPHS`, `QTC`). The list is not derived from market data, so no data source or refresh
procedure is involved.

- A DEPLOY of a blocked symbol is rejected (`symbol blocked`) on tags 0, 11 and 12, and Qlyphs
  wallets never sign one.
- Every other symbol deploys at the flat DEPLOY fee, including lookalikes and related names such as
  `USDT0`, `WBTC`, `QUANTUS`, `QLYP` or `BTC1`. Membership is an exact byte comparison, with no
  prefix or similarity rule. `BLOCKED` changes no price.
- **Existing assets are never touched.** `BLOCKED` only refuses new DEPLOYs. An asset already
  deployed under a symbol keeps its symbol and state.
- The list lives in `tickers.ts`, sorted, with
  `TICKERS_DIGEST = hex(sha512("Qlyphs/QLYP/tickers/v1\0" ‖ utf8({"blocked":["BTC","ETH","QLYPHS","QTC","USDC","USDT"]})))`
  (no whitespace in the JSON, `\0` one zero byte), recomputed and compared at load:
  `623d047831fa2b0b4c90d533d879dc0cd79c1b33d2190f01b3d44cd251f484fd4943a1c33ad125f346a37179da4d52c820de4178548d931c876316818e50f3ea`.
- **Amendments** are rules releases. A later list version adds a height-gated activation, as the
  progressive profiles do, so blocks before it keep their reading.

## 4. Activation model

### 4.1 Rules

```
Rules    = { progressive: {from} | null, progressiveV2: {from} | null, feeSchedule: FeeRules | null }
FeeRules = {
  from:          integer ≥ 1,             // first block read under the schedule
  operator:      Id,                      // 0x + 64 lowercase hex
  guardian:      Id,
  sentinel:      Id,
  rate:          string /^[1-9][0-9]*$/,  // genesis rate; checkRate; never a JSON number
  delay:         integer,                 // blocks
  grace:         integer,                 // blocks
  guardianDelay: integer,                 // blocks
  legacyBefore:  boolean,                 // true: legacy fees below `from`; false: rate-derived ops rejected below `from`
  resets:        [{ at: integer, operator: Id, guardian: Id, sentinel: Id }]   // at most 8
}
```

The rules are strict: exactly these keys, no default, and

- `checkRate(rate)`;
- `320 ≤ grace < delay ≤ 1_000_000` and `guardianDelay ≥ delay`;
- `operator`, `guardian` and `sentinel` pairwise distinct, none the zero account or the Qlyphs fee
  account;
- `resets`: at most 8, `at` strictly ascending and `> from`, each with the same role conditions;
- `from + 2·guardianDelay ≤ 2^32 − 1` and every reset `at ≤ 2^32 − 1`, so every effective height a
  governance action can name from `from` fits the u32 `effective` field. Near the end of the u32
  height range, an action whose window no longer fits is rejected `invalid effective height`.

`feeSchedule = null` means no schedule: no fee state, no tag 13 or 14. The rules, windows included,
are hashed into `rulesHash`, so a wallet build and the witnesses it trusts must agree on them.

### 4.2 Network values

Windows are block counts; hours assume 12-second blocks and are informational.

| | mainnet | testnet | development |
|---|---|---|---|
| `delay` | 7,200 (~24 h) | 7,200 | 600 |
| `grace` | 4,608 (~15 h) | 4,608 | 384 |
| `guardianDelay` | 50,400 (~7 days) | 7,200 | 600 |
| `legacyBefore` | `true` | `true` | `true` |
| genesis `rate` | fixed in the reviewed activation release | 1e10 | 1e10 |
| role accounts | pinned in the activation release | low-value test keys | public development accounts |

Mainnet windows are confirmed against the measured block time before activation. `grace` stays at
least 4,608 because Quantus extrinsics accept mortal eras of up to 4,096 blocks (section 6.3).

### 4.3 Mainnet

- The mainnet schedule is a constant of the code, `MAINNET_FEE_SCHEDULE`. The activation release
  sets it with `from` = `H` = 188,500, the progressive-1000-v2 activation height, and
  `legacyBefore = true`; genesis rate `12200000000` (about 82 USD per QTC), `delay` 7,200,
  `grace` 4,608, `guardianDelay` 50,400. Mainnet accepts no configured value, only the reviewed
  one, and refuses a schedule without `legacyBefore`.
- **Mainnet role account ids:** operator `0x1581d983b4e5ea7cdc09e367934cb3ee26668a9812e93c0fb11c233108dae379`, sentinel `0xadadf0774413e40aa14f9b8474cfbb84e59c369cb5aaeb49cc328422b7560feb`, guardian `0x58cefd2c30b74c033a3cbb09dbb956aecc55c236df5d5a8d0fdb7be0ec7f41f8`.
- **Before `H`, mainnet reads the fixed legacy fees exactly as before fees-1.** From `H` the legacy
  amount stays accepted for `grace` blocks, so an operation priced and signed before `H` within the
  bounds of section 6.3 and included after it is still read; the other checks of section 5.3,
  `BLOCKED` included, apply to it from `H`. Qlyphs wallets refused to sign a rate-derived operation
  on mainnet until the activation release; from it they sign one at the basis of the state it is
  priced at. MINT keeps its fixed rule at every height.

### 4.4 Development and test networks

`NATIVE_FEE_SCHEDULE` holds the strict JSON of a `FeeRules` object, or is unset. Wallet builds and
witnesses read it next to `NATIVE_PROGRESSIVE_FROM` and `NATIVE_PROGRESSIVE_V2_FROM`; it is part of
`rulesHash`, so a wallet build checks it against its witness policy. Mainnet builds refuse it. With
`legacyBefore = true` (or with no schedule) the legacy fees of section 2 price operations before
`from`.

## 5. Fee state and the fee rule

### 5.1 Fee state

`State.fees` is `null` below `from`. From `from` on:

```
fees = {
  operator:        Id | null,                    // null = frozen
  guardian:        Id,
  sentinel:        Id,
  pendingOperator: { account: Id, effective: u32 } | null,
  pendingGuardian: { account: Id, effective: u32 } | null,
  current:         Grid,
  previous:        Grid | null,                  // only while height < current.effective + grace
  pending:         Grid | null,                  // effective > height
  nextGrid:        u32,                          // ids are never reused
  nextReset:       u8                            // resets already applied
}
Grid = { id: u32, rate: u64, effective: u32, height: u32, index: u32 }
```

`(height, index)` is the extrinsic that posted the grid. The genesis grid is
`{id: 0, rate: rules.rate, effective: from, height: from, index: 0xFFFFFFFF}`. Invariants, checked
after every receipt: the windows above; every rate passes `checkRate`; the non-null role accounts
(`operator`, `guardian`, `sentinel`, both pending accounts) are pairwise distinct and none is the
zero account or the fee account; `nextGrid` exceeds every grid id. The fee state is part of the
attested state and its root.

### 5.2 Block-start order

For block `h`, before its receipts:

1. Ticket expiry release (unchanged).
2. Only when `rules.feeSchedule` is set and `h ≥ from`:
   1. at `h == from`, install the genesis state (genesis grid, roles from the rules, no pending
      field, `previous = null`, `nextGrid = 1`, `nextReset = 0`);
   2. while the next reset has `at ≤ h`: set the three roles from it, clear `pendingOperator`,
      `pendingGuardian` and `pending`, count it;
   3. a `pendingGuardian` with `effective ≤ h` becomes `guardian`;
   4. a `pendingOperator` with `effective ≤ h` becomes `operator`;
   5. a `pending` grid with `effective ≤ h` is promoted: `previous := current`, `current := pending`;
   6. `previous` is dropped once `h ≥ current.effective + grace`.
3. Progressive rights (unchanged).
4. Receipts, in extrinsic order.

### 5.3 The fee rule

**MINT.** At every height and whatever the rules hold, a MINT pays exactly `MINT_FEE` in the fee
batch, with the existing checks and verdicts. It reads no rate and no fee state.

**Legacy reading.** For a rate-derived operation, when there is no schedule (on every network,
mainnet included), or `h < from` with `legacyBefore`, the fee is exactly `legacyFee(kind)`, with the
checks and verdicts of before fees-1.

Otherwise, in order, the first failure giving the verdict:

| # | Check | Verdict on failure |
|---|---|---|
| 1 | The call is a batch | the existing "requires the Qlyphs fee batch" verdict |
| 2 | Exactly `utility.batch_all([system.remark_with_event(payload), balances.transfer_keep_alive(QLYPHS_FEE_ACCOUNT, amount)])`, byte for byte | `fee batch must be exactly remark_with_event + transfer to Qlyphs` |
| 3 | `rules.feeSchedule` is set and `h ≥ from` | `fee schedule not active` |
| 4 | The operation does not claim a symbol in `BLOCKED` | `symbol blocked` |
| 5 | `amount ∈ {fee(op, current.rate)} ∪ {fee(op, previous.rate) if previous} ∪ {legacyFee(kind) if legacyBefore and h < from + grace}` | `fee does not match the fee schedule` |
| 6 | The receipt shows exactly one `remarked` by the signer, one payment of `amount` from the signer to the fee account and one `batchCompleted` | `fee batch receipt does not show the paid Qlyphs fee` |
| 7 | The operation's own rules: symbol taken, cap, limit, sequence and the rest | the existing verdicts |

Overpaying and underpaying are both rejected; nothing is refunded, because an indexer cannot move
QTC. No check reads a governance role: a role set between signing and inclusion must never turn a
paid fee into a rejection. A failed extrinsic (`batch_all` reverts the fee leg, so nothing is paid)
keeps its verdicts `fee batch failed` and `extrinsic failed`.

### 5.4 Fee kept

Verdicts keep their form, `accepted` or `rejected: <reason>`. A transaction receipt carries
`feeKept: boolean`: true when the operation is fee-bearing, the extrinsic succeeded, the receipt
shows the fee paid to the Qlyphs fee account, and the verdict is a rejection. Wallets and explorers
show "Qlyphs fee kept" next to such a rejection. It is derived from the receipt, not from the state
root. Older clients ignore the field.

### 5.5 Mainnet before `H`

With no schedule, and below `H`, mainnet reads the legacy exact fees, as every network does. In
`[H, H + grace)` the legacy amount is also accepted (check 5). Setting `MAINNET_FEE_SCHEDULE`
therefore changes how no block below `H` is read. fees-1 itself changes no state and no fee on
mainnet below `H`. The one difference is the verdict text of a tag-15 remark: it now reads
`reserved operation` instead of `unknown operation`. Both are rejections with no fee and no state
change.

The legacy window covers only the signatures of section 6.3: mortal eras with a period of at most
4,096, born at most 512 blocks after the block they were priced at. Receipts carry no era, so the
reader cannot tell when a fee batch was signed. From `H + grace` the legacy amount is no longer
accepted as a transition amount, whatever the era. It remains accepted only if it equals an amount
allowed by the current or previous grid; otherwise the operation is rejected
`fee does not match the fee schedule` and its fee is kept (section 5.4).

## 6. Overlap bound and no-fee-loss guarantee

### 6.1 Lemma: at most two rate-derived fees

A grid posted at `P` has `effective ≥ P + delay`. A FEE_RATE before a promotion replaces the pending
grid, and one included in the promotion block is applied after the promotion, so consecutive
promotions `E₁ < E₂` satisfy `E₂ ≥ E₁ + delay`. Since `delay > grace`, `previous` is dropped before
the next promotion, so the accepted set holds at most two amounts. The legacy amount exists only
with `legacyBefore`, during `[from, from + grace)`, where no promotion can happen
(`from + delay > from + grace`). During an overlap the two rates differ by at most ×5/4, for `grace`
blocks: that bounds any arbitrage between them.

### 6.2 Theorem: a conforming wallet never loses a fee to a rate change

Premises: the wallet reads `fees.current = g` from the state that both witnesses attest at block `a`
with hash `A`; it signs with a mortal era born exactly at `a` (birth number `a`, birth hash `A`) with
a period of at most 256; it pays `fee(op, g.rate)`. Inclusion then happens at `h < a + 256`, so
`h − a < 256 < 320 ≤ grace`.

1. The era commits to `A`. On a chain without `A` the extrinsic is invalid natively and no fee is
   paid. On a chain with `A`, the state at `a` is the attested state, so `g` is current at `a`
   whichever branch wins.
2. With no promotion in `(a, h]`, `g` is current at `h`: accepted.
3. With one promotion at `E ∈ (a, h]`, `g` is `previous` at `h` and `h − E < grace`: accepted.
4. Two promotions in `(a, h]` would need `E₂ − E₁ ≥ delay > grace > h − a`: impossible.
5. CANCEL, FREEZE, SET_OPERATOR, SET_GUARDIAN, SET_SENTINEL and resets change only pending fields
   and roles, never `current` or `previous`, and no fee check reads a role.

A birth block other than `a` breaks step 1 unless it descends from `a`: on another branch a CANCEL,
FREEZE or replacing FEE_RATE can make `g` absent from the inclusion chain. Qlyphs wallets therefore
refuse a signing context whose birth block differs from the attested block, in number or hash. When
`a < from` and `legacyBefore` holds, the wallet pays `legacyFee`, accepted below `from` and during the
legacy window. When `legacyBefore` is false, and on mainnet before the reviewed activation release,
wallets MUST NOT sign a rate-derived operation while `fees` is null in the attested state. MINT is outside the theorem: its
fee is fixed.

### 6.3 Third-party clients

The same argument holds for a client that prices at block `q`, gives its era a birth block `b` that
is `q` or a descendant of `q` with `b − q ≤ 512`, and uses a period of at most 4,096: on mainnet
`h − q < 4,608 = grace`. Pricing and birth at the same block is the simplest way to meet it.

### 6.4 Out of scope

- immortal extrinsics, eras or pricing ages beyond these bounds, including a legacy-priced fee
  batch signed before `H` and included at `H + grace` or later (section 5.5);
- rejections unrelated to the rate: symbol taken, cap, limit, sequence;
- signing a blocked symbol;
- colluding witnesses attesting a false rate (bounded for Qlyphs wallets by the wallet ceiling,
  section 10).

## 7. Tag 13 FEE_RATE (operator)

### 7.1 Encoding (58 bytes)

| Offset | Size | Field | Encoding |
|---|---|---|---|
| 0 | 4 | magic | ASCII `QLYP` |
| 4 | 1 | version | `0x01` |
| 5 | 32 | genesis | bytes |
| 37 | 8 | sequence | u64 LE |
| 45 | 1 | tag | `0x0d` |
| 46 | 4 | effective | u32 LE |
| 50 | 8 | rate | u64 LE |

Decoded only from `from` on; before, it is an `unknown operation`. Full consumption and canonical
re-encoding are required.

### 7.2 Context

A direct, successful, signed `system.remark_with_event(payload)`, not in a batch and not through a
multisig, with exactly one `remarked` event whose sender is the signer. Otherwise, including a tag-13
or tag-14 payload inside a batch or a multisig proposal: `fee schedule requires a direct
remark_with_event`. The sequence, signer, genesis and zero-sender checks of every QLYP operation
apply.

### 7.3 Validation

In order, at inclusion height `P`:

| # | Check | Verdict |
|---|---|---|
| 1 | `fees.operator !== null` | `fee operator frozen` |
| 2 | signer == `fees.operator` | `not the fee operator` |
| 3 | `P + delay ≤ effective ≤ P + 2·delay` | `invalid effective height` |
| 4 | `RATE_MIN ≤ rate ≤ RATE_MAX`, then 3 significant digits | `rate out of bounds`, `rate not canonical` |
| 5 | `4·rate ≤ 5·current.rate` and `5·rate ≥ 4·current.rate` | `rate step too large` |
| 6 | `nextGrid < 2^32 − 1` | `grid ids exhausted` |

Check 5 compares with `current`, never with the pending grid it replaces. Check 6 keeps `nextGrid`
a u32: after the last id, `0xFFFFFFFE`, every FEE_RATE is rejected like any invalid operation, with
no state change and no sequence advance; the rest of the block, CANCEL, FREEZE and the role actions
keep working, and the rate stays where it is. Effect:
`pending := {id: nextGrid, rate, effective, height: P, index}`, `nextGrid += 1`; an earlier pending
grid is replaced. The sequence advances only on acceptance. FEE_RATE carries no Qlyphs fee.

## 8. Tag 14 FEE_ADMIN

### 8.1 Encoding

| Offset | Size | Field | Encoding |
|---|---|---|---|
| 0 | 46 | header | as section 7.1, tag `0x0e` |
| 46 | 1 | action | u8: 0 CANCEL, 1 FREEZE, 2 SET_OPERATOR, 3 SET_GUARDIAN, 4 SET_SENTINEL |
| 47 | 0, 32 or 36 | body | empty for 0 and 1; `account [u8;32] ‖ effective u32 LE` for 2 and 3; `account [u8;32]` for 4 |

Total length 47, 83 or 79 bytes. An action above 4 is `unknown fee admin action`; a body of the wrong
length or a trailing byte fails canonical decoding. Height gating and context are as for tag 13.

### 8.2 Actions

`P` is the inclusion height, `Z` the zero account, `F` the Qlyphs fee account. A null `operator` or
pending slot is left out of a set. Checks run in order; the first failure gives the verdict and
nothing changes.

- **0 CANCEL.** Signer ∈ {operator, sentinel, guardian}, else `not a fee role`; `pending` non-null,
  else `no pending grid`. Effect: `pending := null`, immediately.
- **1 FREEZE.** Signer ∈ {sentinel, guardian}, else `not the fee guardian or sentinel`. Always
  accepted otherwise, also when already frozen. Effect: `operator := null`, `pendingOperator := null`,
  `pending := null`, immediately.
- **2 SET_OPERATOR(account, effective).** Signer == guardian, else `not the fee guardian`; account ∉
  {operator, guardian, sentinel, pendingGuardian.account, Z, F}, else `invalid fee account role`
  (naming the pending operator again replaces it); `P + delay ≤ effective ≤ P + 2·delay`, else
  `invalid effective height`. Effect: `pendingOperator := {account, effective}`.
- **3 SET_GUARDIAN(account, effective).** Signer == guardian, else `not the fee guardian`. If account
  == guardian, the action is an abort: accepted whatever `effective` holds, `pendingGuardian := null`.
  Otherwise account ∉ {operator, sentinel, pendingOperator.account, Z, F}, else
  `invalid fee account role`; `P + guardianDelay ≤ effective ≤ P + 2·guardianDelay`, else
  `invalid effective height`. Effect: `pendingGuardian := {account, effective}`.
- **4 SET_SENTINEL(account).** Signer == guardian, else `not the fee guardian`; account ∉
  {operator, guardian, sentinel, pendingOperator.account, pendingGuardian.account, Z, F}, else
  `invalid fee account role`. Effect: `sentinel := account`, immediately: the sentinel's powers are a
  protective subset of the guardian's.

These sets are exactly the accounts that would break the distinctness invariant, so an accepted
action never reaches an invariant failure. A freeze is lifted only by a promoted SET_OPERATOR or a
reset. The sequence advances only on acceptance, an abort included. FEE_ADMIN carries no Qlyphs fee.

## 9. Trust model

| Role | Custody | Can | Cannot |
|---|---|---|---|
| Operator | online Qlyphs key | post a canonical rate within bounds, at most ×5/4 per promotion, promotions at least `delay` apart; cancel its pending grid | change `current` or `previous`, change `BLOCKED`, move or redirect funds, act without `delay` blocks of public notice |
| Sentinel | separate online Qlyphs key | CANCEL and FREEZE, immediately (protective only) | set a rate, install or rotate any role, change `current` or `previous` |
| Guardian | offline key | CANCEL and FREEZE; install an operator after `delay`; rotate itself after `guardianDelay`; replace the sentinel immediately | set a rate, change `current` or `previous` |
| Qlyphs fee account | unchanged | receive fees | any authority over the schedule |

All roles are native Quantus accounts whose authority is the ML-DSA-87 extrinsic signature checked
by the runtime. Their account ids are public; the mainnet ids are not yet pinned (section 4.3).

**Bounds.** Whatever any key does, the rate stays within `RATE_MIN` (QTC = 5,000 USD) and `RATE_MAX`
(QTC = 5 USD), moves by at most ×5/4 per promotion, and every change is public on chain at least
`delay` blocks (about 24 hours on mainnet) before it applies.

**Compromise and recovery.**

- **Operator.** Every bad rate is visible `delay` blocks before it applies. The sentinel or the
  guardian freezes the operator with a single FREEZE, which also clears the pending grid; the
  guardian then installs a new operator with SET_OPERATOR. **Worst case without any reaction:** a
  drift of ×5/4 per `delay` blocks within the 5 to 5,000 USD per QTC band, which reaches either bound
  after about 18 promotions (about 18 days on mainnet). Through their compiled ceiling (section 10), Qlyphs wallets never pay more than an
  absolute 1 QTC for a DEPLOY or an INSCRIBE, the fee at `WALLET_MAX_RATE`. That is four times the
  fee only at a rate of `1e10` (QTC = 100 USD); at any other genesis rate the multiple differs.
  Nothing but `RATE_MIN` bounds a drift downwards.
- **Freeze cost.** Lifting a freeze takes the guardian, a SET_OPERATOR effective at least `delay`
  later, then another `delay` before the new operator's first rate applies: about two days on
  mainnet, during which the last grid stays valid.
- **Sentinel.** An attacker can cancel pending grids and freeze, which affects liveness only: the
  last grid stays valid. The guardian replaces the sentinel immediately, then lifts the freeze with
  SET_OPERATOR after `delay`.
- **Guardian.** An attacker with the offline key can freeze, install an operator after `delay` and
  post bounded rates a further `delay` later (at least two delays of public notice), and rotate the
  guardian after `guardianDelay`. CANCEL clears neither pending role. A FREEZE clears
  `pendingOperator`, so the sentinel can keep freezing until the attacker replaces it. Only a
  SET_GUARDIAN naming the current guardian clears `pendingGuardian`, and only the guardian key can
  sign it. A reset clears both.
- **Reset.** Recovery from a compromised or lost guardian is a rules release that appends
  `{at, operator, guardian, sentinel}` to `feeSchedule.resets`, with `at` more than 512 blocks above
  the finalized checkpoint of every index that runs it. It carries a new `rulesHash`, a new witness
  policy and new wallet builds. A reset clears every pending field and never touches `current` or
  `previous`.
- **No new rate.** If no new rate is ever posted, the last grid stays valid indefinitely. There is no
  staleness rule.

## 10. Wallets

Qlyphs wallets (the browser extension and Qlyphs Keys):

- **Attested rate.** A rate-derived operation requires a verified tip attestation from both
  witnesses. Without one the wallet refuses: "Fees cannot be verified right now." A MINT needs no
  rate: it pays `MINT_FEE`, checked against that constant.
- **Local fee.** The wallet computes the fee with `fee-schedule.ts` from the attested `current.rate`
  at the attested block `a` (hash `A`). The era is born exactly at `a`, period 256, tip 0. The fee and
  signing context the configured service quotes MUST equal the local ones.
- **Compiled ceiling.** `WALLET_MAX_RATE = 40_000_000_000` (QTC = 25 USD), a wallet constant, not a
  protocol rule. The wallet refuses a fee above `fee(op, WALLET_MAX_RATE)`, which is 1 QTC for a
  DEPLOY or an INSCRIBE: "Fee above this wallet's limit; update the wallet." MINT has no ceiling of
  its own.
- **Refusals:** a blocked symbol ("This ticker is reserved and cannot be deployed."); a symbol taken
  at `a`; a signer that is the fee account or a current or pending role at `a` (a client rule only);
  a quoted fee that differs from the local fee; a birth block other than `a`; a fee above the
  ceiling; a `rulesHash` mismatch; an immortal era or a period other than 256; `fees` null at `a`
  when `legacyBefore` is false; any rate-derived operation on mainnet before the reviewed activation
  ("Qlyphs fees are not active on mainnet yet.").
- **Display.** "Qlyphs fee X QTC (≈ $Y at the on-chain reference rate, grid #N)". When a grid is
  pending: "From block E this fee becomes Z" (informational: the operation is safe by section 6). A
  MINT shows "Qlyphs fee 0.01 QTC", with no USD figure. The review of a rate-derived operation binds
  the grid id, rate, fee and `rulesHash`.

## 11. Front-running

Qlyphs wallets sign with tip 0. Someone who sees a DEPLOY in the transaction pool can submit the
same symbol with a higher tip. The victim's batch still succeeds natively and its fee is paid; the
verdict is `rejected: symbol taken` with `feeKept: true`. Before every DEPLOY, Qlyphs wallets show:
"If another deploy of SYMBOL is included first, even in the same block, your X QTC fee is not
refunded." They also decode pending transactions for a DEPLOY of the same symbol, best effort, and
give a stronger warning on a match, never a refusal, so the pool cannot be used to block a user.

The reserved remedy is tag 15 NAME_COMMIT, not part of fees-1: a fee batch committing
`sha512("Qlyphs/QLYP/name-commit\0" ‖ genesis ‖ owner ‖ symbol ‖ salt[32])[0..32]`, then a DEPLOY
variant that reveals it after a minimum age above finality. Tag 15 is rejected as
`reserved operation` at every height today.

## 12. Codec and tags

The codec checks syntax only: integer ranges, `action ≤ 4`, exact body lengths (0, 0, 36, 36, 32)
and canonical re-encoding. Semantics belong to the reducer. Decoding takes
`{progressive, progressiveV2, feeSchedule}` options derived from the rules at the block height.

| Tag | Operation |
|---|---|
| 0 | DEPLOY (rate-derived fee) |
| 1 | MINT (`MINT_FEE`) |
| 2 | TRANSFER (no Qlyphs fee) |
| 3 | OFFER (1% sale fee) |
| 4–8 | reserved, `reserved operation` |
| 9 | INSCRIBE (rate-derived fee) |
| 10 | allocated to open listings; unknown operation |
| 11, 12 | PROGRESSIVE DEPLOY, V2 (rate-derived fee), from their activations |
| 13 | FEE_RATE, from `feeSchedule.from`; unknown operation before |
| 14 | FEE_ADMIN, from `feeSchedule.from`; unknown operation before |
| 15 | reserved (NAME_COMMIT), `reserved operation` |
| 16+ | unknown operation |

## 13. Witnesses

`rulesHash` covers the protocol sources (`codec.ts`, `protocol.ts`, `progressive-mint.ts`,
`sha512.ts`, `fee-schedule.ts`, `tickers.ts`) and the canonical rules, `feeSchedule` included, so
every target, bound, blocked ticker, window and role is bound to the witness policy. Snapshots
(format 2) carry the fee state, and the state root covers it, so the rate a wallet reads is attested
state. There is no per-transaction fee evidence in attestations: fee correctness rests on both
witnesses running the hashed reducer.
