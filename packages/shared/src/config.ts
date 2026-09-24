/**
 * Environment parsing (SPEC §7). Pure: pass `process.env` (or any record) in, get a typed config or a
 * readable error out. Empty strings count as "unset" so a copied `.env.example` behaves like defaults.
 */
import { z } from 'zod';
import {
  DEFAULT_ESCROW_MIN_GAS_PLANCK,
  DEFAULT_EVM_CHAIN_ID,
  DEFAULT_EVM_CONFIRMATIONS,
  DEFAULT_EVM_EXPLORER_URL,
  DEFAULT_FEE_BPS,
  DEFAULT_LOCK_TIMEOUT_MIN,
  DEFAULT_MIN_FILL_PLANCK,
  DEFAULT_PAY_TIMEOUT_MIN,
  DEFAULT_QUANTUS_CONFIRMATIONS,
  DEFAULT_QUANTUS_EXPLORER_URL,
  DEFAULT_USDC_ADDRESS,
  DEFAULT_WITHDRAW_DAILY_LIMIT_PLANCK,
  API_PORT,
} from './constants';

const DEV_SESSION_SECRET = 'dev-only-session-secret-change-me-0000000000';
/** Mock mode only: 32 bytes, hex. Wallet secrets sealed under it protect play money. */
export const DEV_CUSTODY_MASTER_KEY =
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
/** Mock mode only: a valid 24-word phrase for the escrow hot wallet of the in-memory chain. */
export const DEV_ESCROW_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';

/** 32 bytes as 64 hex characters or as base64 (44 characters with padding). */
const masterKey = z
  .string()
  .refine((v) => /^[0-9a-fA-F]{64}$/.test(v) || /^[A-Za-z0-9+/]{43}=$/.test(v), {
    message: 'must be 32 bytes: 64 hex characters or base64',
  });

const mnemonic24 = z
  .string()
  .transform((v) => v.trim().toLowerCase().split(/\s+/).join(' '))
  .refine((v) => v.split(' ').length === 24 && /^[a-z ]+$/.test(v), {
    message: 'must be a 24-word recovery phrase',
  });

const intString = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/, 'must be a non-negative integer')
    .transform((v) => Number(v))
    .pipe(z.number().int().min(min).max(max));

const bigintString = (min: bigint) =>
  z
    .string()
    .regex(/^\d{1,40}$/, 'must be a non-negative integer')
    .transform((v) => BigInt(v))
    .refine((v) => v >= min, { message: `must be at least ${min}` });

const origin = z
  .url()
  .refine((v) => /^https?:\/\//.test(v), { message: 'must be an http(s) URL' })
  .transform((v) => v.replace(/\/+$/, ''));

const anyUrl = z.url().transform((v) => v.replace(/\/+$/, ''));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: intString(1, 65_535).default(API_PORT),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),

  DATABASE_URL: z.string().min(1).optional(),
  APP_ORIGIN: origin.default('http://localhost:3001'),
  WEB_ORIGIN: origin.default('http://localhost:3000'),
  API_URL: origin.default('http://localhost:4000'),
  SESSION_SECRET: z.string().min(32, 'must be at least 32 characters').default(DEV_SESSION_SECRET),

  CHAIN_MODE: z.enum(['mock', 'quantus']).default('mock'),
  EVM_MODE: z.enum(['mock', 'viem']).default('mock'),

  QUANTUS_RPC_URL: anyUrl.optional(),
  QUANTUS_EXPLORER_URL: origin.default(DEFAULT_QUANTUS_EXPLORER_URL),
  /** Key of the 2-of-2 multisig library in `@qotc/chain`. The custodial API (SPEC §3b) does not use it. */
  PLATFORM_MNEMONIC: z.string().min(1).optional(),
  FEE_ACCOUNT: z.string().min(1).optional(),
  FEE_BPS: intString(0, 1_000).default(DEFAULT_FEE_BPS),
  /** SPEC §3b: seals every user wallet phrase and TOTP secret at rest (AES-256-GCM). */
  CUSTODY_MASTER_KEY: masterKey.optional(),
  /** SPEC §3b: recovery phrase of the platform escrow hot wallet. */
  ESCROW_MNEMONIC: mnemonic24.optional(),
  WITHDRAW_DAILY_LIMIT_PLANCK: bigintString(1n).default(DEFAULT_WITHDRAW_DAILY_LIMIT_PLANCK),
  /** Kept back in every user wallet for network fees. Unset → two single-leg transfer fees. */
  WALLET_FEE_RESERVE_PLANCK: bigintString(0n).optional(),
  ESCROW_MIN_GAS_PLANCK: bigintString(0n).default(DEFAULT_ESCROW_MIN_GAS_PLANCK),

  EVM_RPC_URL: anyUrl.optional(),
  EVM_CHAIN_ID: intString(1, Number.MAX_SAFE_INTEGER).default(DEFAULT_EVM_CHAIN_ID),
  USDC_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 20-byte hex address')
    .default(DEFAULT_USDC_ADDRESS),
  EVM_EXPLORER_URL: origin.default(DEFAULT_EVM_EXPLORER_URL),

  QUANTUS_CONFIRMATIONS: intString(0, 10_000).default(DEFAULT_QUANTUS_CONFIRMATIONS),
  EVM_CONFIRMATIONS: intString(0, 10_000).default(DEFAULT_EVM_CONFIRMATIONS),
  LOCK_TIMEOUT_MIN: intString(1, 10_080).default(DEFAULT_LOCK_TIMEOUT_MIN),
  PAY_TIMEOUT_MIN: intString(1, 10_080).default(DEFAULT_PAY_TIMEOUT_MIN),
  /** Brokered trades: minutes between the payment and the delivery lock before a human steps in. */
  DELIVERY_TIMEOUT_MIN: intString(1, 10_080).default(30),
  MIN_FILL_PLANCK: bigintString(1n).default(DEFAULT_MIN_FILL_PLANCK),

  ADMIN_EMAILS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.length > 0),
    )
    .pipe(z.array(z.email())),
  /**
   * Telegram user ids (numeric, from @userinfobot) that are administrators. Accounts are Telegram
   * only, so this is how the first admin exists: the role is granted at sign-in.
   */
  ADMIN_TELEGRAM_IDS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((e) => e.trim())
        .filter((e) => e.length > 0),
    )
    .pipe(z.array(z.string().regex(/^[1-9]\d{4,15}$/, 'must be numeric Telegram user ids')))
    .transform((ids) => ids.map(Number)),
  /**
   * Email + password accounts (sign-up, sign-in, password reset). The product is Telegram only:
   * unset means off in production and on elsewhere, so local stacks and tests need no bot.
   */
  EMAIL_AUTH: z.enum(['enabled', 'disabled']).optional(),
  /** `true`: trading needs a connected Qlyphs Wallet (bought QTC goes there). Default: on in production. */
  QLYPHS_WALLET_REQUIRED: z.enum(['true', 'false']).optional(),
  MAIL_TRANSPORT: z.enum(['console', 'resend']).default('console'),
  /** `MAIL_TRANSPORT=resend`: API key of the Resend account. */
  RESEND_API_KEY: z.string().min(1).optional(),
  /** Sender, e.g. `Qlyphs OTC <no-reply@qlyphs.com>`; its domain must be verified at the provider. */
  MAIL_FROM: z.string().min(3).optional(),
  /**
   * The console transport delivers nothing. Production refuses it unless this says, explicitly,
   * that running without outgoing mail is intended.
   */
  ALLOW_CONSOLE_MAIL_IN_PRODUCTION: z.enum(['true', 'false']).default('false'),

  /**
   * How many reverse proxies in front of the API append the peer address to `X-Forwarded-For`.
   * 0 → the header is ignored and the socket address is the client.
   */
  TRUSTED_PROXY_HOPS: intString(0, 10).optional(),

  /** `<bot id>:<secret>` from @BotFather. Unset → the Telegram feature is off. */
  TELEGRAM_BOT_TOKEN: z
    .string()
    .regex(/^\d+:[A-Za-z0-9_-]{20,}$/, 'must look like 123456:ABC… (from @BotFather)')
    .optional(),
  TELEGRAM_BOT_USERNAME: z
    .string()
    .regex(/^@?[A-Za-z][A-Za-z0-9_]{3,31}$/, 'must be a Telegram username')
    .transform((v) => v.replace(/^@/, ''))
    .optional(),
  /** Set → webhook mode; unset → long polling. Telegram allows [A-Za-z0-9_-], up to 256 chars. */
  TELEGRAM_WEBHOOK_SECRET: z
    .string()
    .regex(/^[A-Za-z0-9_-]{16,256}$/, 'must be 16–256 characters of A–Z, a–z, 0–9, _ or -')
    .optional(),
  /** Public URL Telegram calls in webhook mode; defaults to `<API_URL>/api/telegram/webhook`. */
  TELEGRAM_WEBHOOK_URL: origin.optional(),

  /**
   * Posting settlements on X (SPEC §9a). The four credentials of one app, from the developer
   * portal, with write access. Any of them missing → nothing is ever posted.
   */
  X_API_KEY: z.string().min(10).optional(),
  X_API_SECRET: z.string().min(10).optional(),
  X_ACCESS_TOKEN: z.string().min(10).optional(),
  X_ACCESS_SECRET: z.string().min(10).optional(),
  /** Settlements smaller than this USDC total stay unannounced. 0 (default) posts every one. */
  X_MIN_USDC: intString(0, 1_000_000).optional(),
});

type ParsedEnv = z.infer<typeof EnvSchema>;

export interface AppConfig {
  nodeEnv: ParsedEnv['NODE_ENV'];
  isProduction: boolean;
  port: number;
  logLevel: NonNullable<ParsedEnv['LOG_LEVEL']>;
  /** Unset → embedded PGlite. */
  databaseUrl: string | null;
  appOrigin: string;
  webOrigin: string;
  apiUrl: string;
  sessionSecret: string;
  chainMode: ParsedEnv['CHAIN_MODE'];
  evmMode: ParsedEnv['EVM_MODE'];
  quantus: {
    rpcUrl: string | null;
    explorerUrl: string;
    platformMnemonic: string | null;
    feeAccount: string | null;
    confirmations: number;
  };
  evm: {
    rpcUrl: string | null;
    chainId: number;
    usdcAddress: string;
    explorerUrl: string;
    confirmations: number;
  };
  feeBps: number;
  lockTimeoutMin: number;
  payTimeoutMin: number;
  deliveryTimeoutMin: number;
  minFillPlanck: bigint;
  /** SPEC §3b. Secrets: never log this object. */
  custody: {
    /** 32 bytes, hex or base64, as configured. */
    masterKey: string;
    escrowMnemonic: string;
    withdrawDailyLimitPlanck: bigint;
    /** Null → derived from the adapter's fee estimate. */
    walletFeeReservePlanck: bigint | null;
    escrowMinGasPlanck: bigint;
  };
  /** False: Telegram is the only way in (`EMAIL_AUTH`, off by default outside the test suites). */
  emailAuth: boolean;
  /** Trading needs a connected Qlyphs Wallet (`QLYPHS_WALLET_REQUIRED`, on by default in production). */
  qlyphsWalletRequired: boolean;
  adminEmails: string[];
  /** Telegram user ids granted the admin role at sign-in. */
  adminTelegramIds: number[];
  mailTransport: ParsedEnv['MAIL_TRANSPORT'];
  /** Set together with `mailTransport: 'resend'`. */
  mail: { resendApiKey: string | null; from: string | null };
  /**
   * Proxies in front of the API that append to `X-Forwarded-For`; the client IP is read that many
   * entries from the right. 0 → the header is never believed.
   */
  trustedProxyHops: number;
  /** SPEC §8. `botToken === null` → feature off. */
  telegram: {
    botToken: string | null;
    botUsername: string | null;
    /** Null → long polling. */
    webhookSecret: string | null;
    webhookUrl: string;
  };
  /** SPEC §9a. Any credential missing → settlements are not posted anywhere. */
  x: {
    apiKey: string | null;
    apiSecret: string | null;
    accessToken: string | null;
    accessSecret: string | null;
    minUsdc: number;
  };
  /** True when the adapters are mocked (never in production): `/dev/*` routes and the dev panel. */
  devRoutesEnabled: boolean;
}

export class ConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid environment:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

export type ConfigResult = { ok: true; config: AppConfig } | { ok: false; issues: string[] };

function withoutBlanks(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value.trim() !== '') out[key] = value.trim();
  }
  return out;
}

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** True only for a URL whose host is this machine: a throwaway dev node, never a public chain. */
export function isLoopbackUrl(url: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Cross-field requirements that depend on the selected modes and environment. */
function crossFieldIssues(env: ParsedEnv): string[] {
  const issues: string[] = [];
  if (env.CHAIN_MODE === 'quantus') {
    if (!env.QUANTUS_RPC_URL) issues.push('QUANTUS_RPC_URL: required when CHAIN_MODE=quantus');
    if (!env.FEE_ACCOUNT) issues.push('FEE_ACCOUNT: required when CHAIN_MODE=quantus');
    if (!env.CUSTODY_MASTER_KEY) {
      issues.push('CUSTODY_MASTER_KEY: required when CHAIN_MODE=quantus (32 random bytes)');
    }
    if (!env.ESCROW_MNEMONIC) issues.push('ESCROW_MNEMONIC: required when CHAIN_MODE=quantus');
  }
  // The development defaults are public: with real funds they protect nothing.
  if (env.CHAIN_MODE === 'quantus' || env.NODE_ENV === 'production') {
    if (env.CUSTODY_MASTER_KEY?.toLowerCase() === DEV_CUSTODY_MASTER_KEY) {
      issues.push('CUSTODY_MASTER_KEY: the development default cannot protect real wallets');
    }
    if (env.ESCROW_MNEMONIC === DEV_ESCROW_MNEMONIC) {
      issues.push('ESCROW_MNEMONIC: the development default cannot hold real funds');
    }
  }
  if (env.EVM_MODE === 'viem' && !env.EVM_RPC_URL) {
    issues.push('EVM_RPC_URL: required when EVM_MODE=viem');
  }
  if (env.MAIL_TRANSPORT === 'resend') {
    if (!env.RESEND_API_KEY) issues.push('RESEND_API_KEY: required when MAIL_TRANSPORT=resend');
    if (!env.MAIL_FROM) issues.push('MAIL_FROM: required when MAIL_TRANSPORT=resend');
  }
  const xKeys = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'] as const;
  const xSet = xKeys.filter((key) => env[key]);
  if (xSet.length > 0 && xSet.length < xKeys.length) {
    issues.push(
      `${xKeys.filter((key) => !env[key]).join(', ')}: posting settlements needs all four X credentials or none`,
    );
  }
  if (env.TELEGRAM_BOT_TOKEN && !env.TELEGRAM_BOT_USERNAME) {
    issues.push('TELEGRAM_BOT_USERNAME: required when TELEGRAM_BOT_TOKEN is set (deep links)');
  }
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET) {
    const url = env.TELEGRAM_WEBHOOK_URL ?? env.API_URL;
    if (!url.startsWith('https://')) {
      issues.push(
        'TELEGRAM_WEBHOOK_URL: Telegram only calls https URLs; set it (or API_URL) to the public https address, or unset TELEGRAM_WEBHOOK_SECRET to use long polling',
      );
    }
  }
  // A mock adapter accepts simulated deposits and payments through the dev routes. Paired with a
  // real one, a simulated USDC payment would release real QTC (or the reverse). One exception:
  // a real Quantus adapter on a loopback node with the mock EVM, outside production, so a local
  // dev node can be exercised without an Arbitrum RPC. Play money on both sides.
  if ((env.CHAIN_MODE === 'mock') !== (env.EVM_MODE === 'mock')) {
    const devNodePairing =
      env.NODE_ENV !== 'production' &&
      env.CHAIN_MODE === 'quantus' &&
      env.EVM_MODE === 'mock' &&
      env.QUANTUS_RPC_URL !== undefined &&
      isLoopbackUrl(env.QUANTUS_RPC_URL);
    if (!devNodePairing) {
      issues.push(
        `EVM_MODE: CHAIN_MODE=${env.CHAIN_MODE} cannot be combined with EVM_MODE=${env.EVM_MODE}; mock both adapters or neither (only a loopback QUANTUS_RPC_URL outside production may be paired with EVM_MODE=mock)`,
      );
    }
  }
  if (env.NODE_ENV === 'production') {
    if (env.SESSION_SECRET === DEV_SESSION_SECRET) {
      issues.push('SESSION_SECRET: the development default cannot be used in production');
    }
    if (!env.DATABASE_URL) issues.push('DATABASE_URL: required in production');
    // Telegram is how people sign in and how every trade step reaches them: not optional.
    if (!env.TELEGRAM_BOT_TOKEN) {
      issues.push('TELEGRAM_BOT_TOKEN: required in production (sign-in and trade notifications)');
    }
    if (env.CHAIN_MODE === 'mock') {
      issues.push(
        'CHAIN_MODE: the mock chain cannot be used in production; set CHAIN_MODE=quantus',
      );
    }
    if (env.EVM_MODE === 'mock') {
      issues.push('EVM_MODE: the mock EVM cannot be used in production; set EVM_MODE=viem');
    }
    if (env.MAIL_TRANSPORT === 'console' && env.ALLOW_CONSOLE_MAIL_IN_PRODUCTION !== 'true') {
      issues.push(
        'MAIL_TRANSPORT: the console transport delivers no mail; set ALLOW_CONSOLE_MAIL_IN_PRODUCTION=true to run without outgoing mail',
      );
    }
    if (env.TRUSTED_PROXY_HOPS === undefined) {
      issues.push(
        'TRUSTED_PROXY_HOPS: required in production (0 when clients reach the API directly, otherwise the number of proxies appending to X-Forwarded-For)',
      );
    }
  }
  return issues;
}

export function safeParseConfig(env: Record<string, string | undefined>): ConfigResult {
  const parsed = EnvSchema.safeParse(withoutBlanks(env));
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => `${i.path.join('.') || '(env)'}: ${i.message}`),
    };
  }
  const e = parsed.data;
  const issues = crossFieldIssues(e);
  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    config: {
      nodeEnv: e.NODE_ENV,
      isProduction: e.NODE_ENV === 'production',
      port: e.PORT,
      logLevel: e.LOG_LEVEL ?? (e.NODE_ENV === 'test' ? 'silent' : 'info'),
      databaseUrl: e.DATABASE_URL ?? null,
      appOrigin: e.APP_ORIGIN,
      webOrigin: e.WEB_ORIGIN,
      apiUrl: e.API_URL,
      sessionSecret: e.SESSION_SECRET,
      chainMode: e.CHAIN_MODE,
      evmMode: e.EVM_MODE,
      quantus: {
        rpcUrl: e.QUANTUS_RPC_URL ?? null,
        explorerUrl: e.QUANTUS_EXPLORER_URL,
        platformMnemonic: e.PLATFORM_MNEMONIC ?? null,
        feeAccount: e.FEE_ACCOUNT ?? null,
        confirmations: e.QUANTUS_CONFIRMATIONS,
      },
      evm: {
        rpcUrl: e.EVM_RPC_URL ?? null,
        chainId: e.EVM_CHAIN_ID,
        usdcAddress: e.USDC_ADDRESS,
        explorerUrl: e.EVM_EXPLORER_URL,
        confirmations: e.EVM_CONFIRMATIONS,
      },
      feeBps: e.FEE_BPS,
      lockTimeoutMin: e.LOCK_TIMEOUT_MIN,
      payTimeoutMin: e.PAY_TIMEOUT_MIN,
      deliveryTimeoutMin: e.DELIVERY_TIMEOUT_MIN,
      minFillPlanck: e.MIN_FILL_PLANCK,
      custody: {
        masterKey: e.CUSTODY_MASTER_KEY ?? DEV_CUSTODY_MASTER_KEY,
        escrowMnemonic: e.ESCROW_MNEMONIC ?? DEV_ESCROW_MNEMONIC,
        withdrawDailyLimitPlanck: e.WITHDRAW_DAILY_LIMIT_PLANCK,
        walletFeeReservePlanck: e.WALLET_FEE_RESERVE_PLANCK ?? null,
        escrowMinGasPlanck: e.ESCROW_MIN_GAS_PLANCK,
      },
      emailAuth:
        // Telegram is the only way in, local development included; the test suites keep email.
        (e.EMAIL_AUTH ?? (e.NODE_ENV === 'test' ? 'enabled' : 'disabled')) === 'enabled',
      qlyphsWalletRequired:
        (e.QLYPHS_WALLET_REQUIRED ?? (e.NODE_ENV === 'production' ? 'true' : 'false')) === 'true',
      adminEmails: e.ADMIN_EMAILS,
      adminTelegramIds: e.ADMIN_TELEGRAM_IDS,
      mailTransport: e.MAIL_TRANSPORT,
      mail: { resendApiKey: e.RESEND_API_KEY ?? null, from: e.MAIL_FROM ?? null },
      trustedProxyHops: e.TRUSTED_PROXY_HOPS ?? 0,
      telegram: {
        botToken: e.TELEGRAM_BOT_TOKEN ?? null,
        botUsername: e.TELEGRAM_BOT_TOKEN ? (e.TELEGRAM_BOT_USERNAME ?? null) : null,
        webhookSecret: e.TELEGRAM_BOT_TOKEN ? (e.TELEGRAM_WEBHOOK_SECRET ?? null) : null,
        webhookUrl: e.TELEGRAM_WEBHOOK_URL ?? `${e.API_URL}/api/telegram/webhook`,
      },
      x: {
        apiKey: e.X_API_KEY ?? null,
        apiSecret: e.X_API_SECRET ?? null,
        accessToken: e.X_ACCESS_TOKEN ?? null,
        accessSecret: e.X_ACCESS_SECRET ?? null,
        minUsdc: e.X_MIN_USDC ?? 0,
      },
      devRoutesEnabled:
        e.NODE_ENV !== 'production' && (e.CHAIN_MODE === 'mock' || e.EVM_MODE === 'mock'),
    },
  };
}

/** Parse or throw a {@link ConfigError} listing every problem at once. */
export function parseConfig(env: Record<string, string | undefined>): AppConfig {
  const result = safeParseConfig(env);
  if (!result.ok) throw new ConfigError(result.issues);
  return result.config;
}
