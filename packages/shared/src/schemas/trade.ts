/** Trades, trade events and the trade-room requests (SPEC §3 Trades, §5 Trading). */
import { z } from 'zod';
import { TRADE_EVENT_TYPES, TRADE_KINDS, TRADE_STATES } from '../trade-machine';
import { OfferSideSchema } from './offer';
import {
  CursorSchema,
  EvmAddressSchema,
  Hash32Schema,
  IdSchema,
  IsoDateSchema,
  LimitSchema,
  MicroStringSchema,
  paginated,
  PlanckStringSchema,
  PriceStringSchema,
  QuantusAddressSchema,
} from './primitives';
import { PublicUserSchema } from './user';

export const TradeStateSchema = z.enum(TRADE_STATES);
export const TradeEventTypeSchema = z.enum(TRADE_EVENT_TYPES);

export const TradeRoleSchema = z.enum(['seller', 'buyer', 'admin']);
export type TradeRole = z.infer<typeof TradeRoleSchema>;

/** Chain tx hashes are hints for explorers; both chains use 32-byte hashes. */
export const TxHashSchema = Hash32Schema;

/** A USDC transfer that looks related to the trade but does not settle it. Never auto-transitions. */
export const PaymentIssueSchema = z.object({
  kind: z.enum(['underpaid', 'overpaid', 'wrong_sender']),
  txHash: TxHashSchema,
  from: EvmAddressSchema,
  value: MicroStringSchema,
  block: z.number().int().min(0),
});
export type PaymentIssue = z.infer<typeof PaymentIssueSchema>;

/** Confirmation progress of an on-chain step, as last observed by the trade worker. */
export const ConfirmationProgressSchema = z.object({
  current: z.number().int().min(0),
  required: z.number().int().min(0),
});
export type ConfirmationProgress = z.infer<typeof ConfirmationProgressSchema>;

export const TradeTimestampsSchema = z.object({
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  lockedAt: IsoDateSchema.nullable(),
  paidAt: IsoDateSchema.nullable(),
  releasedAt: IsoDateSchema.nullable(),
  refundedAt: IsoDateSchema.nullable(),
  cancelledAt: IsoDateSchema.nullable(),
  disputedAt: IsoDateSchema.nullable(),
});

/** Full trade, visible to its two parties and admins. Addresses are snapshotted at match. */
export const TradeSchema = z.object({
  id: IdSchema,
  offerId: IdSchema,
  /** Side of the offer that was taken (maker's side). */
  offerSide: OfferSideSchema,
  seller: PublicUserSchema,
  buyer: PublicUserSchema,
  /** Role of the requesting user. */
  viewerRole: TradeRoleSchema,

  amount: PlanckStringSchema,
  price: PriceStringSchema,
  quoteTotal: MicroStringSchema,
  quoteCurrency: z.enum(['USDC', 'USDT']).optional(),
  paymentTokenAddress: EvmAddressSchema.optional(),
  /** EVM network the payment is sent on (`PublicConfig.paymentChains`). */
  paymentChainId: z.number().int().positive().optional(),
  fee: PlanckStringSchema,
  /** `amount - fee` */
  buyerReceives: PlanckStringSchema,
  state: TradeStateSchema,
  /**
   * `p2p`: the seller's QTC is locked in escrow at the match, before the buyer pays. `broker`: the
   * platform sells QTC it buys on an exchange once paid, and delivers it by `deliveryDeadline`.
   */
  kind: z.enum(TRADE_KINDS),

  /**
   * Platform escrow wallet holding the QTC of this trade from the lock to the release or refund
   * (SPEC §3b), snapshotted at match.
   */
  escrowAddress: QuantusAddressSchema,
  /** `escrowAddress` as a 0x-prefixed 32-byte id, the form a wallet sends QTC to. */
  escrowAccountId: z
    .string()
    .regex(/^0x[0-9a-f]{64}$/)
    .optional(),
  /** Custodial wallet of the buyer: where `buyerReceives` is released to. */
  buyerQuantusAddress: QuantusAddressSchema,
  /** Seller wallet the lock leaves and a refund returns to. */
  sellerPayoutAddress: QuantusAddressSchema,
  /**
   * `seller`: the seller sends the lock from `sellerPayoutAddress` (their own wallet) and reports
   * it. `platform`: the lock is sent for them.
   */
  lockBy: z.enum(['seller', 'platform']),
  /**
   * While awaiting a seller-sent lock or recovering one after cancellation: `none` reported yet,
   * the last report is `verifying`, or it was `rejected`. Else null. A cancelled trade only accepts
   * reports of existing transfers for refund; it never asks the seller to send again.
   */
  lockReport: z.enum(['none', 'verifying', 'rejected']).nullable(),
  sellerEvmAddress: EvmAddressSchema,
  buyerEvmAddress: EvmAddressSchema,
  evmFromBlock: z.number().int().min(0),
  paymentTxHash: TxHashSchema.nullable(),
  paymentIssues: z.array(PaymentIssueSchema),
  /**
   * Confirmations of the seller wallet → escrow transfer, against `QUANTUS_CONFIRMATIONS`. Null
   * until the worker has sent it (and again if a reorg drops it).
   */
  lockConfirmations: ConfirmationProgressSchema.nullable(),
  /** Confirmations of the exact USDC transfer, against `EVM_CONFIRMATIONS`. Null until one is seen. */
  paymentConfirmations: ConfirmationProgressSchema.nullable(),
  /** Confirmations of the release or refund transfer leaving the escrow. Null until it is sent. */
  settlementConfirmations: ConfirmationProgressSchema.nullable(),
  lockTxHashes: z.array(TxHashSchema),
  releaseTxHashes: z.array(TxHashSchema),
  refundTxHashes: z.array(TxHashSchema),

  lockDeadline: IsoDateSchema,
  payDeadline: IsoDateSchema.nullable(),
  /** Brokered trades: when the QTC must be locked for the buyer. Null until paid, and for p2p. */
  deliveryDeadline: IsoDateSchema.nullable(),
  timestamps: TradeTimestampsSchema,
  disputeId: IdSchema.nullable(),
});
export type Trade = z.infer<typeof TradeSchema>;

export const TradeResponseSchema = z.object({ trade: TradeSchema });
export type TradeResponse = z.infer<typeof TradeResponseSchema>;

/** `GET /me/trades` */
export const MyTradesQuerySchema = z.object({
  status: z.enum(['open', 'closed', 'all']).default('all'),
  cursor: CursorSchema.optional(),
  limit: LimitSchema,
});
export type MyTradesQuery = z.infer<typeof MyTradesQuerySchema>;

export const TradeListResponseSchema = paginated(TradeSchema);
export type TradeListResponse = z.infer<typeof TradeListResponseSchema>;

/** Completed trade on a public offer, as listed on /settlements. No usernames, no addresses. */
export const PublicTradeSchema = z.object({
  id: IdSchema,
  /** Taker direction: `buy` when the taker bought QTC (hit a sell offer). */
  takerSide: OfferSideSchema,
  amount: PlanckStringSchema,
  price: PriceStringSchema,
  quoteTotal: MicroStringSchema,
  quoteCurrency: z.enum(['USDC', 'USDT']).optional(),
  completedAt: IsoDateSchema,
  paymentTxHash: TxHashSchema.nullable(),
  releaseTxHash: TxHashSchema.nullable(),
  paymentExplorerUrl: z.url().nullable(),
  releaseExplorerUrl: z.url().nullable(),
});
export type PublicTrade = z.infer<typeof PublicTradeSchema>;

export const TradeRangeSchema = z.enum(['all', '30d', '7d', '24h']);
export type TradeRange = z.infer<typeof TradeRangeSchema>;

/** `GET /trades/public?range&cursor` */
export const PublicTradesQuerySchema = z.object({
  range: TradeRangeSchema.default('all'),
  cursor: CursorSchema.optional(),
  limit: LimitSchema,
});
export type PublicTradesQuery = z.infer<typeof PublicTradesQuerySchema>;

export const PublicTradeListResponseSchema = paginated(PublicTradeSchema);
export type PublicTradeListResponse = z.infer<typeof PublicTradeListResponseSchema>;

/** `GET /trades/public/:id` — one settlement, for its public ticket. */
export const PublicTradeResponseSchema = z.object({ trade: PublicTradeSchema });
export type PublicTradeResponse = z.infer<typeof PublicTradeResponseSchema>;

/** Audit log row. `type` is a machine event or an informational entry (hints, notes). */
export const TradeLogTypeSchema = z.enum([
  ...TRADE_EVENT_TYPES,
  'TRADE_CREATED',
  /** A custody transfer of the trade was included: `data.kind` is lock, release or refund. */
  'CUSTODY_TRANSFER_SENT',
  'PAYMENT_SUBMITTED',
  'PAYMENT_ISSUE',
  /** The seller reported the transfer that locks the QTC (`data.txHash`). */
  'LOCK_SUBMITTED',
  'LATE_LOCK_VERIFIED',
  // Written by the browser-escrow design only; kept so old audit rows still parse.
  'ESCROW_KEY_SET',
  'REFUND_SUBMITTED',
]);
export type TradeLogType = z.infer<typeof TradeLogTypeSchema>;

export const TradeActorSchema = z.enum(['system', 'seller', 'buyer', 'admin']);
export type TradeActor = z.infer<typeof TradeActorSchema>;

export const TradeEventRecordSchema = z.object({
  id: IdSchema,
  tradeId: IdSchema,
  type: TradeLogTypeSchema,
  fromState: TradeStateSchema.nullable(),
  toState: TradeStateSchema,
  actor: TradeActorSchema,
  /** JSON-safe payload (tx hashes, reasons, …). Amounts inside are base-unit strings. */
  data: z.record(z.string(), z.unknown()),
  createdAt: IsoDateSchema,
});
export type TradeEventRecord = z.infer<typeof TradeEventRecordSchema>;

/** `GET /trades/:id/events` */
export const TradeEventsResponseSchema = z.object({ events: z.array(TradeEventRecordSchema) });
export type TradeEventsResponse = z.infer<typeof TradeEventsResponseSchema>;

/** `POST /trades/:id/payment-submitted` — hint only. */
export const PaymentSubmittedRequestSchema = z.object({ txHash: TxHashSchema });

/** `POST /trades/:id/lock`: the seller sent the lock from their own wallet. */
export const SellerLockRequestSchema = z.object({ txHash: TxHashSchema });
export type SellerLockRequest = z.infer<typeof SellerLockRequestSchema>;
export type PaymentSubmittedRequest = z.infer<typeof PaymentSubmittedRequestSchema>;
