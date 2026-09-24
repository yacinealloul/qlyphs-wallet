/** Auth requests/responses (SPEC §5 Auth). Cookies carry the session; bodies never do. */
import { z } from 'zod';
import { EmailSchema, PasswordSchema, TokenSchema, UsernameSchema } from './primitives';
import { MeSchema } from './user';

export const RegisterRequestSchema = z.object({
  username: UsernameSchema,
  email: EmailSchema,
  password: PasswordSchema,
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  email: EmailSchema,
  /** Not length-checked on login so old/short inputs fail as INVALID_CREDENTIALS, not validation. */
  password: z.string().min(1).max(256),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/** `POST /auth/register` and `POST /auth/login` */
export const AuthResponseSchema = z.object({ user: MeSchema });
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

export const VerifyEmailRequestSchema = z.object({ token: TokenSchema });
export type VerifyEmailRequest = z.infer<typeof VerifyEmailRequestSchema>;

/** Always answers `{ ok: true }` so the endpoint does not reveal which emails exist. */
export const ForgotPasswordRequestSchema = z.object({ email: EmailSchema });
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>;

export const ResetPasswordRequestSchema = z.object({
  token: TokenSchema,
  password: PasswordSchema,
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;
