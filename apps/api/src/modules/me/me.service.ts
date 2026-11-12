import { Inject, Injectable } from '@nestjs/common';
import type {
  MfaSetupResponse,
  RecoveryCodesResponse,
  SessionSummary,
  UserSummary,
  WorkspaceSummary,
} from '@crm/contracts';
import { RequestContext, requireUserId } from '../../common/context/request-context.js';
import { AppException } from '../../common/errors/app-exception.js';
import { encryptSecret, decryptSecret } from '../../common/security/encryption.js';
import { verifyPassword } from '../../common/security/password.js';
import { generateRecoveryCodes, hashRecoveryCode } from '../../common/security/recovery-codes.js';
import { buildOtpauthUri, generateTotpSecret, verifyTotp } from '../../common/security/totp.js';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthService, toUserSummary } from '../auth/auth.service.js';

const MFA_ISSUER = 'Migration CRM';

@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async me(): Promise<UserSummary> {
    const userId = requireUserId();
    const user = await this.prisma.systemTx({ userId }, (tx) =>
      tx.user.findUniqueOrThrow({
        where: { id: userId },
        include: { platformRoles: { select: { role: true } } },
      }),
    );
    return toUserSummary(user);
  }

  /** Every ACTIVE membership of the caller, across tenants (RLS allows only their own rows). */
  async workspaces(): Promise<WorkspaceSummary[]> {
    const userId = requireUserId();
    return this.prisma.systemTx({ userId }, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { mfaEnabledAt: true },
      });
      const memberships = await tx.membership.findMany({
        where: { userId, status: 'ACTIVE' },
        orderBy: { joinedAt: 'asc' },
        select: {
          kind: true,
          tenant: { select: { id: true, slug: true, name: true, status: true } },
          role: { select: { key: true, name: true, requiresMfa: true } },
        },
      });
      return memberships.map((m) => ({
        tenantId: m.tenant.id,
        slug: m.tenant.slug,
        name: m.tenant.name,
        kind: m.kind,
        role: m.role,
        mfaSetupRequired: !!m.role?.requiresMfa && !user.mfaEnabledAt,
        status: m.tenant.status,
      }));
    });
  }

  async sessions(): Promise<SessionSummary[]> {
    const userId = requireUserId();
    const currentId = RequestContext.get()?.sessionId;
    const now = new Date();
    const rows = await this.prisma.systemTx({ userId }, (tx) =>
      tx.session.findMany({
        where: {
          userId,
          revokedAt: null,
          absoluteExpiresAt: { gt: now },
          idleExpiresAt: { gt: now },
        },
        orderBy: { lastUsedAt: 'desc' },
      }),
    );
    return rows.map((s) => ({
      id: s.id,
      current: s.id === currentId,
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
    }));
  }

  /** Sign out one device. Only the caller's own sessions; others look "not found". */
  async revokeSession(sessionId: string): Promise<void> {
    const userId = requireUserId();
    const updated = await this.prisma.systemTx({ userId }, async (tx) => {
      const result = await tx.session.updateMany({
        where: { id: sessionId, userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'user_revoked' },
      });
      if (result.count === 1) {
        await this.audit.record(tx, {
          action: 'session.revoked',
          tenantId: null,
          targetType: 'session',
          targetId: sessionId,
        });
      }
      return result.count;
    });
    if (updated !== 1) throw new AppException(404, 'NOT_FOUND', 'Session not found.');
  }

  /** Step 1: create a pending secret. MFA is not active until a code is confirmed. */
  async startMfaSetup(): Promise<MfaSetupResponse> {
    const userId = requireUserId();
    const secret = generateTotpSecret();
    const user = await this.prisma.systemTx({ userId }, async (tx) => {
      const current = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (current.mfaEnabledAt) {
        throw new AppException(
          409,
          'MFA_ALREADY_ENABLED',
          'Two-factor authentication is already on.',
        );
      }
      return tx.user.update({
        where: { id: userId },
        data: { mfaSecretEnc: encryptSecret(secret, this.config.auth.mfaEncryptionKey) },
      });
    });
    return { secret, otpauthUri: buildOtpauthUri(secret, user.email, MFA_ISSUER) };
  }

  /** Step 2: confirm a code → MFA on, recovery codes shown once, this session marked verified. */
  async enableMfa(code: string): Promise<RecoveryCodesResponse> {
    const userId = requireUserId();
    const sessionId = RequestContext.get()?.sessionId;
    const recoveryCodes = generateRecoveryCodes();
    await this.prisma.systemTx({ userId }, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.mfaEnabledAt) {
        throw new AppException(
          409,
          'MFA_ALREADY_ENABLED',
          'Two-factor authentication is already on.',
        );
      }
      if (!user.mfaSecretEnc) {
        throw new AppException(409, 'MFA_SETUP_NOT_STARTED', 'Start two-factor setup first.');
      }
      const secret = decryptSecret(user.mfaSecretEnc, this.config.auth.mfaEncryptionKey);
      const step = verifyTotp(secret, code);
      if (step === null) throw new AppException(400, 'INVALID_MFA_CODE', 'That code is not valid.');

      await tx.user.update({
        where: { id: userId },
        data: { mfaEnabledAt: new Date(), mfaLastStep: BigInt(step) },
      });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
      await tx.mfaRecoveryCode.createMany({
        data: recoveryCodes.map((c) => ({ userId, codeHash: hashRecoveryCode(c) })),
      });
      if (sessionId) {
        await tx.session.update({ where: { id: sessionId }, data: { mfaVerified: true } });
      }
      await this.audit.record(tx, {
        action: 'auth.mfa_enabled',
        tenantId: null,
        targetType: 'user',
        targetId: userId,
      });
    });
    return { recoveryCodes };
  }

  /** Not allowed while the user holds a role that requires MFA (Owner/Admin, DEC-06). */
  async disableMfa(password: string, code: string): Promise<void> {
    const userId = requireUserId();
    await this.prisma.systemTx({ userId }, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (!user.mfaEnabledAt) {
        throw new AppException(409, 'MFA_NOT_ENABLED', 'Two-factor authentication is off.');
      }
      const required = await tx.membership.count({
        where: { userId, status: 'ACTIVE', role: { requiresMfa: true } },
      });
      if (required > 0) {
        throw new AppException(
          409,
          'MFA_REQUIRED_BY_ROLE',
          'Your role in a workspace requires two-factor authentication.',
        );
      }
      const passwordOk = user.passwordHash
        ? await verifyPassword(user.passwordHash, password)
        : false;
      if (!passwordOk || !(await this.auth.checkSecondFactor(tx, user, code))) {
        throw new AppException(400, 'INVALID_CREDENTIALS', 'Password or code is not valid.');
      }
      await tx.user.update({
        where: { id: userId },
        data: { mfaEnabledAt: null, mfaSecretEnc: null, mfaLastStep: null },
      });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
      await this.audit.record(tx, {
        action: 'auth.mfa_disabled',
        tenantId: null,
        targetType: 'user',
        targetId: userId,
      });
    });
  }
}
