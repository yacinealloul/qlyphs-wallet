/**
 * Protocol constants and spec defaults (docs/SPEC.md §2, §3, §7).
 * Values that operators may override live in `config.ts`; the numbers here are the defaults.
 */

export const QTC_DECIMALS = 12;
export const USDC_DECIMALS = 6;

/** 1 QTC in planck. */
export const PLANCK_PER_QTC = 10n ** 12n;
/** 1 USDC in micro. */
export const MICRO_PER_USDC = 10n ** 6n;
/** One cent in USDC micro. Quote totals are rounded to this unit. */
export const CENT_MICRO = 10_000n;
/** Price tick: $0.01 per QTC, in USDC micro. */
export const PRICE_TICK_MICRO = 10_000n;

export const BPS_DENOMINATOR = 10_000n;

export const DEFAULT_FEE_BPS = 200;
export const DEFAULT_MIN_FILL_PLANCK = PLANCK_PER_QTC;
/**
 * 1.25 QTC, sent on top of the amount to the per-trade escrow key to cover chain fees and burns.
 * `propose` charges about 1.01 QTC up front (mostly refunded) and the key peaks near 1.12 QTC above
 * the amount, so anything lower stops the lock with INSUFFICIENT_BALANCE (packages/chain/README.md).
 */
export const DEFAULT_ESCROW_FEE_BUFFER_PLANCK = (PLANCK_PER_QTC * 5n) / 4n;

/** SPEC §3b: planck a user may withdraw per rolling 24 h (10 000 QTC). */
export const DEFAULT_WITHDRAW_DAILY_LIMIT_PLANCK = 10_000n * PLANCK_PER_QTC;
/** Below this the escrow hot wallet can no longer pay release and refund fees: operators are alerted. */
export const DEFAULT_ESCROW_MIN_GAS_PLANCK = 5n * PLANCK_PER_QTC;
/** Hold on withdrawals and phrase export after a security change (2FA enabled, Telegram link, password reset). */
export const SECURITY_HOLD_HOURS = 24;
/** Two-factor (RFC 6238): SHA-1, 6 digits, 30 s steps, ±1 step of clock drift. */
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SEC = 30;
export const TOTP_WINDOW_STEPS = 1;
export const TWO_FACTOR_MAX_FAILURES = 5;
export const TWO_FACTOR_LOCK_MIN = 15;
export const TWO_FACTOR_RECOVERY_CODES = 10;

export const DEFAULT_LOCK_TIMEOUT_MIN = 60;
export const DEFAULT_PAY_TIMEOUT_MIN = 90;
export const DEFAULT_QUANTUS_CONFIRMATIONS = 30;
export const DEFAULT_EVM_CONFIRMATIONS = 12;

export const DEFAULT_EVM_CHAIN_ID = 42161;
export const DEFAULT_USDC_ADDRESS = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
export const DEFAULT_QUANTUS_EXPLORER_URL = 'https://explorer.quantus.com';
export const DEFAULT_EVM_EXPLORER_URL = 'https://arbiscan.io';

export const QUANTUS_SS58_PREFIX = 189;
/** HD path used by `@quantus-network/wasm` for the escrow key at `index`. */
export const escrowDerivationPath = (index: number): string => `m/44'/189189'/${index}'/0'/0'`;

/** Per-trade escrow multisig: seller escrow key + platform key, both required. */
export const ESCROW_THRESHOLD = 2;
/** Longest proposal expiry the multisig pallet accepts (≈ 14 days at 12 s blocks). */
export const MAX_PROPOSAL_EXPIRY_BLOCKS = 100_800;
/** Target block time of Quantus. Only ever used to turn a duration into a block count. */
export const QUANTUS_BLOCK_TIME_SEC = 12;
/**
 * How long the release proposal must outlive the payment window when the lock is verified:
 * confirmations on both chains, the co-signature, and a dispute an admin has to look at (3 days).
 */
export const RELEASE_EXPIRY_MARGIN_BLOCKS = 21_600;
/** The same, once the buyer is already paying: one day past the pay deadline. */
export const RELEASE_EXPIRY_PAYING_MARGIN_BLOCKS = 7_200;

/** Blocks Quantus produces in `ms`, rounded up. */
export const quantusBlocksIn = (ms: number): number =>
  Math.ceil(Math.max(0, ms) / (QUANTUS_BLOCK_TIME_SEC * 1_000));

/**
 * Minimum remaining lifetime of `R` at lock verification. Capped at half the longest expiry the
 * pallet accepts, so an extreme `PAY_TIMEOUT_MIN` cannot make every lock unverifiable.
 */
export const minReleaseLifetimeBlocks = (payTimeoutMin: number): number =>
  Math.min(
    quantusBlocksIn(payTimeoutMin * 60_000) + RELEASE_EXPIRY_MARGIN_BLOCKS,
    MAX_PROPOSAL_EXPIRY_BLOCKS / 2,
  );

export const SESSION_COOKIE = 'qotc_session';
export const CSRF_COOKIE = 'qotc_csrf';
export const CSRF_HEADER = 'x-qotc-csrf';
/** httpOnly cookie binding a pending Telegram sign-in to the browser that started it (SPEC §8). */
export const TELEGRAM_LOGIN_COOKIE = 'qotc_tg_login';
export const SESSION_TTL_DAYS = 30;
export const PASSWORD_MIN_LENGTH = 12;

/** Price guardrail (SPEC §3 Offers). */
export const GUARDRAIL_VWAP_TRADES = 20;
export const GUARDRAIL_VWAP_WINDOW_DAYS = 7;
export const GUARDRAIL_CONFIRM_DEVIATION_BPS = 2_000n;
/** More than 80 % below the reference is rejected. */
export const GUARDRAIL_REJECT_BELOW_BPS = 8_000n;
/** More than 400 % above the reference is rejected. */
export const GUARDRAIL_REJECT_ABOVE_BPS = 40_000n;

/** Timer worker polling interval. */
export const WORKER_POLL_INTERVAL_MS = 10_000;

export const RESTRICTION_DAYS = 7;

export const API_PORT = 4000;
export const WEB_PORT = 3000;
export const APP_PORT = 3001;
