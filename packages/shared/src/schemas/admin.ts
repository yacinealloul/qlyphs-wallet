/** Admin routes (SPEC §5 Admin). */
import { z } from 'zod';
import { DisputeResolutionSchema, DisputeSchema, DisputeStatusSchema } from './dispute';
import {
  CursorSchema,
  IdSchema,
  IsoDateSchema,
  LimitSchema,
  paginated,
  PlanckStringSchema,
  QuantusAddressSchema,
} from './primitives';
import { TradeSchema } from './trade';
import { PublicUserSchema, UserStatusSchema } from './user';

/** `GET /admin/disputes` */
export const AdminDisputesQuerySchema = z.object({
  status: DisputeStatusSchema.optional(),
  cursor: CursorSchema.optional(),
  limit: LimitSchema,
});
export type AdminDisputesQuery = z.infer<typeof AdminDisputesQuerySchema>;

export const AdminDisputeItemSchema = z.object({ dispute: DisputeSchema, trade: TradeSchema });
export type AdminDisputeItem = z.infer<typeof AdminDisputeItemSchema>;

export const AdminDisputeListResponseSchema = paginated(AdminDisputeItemSchema);
export type AdminDisputeListResponse = z.infer<typeof AdminDisputeListResponseSchema>;

/**
 * `POST /admin/disputes/:id/resolve`. Answers 409 `CUSTODY_TRANSFER_UNRESOLVED` while a release or
 * refund of the trade was handed to the chain and its fate is not known yet (the worker keeps
 * watching it: retry once it is confirmed or provably dead), and 409 `CONFLICT` when a confirmed
 * transfer already moved the funds the other way.
 */
export const ResolveDisputeRequestSchema = z.object({
  resolution: DisputeResolutionSchema,
  note: z.string().trim().min(3).max(2_000),
});
export type ResolveDisputeRequest = z.infer<typeof ResolveDisputeRequestSchema>;

export const ResolveDisputeResponseSchema = AdminDisputeItemSchema;
export type ResolveDisputeResponse = z.infer<typeof ResolveDisputeResponseSchema>;

/** `POST /admin/users/:id/warn` */
export const WarnUserRequestSchema = z.object({
  reason: z.string().trim().min(3).max(1_000),
});
export type WarnUserRequest = z.infer<typeof WarnUserRequestSchema>;

export const AdminUserSchema = PublicUserSchema.extend({
  /** Null for Telegram-only accounts. */
  email: z.string().nullable(),
  warnings: z.number().int().min(0),
  status: UserStatusSchema,
  restrictedUntil: IsoDateSchema.nullable(),
});
export type AdminUser = z.infer<typeof AdminUserSchema>;

export const WarnUserResponseSchema = z.object({
  user: AdminUserSchema,
  consequence: z.enum(['notice', 'restricted', 'banned']),
});
export type WarnUserResponse = z.infer<typeof WarnUserResponseSchema>;

/** `GET /maintenance` and `PUT /admin/maintenance` */
export const MaintenanceSchema = z.object({
  enabled: z.boolean(),
  message: z.string().max(500).nullable(),
  updatedAt: IsoDateSchema.nullable(),
});
export type Maintenance = z.infer<typeof MaintenanceSchema>;

export const SetMaintenanceRequestSchema = z.object({
  enabled: z.boolean(),
  message: z.string().trim().max(500).optional(),
});
export type SetMaintenanceRequest = z.infer<typeof SetMaintenanceRequestSchema>;

/**
 * `GET /admin/escrow` — the escrow accounting invariant (SPEC §3b), as last checked by the worker
 * and re-checked for this call: the hot wallet must hold at least what open trades have locked.
 */
export const EscrowAccountingSchema = z.object({
  escrowAddress: QuantusAddressSchema,
  /** Free balance `QUANTUS_CONFIRMATIONS` below the head. */
  onChain: PlanckStringSchema,
  /** Σ amount of trades in AWAITING_PAYMENT, RELEASING, REFUNDING or DISPUTED still held. */
  owed: PlanckStringSchema,
  /** `onChain − owed` when positive: pays release and refund fees. */
  surplus: PlanckStringSchema,
  /** `owed − onChain` when positive: funds are missing. */
  shortfall: PlanckStringSchema,
  healthy: z.boolean(),
  /** `surplus` is below `ESCROW_MIN_GAS_PLANCK`: top the wallet up. */
  gasLow: z.boolean(),
  tradesCounted: z.number().int().min(0),
  checkedAt: IsoDateSchema,
});
export type EscrowAccounting = z.infer<typeof EscrowAccountingSchema>;

export const EscrowAccountingResponseSchema = z.object({ escrow: EscrowAccountingSchema });
export type EscrowAccountingResponse = z.infer<typeof EscrowAccountingResponseSchema>;

export const UserIdParamSchema = z.object({ id: IdSchema });
