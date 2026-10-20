/** QLYP-v1 Qlyphs fees, recomputed by the wallet itself. The service's cost estimate is only
 * trusted for network charges: a server asking for any other Qlyphs fee is refused. Creating a
 * token or a Quark costs a rate-derived fee, priced from an attested on-chain rate under a compiled
 * ceiling (docs/extension/PROTOCOL-FEES.md); minting keeps its fixed fee. */
import { MAINNET, requireThat } from '../../../packages/native/src/codec.ts';
import type { Id } from '../../../packages/native/src/codec.ts';
import { feeBasis, qlyphsFee } from '../../../packages/native/src/commands.ts';
import type { Command, FeeBasis } from '../../../packages/native/src/commands.ts';
import { checkFeeRules, FEE_TARGETS_CENTS, feeAt, fee as rateFee, isRateDerived, legacyFee, MIN_GRACE } from '../../../packages/native/src/fee-schedule.ts';
import type { FeeRules } from '../../../packages/native/src/fee-schedule.ts';
import type { NetworkName } from '../../../packages/native/src/network.ts';
import type { PublicFeeSchedule } from '../../../packages/native/src/public.ts';
import {
  MAINNET_FEE_SCHEDULE,
  MINT_FEE,
  PROTOCOL_LABEL,
  QLYPHS_FEE_ACCOUNT,
  saleFee,
} from '../../../packages/native/src/protocol.ts';
import type { State, Ticket } from '../../../packages/native/src/protocol.ts';
import { FEE_CEILING_ERROR, FEE_ROLE_ERROR, FEES_UNVERIFIED_ERROR, MAINNET_FEES_OFF } from './fee-copy.ts';
import { symbolTakenError } from './qlyph-errors.ts';
import {
  BUY_FUNDS_ERROR,
  checkPayerBalance as checkProtocolPayerBalance,
  checkSendBalance,
  FEE_FUNDS_ERROR,
  nativeOutlay as protocolOutlay,
  QLYPHS_FEE_ERROR,
  SALE_FEE_ERROR,
} from './send-balance.ts';
import type { NativeBalance } from './send-balance.ts';

export { PROTOCOL_LABEL };
export { BUY_FUNDS_ERROR, FEE_FUNDS_ERROR, QLYPHS_FEE_ERROR, SALE_FEE_ERROR };
export { FEE_CEILING_ERROR, FEE_ROLE_ERROR, FEES_UNVERIFIED_ERROR, MAINNET_FEES_OFF };

/** The highest rate (QTC base units per USD) this build pays a rate-derived fee at: QTC = 25 USD,
 * so at most 1 QTC to create a token or a Quark. A wallet build constant, not a protocol rule: it
 * bounds what a false attested rate could charge. */
export const WALLET_MAX_RATE = 40_000_000_000n;

declare const QLYPHS_FEE_RULES: FeeRules | null | undefined;
// The development network's schedule, bound by the build to the witness policy's rules. Mainnet
// takes only the reviewed one compiled into the protocol package.
const DEVELOPMENT_FEE_RULES: FeeRules | null =
  typeof QLYPHS_FEE_RULES === 'undefined' || QLYPHS_FEE_RULES === null
    ? null
    : checkFeeRules(QLYPHS_FEE_RULES);
/** The fee schedule the wallet prices with on `network`; null reads the fixed legacy fees off
 * mainnet, and refuses every rate-derived operation on mainnet. */
export const feeRulesFor = (network: NetworkName): FeeRules | null =>
  network === 'mainnet' ? MAINNET_FEE_SCHEDULE : DEVELOPMENT_FEE_RULES;

type Offer = { price: bigint; fee: bigint; feeTo: string };
/** Any token-for-QTC exchange pays exactly 1% (rounded up) to the Qlyphs fee account. */
export function checkSaleOffer(offer: Offer): void {
  requireThat(offer.fee === saleFee(offer.price) && offer.feeTo === QLYPHS_FEE_ACCOUNT, SALE_FEE_ERROR);
}
/** The Qlyphs fee this signer pays, computed locally from the protocol rules. A rate-derived
 * operation needs its `basis` (the attested rate, or the legacy fees); without one it is refused. */
export function expectedQlyphsFee(command: Command, ticket?: Ticket, basis?: FeeBasis): bigint {
  if (command.kind === 'sell') checkSaleOffer(command.offer);
  if (command.kind === 'buy') {
    requireThat(ticket !== undefined, QLYPHS_FEE_ERROR);
    checkSaleOffer(ticket!.offer);
  }
  requireThat(!isRateDerived(command.kind) || basis !== undefined, QLYPHS_FEE_ERROR);
  return qlyphsFee(command, ticket, basis);
}
export function checkQlyphsFee(
  command: Command,
  ticket: Ticket | undefined,
  platformFee: string,
  basis?: FeeBasis,
): void {
  requireThat(platformFee === expectedQlyphsFee(command, ticket, basis).toString(), QLYPHS_FEE_ERROR);
}

type RateDerived = Extract<
  Command,
  { kind: 'deploy' | 'inscribe' | 'deployProgressive' | 'deployProgressiveV2' }
>;
/** The priced terms of a rate-derived operation, which its review digest binds. `block` is the
 * attested block it is priced at and signed on; null in a build without a fee schedule, which pays
 * the fixed legacy fees. `grid` is the attested current grid, null for a legacy fee. */
export interface FeeQuote {
  fee: string;
  block: { height: number; hash: string } | null;
  grid: { id: number; rate: string } | null;
  /** The fee once the attested pending grid applies, for display only. */
  pending: { effective: number; fee: string } | null;
  rulesHash: string | null;
}
export const quoteBasis = (q: FeeQuote): FeeBasis =>
  q.grid ? { rate: BigInt(q.grid.rate) } : { legacy: true };
/** Price `command` for `owner`. With a fee schedule, only from the state both witnesses attest at
 * one block: the fee of its current grid, refused above the wallet ceiling, for a signer that holds
 * no fee schedule role there and a symbol still free there. */
export function quoteFees(
  command: RateDerived,
  owner: Id,
  genesis: Id,
  rules: FeeRules | null,
  attested?: { block: { height: number; hash: string }; state: State },
  rulesHash?: string,
): FeeQuote {
  if (rules === null) {
    requireThat(genesis !== MAINNET, MAINNET_FEES_OFF);
    const fee = qlyphsFee(command, undefined, { legacy: true });
    requireThat(fee <= rateFee(command, WALLET_MAX_RATE), FEE_CEILING_ERROR);
    return { fee: String(fee), block: null, grid: null, pending: null, rulesHash: null };
  }
  requireThat(attested && rulesHash, FEES_UNVERIFIED_ERROR);
  const s = attested!.state,
    f = s.fees;
  // Throws while the schedule is not active at the attested block and no legacy fee applies there.
  const basis = feeBasis(s, { progressive: null, progressiveV2: null, feeSchedule: rules }, genesis);
  const fee = qlyphsFee(command, undefined, basis);
  requireThat(fee <= rateFee(command, WALLET_MAX_RATE), FEE_CEILING_ERROR);
  // A client rule, not consensus: a fee schedule account never pays a user fee from this wallet.
  const roles = [
    QLYPHS_FEE_ACCOUNT,
    f?.operator,
    f?.guardian,
    f?.sentinel,
    f?.pendingOperator?.account,
    f?.pendingGuardian?.account,
  ];
  requireThat(!roles.includes(owner), FEE_ROLE_ERROR);
  if (command.kind !== 'inscribe') {
    const taken = s.symbols.get(command.symbol);
    if (taken !== undefined) throw Error(symbolTakenError(command.symbol, taken));
  }
  return {
    fee: String(fee),
    block: { ...attested!.block },
    grid: f && 'rate' in basis ? { id: f.current.id, rate: String(f.current.rate) } : null,
    pending:
      f?.pending && 'rate' in basis
        ? { effective: f.pending.effective, fee: String(rateFee(command, f.pending.rate)) }
        : null,
    rulesHash: rulesHash!,
  };
}

/** QTC the signer spends besides fees, or undefined when the operation needs no balance check.
 * Inscribing spends only fees. */
export function nativeOutlay(command: Command, ticket?: Ticket): bigint | undefined {
  if (command.kind === 'inscribe') return 0n;
  return protocolOutlay(command, ticket);
}
type Costs = Parameters<typeof checkProtocolPayerBalance>[1];
/** Refuse an operation the signer cannot afford from finalized spendable QTC. For an inscription
 * the Qlyphs fee is the locally recomputed one, never the service's figure. */
export function checkPayerBalance(
  balance: NativeBalance,
  costs: Costs,
  command: Command,
  ticket?: Ticket,
  basis?: FeeBasis,
): void {
  if (command.kind === 'inscribe') {
    const local = { ...costs, platformFee: expectedQlyphsFee(command, undefined, basis).toString() };
    checkSendBalance(balance, local, 0n, FEE_FUNDS_ERROR);
    return;
  }
  checkProtocolPayerBalance(balance, costs, command, ticket);
}

/** The Qlyphs fee a creation included at `height` paid, from the indexer's public fee schedule, for
 * an Activity entry recorded before the wallet kept the reviewed fee. Display only. Null where the
 * schedule no longer says which rate applied there, and in the overlap after a rate change, when the
 * old fee was still accepted (at least MIN_GRACE blocks). */
export function scheduledQlyphsFee(kind: string, height: number, schedule: unknown): bigint | null {
  if (kind === 'mint' && Number.isSafeInteger(height)) return MINT_FEE;
  if (!isRateDerived(kind) || !Number.isSafeInteger(height) || !isFeeSchedule(schedule)) return null;
  if (height > schedule.height || schedule.frozen) return null;
  if (schedule.mode === 'legacy' || (schedule.mode === 'schedule' && schedule.from !== null && height < schedule.from))
    return legacyFee(kind);
  if (schedule.mode !== 'schedule') return null;
  const grid = [schedule.current, schedule.previous].find((g) => g && height >= g.effective);
  if (!grid || height < grid.effective + MIN_GRACE || !/^[1-9]\d{0,20}$/.test(grid.rate)) return null;
  try {
    return feeAt(kind === 'inscribe' ? FEE_TARGETS_CENTS.inscribe : FEE_TARGETS_CENTS.deploy, BigInt(grid.rate));
  } catch {
    return null;
  }
}
const isGrid = (g: unknown): boolean =>
  g === null ||
  (!!g && typeof g === 'object' && typeof (g as Record<string, unknown>).rate === 'string' &&
    Number.isSafeInteger((g as Record<string, unknown>).effective));
function isFeeSchedule(v: unknown): v is PublicFeeSchedule {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return (
    Number.isSafeInteger(s.height) &&
    (s.mode === 'schedule' || s.mode === 'legacy' || s.mode === 'inactive') &&
    (s.from === null || Number.isSafeInteger(s.from)) &&
    typeof s.frozen === 'boolean' &&
    isGrid(s.current) &&
    isGrid(s.previous)
  );
}
