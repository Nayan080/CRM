import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  AuthTokensResponse,
  LoginInput,
  LoginResponse,
  RegisterInput,
  ResetPasswordInput,
  UserSummary,
} from '@crm/contracts';
import { AppException } from '../../common/errors/app-exception.js';
import { decryptSecret } from '../../common/security/encryption.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../../common/security/password.js';
import { hashRecoveryCode, isRecoveryCodeFormat } from '../../common/security/recovery-codes.js';
import { generateToken, hashToken } from '../../common/security/tokens.js';
import { verifyTotp } from '../../common/security/totp.js';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import {
  accountExistsMessage,
  passwordResetMessage,
  verifyEmailMessage,
} from '../../infra/mail/email-templates.js';
import { MAILER, type Mailer } from '../../infra/mail/mailer.js';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { JwtService } from './jwt.service.js';
import { type IssuedTokens, SessionService } from './session.service.js';

const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // DEC-05
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000; // DEC-05
const MAX_FAILED_LOGINS = 10;
const LOCKOUT_MS = 15 * 60 * 1000;

const INVALID_CREDENTIALS = () =>
  new AppException(401, 'INVALID_CREDENTIALS', 'Invalid email or password, or too many attempts.');
const INVALID_TOKEN = () =>
  new AppException(400, 'INVALID_OR_EXPIRED_TOKEN', 'This link is invalid or has expired.');

export const GENERIC_EMAIL_SENT =
  'If the details are valid, we have sent an email with the next step.';

interface UserRow {
  id: string;
  email: string;
  name: string;
  mfaEnabledAt: Date | null;
  platformRoles?: { role: 'SUPER_ADMIN' | 'SUPPORT' }[];
}

export function toUserSummary(user: UserRow): UserSummary {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    mfaEnabled: !!user.mfaEnabledAt,
    platformRoles: (user.platformRoles ?? []).map((r) => r.role),
  };
}

/** Result for controllers: the response body plus the refresh token to put in the cookie. */
export interface AuthenticatedResult {
  body: AuthTokensResponse;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Always the same response, whether or not the email is registered (no account discovery). */
  async register(input: RegisterInput): Promise<void> {
    // Hash first in every path so response time doesn't reveal whether the email exists.
    const passwordHash = await hashPassword(input.password);
    const mail = await this.prisma.systemTx({}, async (tx) => {
      const existing = await tx.user.findUnique({ where: { email: input.email } });
      if (existing?.emailVerifiedAt) {
        return accountExistsMessage(
          existing.email,
          this.link('/login'),
          this.link('/forgot-password'),
        );
      }
      // Unverified account: the latest registration wins (new password, older links invalidated).
      // Prevents "pre-registration" takeover where someone else set a password first.
      const user = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: { name: input.name, passwordHash, passwordChangedAt: new Date() },
          })
        : await tx.user.create({
            data: { email: input.email, name: input.name, passwordHash },
          });
      if (!existing) {
        await this.audit.record(tx, {
          action: 'auth.registered',
          tenantId: null,
          actorUserId: user.id,
          targetType: 'user',
          targetId: user.id,
        });
      }
      const token = await this.issueAuthToken(tx, user.id, 'EMAIL_VERIFY', EMAIL_VERIFY_TTL_MS);
      return verifyEmailMessage(user.email, user.name, this.link('/verify-email', token));
    });
    await this.mailer.send(mail);
  }

  async resendVerification(email: string): Promise<void> {
    const mail = await this.prisma.systemTx({}, async (tx) => {
      const user = await tx.user.findUnique({ where: { email } });
      if (!user || user.emailVerifiedAt) return null;
      const token = await this.issueAuthToken(tx, user.id, 'EMAIL_VERIFY', EMAIL_VERIFY_TTL_MS);
      return verifyEmailMessage(user.email, user.name, this.link('/verify-email', token));
    });
    if (mail) await this.mailer.send(mail);
  }

  async verifyEmail(token: string): Promise<void> {
    await this.prisma.systemTx({}, async (tx) => {
      const record = await this.consumeAuthToken(tx, token, 'EMAIL_VERIFY');
      await tx.user.updateMany({
        where: { id: record.userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'auth.email_verified',
        tenantId: null,
        actorUserId: record.userId,
        targetType: 'user',
        targetId: record.userId,
      });
    });
  }

  async login(input: LoginInput): Promise<LoginResponse | AuthenticatedResult> {
    const user = await this.prisma.systemTx({}, (tx) =>
      tx.user.findUnique({ where: { email: input.email } }),
    );
    if (!user?.passwordHash) {
      await burnPasswordCheck(input.password);
      throw INVALID_CREDENTIALS();
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await burnPasswordCheck(input.password);
      throw INVALID_CREDENTIALS();
    }
    if (!(await verifyPassword(user.passwordHash, input.password))) {
      await this.recordFailedLogin(user.id, user.failedLoginCount);
      throw INVALID_CREDENTIALS();
    }
    if (!user.emailVerifiedAt) {
      throw new AppException(403, 'EMAIL_NOT_VERIFIED', 'Verify your email address first.');
    }

    if (user.mfaEnabledAt) {
      return { status: 'mfa_required', mfaToken: await this.jwt.signMfaChallenge(user.id) };
    }
    return this.startSession(user.id, false, 'auth.login');
  }

  /** Second login step: authenticator code or one recovery code. */
  async loginWithMfa(mfaToken: string, code: string): Promise<AuthenticatedResult> {
    const userId = await this.jwt.verifyMfaChallenge(mfaToken);
    if (!userId) {
      throw new AppException(401, 'MFA_CHALLENGE_EXPIRED', 'Sign in again to continue.');
    }
    const ok = await this.prisma.systemTx({ userId }, async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user?.mfaEnabledAt || !user.mfaSecretEnc) return false;
      if (user.lockedUntil && user.lockedUntil > new Date()) return false;
      return this.checkSecondFactor(tx, user, code);
    });
    if (!ok) {
      const user = await this.prisma.systemTx({}, (tx) =>
        tx.user.findUnique({ where: { id: userId }, select: { failedLoginCount: true } }),
      );
      await this.recordFailedLogin(userId, user?.failedLoginCount ?? 0);
      throw new AppException(401, 'INVALID_MFA_CODE', 'That code is not valid.');
    }
    return this.startSession(userId, true, 'auth.login_mfa');
  }

  /**
   * Verifies a TOTP (with replay protection) or consumes a recovery code. Shared with MFA disable.
   */
  async checkSecondFactor(
    tx: Tx,
    user: { id: string; mfaSecretEnc: string | null; mfaLastStep: bigint | null },
    code: string,
  ): Promise<boolean> {
    if (!user.mfaSecretEnc) return false;
    if (isRecoveryCodeFormat(code)) {
      const used = await tx.mfaRecoveryCode.updateMany({
        where: { userId: user.id, codeHash: hashRecoveryCode(code), usedAt: null },
        data: { usedAt: new Date() },
      });
      return used.count === 1;
    }
    const secret = decryptSecret(user.mfaSecretEnc, this.config.auth.mfaEncryptionKey);
    const step = verifyTotp(secret, code, {
      lastUsedStep: user.mfaLastStep === null ? null : Number(user.mfaLastStep),
    });
    if (step === null) return false;
    await tx.user.update({ where: { id: user.id }, data: { mfaLastStep: BigInt(step) } });
    return true;
  }

  async forgotPassword(email: string): Promise<void> {
    const mail = await this.prisma.systemTx({}, async (tx) => {
      const user = await tx.user.findUnique({ where: { email } });
      if (!user) return null;
      const token = await this.issueAuthToken(tx, user.id, 'PASSWORD_RESET', PASSWORD_RESET_TTL_MS);
      return passwordResetMessage(user.email, this.link('/reset-password', token));
    });
    if (mail) await this.mailer.send(mail);
  }

  /** Sets the new password and signs the user out everywhere. */
  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const passwordHash = await hashPassword(input.password);
    await this.prisma.systemTx({}, async (tx) => {
      const record = await this.consumeAuthToken(tx, input.token, 'PASSWORD_RESET');
      const now = new Date();
      await tx.user.update({
        where: { id: record.userId },
        data: {
          passwordHash,
          passwordChangedAt: now,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      // Receiving the reset email proves control of the address.
      await tx.user.updateMany({
        where: { id: record.userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: now },
      });
      await this.sessions.revokeAllForUser(tx, record.userId, 'password_reset');
      await this.audit.record(tx, {
        action: 'auth.password_reset',
        tenantId: null,
        actorUserId: record.userId,
        targetType: 'user',
        targetId: record.userId,
      });
    });
  }

  async startSession(
    userId: string,
    mfaVerified: boolean,
    action: string,
  ): Promise<AuthenticatedResult> {
    const { tokens, user } = await this.prisma.systemTx({ userId }, async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: { failedLoginCount: 0, lockedUntil: null },
        include: { platformRoles: { select: { role: true } } },
      });
      const tokens: IssuedTokens = await this.sessions.create(tx, userId, mfaVerified);
      await this.audit.record(tx, {
        action,
        tenantId: null,
        actorUserId: userId,
        targetType: 'session',
        targetId: tokens.sessionId,
      });
      return { tokens, user };
    });
    return {
      refreshToken: tokens.refreshToken,
      body: {
        status: 'authenticated',
        accessToken: tokens.accessToken,
        expiresIn: tokens.expiresIn,
        user: toUserSummary(user),
      },
    };
  }

  private async recordFailedLogin(userId: string, previousCount: number): Promise<void> {
    const count = previousCount + 1;
    const lock = count >= MAX_FAILED_LOGINS;
    await this.prisma.systemTx({}, (tx) =>
      tx.user.update({
        where: { id: userId },
        data: lock
          ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MS) }
          : { failedLoginCount: count },
      }),
    );
    if (lock) this.logger.warn({ userId }, 'Account temporarily locked after failed logins');
  }

  /** New single-use token; any older unused token of the same type stops working. */
  private async issueAuthToken(
    tx: Tx,
    userId: string,
    type: 'EMAIL_VERIFY' | 'PASSWORD_RESET',
    ttlMs: number,
  ): Promise<string> {
    await tx.authToken.updateMany({
      where: { userId, type, usedAt: null },
      data: { usedAt: new Date() },
    });
    const token = generateToken();
    await tx.authToken.create({
      data: { userId, type, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) },
    });
    return token;
  }

  private async consumeAuthToken(tx: Tx, token: string, type: 'EMAIL_VERIFY' | 'PASSWORD_RESET') {
    const now = new Date();
    const record = await tx.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!record || record.type !== type || record.usedAt || record.expiresAt <= now) {
      throw INVALID_TOKEN();
    }
    const claimed = await tx.authToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) throw INVALID_TOKEN();
    return record;
  }

  /** Web link with the token in the URL fragment (never sent to servers). */
  link(path: string, token?: string): string {
    return `${this.config.webAppUrl}${path}${token ? `#token=${token}` : ''}`;
  }
}
