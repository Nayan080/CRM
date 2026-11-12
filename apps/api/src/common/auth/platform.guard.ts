import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PlatformRole } from '@crm/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { RequestContext } from '../context/request-context.js';
import { AppException } from '../errors/app-exception.js';

export const PLATFORM_ROLES_KEY = 'auth:platformRoles';
/** Route needs one of these platform roles (agency metadata only, never client data). */
export const PlatformRoles = (...roles: PlatformRole[]) => SetMetadata(PLATFORM_ROLES_KEY, roles);

/**
 * Platform routes: the signed-in user must hold a platform role AND have two-factor on, with this
 * session verified by it (DEC-06). Anyone else gets 404, so the routes are not advertised.
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowed =
      this.reflector.getAllAndOverride<PlatformRole[]>(PLATFORM_ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const ctx = RequestContext.get();
    const userId = ctx?.userId;
    if (!userId) throw new AppException(404, 'NOT_FOUND', 'Not found.');
    const user = await this.prisma.systemTx({ userId }, (tx) =>
      tx.user.findUnique({
        where: { id: userId },
        select: { mfaEnabledAt: true, platformRoles: { select: { role: true } } },
      }),
    );
    const roles = user?.platformRoles.map((r) => r.role) ?? [];
    if (!roles.length) throw new AppException(404, 'NOT_FOUND', 'Not found.');
    if (!user?.mfaEnabledAt) {
      throw new AppException(
        403,
        'MFA_SETUP_REQUIRED',
        'Platform roles require two-factor authentication.',
      );
    }
    if (!ctx.sessionMfaVerified) {
      throw new AppException(403, 'MFA_REQUIRED', 'Sign in again with your authenticator code.');
    }
    if (!roles.some((r) => allowed.includes(r))) {
      throw new AppException(403, 'PERMISSION_DENIED', 'Your platform role cannot do this.');
    }
    return true;
  }
}
