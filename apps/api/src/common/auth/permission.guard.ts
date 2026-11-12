import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type PermissionScope, scopeFor } from '@crm/permissions';
import { RequestContext } from '../context/request-context.js';
import { AppException } from '../errors/app-exception.js';
import { REQUIRED_PERMISSION, type RequiredPermission } from './decorators.js';

const RANK: Record<PermissionScope, number> = { OWN: 1, BRANCH: 2, TENANT: 3 };

/** Route-level RBAC. Resource-level rules (own/branch/shares) are checked again in services. */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const required = this.reflector.getAllAndOverride<RequiredPermission | undefined>(
      REQUIRED_PERMISSION,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const grants = RequestContext.get()?.grants;
    if (!grants) throw new Error('PermissionGuard used without TenantScoped');
    const scope = scopeFor(grants, required.permission);
    if (!scope || RANK[scope] < RANK[required.minScope]) {
      throw new AppException(403, 'PERMISSION_DENIED', 'You do not have permission to do this.');
    }
    return true;
  }
}
