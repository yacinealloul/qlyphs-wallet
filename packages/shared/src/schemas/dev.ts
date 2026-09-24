/** Dev routes, mock modes only (404 otherwise). They drive the mock adapters, never a real chain. */
import { z } from 'zod';
import {
  EvmAddressSchema,
  IdSchema,
  MicroStringSchema,
  PositivePlanckStringSchema,
  UsernameSchema,
} from './primitives';

/**
 * `POST /dev/chain/deposit` — credit a custodial wallet on the mock chain, as an external deposit
 * would. Default: the caller's own wallet; `username` targets another account.
 */
export const DevDepositRequestSchema = z.object({
  amount: PositivePlanckStringSchema,
  username: UsernameSchema.optional(),
});
export type DevDepositRequest = z.infer<typeof DevDepositRequestSchema>;

/** `POST /dev/evm/pay` — emit a USDC transfer. Defaults: exact `quoteTotal` from the buyer address. */
export const DevPayRequestSchema = z.object({
  tradeId: IdSchema,
  amount: MicroStringSchema.optional(),
  from: EvmAddressSchema.optional(),
});
export type DevPayRequest = z.infer<typeof DevPayRequestSchema>;

/** `POST /dev/chain/advance` — mine blocks on the mock chains so confirmations accrue. */
export const DevAdvanceRequestSchema = z.object({
  blocks: z.number().int().min(1).max(100_000),
  chain: z.enum(['quantus', 'evm', 'both']).default('both'),
});
export type DevAdvanceRequest = z.infer<typeof DevAdvanceRequestSchema>;

/**
 * `POST /dev/trades/expire-deadline` — move the running deadline of a trade (lock while
 * AWAITING_LOCK, pay while AWAITING_PAYMENT) into the past, so timeouts can be exercised without
 * waiting for them.
 */
export const DevExpireDeadlineRequestSchema = z.object({ tradeId: IdSchema });
export type DevExpireDeadlineRequest = z.infer<typeof DevExpireDeadlineRequestSchema>;

/**
 * `GET /dev/2fa/code?username=` — mock mode only: a TOTP code the API will accept right now for
 * that account (default: the caller), so a browser test can pass two-factor. `code` is null when
 * every step of the current window was already used; retry after `validInMs`.
 */
export const DevTotpCodeQuerySchema = z.object({ username: UsernameSchema.optional() });
export type DevTotpCodeQuery = z.infer<typeof DevTotpCodeQuerySchema>;

export const DevTotpCodeResponseSchema = z.object({
  code: z
    .string()
    .regex(/^\d{6}$/)
    .nullable(),
  /** Milliseconds until a fresh step starts. */
  validInMs: z.number().int().min(0),
});
export type DevTotpCodeResponse = z.infer<typeof DevTotpCodeResponseSchema>;

/** `POST /dev/security-hold/clear` — mock mode only: end the caller's 24 h security hold now. */
export const DevClearHoldRequestSchema = z.object({ username: UsernameSchema.optional() });
export type DevClearHoldRequest = z.infer<typeof DevClearHoldRequestSchema>;

export const DevResultSchema = z.object({
  ok: z.literal(true),
  quantusHead: z.number().int().min(0),
  evmHead: z.number().int().min(0),
  txHashes: z.array(z.string()),
});
export type DevResult = z.infer<typeof DevResultSchema>;
