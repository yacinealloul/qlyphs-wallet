/** QLYP Qlyphs fees, for showing the exact cost before requesting a transaction.
 * Every amount is QTC base units (12 decimals) as a bigint: format with formatUnits(fee, 12).
 * These are the protocol's own constants and rules, re-exported rather than restated
 * (docs/extension/PROTOCOL-FEES.md):
 * - deploy (every deploy kind) and inscribe are rate-derived: fee(op, rate) is a 25 USD target
 *   priced at the on-chain rate (QTC base units per USD), so qlyphsFee needs a fee schedule for
 *   them. Networks with a legacy history read LEGACY_DEPLOY_FEE (1 QTC) and LEGACY_INSCRIBE_FEE
 *   (0.1 QTC) before the schedule starts; mainnet never does. A BLOCKED ticker is never deployed.
 * - mint pays the fixed MINT_FEE (0.01 QTC). Every fee-bearing operation pays QLYPHS_FEE_ACCOUNT
 *   in the same signed batch as the operation; the wallet builds that batch.
 * - lot n of a progressive asset pays progressiveLotFee(n, profile) in its settlement, instead of
 *   MINT_FEE: 0.1 to 0.5 QTC on progressive-1000-v1, 0.01 to 0.44 QTC on progressive-1000-v2.
 * - any token-for-QTC exchange pays saleFee(price), 1% of the price rounded up, to
 *   QLYPHS_FEE_ACCOUNT. The seller commits it in the offer; the buyer pays it next to the price.
 * - token transfers, pairing, cancellations and plain QTC sends carry no Qlyphs fee.
 * The wallet prices rate-derived fees itself from an attested rate: figures computed here from an
 * indexer read are for display. */
import {
  MINT_FEE,
  QLYPHS_FEE_ACCOUNT,
  SALE_FEE_BPS,
  saleFee as protocolSaleFee,
} from '../../native/src/protocol.ts';
import {
  ED,
  FEE_TARGETS_CENTS,
  LEGACY_DEPLOY_FEE,
  LEGACY_INSCRIBE_FEE,
  RATE_MAX,
  RATE_MIN,
  centsFor,
  checkRate,
  fee,
  isFeeBearing,
  isRateDerived,
  legacyFee,
  symbolClass,
} from '../../native/src/fee-schedule.ts';
import { BLOCKED, TICKERS_DIGEST } from '../../native/src/tickers.ts';
import { FEE_ADMIN_ACTIONS, FEE_ADMIN_TAG, FEE_RATE_TAG, decode } from '../../native/src/codec.ts';
import { parseCommand } from '../../native/src/commands.ts';
import {
  PROGRESSIVE_MINT_PROFILE,
  PROGRESSIVE_MINT_PROFILE_V2,
  progressiveLotFee,
} from '../../native/src/progressive-mint.ts';
import { QlyphsError } from '../../provider/src/index.ts';
import type { Operation } from '../../native/src/codec.ts';
import type {
  PublicFeeSchedule,
  PublicTicket,
  TransactionCommand,
} from '../../native/src/public.ts';
import { command } from './validation.ts';

export {
  BLOCKED,
  ED,
  FEE_ADMIN_ACTIONS,
  FEE_ADMIN_TAG,
  FEE_RATE_TAG,
  FEE_TARGETS_CENTS,
  LEGACY_DEPLOY_FEE,
  LEGACY_INSCRIBE_FEE,
  MINT_FEE,
  PROGRESSIVE_MINT_PROFILE,
  PROGRESSIVE_MINT_PROFILE_V2,
  QLYPHS_FEE_ACCOUNT,
  RATE_MAX,
  RATE_MIN,
  SALE_FEE_BPS,
  TICKERS_DIGEST,
  centsFor,
  checkRate,
  decode,
  fee,
  isFeeBearing,
  isRateDerived,
  progressiveLotFee,
  symbolClass,
};
export type {
  Envelope,
  FeeAdminOp,
  FeeGovernanceOperation,
  Operation,
} from '../../native/src/codec.ts';
/** A tag 13 FEE_RATE operation: the operator posts `rate` from block `effective`. */
export type FeeRateOp = Extract<Operation, { kind: 'feeRate' }>;
/** How rate-derived fees are priced: at an on-chain rate (QTC base units per USD, a bigint or a
 * canonical decimal string such as PublicFeeGrid.rate), or at the legacy fixed fees of a network
 * that reads them. */
export type FeeScheduleInput = { rate: bigint | string } | { legacy: true };
/** The schedule argument of qlyphsFee for a fee schedule read (indexer.schedule()): its current
 * rate, the legacy fees, or null while rate-derived fees are not active on that network. */
export function scheduleBasis(view: PublicFeeSchedule): FeeScheduleInput | null {
  if (view.mode === 'schedule' && view.current) return { rate: view.current.rate };
  return view.mode === 'legacy' ? { legacy: true } : null;
}
/** The signed offer inside a `sell` command. */
export type SellOffer = Extract<TransactionCommand, { kind: 'sell' }>['offer'];

function price(value: unknown): bigint {
  if (typeof value === 'bigint' && value >= 0n) return value;
  if (typeof value === 'string' && /^(0|[1-9]\d{0,38})$/.test(value)) return BigInt(value);
  throw new QlyphsError(
    'INVALID_REQUEST',
    'A non-negative price in base units is required',
    'not-submitted',
  );
}
/** 1% of a QTC price, rounded up: ceil(price * SALE_FEE_BPS / 10000). */
export function saleFee(value: bigint | string): bigint {
  return protocolSaleFee(price(value));
}
/** Commit the exact QLYP-v1 sale fee into an offer (fee = saleFee(price), feeTo = Qlyphs). */
export function withSaleFee(offer: Omit<SellOffer, 'fee' | 'feeTo'>): SellOffer {
  return { ...offer, fee: saleFee(offer.price).toString(), feeTo: QLYPHS_FEE_ACCOUNT };
}
/** True when a sell offer commits exactly the QLYP-v1 sale fee; any other offer is rejected. */
export function hasSaleFee(offer: Pick<SellOffer, 'price' | 'fee' | 'feeTo'>): boolean {
  try {
    return offer.feeTo === QLYPHS_FEE_ACCOUNT && price(offer.fee) === saleFee(offer.price);
  } catch {
    return false;
  }
}
function request(message: string): never {
  throw new QlyphsError('INVALID_REQUEST', message, 'not-submitted');
}
function scheduleRate(schedule: FeeScheduleInput): bigint | null {
  const v = schedule as Record<string, unknown> | null;
  if (!v || typeof v !== 'object' || Object.keys(v).length !== 1) request('Invalid fee schedule');
  if (v.legacy === true) return null;
  let rate: unknown = v.rate;
  if (typeof rate === 'string' && /^[1-9]\d{0,38}$/.test(rate)) rate = BigInt(rate);
  if (typeof rate !== 'bigint' || !checkRate(rate)) request('Invalid fee rate');
  return rate;
}
/** The Qlyphs fee (QTC base units) the signer of `input` pays on top of network fees.
 * A deploy or an inscribe requires `schedule`: the current grid's rate, or `{legacy: true}` on a
 * network that still reads the legacy fees (PublicFeeSchedule.mode). A buy pays the fee its
 * reservation committed, so it requires that reservation's ticket. */
export function qlyphsFee(
  input: TransactionCommand,
  ticket?: PublicTicket['ticket'],
  schedule?: FeeScheduleInput,
): bigint {
  const c = command(input);
  if (isRateDerived(c.kind)) {
    if (schedule === undefined) request('A fee schedule is required for this operation');
    const rate = scheduleRate(schedule);
    // No Qlyphs client signs a blocked deploy at any height, so it has no fee to show.
    if ('symbol' in c && symbolClass(c.symbol) === 'blocked')
      request('This ticker is reserved and cannot be deployed.');
    return rate === null ? legacyFee(c.kind) : fee(parseCommand(c) as Operation, rate);
  }
  switch (c.kind) {
    case 'mint':
      return MINT_FEE;
    case 'mintProgressive':
      return progressiveLotFee(BigInt(c.lot), c.profile ?? PROGRESSIVE_MINT_PROFILE);
    case 'buy':
      if (!ticket || ticket.key !== c.ticket || !hasSaleFee(ticket.offer))
        throw new QlyphsError(
          'INVALID_REQUEST',
          'The fee of a purchase requires its reservation with a valid QLYP-v1 sale fee',
          'not-submitted',
        );
      return BigInt(ticket.offer.fee);
    default:
      return 0n;
  }
}
