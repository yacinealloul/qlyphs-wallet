/**
 * Price guardrail (SPEC §3 Offers).
 * Reference = VWAP of the last 20 completed trades within 7 days, else order-book mid, else none.
 * Deviation > 20 % needs an explicit confirmation; > 80 % below or > 400 % above is rejected.
 */
import {
  BPS_DENOMINATOR,
  GUARDRAIL_CONFIRM_DEVIATION_BPS,
  GUARDRAIL_REJECT_ABOVE_BPS,
  GUARDRAIL_REJECT_BELOW_BPS,
  GUARDRAIL_VWAP_TRADES,
  GUARDRAIL_VWAP_WINDOW_DAYS,
} from './constants';
import { divRoundHalfUp } from './money';

export interface ReferenceTrade {
  /** planck */
  amount: bigint;
  /** USDC micro per QTC */
  price: bigint;
  completedAt: Date;
}

export type ReferenceSource = 'vwap' | 'mid' | 'none';

export type ReferencePrice =
  { source: 'vwap' | 'mid'; price: bigint } | { source: 'none'; price: null };

const DAY_MS = 86_400_000;

/** Most recent `GUARDRAIL_VWAP_TRADES` trades completed within the window ending at `now`. */
export function selectReferenceTrades<T extends ReferenceTrade>(
  trades: readonly T[],
  now: Date,
): T[] {
  const cutoff = now.getTime() - GUARDRAIL_VWAP_WINDOW_DAYS * DAY_MS;
  return trades
    .filter((t) => t.completedAt.getTime() >= cutoff && t.completedAt.getTime() <= now.getTime())
    .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime())
    .slice(0, GUARDRAIL_VWAP_TRADES);
}

/** Volume-weighted average price, rounded half-up to the micro. `null` when there is no volume. */
export function vwap(trades: readonly Pick<ReferenceTrade, 'amount' | 'price'>[]): bigint | null {
  let notional = 0n;
  let volume = 0n;
  for (const t of trades) {
    if (t.amount <= 0n || t.price <= 0n) continue;
    notional += t.amount * t.price;
    volume += t.amount;
  }
  return volume === 0n ? null : divRoundHalfUp(notional, volume);
}

/** Order-book mid, or `null` unless both sides are quoted. */
export function orderBookMid(bestBid: bigint | null, bestAsk: bigint | null): bigint | null {
  if (bestBid === null || bestAsk === null || bestBid <= 0n || bestAsk <= 0n) return null;
  return (bestBid + bestAsk) / 2n;
}

export function referencePrice(p: {
  trades: readonly ReferenceTrade[];
  bestBid: bigint | null;
  bestAsk: bigint | null;
  now: Date;
}): ReferencePrice {
  const fromTrades = vwap(selectReferenceTrades(p.trades, p.now));
  if (fromTrades !== null) return { source: 'vwap', price: fromTrades };
  const mid = orderBookMid(p.bestBid, p.bestAsk);
  if (mid !== null) return { source: 'mid', price: mid };
  return { source: 'none', price: null };
}

export type DeviationVerdict = 'ok' | 'needs_confirmation' | 'rejected';

export interface DeviationResult {
  verdict: DeviationVerdict;
  /** Signed deviation from the reference in bps (truncated); `null` without a reference. */
  deviationBps: number | null;
  reference: bigint | null;
}

/** Classify `price` against `reference`. No reference means no guardrail. */
export function checkDeviation(price: bigint, reference: bigint | null): DeviationResult {
  if (price <= 0n) throw new RangeError('price must be positive');
  if (reference === null || reference <= 0n) {
    return { verdict: 'ok', deviationBps: null, reference: null };
  }
  const diff = price - reference;
  const absDiff = diff < 0n ? -diff : diff;
  const scaled = absDiff * BPS_DENOMINATOR;
  const deviationBps = Number((diff * BPS_DENOMINATOR) / reference);

  const rejectLimit = diff < 0n ? GUARDRAIL_REJECT_BELOW_BPS : GUARDRAIL_REJECT_ABOVE_BPS;
  let verdict: DeviationVerdict = 'ok';
  if (scaled > rejectLimit * reference) verdict = 'rejected';
  else if (scaled > GUARDRAIL_CONFIRM_DEVIATION_BPS * reference) verdict = 'needs_confirmation';
  return { verdict, deviationBps, reference };
}

export type GuardrailDecision =
  | { allowed: true; result: DeviationResult }
  | { allowed: false; reason: 'confirmation_required' | 'rejected'; result: DeviationResult };

/** Gate used by create-offer and take-offer: applies the user's `confirmDeviation` flag. */
export function evaluateGuardrail(p: {
  price: bigint;
  reference: bigint | null;
  confirmDeviation?: boolean | undefined;
}): GuardrailDecision {
  const result = checkDeviation(p.price, p.reference);
  if (result.verdict === 'rejected') return { allowed: false, reason: 'rejected', result };
  if (result.verdict === 'needs_confirmation' && p.confirmDeviation !== true) {
    return { allowed: false, reason: 'confirmation_required', result };
  }
  return { allowed: true, result };
}
