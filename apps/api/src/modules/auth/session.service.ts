import { Inject, Injectable, Logger } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context.js';
import { AppException } from '../../common/errors/app-exception.js';
import { generateToken, hashToken } from '../../common/security/tokens.js';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ACCESS_TOKEN_TTL_SECONDS, JwtService } from './jwt.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 7 * DAY_MS; // DEC-05
export const SESSION_ABSOLUTE_MS = 30 * DAY_MS; // DEC-05
/** Parallel refreshes (e.g. two tabs) within this window are not treated as token theft. */
const REUSE_GRACE_MS = 30_000;

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  sessionId: string;
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** New login session + first refresh token. Call inside a system transaction. */
  async create(tx: Tx, userId: string, mfaVerified: boolean): Promise<IssuedTokens> {
    const ctx = RequestContext.get();
    const now = Date.now();
    const session = await tx.session.create({
      data: {
        userId,
        mfaVerified,
        userAgent: ctx?.userAgent ?? null,
        ipAddress: ctx?.ipAddress ?? null,
        idleExpiresAt: new Date(now + SESSION_IDLE_MS),
        absoluteExpiresAt: new Date(now + SESSION_ABSOLUTE_MS),
      },
    });
    const refreshToken = generateToken();
    await tx.refreshToken.create({
      data: { sessionId: session.id, tokenHash: hashToken(refreshToken) },
    });
    return {
      accessToken: await this.jwt.signAccess({ userId, sessionId: session.id }),
      refreshToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      sessionId: session.id,
    };
  }

  /**
   * Rotate: the presented refresh token becomes used and a new one is issued.
   * Re-use of an already-used token (outside a short grace window) means it was stolen:
   * the whole session is revoked.
   */
  async refresh(refreshToken: string): Promise<IssuedTokens & { userId: string }> {
    const tokenHash = hashToken(refreshToken);
    const result = await this.prisma.systemTx({}, async (tx) => {
      const record = await tx.refreshToken.findUnique({
        where: { tokenHash },
        include: { session: true },
      });
      const now = new Date();
      const session = record?.session;
      if (
        !record ||
        !session ||
        session.revokedAt ||
        session.idleExpiresAt <= now ||
        session.absoluteExpiresAt <= now
      ) {
        return { kind: 'invalid' as const };
      }

      if (record.usedAt) {
        if (now.getTime() - record.usedAt.getTime() <= REUSE_GRACE_MS) {
          return { kind: 'rotated' as const };
        }
        await tx.session.update({
          where: { id: session.id },
          data: { revokedAt: now, revokedReason: 'refresh_token_reuse' },
        });
        await this.audit.record(tx, {
          action: 'auth.refresh_token_reuse',
          tenantId: null,
          actorUserId: session.userId,
          targetType: 'session',
          targetId: session.id,
        });
        return { kind: 'reused' as const, userId: session.userId };
      }

      // Conditional update: if two requests race with the same token, only one wins.
      const claimed = await tx.refreshToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) return { kind: 'rotated' as const };

      const next = generateToken();
      await tx.refreshToken.create({ data: { sessionId: session.id, tokenHash: hashToken(next) } });
      await tx.session.update({
        where: { id: session.id },
        data: {
          lastUsedAt: now,
          idleExpiresAt: new Date(
            Math.min(now.getTime() + SESSION_IDLE_MS, session.absoluteExpiresAt.getTime()),
          ),
        },
      });
      return { kind: 'ok' as const, userId: session.userId, sessionId: session.id, next };
    });

    if (result.kind === 'reused') {
      this.logger.warn({ userId: result.userId }, 'Refresh token reuse detected; session revoked');
    }
    if (result.kind === 'rotated') {
      throw new AppException(409, 'TOKEN_ROTATED', 'Session was refreshed elsewhere. Retry.');
    }
    if (result.kind !== 'ok') {
      throw new AppException(401, 'UNAUTHENTICATED', 'Sign in again to continue.');
    }
    return {
      userId: result.userId,
      sessionId: result.sessionId,
      refreshToken: result.next,
      accessToken: await this.jwt.signAccess({
        userId: result.userId,
        sessionId: result.sessionId,
      }),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  /** Logout by refresh token (cookie). Unknown tokens are ignored (logout is idempotent). */
  async revokeByRefreshToken(refreshToken: string): Promise<void> {
    await this.prisma.systemTx({}, async (tx) => {
      const record = await tx.refreshToken.findUnique({
        where: { tokenHash: hashToken(refreshToken) },
        select: { sessionId: true },
      });
      if (!record) return;
      await tx.session.updateMany({
        where: { id: record.sessionId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'logout' },
      });
    });
  }

  async revokeAllForUser(tx: Tx, userId: string, reason: string): Promise<void> {
    await tx.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }
}
