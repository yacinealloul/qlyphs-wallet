/** Public market data (SPEC §5 Public): config, order book, stats. */
import { z } from 'zod';
import {
  EvmAddressSchema,
  IsoDateSchema,
  MicroStringSchema,
  PlanckStringSchema,
  PriceStringSchema,
  QuantusAddressSchema,
} from './primitives';

/** A network a swap can be paid on. The first listed is the one peer-to-peer trades settle on. */
export const PaymentChainSchema = z.object({
  chainId: z.number().int().positive(),
  name: z.string(),
  tokenAddress: EvmAddressSchema,
  explorerUrl: z.url(),
  nativeSymbol: z.string(),
  /** Public endpoint for a wallet to add the network; null when none is known. */
  rpcUrl: z.url().nullable(),
  confirmations: z.number().int().min(0),
});
export type PaymentChain = z.infer<typeof PaymentChainSchema>;

/** `GET /config` — everything the frontends need to mirror server rules. */
export const PublicConfigSchema = z.object({
  feeBps: z.number().int().min(0),
  lockTimeoutMin: z.number().int().positive(),
  payTimeoutMin: z.number().int().positive(),
  /** Brokered trades: minutes between the confirmed payment and the delivery. */
  deliveryTimeoutMin: z.number().int().positive().optional(),
  quantusConfirmations: z.number().int().min(0),
  evmConfirmations: z.number().int().min(0),
  minFillPlanck: PlanckStringSchema,
  /** SPEC §3b: the platform holds every QTC wallet. There is no browser vault. */
  custodial: z.literal(true),
  /** Rolling 24 h withdrawal limit per user, planck. */
  withdrawDailyLimitPlanck: PlanckStringSchema,
  chainMode: z.enum(['mock', 'quantus']),
  evmMode: z.enum(['mock', 'viem']),
  quantusExplorerUrl: z.url(),
  evmExplorerUrl: z.url(),
  evmChainId: z.number().int().positive(),
  usdcAddress: EvmAddressSchema,
  quoteCurrency: z.enum(['USDC', 'USDT']).optional(),
  /** Networks a swap can be paid on, `evmChainId` first. */
  paymentChains: z.array(PaymentChainSchema).default([]),
  /** The platform escrow hot wallet and the fee account, published on /transparency. */
  escrowAddress: QuantusAddressSchema,
  feeAccount: QuantusAddressSchema,
  /** Telegram sign-in and notifications (SPEC §8). Disabled without `TELEGRAM_BOT_TOKEN`: hide the UI. */
  telegram: z.object({ enabled: z.boolean(), botUsername: z.string().nullable() }),
  /** False: Telegram is the only way to sign in; the email forms must not be shown. */
  emailAuth: z.boolean().default(true),
});
export type PublicConfig = z.infer<typeof PublicConfigSchema>;

export const OrderBookLevelSchema = z.object({
  price: PriceStringSchema,
  /** Sum of `remaining` at this price, planck. */
  amount: PlanckStringSchema,
  /** Running total from the best price down to this level, planck (depth bars). */
  cumulative: PlanckStringSchema,
  offers: z.number().int().positive(),
});
export type OrderBookLevel = z.infer<typeof OrderBookLevelSchema>;

export const ReferencePriceSchema = z.object({
  source: z.enum(['vwap', 'mid', 'none']),
  price: MicroStringSchema.nullable(),
});

/** `GET /orderbook` — bids (buy offers) best/highest first; asks (sell offers) best/lowest first. */
export const OrderBookSchema = z.object({
  bids: z.array(OrderBookLevelSchema),
  asks: z.array(OrderBookLevelSchema),
  bestBid: PriceStringSchema.nullable(),
  bestAsk: PriceStringSchema.nullable(),
  /** `bestAsk - bestBid`, micro; null unless both sides are quoted. May be negative in a P2P book. */
  spread: z
    .string()
    .regex(/^-?\d+$/)
    .nullable(),
  mid: MicroStringSchema.nullable(),
  reference: ReferencePriceSchema,
  updatedAt: IsoDateSchema,
});
export type OrderBook = z.infer<typeof OrderBookSchema>;

export const PricePointSchema = z.object({ t: IsoDateSchema, price: MicroStringSchema });
export type PricePoint = z.infer<typeof PricePointSchema>;

/** `GET /stats` — changes are signed basis points, null without enough history. */
export const StatsSchema = z.object({
  volumeQtc: PlanckStringSchema,
  volumeUsdc: MicroStringSchema,
  volume24hUsdc: MicroStringSchema,
  users: z.number().int().min(0),
  trades: z.number().int().min(0),
  lastPrice: MicroStringSchema.nullable(),
  change24hBps: z.number().int().nullable(),
  change7dBps: z.number().int().nullable(),
  change30dBps: z.number().int().nullable(),
  priceSeries: z.array(PricePointSchema),
  updatedAt: IsoDateSchema,
});
export type Stats = z.infer<typeof StatsSchema>;

/** External market price (SafeTrade or CoinGecko). Display only: trades are always priced by the order book. */
export const MARKET_PRICE_RANGES = ['24h', '7d', '30d'] as const;
export type MarketPriceRange = (typeof MARKET_PRICE_RANGES)[number];

export const MarketPriceQuerySchema = z.object({
  range: z.enum(MARKET_PRICE_RANGES).default('7d'),
});
export type MarketPriceQuery = z.infer<typeof MarketPriceQuerySchema>;

/** Top of the exchange book and the 24 h window, when the source is an exchange (SafeTrade). */
export const ExchangeQuoteSchema = z.object({
  market: z.string(),
  bid: MicroStringSchema.nullable(),
  ask: MicroStringSchema.nullable(),
  high: MicroStringSchema.nullable(),
  low: MicroStringSchema.nullable(),
  /** Base-asset volume over 24 h, in planck. */
  volume: z.string().regex(/^\d{1,40}$/),
});
export type ExchangeQuote = z.infer<typeof ExchangeQuoteSchema>;

export const MarketPriceSchema = z.object({
  source: z.enum(['coingecko', 'safetrade']),
  range: z.enum(MARKET_PRICE_RANGES),
  price: MicroStringSchema,
  change24hBps: z.number().int().nullable(),
  series: z.array(PricePointSchema),
  quote: ExchangeQuoteSchema.optional(),
  updatedAt: IsoDateSchema,
});
export type MarketPrice = z.infer<typeof MarketPriceSchema>;

/** `market` is null when the feed is disabled or the provider is unreachable and nothing is cached. */
export const MarketPriceResponseSchema = z.object({ market: MarketPriceSchema.nullable() });
export type MarketPriceResponse = z.infer<typeof MarketPriceResponseSchema>;
