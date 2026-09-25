/** Users, profile and sessions (SPEC §3 Users, §3b, §5 Auth). */
import { z } from 'zod';
import {
  EmailSchema,
  EvmAddressSchema,
  IdSchema,
  IsoDateSchema,
  QuantusAddressSchema,
  UsernameSchema,
} from './primitives';

export const UserRoleSchema = z.enum(['user', 'admin']);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const UserStatusSchema = z.enum(['active', 'restricted', 'banned']);
export type UserStatus = z.infer<typeof UserStatusSchema>;

export const RankSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

/** What any visitor may know about a trader. */
export const PublicUserSchema = z.object({
  id: IdSchema,
  username: UsernameSchema,
  rank: RankSchema,
  completedTrades: z.number().int().min(0),
  createdAt: IsoDateSchema,
});
export type PublicUser = z.infer<typeof PublicUserSchema>;

/** `GET /me` */
export const MeSchema = PublicUserSchema.extend({
  /** Null for accounts created with Telegram that never added an email. */
  email: EmailSchema.nullable(),
  emailVerified: z.boolean(),
  /** False for Telegram-only accounts: there is no password to sign in with or to reset. */
  hasPassword: z.boolean(),
  /** Notification chat (SPEC §8). Trading needs a verified email or a linked Telegram. */
  telegram: z.object({ linked: z.boolean(), username: z.string().nullable() }),
  /** Verified email, or a linked Telegram chat that has not blocked the bot. */
  canTrade: z.boolean(),
  /** Trading needs a connected Qlyphs Wallet (`receiveAddress`); it cannot be switched back to the custodial one. */
  walletRequired: z.boolean().default(false),
  /** The platform's market maker account: it sells through the swap and cannot buy from it. */
  marketMaker: z.boolean().default(false),
  role: UserRoleSchema,
  /**
   * The user's custodial QTC wallet (SPEC §3b), created at sign-up and held by the platform.
   * Deposits go here; it is also where bought QTC arrives and refunds return.
   */
  walletAddress: QuantusAddressSchema,
  /** The only user-entered address: where USDC is paid from (buying) and to (selling). */
  evmAddress: EvmAddressSchema.nullable(),
  /**
   * The user's own Quantus wallet (a connected Qlyphs Wallet): bought QTC is released there.
   * Null: it arrives in `walletAddress`.
   */
  receiveAddress: QuantusAddressSchema.nullable().default(null),
  /** TOTP two-factor is on: withdrawals, phrase export and EVM address changes are possible. */
  twoFactorEnabled: z.boolean(),
  /** Withdrawals and phrase export are held until then after a security change; null when none runs. */
  securityHoldUntil: IsoDateSchema.nullable(),
  warnings: z.number().int().min(0),
  status: UserStatusSchema,
  restrictedUntil: IsoDateSchema.nullable(),
  /** Open offers allowed at the current rank and status. */
  offerSlots: z.number().int().min(0),
  openOffers: z.number().int().min(0),
  openTrades: z.number().int().min(0),
});
export type Me = z.infer<typeof MeSchema>;

export const MeResponseSchema = z.object({ user: MeSchema });
export type MeResponse = z.infer<typeof MeResponseSchema>;

/**
 * `PATCH /me` — the Arbitrum address. Blocked with ADDRESS_LOCKED_BY_OPEN_TRADES while the user has
 * open trades. Setting it for the first time needs nothing else; replacing one needs two-factor
 * enabled and a fresh `totp` (or a recovery code).
 */
export const UpdateMeRequestSchema = z.object({
  evmAddress: EvmAddressSchema,
  totp: z.string().trim().min(6).max(32).optional(),
});
export type UpdateMeRequest = z.infer<typeof UpdateMeRequestSchema>;

/**
 * `PUT /me/receive-address` — the wallet bought QTC is released to; `null` goes back to the custodial
 * wallet. Blocked while a trade is open; replacing a set address needs `totp` when two-factor is on.
 */
export const UpdateReceiveAddressRequestSchema = z.object({
  address: QuantusAddressSchema.nullable(),
  totp: z.string().trim().min(6).max(32).optional(),
});
export type UpdateReceiveAddressRequest = z.infer<typeof UpdateReceiveAddressRequestSchema>;

export const SessionInfoSchema = z.object({
  id: IdSchema,
  createdAt: IsoDateSchema,
  lastSeenAt: IsoDateSchema,
  expiresAt: IsoDateSchema,
  userAgent: z.string().nullable(),
  ip: z.string().nullable(),
  current: z.boolean(),
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;

/** `GET /me/sessions` */
export const SessionsResponseSchema = z.object({ sessions: z.array(SessionInfoSchema) });
export type SessionsResponse = z.infer<typeof SessionsResponseSchema>;
