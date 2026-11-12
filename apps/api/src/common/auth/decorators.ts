import { SetMetadata, applyDecorators } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import type { Permission, PermissionScope } from '@crm/permissions';

export const IS_PUBLIC = 'auth:isPublic';
export const IS_TENANT_SCOPED = 'auth:isTenantScoped';
export const REQUIRED_PERMISSION = 'auth:requiredPermission';

/** No login needed (register, login, health…). Everything else requires a valid access token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Route works inside one workspace. Requires the `X-Tenant-Id` header; the API verifies an ACTIVE
 * membership on every request (the header is only a selector, never proof of access).
 */
export const TenantScoped = () =>
  applyDecorators(
    SetMetadata(IS_TENANT_SCOPED, true),
    ApiBearerAuth(),
    ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Active workspace id' }),
  );

export interface RequiredPermission {
  permission: Permission;
  /** Minimum scope the caller's role must grant (default OWN = any scope). */
  minScope: PermissionScope;
}

export const RequirePermission = (permission: Permission, minScope: PermissionScope = 'OWN') =>
  SetMetadata(REQUIRED_PERMISSION, { permission, minScope } satisfies RequiredPermission);
