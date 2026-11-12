import type { PermissionScope } from '@crm/permissions';
import type { TenantContext } from '../../common/context/request-context.js';
import { AppException } from '../../common/errors/app-exception.js';
import type { Tx } from '../../infra/prisma/prisma.service.js';

/**
 * Record-level visibility rules (docs/ARCHITECTURE.md §10). Every query on these records adds the
 * filter for the caller's scope; records outside it behave as "not found".
 *
 * Lead   OWN = I own it · BRANCH = own or in my branches · TENANT = all
 * Client OWN = I created it, converted it from a lead I own, or I am assigned to one of its matters
 *        BRANCH = own or in my branches · TENANT = all
 * Matter OWN = I am assigned to it (active assignment) or I created it
 *        BRANCH = own or in my branches · TENANT = all
 * Appointment OWN = I host it · BRANCH = hosted by me or by someone in my branches · TENANT = all
 * Document  filed on a matter → follows the matter's rule; client-level → follows the client's rule
 * Task   OWN = assigned to me or created by me
 *        BRANCH = own, assigned to someone in my branches, or on a matter in my branches · TENANT = all
 */
export function leadScopeWhere(scope: PermissionScope, ctx: TenantContext) {
  if (scope === 'TENANT') return {};
  if (scope === 'OWN') return { ownerMembershipId: ctx.membershipId };
  return { OR: [{ ownerMembershipId: ctx.membershipId }, { branchId: { in: ctx.branchIds } }] };
}

export function clientOwnConditions(ctx: TenantContext) {
  return [
    { createdByMembershipId: ctx.membershipId },
    { sourceLeads: { some: { ownerMembershipId: ctx.membershipId } } },
    { matters: { some: activeAssignment(ctx) } },
  ];
}

function activeAssignment(ctx: TenantContext) {
  return { assignments: { some: { membershipId: ctx.membershipId, unassignedAt: null } } };
}

export function matterScopeWhere(scope: PermissionScope, ctx: TenantContext) {
  if (scope === 'TENANT') return {};
  const own = [activeAssignment(ctx), { createdByMembershipId: ctx.membershipId }];
  if (scope === 'OWN') return { OR: own };
  return { OR: [...own, { branchId: { in: ctx.branchIds } }] };
}

export function documentScopeWhere(scope: PermissionScope, ctx: TenantContext) {
  if (scope === 'TENANT') return {};
  return {
    OR: [
      { matterId: null, client: clientScopeWhere(scope, ctx) },
      { matter: { is: matterScopeWhere(scope, ctx) } },
    ],
  };
}

export function taskScopeWhere(scope: PermissionScope, ctx: TenantContext) {
  if (scope === 'TENANT') return {};
  const own = [
    { assigneeMembershipId: ctx.membershipId },
    { createdByMembershipId: ctx.membershipId },
  ];
  if (scope === 'OWN') return { OR: own };
  return {
    OR: [
      ...own,
      { assignee: { branches: { some: { branchId: { in: ctx.branchIds } } } } },
      { matter: { branchId: { in: ctx.branchIds } } },
    ],
  };
}

export function clientScopeWhere(scope: PermissionScope, ctx: TenantContext) {
  if (scope === 'TENANT') return {};
  const own = clientOwnConditions(ctx);
  if (scope === 'OWN') return { OR: own };
  return { OR: [...own, { branchId: { in: ctx.branchIds } }] };
}

export function appointmentScopeWhere(scope: PermissionScope, ctx: TenantContext) {
  if (scope === 'TENANT') return {};
  if (scope === 'OWN') return { hostMembershipId: ctx.membershipId };
  return {
    OR: [
      { hostMembershipId: ctx.membershipId },
      { host: { branches: { some: { branchId: { in: ctx.branchIds } } } } },
    ],
  };
}

export const notFound = (what: string) => new AppException(404, 'NOT_FOUND', `${what} not found.`);

export function invalidRef(field: string, message = 'Choose a value from the list') {
  return new AppException(400, 'INVALID_REFERENCE', message, [{ path: field, message }]);
}

/** An ACTIVE staff member of this workspace (owners/hosts/assignees). */
export async function requireActiveStaff(
  tx: Tx,
  membershipId: string,
  field: string,
): Promise<void> {
  const found = await tx.membership.count({
    where: { id: membershipId, status: 'ACTIVE', kind: 'STAFF' },
  });
  if (!found) throw invalidRef(field, 'Choose an active team member');
}

export async function requireActiveBranch(
  tx: Tx,
  branchId: string,
  field = 'branchId',
): Promise<void> {
  const found = await tx.branch.count({ where: { id: branchId, isActive: true } });
  if (!found) throw invalidRef(field, 'Choose an active branch');
}

export async function requirePartner(tx: Tx, partnerId: string, field: string): Promise<void> {
  const found = await tx.partnerOrganization.count({ where: { id: partnerId, deletedAt: null } });
  if (!found) throw invalidRef(field, 'Choose a partner from the directory');
}

/** A partner contact; when a partner is given, the contact must belong to it. */
export async function requirePartnerContact(
  tx: Tx,
  contactId: string,
  partnerId: string | null | undefined,
  field: string,
): Promise<string> {
  const contact = await tx.partnerContact.findFirst({
    where: { id: contactId, deletedAt: null, partnerOrg: { deletedAt: null } },
    select: { partnerOrgId: true },
  });
  if (!contact || (partnerId && contact.partnerOrgId !== partnerId)) {
    throw invalidRef(field, 'Choose a contact of the referring partner');
  }
  return contact.partnerOrgId;
}

export function memberRef(m: { id: string; user: { name: string } } | null) {
  return m ? { id: m.id, name: m.user.name } : null;
}

export const memberRefSelect = { select: { id: true, user: { select: { name: true } } } } as const;
