/** Swap: buy QTC for USDT in one step, priced from the exchange book (`/swap`). */
import { z } from 'zod';
import { PlanckStringSchema, PositivePlanckStringSchema, PriceStringSchema } from './primitives';

/** One exchange ask level the swap price walks through. */
export const SwapBookLevelSchema = z.object({
  price: PriceStringSchema,
  amount: PositivePlanckStringSchema,
});
export type SwapBookLevelView = z.infer<typeof SwapBookLevelSchema>;

/**
 * `GET /swap/quote`. The price of an amount is its average fill cost across `asks` plus
 * `markupBps` (see `swapPrice`). `available: false` → `reason` says why no swap can start now.
 */
export const SwapQuoteResponseSchema = z.object({
  available: z.boolean(),
  reason: z.string().nullable(),
  markupBps: z.number().int().min(0),
  minAmount: PlanckStringSchema,
  maxAmount: PlanckStringSchema,
  /** Best first. */
  asks: z.array(SwapBookLevelSchema),
});
export type SwapQuoteResponse = z.infer<typeof SwapQuoteResponseSchema>;

/**
 * `POST /swap`: buy `amount` planck at no more than `maxPrice`, the price the buyer saw. The
 * server prices the amount again from the latest book and refuses when it rose above.
 */
export const SwapRequestSchema = z.object({
  amount: PositivePlanckStringSchema,
  maxPrice: PriceStringSchema,
  /** Network the buyer pays on, one of `PublicConfig.paymentChains`. Default: the first. */
  paymentChainId: z.number().int().positive().optional(),
});
export type SwapRequest = z.infer<typeof SwapRequestSchema>;
