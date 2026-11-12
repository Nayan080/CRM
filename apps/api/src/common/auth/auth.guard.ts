import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { JwtService } from '../../modules/auth/jwt.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { RequestContext } from '../context/request-context.js';
import { AppException } from '../errors/app-exception.js';
import { IS_PUBLIC } from './decorators.js';

/** Isolation layer 1: a valid, unexpired access token AND a live (not revoked/expired) session. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request & { id?: string }>();
    // pino-http assigns the request id after the context middleware ran; copy it for audit logs.
    const store = RequestContext.get();
    if (store && !store.requestId) store.requestId = req.id;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const header = req.get('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    const claims = token ? await this.jwt.verifyAccess(token) : null;
    if (!claims) throw unauthenticated();

    const now = new Date();
    const session = await this.prisma.systemTx({ userId: claims.userId }, (tx) =>
      tx.session.findFirst({
        where: {
          id: claims.sessionId,
          userId: claims.userId,
          revokedAt: null,
          idleExpiresAt: { gt: now },
          absoluteExpiresAt: { gt: now },
        },
        select: { id: true, mfaVerified: true },
      }),
    );
    if (!session) throw unauthenticated();

    const ctx = RequestContext.require();
    ctx.userId = claims.userId;
    ctx.sessionId = session.id;
    ctx.sessionMfaVerified = session.mfaVerified;
    return true;
  }
}

function unauthenticated() {
  return new AppException(401, 'UNAUTHENTICATED', 'Sign in again to continue.');
}
