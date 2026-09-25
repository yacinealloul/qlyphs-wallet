/** Swap: buy QTC for USDT in one step, against the cheapest open ask (`/swap`). */
import { z } from 'zod';
import { IdSchema, PlanckStringSchema, PositivePlanckStringSchema, PriceStringSchema } from './primitives';

/** One open ask a swap can fill. */
export const SwapLevelSchema = z.object({
  offerId: IdSchema,
  price: PriceStringSchema,
  remaining: PlanckStringSchema,
  minFill: PlanckStringSchema,
});
export type SwapLevel = z.infer<typeof SwapLevelSchema>;

/** `GET /swap/quote`. `available: false` → `reason` says why no swap can start right now. */
export const SwapQuoteResponseSchema = z.object({
  available: z.boolean(),
  reason: z.string().nullable(),
  /** Cheapest first. */
  levels: z.array(SwapLevelSchema),
});
export type SwapQuoteResponse = z.infer<typeof SwapQuoteResponseSchema>;

/**
 * `POST /swap`: buy `amount` planck at no more than `maxPrice` (the quote the buyer saw). The
 * server picks the cheapest ask that can take the whole amount.
 */
export const SwapRequestSchema = z.object({
  amount: PositivePlanckStringSchema,
  maxPrice: PriceStringSchema,
  /** Network the buyer pays on, one of `PublicConfig.paymentChains`. Default: the first. */
  paymentChainId: z.number().int().positive().optional(),
});
export type SwapRequest = z.infer<typeof SwapRequestSchema>;
