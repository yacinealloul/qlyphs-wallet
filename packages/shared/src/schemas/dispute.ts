/** Disputes (SPEC §3 Disputes). */
import { z } from 'zod';
import { IdSchema, IsoDateSchema } from './primitives';

export const DisputeStatusSchema = z.enum(['open', 'resolved']);
export type DisputeStatus = z.infer<typeof DisputeStatusSchema>;

export const DisputeResolutionSchema = z.enum(['release', 'refund']);

export const DisputeOpenerSchema = z.enum(['seller', 'buyer', 'admin', 'system']);

export const DisputeSchema = z.object({
  id: IdSchema,
  tradeId: IdSchema,
  openedBy: DisputeOpenerSchema,
  /** Null when the system opened it. */
  openedByUserId: IdSchema.nullable(),
  reason: z.string(),
  evidence: z.string().nullable(),
  status: DisputeStatusSchema,
  resolution: DisputeResolutionSchema.nullable(),
  /** Visible to both parties once resolved. */
  adminNote: z.string().nullable(),
  createdAt: IsoDateSchema,
  resolvedAt: IsoDateSchema.nullable(),
});
export type Dispute = z.infer<typeof DisputeSchema>;

/** `POST /trades/:id/dispute` */
export const OpenDisputeRequestSchema = z.object({
  reason: z.string().trim().min(10, 'Explain the problem in at least 10 characters').max(2_000),
  /** Free text and/or URLs (tx links, screenshots). */
  evidence: z.string().trim().max(4_000).optional(),
});
export type OpenDisputeRequest = z.infer<typeof OpenDisputeRequestSchema>;

export const DisputeResponseSchema = z.object({ dispute: DisputeSchema });
export type DisputeResponse = z.infer<typeof DisputeResponseSchema>;
