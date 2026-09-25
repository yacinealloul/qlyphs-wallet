/** Offers (SPEC §3 Offers, §5). `side` is always the maker's side of QTC. */
import { z } from 'zod';
import {
  CursorSchema,
  IdSchema,
  IsoDateSchema,
  LimitSchema,
  paginated,
  PlanckStringSchema,
  PositivePlanckStringSchema,
  PriceStringSchema,
  TokenSchema,
} from './primitives';
import { PublicUserSchema } from './user';
import { TRADE_KINDS } from '../trade-machine';

export const OfferSideSchema = z.enum(['sell', 'buy']);
export type OfferSide = z.infer<typeof OfferSideSchema>;

export const OfferVisibilitySchema = z.enum(['public', 'private']);
export type OfferVisibility = z.infer<typeof OfferVisibilitySchema>;

export const OfferStatusSchema = z.enum(['open', 'filled', 'cancelled']);
export type OfferStatus = z.infer<typeof OfferStatusSchema>;

export const OfferSchema = z.object({
  id: IdSchema,
  side: OfferSideSchema,
  price: PriceStringSchema,
  quoteCurrency: z.enum(['USDC', 'USDT']).optional(),
  amount: PlanckStringSchema,
  remaining: PlanckStringSchema,
  minFill: PlanckStringSchema,
  visibility: OfferVisibilitySchema,
  status: OfferStatusSchema,
  /** `broker`: sold by the platform, bought on an exchange once paid and delivered after (see Trade.kind). */
  kind: z.enum(TRADE_KINDS),
  createdAt: IsoDateSchema,
  maker: PublicUserSchema,
});
export type Offer = z.infer<typeof OfferSchema>;

/** The maker's own view: adds the private share token and open-trade count. */
export const MyOfferSchema = OfferSchema.extend({
  privateToken: TokenSchema.nullable(),
  openTrades: z.number().int().min(0),
});
export type MyOffer = z.infer<typeof MyOfferSchema>;

/** `POST /offers` — `minFill` defaults to MIN_FILL_PLANCK and must be ≤ amount. */
export const CreateOfferRequestSchema = z
  .object({
    quoteCurrency: z.literal('USDT'),
    side: OfferSideSchema,
    price: PriceStringSchema,
    amount: PositivePlanckStringSchema,
    minFill: PositivePlanckStringSchema.optional(),
    visibility: OfferVisibilitySchema.default('public'),
    confirmDeviation: z.boolean().optional(),
  })
  .refine((v) => v.minFill === undefined || BigInt(v.minFill) <= BigInt(v.amount), {
    message: 'minFill cannot exceed amount',
    path: ['minFill'],
  });
export type CreateOfferRequest = z.infer<typeof CreateOfferRequestSchema>;

export const OfferResponseSchema = z.object({ offer: OfferSchema });
export type OfferResponse = z.infer<typeof OfferResponseSchema>;

export const MyOfferResponseSchema = z.object({ offer: MyOfferSchema });
export type MyOfferResponse = z.infer<typeof MyOfferResponseSchema>;

/** `GET /offers?side&cursor` — open public offers, best price first. */
export const ListOffersQuerySchema = z.object({
  side: OfferSideSchema.optional(),
  cursor: CursorSchema.optional(),
  limit: LimitSchema,
});
export type ListOffersQuery = z.infer<typeof ListOffersQuerySchema>;

export const OfferListResponseSchema = paginated(OfferSchema);
export type OfferListResponse = z.infer<typeof OfferListResponseSchema>;

/** `GET /me/offers` */
export const MyOffersQuerySchema = z.object({
  status: OfferStatusSchema.optional(),
  cursor: CursorSchema.optional(),
  limit: LimitSchema,
});
export type MyOffersQuery = z.infer<typeof MyOffersQuerySchema>;

export const MyOfferListResponseSchema = paginated(MyOfferSchema);
export type MyOfferListResponse = z.infer<typeof MyOfferListResponseSchema>;

/**
 * `POST /offers/:id/take`. `privateToken` is required to take a private offer. Whoever ends up
 * selling needs the amount available in their custodial wallet (SPEC §3b).
 */
export const TakeOfferRequestSchema = z.object({
  quoteCurrency: z.literal('USDT'),
  amount: PositivePlanckStringSchema,
  confirmDeviation: z.boolean().optional(),
  privateToken: TokenSchema.optional(),
});
export type TakeOfferRequest = z.infer<typeof TakeOfferRequestSchema>;
