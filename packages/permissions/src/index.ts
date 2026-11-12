/**
 * Permission model (docs/ARCHITECTURE.md §10, decision DEC-08).
 * - A permission is a code `resource:action`.
 * - A role grants permissions, each with a scope: OWN (assigned to me) < BRANCH < TENANT.
 * - EXTERNAL members have no role: they only see resources explicitly shared with them (DEC-09).
 */

export const PERMISSION_SCOPES = ['OWN', 'BRANCH', 'TENANT'] as const;
export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

export const PERMISSIONS = {
  TENANT_READ: 'tenant:read',
  TENANT_UPDATE: 'tenant:update',
  BILLING_READ: 'billing:read',
  BILLING_MANAGE: 'billing:manage',
  MEMBER_READ: 'member:read',
  MEMBER_INVITE: 'member:invite',
  MEMBER_MANAGE: 'member:manage',
  ROLE_READ: 'role:read',
  BRANCH_READ: 'branch:read',
  BRANCH_MANAGE: 'branch:manage',
  LEAD_READ: 'lead:read',
  LEAD_CREATE: 'lead:create',
  LEAD_UPDATE: 'lead:update',
  LEAD_DELETE: 'lead:delete',
  CLIENT_READ: 'client:read',
  CLIENT_CREATE: 'client:create',
  CLIENT_UPDATE: 'client:update',
  MATTER_READ: 'matter:read',
  MATTER_CREATE: 'matter:create',
  MATTER_UPDATE: 'matter:update',
  DOCUMENT_READ: 'document:read',
  DOCUMENT_UPLOAD: 'document:upload',
  DOCUMENT_DOWNLOAD: 'document:download',
  DIRECTORY_READ: 'directory:read',
  DIRECTORY_MANAGE: 'directory:manage',
  PARTNER_MANAGE: 'partner:manage',
  SHARE_MANAGE: 'share:manage',
  AUDIT_READ: 'audit:read',
  APPOINTMENT_READ: 'appointment:read',
  APPOINTMENT_MANAGE: 'appointment:manage',
  TASK_READ: 'task:read',
  TASK_MANAGE: 'task:manage',
  REPORT_READ: 'report:read',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS);

export interface PermissionGrant {
  permission: Permission;
  scope: PermissionScope;
}

export interface RoleTemplate {
  key: string;
  name: string;
  requiresMfa: boolean;
  grants: readonly PermissionGrant[];
}

/**
 * Bump whenever ROLE_TEMPLATES change. On start-up the API re-applies the templates to every
 * workspace whose system roles are on an older version (system roles are not editable by agencies).
 *  v1 Stage 2 · v2 Stage 4/5: appointments and tasks · v3 Stage 7: reports.
 * Reports never widen access: each report also applies the caller's scope for the data it shows.
 */
export const ROLE_TEMPLATES_VERSION = 3;

export const OWNER_ROLE_KEY = 'owner';
export const ADMIN_ROLE_KEY = 'admin';

const PERMISSION_PATTERN = /^[a-z][a-z_]*:[a-z][a-z_]*$/;

export function isValidPermissionCode(code: string): boolean {
  return PERMISSION_PATTERN.test(code);
}

const SCOPE_RANK: Record<PermissionScope, number> = { OWN: 1, BRANCH: 2, TENANT: 3 };

function grant(scope: PermissionScope, ...permissions: Permission[]): PermissionGrant[] {
  return permissions.map((permission) => ({ permission, scope }));
}

const P = PERMISSIONS;

/**
 * System role templates copied into every new tenant (DEC-08: starting point from §10.2).
 * "basic" field-level restrictions (e.g. reception sees client contact details only) are
 * enforced in the relevant modules in later stages.
 */
export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    key: OWNER_ROLE_KEY,
    name: 'Owner',
    requiresMfa: true,
    grants: grant('TENANT', ...ALL_PERMISSIONS),
  },
  {
    key: ADMIN_ROLE_KEY,
    name: 'Admin',
    requiresMfa: true,
    grants: grant(
      'TENANT',
      ...ALL_PERMISSIONS.filter((p) => p !== P.BILLING_READ && p !== P.BILLING_MANAGE),
    ),
  },
  {
    key: 'branch_manager',
    name: 'Branch Manager',
    requiresMfa: false,
    grants: [
      ...grant('TENANT', P.TENANT_READ, P.ROLE_READ, P.BRANCH_READ, P.DIRECTORY_READ),
      ...grant(
        'BRANCH',
        P.MEMBER_READ,
        P.MEMBER_INVITE,
        P.LEAD_READ,
        P.LEAD_CREATE,
        P.LEAD_UPDATE,
        P.CLIENT_READ,
        P.CLIENT_CREATE,
        P.CLIENT_UPDATE,
        P.MATTER_READ,
        P.MATTER_CREATE,
        P.MATTER_UPDATE,
        P.DOCUMENT_READ,
        P.DOCUMENT_UPLOAD,
        P.DOCUMENT_DOWNLOAD,
        P.APPOINTMENT_READ,
        P.APPOINTMENT_MANAGE,
        P.TASK_READ,
        P.TASK_MANAGE,
        P.REPORT_READ,
      ),
    ],
  },
  ...(['migration_agent', 'migration_lawyer', 'case_manager'] as const).map(
    (key): RoleTemplate => ({
      key,
      name:
        key === 'migration_agent'
          ? 'Migration Agent'
          : key === 'migration_lawyer'
            ? 'Migration Lawyer'
            : 'Case Manager',
      requiresMfa: false,
      grants: [
        ...grant('TENANT', P.TENANT_READ, P.DIRECTORY_READ),
        ...grant(
          'OWN',
          P.LEAD_READ,
          P.LEAD_UPDATE,
          P.CLIENT_READ,
          P.CLIENT_UPDATE,
          P.MATTER_READ,
          P.MATTER_UPDATE,
          P.DOCUMENT_READ,
          P.DOCUMENT_UPLOAD,
          P.DOCUMENT_DOWNLOAD,
          P.APPOINTMENT_READ,
          P.APPOINTMENT_MANAGE,
          P.TASK_READ,
          P.TASK_MANAGE,
        ),
      ],
    }),
  ),
  {
    key: 'sales_manager',
    name: 'Sales / Lead Manager',
    requiresMfa: false,
    grants: [
      ...grant(
        'TENANT',
        P.TENANT_READ,
        P.LEAD_READ,
        P.LEAD_CREATE,
        P.LEAD_UPDATE,
        P.CLIENT_READ,
        P.DIRECTORY_READ,
        P.PARTNER_MANAGE,
        P.APPOINTMENT_READ,
        P.APPOINTMENT_MANAGE,
        P.REPORT_READ,
      ),
      ...grant('OWN', P.TASK_READ, P.TASK_MANAGE),
    ],
  },
  {
    key: 'receptionist',
    name: 'Receptionist',
    requiresMfa: false,
    grants: grant(
      'TENANT',
      P.TENANT_READ,
      P.LEAD_READ,
      P.LEAD_CREATE,
      P.CLIENT_READ,
      P.DOCUMENT_UPLOAD,
      P.DIRECTORY_READ,
      P.APPOINTMENT_READ,
      P.APPOINTMENT_MANAGE,
    ),
  },
  {
    key: 'finance_manager',
    name: 'Accounts / Finance Manager',
    requiresMfa: false,
    grants: grant(
      'TENANT',
      P.TENANT_READ,
      P.BILLING_READ,
      P.CLIENT_READ,
      P.MATTER_READ,
      P.DIRECTORY_READ,
      P.REPORT_READ,
    ),
  },
];

export function findRoleTemplate(key: string): RoleTemplate | undefined {
  return ROLE_TEMPLATES.find((role) => role.key === key);
}

/** True when the grants include the permission at any scope. */
export function hasPermission(
  grants: readonly { permission: string; scope: PermissionScope }[],
  permission: Permission,
): boolean {
  return grants.some((g) => g.permission === permission);
}

/** Broadest scope at which the grants include the permission, or null. */
export function scopeFor(
  grants: readonly { permission: string; scope: PermissionScope }[],
  permission: Permission,
): PermissionScope | null {
  let best: PermissionScope | null = null;
  for (const g of grants) {
    if (g.permission === permission && (!best || SCOPE_RANK[g.scope] > SCOPE_RANK[best])) {
      best = g.scope;
    }
  }
  return best;
}

/**
 * Privilege-escalation guard: an actor may assign/invite a role only if every grant of that role
 * is also held by the actor at the same or a broader scope.
 */
export function canGrantRole(
  actorGrants: readonly { permission: string; scope: PermissionScope }[],
  roleGrants: readonly { permission: string; scope: PermissionScope }[],
): boolean {
  return roleGrants.every((rg) => {
    const actorScope = scopeFor(actorGrants, rg.permission as Permission);
    return actorScope !== null && SCOPE_RANK[actorScope] >= SCOPE_RANK[rg.scope];
  });
}
