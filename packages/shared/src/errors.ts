/** API error codes (SPEC §5: errors are `{ error: { code, message } }`). */
import { z } from 'zod';

export const ERROR_CODES = [
  // generic
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'CSRF_MISMATCH',
  'MAINTENANCE',
  'INTERNAL_ERROR',
  // auth / account
  'INVALID_CREDENTIALS',
  'EMAIL_TAKEN',
  'USERNAME_TAKEN',
  'EMAIL_NOT_VERIFIED',
  'TELEGRAM_REQUIRED',
  'EMAIL_AUTH_DISABLED',
  'INVALID_TOKEN',
  'ACCOUNT_BANNED',
  'ACCOUNT_RESTRICTED',
  'ADDRESSES_REQUIRED',
  'WALLET_REQUIRED',
  'INVALID_ADDRESS',
  'ADDRESS_LOCKED_BY_OPEN_TRADES',
  'TELEGRAM_DISABLED',
  'TELEGRAM_AUTH_FAILED',
  'TELEGRAM_CODE_INVALID',
  // two-factor (SPEC §3b)
  'TWO_FACTOR_REQUIRED',
  'TWO_FACTOR_INVALID',
  'TWO_FACTOR_LOCKED',
  'TWO_FACTOR_ALREADY_ENABLED',
  'TWO_FACTOR_NOT_SETUP',
  // offers
  'OFFER_NOT_OPEN',
  'OFFER_SLOTS_EXHAUSTED',
  'OWN_OFFER',
  'INVALID_PRICE',
  'INVALID_AMOUNT',
  'MIN_FILL_TOO_LOW',
  'FILL_BELOW_MIN',
  'FILL_EXCEEDS_REMAINING',
  'FILL_LEAVES_DUST',
  'PRICE_DEVIATION_CONFIRMATION_REQUIRED',
  'PRICE_DEVIATION_REJECTED',
  'OFFER_UNFUNDED',
  // trades
  'ILLEGAL_TRANSITION',
  'TRADE_NOT_PARTY',
  'DISPUTE_ALREADY_OPEN',
  'DISPUTE_NOT_OPEN',
  'CUSTODY_TRANSFER_UNRESOLVED',
  'CHAIN_UNAVAILABLE',
  // custodial wallet (SPEC §3b)
  'INSUFFICIENT_AVAILABLE_BALANCE',
  'WITHDRAWAL_IN_FLIGHT',
  'WITHDRAWAL_LIMIT_EXCEEDED',
  'WITHDRAWAL_HOLD',
  'WALLET_EXPORT_BLOCKED',
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  CSRF_MISMATCH: 403,
  MAINTENANCE: 503,
  INTERNAL_ERROR: 500,
  INVALID_CREDENTIALS: 401,
  EMAIL_TAKEN: 409,
  USERNAME_TAKEN: 409,
  EMAIL_NOT_VERIFIED: 403,
  TELEGRAM_REQUIRED: 403,
  EMAIL_AUTH_DISABLED: 403,
  INVALID_TOKEN: 400,
  ACCOUNT_BANNED: 403,
  ACCOUNT_RESTRICTED: 403,
  ADDRESSES_REQUIRED: 409,
  WALLET_REQUIRED: 409,
  INVALID_ADDRESS: 400,
  ADDRESS_LOCKED_BY_OPEN_TRADES: 409,
  TELEGRAM_DISABLED: 404,
  TELEGRAM_AUTH_FAILED: 401,
  TELEGRAM_CODE_INVALID: 400,
  TWO_FACTOR_REQUIRED: 403,
  TWO_FACTOR_INVALID: 400,
  TWO_FACTOR_LOCKED: 429,
  TWO_FACTOR_ALREADY_ENABLED: 409,
  TWO_FACTOR_NOT_SETUP: 409,
  OFFER_NOT_OPEN: 409,
  OFFER_SLOTS_EXHAUSTED: 409,
  OWN_OFFER: 409,
  INVALID_PRICE: 400,
  INVALID_AMOUNT: 400,
  MIN_FILL_TOO_LOW: 400,
  FILL_BELOW_MIN: 400,
  FILL_EXCEEDS_REMAINING: 409,
  FILL_LEAVES_DUST: 400,
  PRICE_DEVIATION_CONFIRMATION_REQUIRED: 409,
  PRICE_DEVIATION_REJECTED: 400,
  OFFER_UNFUNDED: 409,
  ILLEGAL_TRANSITION: 409,
  TRADE_NOT_PARTY: 403,
  DISPUTE_ALREADY_OPEN: 409,
  DISPUTE_NOT_OPEN: 409,
  CUSTODY_TRANSFER_UNRESOLVED: 409,
  CHAIN_UNAVAILABLE: 503,
  INSUFFICIENT_AVAILABLE_BALANCE: 409,
  WITHDRAWAL_IN_FLIGHT: 409,
  WITHDRAWAL_LIMIT_EXCEEDED: 409,
  WITHDRAWAL_HOLD: 409,
  WALLET_EXPORT_BLOCKED: 409,
};

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    /** Optional machine-readable context (zod issues, guardrail deviation, …). */
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** Error thrown by services and mapped to the JSON envelope by the API's error handler. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = details;
  }

  toJSON(): ApiError {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

export const isAppError = (error: unknown): error is AppError => error instanceof AppError;

/** Narrow an unknown JSON body to the error envelope (client side). */
export function parseApiError(body: unknown): ApiError['error'] | null {
  const parsed = ApiErrorSchema.safeParse(body);
  return parsed.success ? parsed.data.error : null;
}
