/**
 * Swap arithmetic, pure. The price of an amount is what buying it costs across the exchange's
 * ask levels — the first level, then the next, until the amount is filled — averaged, plus the
 * markup, rounded up to the cent. The page and the API compute it the same way.
 */
import { PLANCK_PER_QTC, PRICE_TICK_MICRO } from './constants';
import { quoteTotal } from './money';

/** Swap amounts are whole thousandths of a QTC. */
export const SWAP_AMOUNT_STEP = PLANCK_PER_QTC / 1_000n;

/** One exchange ask level: USDT micro per QTC, and the planck offered there. */
export interface SwapBookLevel {
  price: bigint;
  amount: bigint;
}

export interface SwapFill {
  /** QTC bought, planck. */
  amount: bigint;
  /** USDT micro per QTC for this amount: average fill cost plus the markup. */
  price: bigint;
  /** USDT micro paid, exactly what the trade will ask for. */
  total: bigint;
}

export interface SwapLimits {
  markupBps: number;
  /** Smallest amount one swap may buy, planck. */
  minAmount: bigint;
  /** Largest amount one swap may buy, planck. */
  maxAmount: bigint;
}

const BPS = 10_000n;
/** One cent in USDT micro: totals are rounded to it. */
const CENT = 10_000n;

/** Average cost of `amount` taken from the best level onwards, rounded up; null if too thin. */
export function averageFillCost(asks: readonly SwapBookLevel[], amount: bigint): bigint | null {
  if (amount <= 0n) return null;
  let left = amount;
  let cost = 0n;
  for (const level of asks) {
    const take = left < level.amount ? left : level.amount;
    cost += take * level.price;
    left -= take;
    if (left === 0n) break;
  }
  if (left > 0n) return null;
  return (cost + amount - 1n) / amount;
}

/** Price of a swap of `amount`: average fill cost plus `markupBps`, rounded up to the cent. */
export function swapPrice(
  asks: readonly SwapBookLevel[],
  amount: bigint,
  markupBps: number,
): bigint | null {
  const cost = averageFillCost(asks, amount);
  if (cost === null) return null;
  const marked = (cost * (BPS + BigInt(markupBps)) + BPS - 1n) / BPS;
  return ((marked + PRICE_TICK_MICRO - 1n) / PRICE_TICK_MICRO) * PRICE_TICK_MICRO;
}

/** The swap of `amount`, or null when the book cannot fill it. */
export function swapFillForAmount(
  asks: readonly SwapBookLevel[],
  amount: bigint,
  markupBps: number,
): SwapFill | null {
  const price = swapPrice(asks, amount, markupBps);
  if (price === null) return null;
  return { amount, price, total: quoteTotal(amount, price) };
}

/** Largest amount one swap can buy: the limit, or less when the book is thinner. */
export function maxSwapAmount(asks: readonly SwapBookLevel[], limits: SwapLimits): bigint {
  const depth = asks.reduce((sum, level) => sum + level.amount, 0n);
  const most = limits.maxAmount < depth ? limits.maxAmount : depth;
  return most - (most % SWAP_AMOUNT_STEP);
}

/**
 * The most QTC a USDT budget buys: the largest whole step whose total fits the budget, within the
 * limits and the book's depth. The total only grows with the amount (more QTC, at a price that
 * can only rise deeper in the book), so a binary search over the steps finds it. Null when even
 * the minimum amount costs more than the budget.
 */
export function swapFillForBudget(
  asks: readonly SwapBookLevel[],
  budgetMicro: bigint,
  limits: SwapLimits,
): SwapFill | null {
  if (budgetMicro <= 0n) return null;
  let low = 1n;
  let high = maxSwapAmount(asks, limits) / SWAP_AMOUNT_STEP;
  let best: SwapFill | null = null;
  while (low <= high) {
    const mid = (low + high) / 2n;
    const fill = swapFillForAmount(asks, mid * SWAP_AMOUNT_STEP, limits.markupBps);
    if (fill !== null && fill.total <= budgetMicro) {
      best = fill;
      low = mid + 1n;
    } else {
      high = mid - 1n;
    }
  }
  return best !== null && best.amount >= limits.minAmount ? best : null;
}

/** Budget range of one swap, USDT micro: the minimum amount's total and the maximum's. */
export function swapBudgetRange(
  asks: readonly SwapBookLevel[],
  limits: SwapLimits,
): { min: bigint; max: bigint } | null {
  const top = maxSwapAmount(asks, limits);
  if (top <= 0n || top < limits.minAmount) return null;
  const low = swapFillForAmount(asks, limits.minAmount, limits.markupBps);
  const high = swapFillForAmount(asks, top, limits.markupBps);
  return low && high ? { min: low.total, max: high.total } : null;
}

/** Rounds micro down to whole cents, the precision a swap budget is typed in. */
export const floorToCent = (micro: bigint): bigint => micro - (micro % CENT);
