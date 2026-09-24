/** Telegram sign-in, linking and Mini App auth (SPEC §8). Cookies carry the session; bodies never do. */
import { z } from 'zod';
import { IsoDateSchema } from './primitives';
import { MeSchema } from './user';

/** Short id of a pending sign-in; it also travels in Telegram callback data. */
export const TelegramRequestIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,24}$/);

/**
 * `POST /auth/telegram/start` — also sets the httpOnly `qotc_tg_login` cookie; only the browser
 * holding it can poll this request.
 */
export const TelegramLoginStartResponseSchema = z.object({
  requestId: TelegramRequestIdSchema,
  /** `https://t.me/<bot>?start=a_<token>`: QR on desktop, "Open Telegram" button on mobile. */
  deepLink: z.url(),
  expiresAt: IsoDateSchema,
});
export type TelegramLoginStartResponse = z.infer<typeof TelegramLoginStartResponseSchema>;

/**
 * The one-time code the bot shows inside the Telegram chat that opened a deep link. It is typed in
 * the browser that started the flow (`POST /auth/telegram/confirm/:requestId`, `POST
 * /me/telegram/link/confirm`) and is never sent to that browser: whoever starts a flow and forwards
 * its link to someone else gets nothing unless that person also hands the code over. Six digits;
 * spaces and dashes are tolerated.
 */
export const TelegramCodeRequestSchema = z.object({
  code: z
    .string()
    .max(16)
    .transform((v) => v.replace(/[\s-]/g, ''))
    .pipe(z.string().regex(/^\d{6}$/, 'The code has six digits')),
});
export type TelegramCodeRequest = z.infer<typeof TelegramCodeRequestSchema>;

/**
 * `GET /auth/telegram/poll/:requestId`. `confirmed` is answered once, together with the session
 * cookie; any later poll of the same request reads `expired`.
 */
export const TelegramLoginPollResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('pending'),
    /** True once the bot received the deep link and showed the code: ask for it now. */
    opened: z.boolean(),
  }),
  z.object({ status: z.literal('denied'), reason: z.enum(['user_denied', 'wrong_code']) }),
  z.object({ status: z.literal('expired') }),
  z.object({
    status: z.literal('confirmed'),
    user: MeSchema,
    /** True when this sign-in created the account: continue to onboarding (vault, addresses). */
    created: z.boolean(),
  }),
]);
export type TelegramLoginPollResponse = z.infer<typeof TelegramLoginPollResponseSchema>;

/** `POST /auth/telegram/webapp` — `Telegram.WebApp.initData`, verbatim. */
export const TelegramWebAppRequestSchema = z.object({ initData: z.string().min(1).max(4_096) });
export type TelegramWebAppRequest = z.infer<typeof TelegramWebAppRequestSchema>;

export const TelegramWebAppResponseSchema = z.object({ user: MeSchema, created: z.boolean() });
export type TelegramWebAppResponse = z.infer<typeof TelegramWebAppResponseSchema>;

/** `GET /me/telegram`, `DELETE /me/telegram` */
export const TelegramLinkStatusSchema = z.object({
  /** False when the API runs without a bot token; everything else is then empty. */
  enabled: z.boolean(),
  botUsername: z.string().nullable(),
  linked: z.boolean(),
  telegramUsername: z.string().nullable(),
  /** `/mute` was sent: only action-required messages are delivered. */
  muted: z.boolean(),
  /** The user blocked the bot; nothing can be delivered until they unblock it. */
  blocked: z.boolean(),
  linkedAt: IsoDateSchema.nullable(),
});
export type TelegramLinkStatus = z.infer<typeof TelegramLinkStatusSchema>;

export const TelegramLinkStatusResponseSchema = z.object({ telegram: TelegramLinkStatusSchema });
export type TelegramLinkStatusResponse = z.infer<typeof TelegramLinkStatusResponseSchema>;

/**
 * `POST /me/telegram/link` — single-use deep link `l_<token>`, 10 minutes. Opening it links
 * nothing: the bot shows a code, and `POST /me/telegram/link/confirm` with that code does.
 */
export const TelegramLinkStartResponseSchema = z.object({
  deepLink: z.url(),
  expiresAt: IsoDateSchema,
});
export type TelegramLinkStartResponse = z.infer<typeof TelegramLinkStartResponseSchema>;
