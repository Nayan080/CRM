import { z } from 'zod';

/** Emails are normalised (trimmed + lower-cased) before validation and storage. */
export const emailSchema = z
  .string({ message: 'Email is required' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Enter a valid email address' }).max(254));

/**
 * Password policy (NIST SP 800-63B style): length over complexity rules.
 * 12–128 characters, any characters allowed.
 */
export const passwordSchema = z
  .string({ message: 'Password is required' })
  .min(12, 'Use at least 12 characters')
  .max(128, 'Use at most 128 characters');

export const personNameSchema = z
  .string({ message: 'Name is required' })
  .trim()
  .min(1, 'Name is required')
  .max(100, 'Name is too long');

/** Opaque single-use token from an email link. */
export const tokenSchema = z.string().trim().min(20).max(200);

/** 6-digit authenticator code, or a recovery code (xxxxx-xxxxx). */
export const mfaCodeSchema = z
  .string()
  .trim()
  .regex(/^(\d{6}|[a-z0-9]{5}-[a-z0-9]{5})$/i, 'Enter the 6-digit code or a recovery code');

export const registerSchema = z.object({
  name: personNameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(128),
});

export const loginMfaSchema = z.object({
  mfaToken: z.string().min(10).max(2000),
  code: mfaCodeSchema,
});

export const tokenOnlySchema = z.object({ token: tokenSchema });
export const emailOnlySchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: tokenSchema,
  password: passwordSchema,
});

export const mfaEnableSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const mfaDisableSchema = z.object({
  password: z.string().min(1).max(128),
  code: mfaCodeSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type LoginMfaInput = z.infer<typeof loginMfaSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// ───────── Responses ─────────

export interface UserSummary {
  id: string;
  email: string;
  name: string;
  mfaEnabled: boolean;
  /** Platform roles (agency metadata only). Empty for normal users. */
  platformRoles: ('SUPER_ADMIN' | 'SUPPORT')[];
}

export interface AuthTokensResponse {
  status: 'authenticated';
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  user: UserSummary;
}

export interface MfaChallengeResponse {
  status: 'mfa_required';
  /** Short-lived token proving the password step passed. */
  mfaToken: string;
}

export type LoginResponse = AuthTokensResponse | MfaChallengeResponse;

export interface MessageResponse {
  message: string;
}

export interface SessionSummary {
  id: string;
  current: boolean;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string;
}

export interface MfaSetupResponse {
  /** Base32 secret to type into an authenticator app. */
  secret: string;
  /** otpauth:// URI (can be rendered as a QR code). */
  otpauthUri: string;
}

export interface RecoveryCodesResponse {
  /** Shown once. Each code works one time. */
  recoveryCodes: string[];
}
