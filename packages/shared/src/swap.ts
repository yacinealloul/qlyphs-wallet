/** Swap arithmetic, pure: a USDT budget → the QTC amount and the ask that fills it. */
import { checkFill, quoteTotal } from './money';
import { PLANCK_PER_QTC } from './constants';

/** Swap amounts are whole thousandths of a QTC. */
export const SWAP_AMOUNT_STEP = PLANCK_PER_QTC / 1_000n;

export interface SwapAsk {
  offerId: string;
  /** USDT micro per QTC. */
  price: bigint;
  remaining: bigint;
  minFill: bigint;
}

export interface SwapFill {
  ask: SwapAsk;
  /** QTC bought, planck. */
  amount: bigint;
  /** USDT micro paid, exactly what the trade will ask for. */
  total: bigint;
}

/** QTC a budget buys at `price`, rounded down to the swap step. */
export function amountForBudget(budgetMicro: bigint, price: bigint): bigint {
  if (budgetMicro <= 0n || price <= 0n) return 0n;
  const planck = (budgetMicro * PLANCK_PER_QTC) / price;
  return planck - (planck % SWAP_AMOUNT_STEP);
}

/** One cent in USDT micro: totals are rounded to it. */
const CENT = 10_000n;

/**
 * What `ask` sells for the budget, or null when it cannot take it: too small for the budget, or
 * leaving a remainder below its minimum fill.
 */
function fillFor(ask: SwapAsk, budgetMicro: bigint): bigint | null {
  const amount = amountForBudget(budgetMicro, ask.price);
  if (amount <= 0n) return null;
  if (amount >= ask.remaining || ask.remaining - amount < ask.minFill) {
    // Only a budget within a cent of the whole ask's total takes it: a larger one wants more
    // than this ask holds, a smaller one would leave dust.
    const whole = quoteTotal(ask.remaining, ask.price);
    return whole <= budgetMicro && budgetMicro - whole < CENT ? ask.remaining : null;
  }
  return checkFill({ amount, remaining: ask.remaining, minFill: ask.minFill }).ok ? amount : null;
}

/**
 * The cheapest ask able to take the whole amount the budget buys at its price. One ask per swap:
 * a trade fills a single offer. Null when no ask fits.
 */
export function pickSwapFill(asks: readonly SwapAsk[], budgetMicro: bigint): SwapFill | null {
  const sorted = [...asks].sort((a, b) => (a.price < b.price ? -1 : a.price > b.price ? 1 : 0));
  for (const ask of sorted) {
    const amount = fillFor(ask, budgetMicro);
    if (amount === null) continue;
    const total = quoteTotal(amount, ask.price);
    if (total <= 0n) continue;
    return { ask, amount, total };
  }
  return null;
}

/** Largest USDT budget a single swap can spend, micro: the biggest ask taken whole. */
export function maxSwapBudget(asks: readonly SwapAsk[]): bigint {
  let max = 0n;
  for (const ask of asks) {
    const total = quoteTotal(ask.remaining, ask.price);
    if (total > max) max = total;
  }
  return max;
}

/** Smallest USDT budget a single swap can spend, micro: the cheapest minimum fill. 0 when none. */
export function minSwapBudget(asks: readonly SwapAsk[]): bigint {
  let min = 0n;
  for (const ask of asks) {
    const smallest = ask.minFill < ask.remaining ? ask.minFill : ask.remaining;
    // Rounded up to the cent, so the budget shown buys at least the minimum.
    const exact = (smallest * ask.price + PLANCK_PER_QTC - 1n) / PLANCK_PER_QTC;
    const total = ((exact + CENT - 1n) / CENT) * CENT;
    if (total > 0n && (min === 0n || total < min)) min = total;
  }
  return min;
}

/** Rounds micro down to whole cents, the precision a swap budget is typed in. */
export const floorToCent = (micro: bigint): bigint => micro - (micro % CENT);
