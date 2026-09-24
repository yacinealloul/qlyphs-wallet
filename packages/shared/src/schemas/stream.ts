/** SSE payloads. The SSE `event:` name equals `type`; `data:` is the JSON of `data`. */
import { z } from 'zod';
import { OrderBookSchema, StatsSchema } from './market';
import { PublicTradeSchema, TradeEventRecordSchema, TradeSchema } from './trade';

/** `GET /stream/market` */
export const MarketStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('orderbook'), data: OrderBookSchema }),
  z.object({ type: z.literal('trade'), data: PublicTradeSchema }),
  z.object({ type: z.literal('stats'), data: StatsSchema }),
]);
export type MarketStreamEvent = z.infer<typeof MarketStreamEventSchema>;

/** `GET /stream/trades/:id` */
export const TradeStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('trade'), data: TradeSchema }),
  z.object({ type: z.literal('event'), data: TradeEventRecordSchema }),
]);
export type TradeStreamEvent = z.infer<typeof TradeStreamEventSchema>;

export const MARKET_STREAM_EVENTS = ['orderbook', 'trade', 'stats'] as const;
export const TRADE_STREAM_EVENTS = ['trade', 'event'] as const;
