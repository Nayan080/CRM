import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ROLE_TEMPLATES_VERSION } from '@crm/permissions';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { applyRoleTemplates } from '../../modules/tenants/role-sync.service.js';
import { RequestContext } from '../context/request-context.js';
import { AppException } from '../errors/app-exception.js';
import { IS_TENANT_SCOPED } from './decorators.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Isolation layer 2: derive the active tenant from a VERIFIED membership.
 * The X-Tenant-Id header only says which workspace the caller wants; access requires an ACTIVE
 * membership in an ACTIVE tenant. Otherwise 404 (we don't confirm the workspace exists).
 * Also enforces MFA for roles that require it (DEC-06).
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const scoped = this.reflector.getAllAndOverride<boolean>(IS_TENANT_SCOPED, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!scoped) return true;

    const ctx = RequestContext.require();
    if (!ctx.userId) throw new AppException(401, 'UNAUTHENTICATED', 'Sign in again to continue.');

    const header = context.switchToHttp().getRequest<Request>().get('x-tenant-id')?.trim();
    if (!header || !UUID.test(header)) {
      throw new AppException(
        400,
        'TENANT_REQUIRED',
        'Send the active workspace id in X-Tenant-Id.',
      );
    }

    const userId = ctx.userId;
    const membership = await this.prisma.systemTx({ userId, tenantId: header }, async (tx) => {
      // Bring this workspace's system roles up to date before reading permissions (members only).
      const outdated = await tx.membership.count({
        where: {
          tenantId: header,
          userId,
          status: 'ACTIVE',
          tenant: { status: 'ACTIVE', rolesVersion: { lt: ROLE_TEMPLATES_VERSION } },
        },
      });
      if (outdated) await applyRoleTemplates(tx, header);
      return tx.membership.findFirst({
        where: { tenantId: header, userId, status: 'ACTIVE', tenant: { status: 'ACTIVE' } },
        select: {
          id: true,
          kind: true,
          user: { select: { mfaEnabledAt: true } },
          branches: { select: { branchId: true } },
          role: {
            select: {
              key: true,
              requiresMfa: true,
              permissions: { select: { permission: true, scope: true } },
            },
          },
        },
      });
    });
    if (!membership) {
      // Members of a suspended/offboarding workspace get a clear reason; everyone else a 404.
      const blocked = await this.prisma.systemTx({ userId, tenantId: header }, (tx) =>
        tx.membership.count({
          where: {
            tenantId: header,
            userId,
            status: 'ACTIVE',
            tenant: { status: { not: 'ACTIVE' } },
          },
        }),
      );
      if (blocked) {
        throw new AppException(
          403,
          'WORKSPACE_SUSPENDED',
          'This workspace is suspended. Contact support.',
        );
      }
      throw new AppException(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found.');
    }

    if (membership.role?.requiresMfa) {
      if (!membership.user.mfaEnabledAt) {
        throw new AppException(
          403,
          'MFA_SETUP_REQUIRED',
          'Your role requires two-factor authentication. Set it up in your account security settings.',
        );
      }
      if (!ctx.sessionMfaVerified) {
        throw new AppException(403, 'MFA_REQUIRED', 'Sign in again with your authenticator code.');
      }
    }

    ctx.tenantId = header;
    ctx.membershipId = membership.id;
    ctx.membershipKind = membership.kind;
    ctx.roleKey = membership.role?.key ?? null;
    ctx.branchIds = membership.branches.map((b) => b.branchId);
    // EXTERNAL members have no role → no permissions; they only see explicit shares (DEC-09).
    ctx.grants = membership.kind === 'EXTERNAL' ? [] : (membership.role?.permissions ?? []);
    return true;
  }
}
