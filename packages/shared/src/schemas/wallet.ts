/** Custodial wallet, withdrawals, phrase export and two-factor (SPEC §3b). */
import { z } from 'zod';
import {
  CursorSchema,
  Hash32Schema,
  IdSchema,
  IsoDateSchema,
  LimitSchema,
  paginated,
  PlanckStringSchema,
  PositivePlanckStringSchema,
  QuantusAddressSchema,
} from './primitives';

/**
 * A TOTP code (6 digits; spaces tolerated) or one of the single-use recovery codes
 * (`xxxxx-xxxxx`). Sent with every sensitive action.
 */
export const TotpCodeSchema = z
  .string()
  .trim()
  .min(6)
  .max(32)
  .regex(/^[0-9A-Za-z -]+$/, 'Expected a 6-digit code or a recovery code');

/** A balance increase of the wallet that no platform transfer explains: an external deposit. */
export const WalletDepositSchema = z.object({
  id: IdSchema,
  amount: PlanckStringSchema,
  /** Block (at `QUANTUS_CONFIRMATIONS` depth) at which the increase was first seen. */
  observedAtBlock: z.number().int().min(0),
  createdAt: IsoDateSchema,
});
export type WalletDeposit = z.infer<typeof WalletDepositSchema>;

/** `GET /me/wallet`. The chain is the source of truth; the database only adds what it promised. */
export const WalletSchema = z.object({
  address: QuantusAddressSchema,
  /**
   * The same account as a 0x-prefixed 32-byte id: the form a connected Qlyphs Wallet sends QTC to.
   * Optional so a newer app still reads an older API.
   */
  accountId: z
    .string()
    .regex(/^0x[0-9a-f]{64}$/)
    .optional(),
  /** Free balance `QUANTUS_CONFIRMATIONS` below the head. */
  onChain: PlanckStringSchema,
  /**
   * Already in the wallet at the chain head but not deep enough to count yet:
   * `max(0, balance at head − onChain)`. Display only; nothing can be spent out of it.
   */
  incoming: PlanckStringSchema.default('0'),
  existentialDeposit: PlanckStringSchema,
  /** Kept back for network fees (one lock, one withdrawal). */
  feeReserve: PlanckStringSchema,
  /** `max(0, onChain − existentialDeposit − feeReserve)` */
  available: PlanckStringSchema,
  /** What the database already promised out of `available`. */
  reserved: z.object({
    /** Σ `remaining` of the open sell offers. */
    openSellOffers: PlanckStringSchema,
    /** Trades matched as seller whose lock has not confirmed yet. */
    pendingLocks: PlanckStringSchema,
    /** Withdrawals not confirmed yet. */
    pendingWithdrawals: PlanckStringSchema,
    total: PlanckStringSchema,
  }),
  /** `max(0, available − reserved.total)`: what a new sell offer, take or withdrawal may use. */
  spendable: PlanckStringSchema,
  /** QTC of this user's trades as seller currently held by the platform escrow wallet. */
  inEscrow: PlanckStringSchema,
  /** Newest first, at most 20. Best effort: derived from balance increases, not from a transfer index. */
  recentDeposits: z.array(WalletDepositSchema),
  withdrawDailyLimit: PlanckStringSchema,
  /** Already used of the limit in the last 24 h. */
  withdrawnLast24h: PlanckStringSchema,
});
export type Wallet = z.infer<typeof WalletSchema>;

export const WalletResponseSchema = z.object({ wallet: WalletSchema });
export type WalletResponse = z.infer<typeof WalletResponseSchema>;

export const WITHDRAWAL_STATUSES = ['pending', 'sent', 'confirmed', 'failed'] as const;
export const WithdrawalStatusSchema = z.enum(WITHDRAWAL_STATUSES);
export type WithdrawalStatus = z.infer<typeof WithdrawalStatusSchema>;

/** `pending` and `sent` count as "in flight": one per user at a time. */
export const WITHDRAWAL_IN_FLIGHT_STATUSES: readonly WithdrawalStatus[] = ['pending', 'sent'];

export const WithdrawalSchema = z.object({
  id: IdSchema,
  to: QuantusAddressSchema,
  amount: PlanckStringSchema,
  status: WithdrawalStatusSchema,
  txHash: Hash32Schema.nullable(),
  explorerUrl: z.url().nullable(),
  /** Network fee charged to the wallet on top of `amount`; null until sent. */
  networkFee: PlanckStringSchema.nullable(),
  /** Why it failed, in words a user can act on; null otherwise. */
  failureReason: z.string().nullable(),
  createdAt: IsoDateSchema,
  sentAt: IsoDateSchema.nullable(),
  confirmedAt: IsoDateSchema.nullable(),
});
export type Withdrawal = z.infer<typeof WithdrawalSchema>;

/** `POST /me/withdrawals` — `totp` is required only when the account has two-factor on. */
export const CreateWithdrawalRequestSchema = z.object({
  to: QuantusAddressSchema,
  amount: PositivePlanckStringSchema,
  totp: TotpCodeSchema.optional(),
});
export type CreateWithdrawalRequest = z.infer<typeof CreateWithdrawalRequestSchema>;

export const WithdrawalResponseSchema = z.object({ withdrawal: WithdrawalSchema });
export type WithdrawalResponse = z.infer<typeof WithdrawalResponseSchema>;

/** `GET /me/withdrawals` — newest first. */
export const WithdrawalsQuerySchema = z.object({
  cursor: CursorSchema.optional(),
  limit: LimitSchema,
});
export type WithdrawalsQuery = z.infer<typeof WithdrawalsQuerySchema>;

export const WithdrawalListResponseSchema = paginated(WithdrawalSchema);
export type WithdrawalListResponse = z.infer<typeof WithdrawalListResponseSchema>;

/** `POST /me/wallet/export` — `totp` is required only when the account has two-factor on. */
export const ExportWalletRequestSchema = z.object({ totp: TotpCodeSchema.optional() });
export type ExportWalletRequest = z.infer<typeof ExportWalletRequestSchema>;

/**
 * The 24-word recovery phrase, answered with `cache-control: no-store`. Whoever holds it controls
 * the wallet; the platform keeps its copy (exporting does not end custody).
 */
export const ExportWalletResponseSchema = z.object({
  address: QuantusAddressSchema,
  phrase: z.string(),
});
export type ExportWalletResponse = z.infer<typeof ExportWalletResponseSchema>;

/** `GET /me/2fa` */
export const TwoFactorStatusSchema = z.object({
  enabled: z.boolean(),
  /** A secret was issued by `/me/2fa/setup` and waits for its first code. */
  pendingSetup: z.boolean(),
  enabledAt: IsoDateSchema.nullable(),
  recoveryCodesLeft: z.number().int().min(0),
  /** Too many wrong codes: nothing is accepted until then. */
  lockedUntil: IsoDateSchema.nullable(),
});
export type TwoFactorStatus = z.infer<typeof TwoFactorStatusSchema>;

export const TwoFactorStatusResponseSchema = z.object({ twoFactor: TwoFactorStatusSchema });
export type TwoFactorStatusResponse = z.infer<typeof TwoFactorStatusResponseSchema>;

/** `POST /me/2fa/setup` — the secret is shown once more only by calling setup again (new secret). */
export const TwoFactorSetupResponseSchema = z.object({
  /** Base32, for manual entry. */
  secret: z.string().regex(/^[A-Z2-7]+$/),
  /** `otpauth://totp/…` for the QR code. */
  otpauthUri: z.string().startsWith('otpauth://totp/'),
});
export type TwoFactorSetupResponse = z.infer<typeof TwoFactorSetupResponseSchema>;

/** `POST /me/2fa/enable` — the first code of the authenticator. Six digits only. */
export const TwoFactorEnableRequestSchema = z.object({
  code: z
    .string()
    .max(16)
    .transform((v) => v.replace(/[\s-]/g, ''))
    .pipe(z.string().regex(/^\d{6}$/, 'The code has six digits')),
});
export type TwoFactorEnableRequest = z.infer<typeof TwoFactorEnableRequestSchema>;

/** Shown once; stored hashed. Each code replaces a TOTP code a single time. */
export const TwoFactorEnableResponseSchema = z.object({
  twoFactor: TwoFactorStatusSchema,
  recoveryCodes: z.array(z.string()),
});
export type TwoFactorEnableResponse = z.infer<typeof TwoFactorEnableResponseSchema>;

/** `POST /me/2fa/disable` — a TOTP code or a recovery code. */
export const TwoFactorDisableRequestSchema = z.object({ code: TotpCodeSchema });
export type TwoFactorDisableRequest = z.infer<typeof TwoFactorDisableRequestSchema>;
