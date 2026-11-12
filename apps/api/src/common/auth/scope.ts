import type { Permission, PermissionScope } from '@crm/permissions';
import { scopeFor } from '@crm/permissions';
import { type TenantContext, requireTenantContext } from '../context/request-context.js';
import { AppException } from '../errors/app-exception.js';

/** Broadest scope the caller's role grants for a permission in the active workspace, or null. */
export function scopeOf(permission: Permission, ctx: TenantContext = requireTenantContext()) {
  return scopeFor(ctx.grants, permission);
}

/** Like scopeOf, but throws 403 when the role does not grant the permission at all. */
export function requireScope(
  permission: Permission,
  ctx: TenantContext = requireTenantContext(),
): PermissionScope {
  const scope = scopeFor(ctx.grants, permission);
  if (!scope)
    throw new AppException(403, 'PERMISSION_DENIED', 'You do not have permission to do this.');
  return scope;
}

/** For callers with BRANCH scope: the chosen branch must be one of their own branches. */
export function assertBranchInScope(
  scope: PermissionScope,
  branchId: string | null | undefined,
  ctx: TenantContext,
) {
  if (scope === 'BRANCH' && (!branchId || !ctx.branchIds.includes(branchId))) {
    throw new AppException(403, 'OUT_OF_SCOPE', 'Choose one of your own branches.', [
      { path: 'branchId', message: 'Choose one of your own branches' },
    ]);
  }
}
