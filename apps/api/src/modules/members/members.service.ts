import { Injectable } from '@nestjs/common';
import type { MemberSummary, UpdateMemberInput } from '@crm/contracts';
import { OWNER_ROLE_KEY, PERMISSIONS, canGrantRole, scopeFor } from '@crm/permissions';
import { requireTenantContext } from '../../common/context/request-context.js';
import { assertStaffSeatAvailable } from '../../common/data/plan-limits.js';
import { AppException } from '../../common/errors/app-exception.js';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';

const memberSelect = {
  id: true,
  userId: true,
  kind: true,
  status: true,
  joinedAt: true,
  user: { select: { name: true, email: true } },
  branches: { select: { branch: { select: { id: true, name: true } } } },
  role: {
    select: {
      id: true,
      key: true,
      name: true,
      requiresMfa: true,
      permissions: { select: { permission: true, scope: true } },
    },
  },
} as const;

type MemberRow = {
  id: string;
  userId: string;
  kind: 'STAFF' | 'EXTERNAL';
  status: 'ACTIVE' | 'SUSPENDED' | 'REMOVED';
  joinedAt: Date;
  user: { name: string; email: string };
  branches: { branch: { id: string; name: string } }[];
  role: { key: string; name: string; requiresMfa: boolean } | null;
};

function toSummary(m: MemberRow): MemberSummary {
  return {
    id: m.id,
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    kind: m.kind,
    status: m.status,
    role: m.role ? { key: m.role.key, name: m.role.name, requiresMfa: m.role.requiresMfa } : null,
    branches: m.branches.map((b) => b.branch).sort((a, b) => a.name.localeCompare(b.name)),
    joinedAt: m.joinedAt.toISOString(),
  };
}

const notFound = () => new AppException(404, 'NOT_FOUND', 'Member not found.');

/** Checks every id is a branch of the active tenant; returns the distinct ids. */
export async function requireBranches(tx: Tx, branchIds: string[], activeOnly: boolean) {
  const ids = [...new Set(branchIds)];
  if (ids.length === 0) return ids;
  const found = await tx.branch.count({
    where: { id: { in: ids }, ...(activeOnly ? { isActive: true } : {}) },
  });
  if (found !== ids.length) {
    throw new AppException(400, 'UNKNOWN_BRANCH', 'Choose existing, active branches.', [
      { path: 'branchIds', message: 'Unknown or inactive branch' },
    ]);
  }
  return ids;
}

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Who the caller may see depends on the scope of their member:read permission:
   * TENANT = everyone · BRANCH = people who share a branch with them (and themselves) · OWN = themselves.
   */
  async list(): Promise<MemberSummary[]> {
    const ctx = requireTenantContext();
    const scope = scopeFor(ctx.grants, PERMISSIONS.MEMBER_READ);
    const visibility =
      scope === 'TENANT'
        ? {}
        : scope === 'BRANCH'
          ? {
              OR: [
                { id: ctx.membershipId },
                { branches: { some: { branchId: { in: ctx.branchIds } } } },
              ],
            }
          : { id: ctx.membershipId };
    const rows = await this.prisma.tenantTx((tx) =>
      tx.membership.findMany({
        where: { status: { in: ['ACTIVE', 'SUSPENDED'] }, ...visibility },
        orderBy: { joinedAt: 'asc' },
        select: memberSelect,
      }),
    );
    return rows.map(toSummary);
  }

  async update(membershipId: string, input: UpdateMemberInput): Promise<MemberSummary> {
    const ctx = requireTenantContext();
    return this.prisma.tenantTx(async (tx) => {
      const target = await tx.membership.findUnique({
        where: { id: membershipId },
        select: memberSelect,
      });
      if (!target || target.status === 'REMOVED') throw notFound();
      const isSelf = target.id === ctx.membershipId;

      // The actor must outrank the target's current role (e.g. Admin cannot touch the Owner).
      if (!isSelf && target.role && !canGrantRole(ctx.grants, target.role.permissions)) {
        throw new AppException(
          403,
          'ROLE_ESCALATION',
          'You cannot change a member with this role.',
        );
      }

      const data: { roleId?: string; status?: 'ACTIVE' | 'SUSPENDED' } = {};

      if (input.roleKey !== undefined && input.roleKey !== target.role?.key) {
        if (target.kind === 'EXTERNAL') {
          throw new AppException(
            409,
            'EXTERNAL_MEMBER_HAS_NO_ROLE',
            'External collaborators only see what is shared with them. Invite them as staff instead.',
          );
        }
        const newRole = await tx.role.findUnique({
          where: { tenantId_key: { tenantId: ctx.tenantId, key: input.roleKey } },
          select: {
            id: true,
            key: true,
            permissions: { select: { permission: true, scope: true } },
          },
        });
        if (!newRole) {
          throw new AppException(400, 'UNKNOWN_ROLE', 'Unknown role.', [
            { path: 'roleKey', message: 'Unknown role' },
          ]);
        }
        if (!canGrantRole(ctx.grants, newRole.permissions)) {
          throw new AppException(
            403,
            'ROLE_ESCALATION',
            'You cannot assign a role above your own.',
          );
        }
        if (target.role?.key === OWNER_ROLE_KEY) await this.assertNotLastOwner(tx, target.id);
        data.roleId = newRole.id;
      }

      if (input.status !== undefined && input.status !== target.status) {
        if (isSelf) {
          throw new AppException(409, 'CANNOT_SUSPEND_SELF', 'You cannot suspend yourself.');
        }
        if (input.status === 'SUSPENDED' && target.role?.key === OWNER_ROLE_KEY) {
          await this.assertNotLastOwner(tx, target.id);
        }
        if (input.status === 'ACTIVE' && target.kind === 'STAFF') {
          await assertStaffSeatAvailable(tx, ctx.tenantId, { includePending: true });
        }
        data.status = input.status;
      }

      let branchesChanged = false;
      if (input.branchIds !== undefined) {
        if (target.kind === 'EXTERNAL') {
          throw new AppException(
            409,
            'EXTERNAL_MEMBER_HAS_NO_BRANCHES',
            'External collaborators are not assigned to branches.',
          );
        }
        const branchIds = await requireBranches(tx, input.branchIds, false);
        const current = target.branches.map((b) => b.branch.id).sort();
        branchesChanged = current.join() !== [...branchIds].sort().join();
        if (branchesChanged) {
          await tx.membershipBranch.deleteMany({ where: { membershipId: target.id } });
          if (branchIds.length > 0) {
            await tx.membershipBranch.createMany({
              data: branchIds.map((branchId) => ({
                tenantId: ctx.tenantId,
                membershipId: target.id,
                branchId,
              })),
            });
          }
          await this.audit.record(tx, {
            action: 'member.branches_changed',
            targetType: 'membership',
            targetId: target.id,
            metadata: { count: branchIds.length },
          });
        }
      }

      if (Object.keys(data).length === 0 && !branchesChanged) return toSummary(target);

      const updated =
        Object.keys(data).length > 0
          ? await tx.membership.update({ where: { id: target.id }, data, select: memberSelect })
          : await tx.membership.findUniqueOrThrow({
              where: { id: target.id },
              select: memberSelect,
            });
      if (data.roleId) {
        await this.audit.record(tx, {
          action: 'member.role_changed',
          targetType: 'membership',
          targetId: target.id,
          metadata: { from: target.role?.key ?? null, to: updated.role?.key ?? null },
        });
      }
      if (data.status) {
        await this.audit.record(tx, {
          action: data.status === 'SUSPENDED' ? 'member.suspended' : 'member.reactivated',
          targetType: 'membership',
          targetId: target.id,
        });
      }
      return toSummary(updated);
    });
  }

  /**
   * Removes access to THIS workspace only; the user's account and other memberships stay.
   * Anyone may leave; removing others needs member:manage.
   */
  async remove(membershipId: string): Promise<void> {
    const ctx = requireTenantContext();
    await this.prisma.tenantTx(async (tx) => {
      const target = await tx.membership.findUnique({
        where: { id: membershipId },
        select: memberSelect,
      });
      if (!target || target.status === 'REMOVED') throw notFound();
      const isSelf = target.id === ctx.membershipId;
      if (!isSelf) {
        if (scopeFor(ctx.grants, PERMISSIONS.MEMBER_MANAGE) !== 'TENANT') {
          throw new AppException(
            403,
            'PERMISSION_DENIED',
            'You do not have permission to do this.',
          );
        }
        if (target.role && !canGrantRole(ctx.grants, target.role.permissions)) {
          throw new AppException(
            403,
            'ROLE_ESCALATION',
            'You cannot remove a member with this role.',
          );
        }
      }
      if (target.role?.key === OWNER_ROLE_KEY) await this.assertNotLastOwner(tx, target.id);

      await tx.membership.update({
        where: { id: target.id },
        data: { status: 'REMOVED', removedAt: new Date() },
      });
      await tx.membershipBranch.deleteMany({ where: { membershipId: target.id } });
      await this.audit.record(tx, {
        action: isSelf ? 'member.left' : 'member.removed',
        targetType: 'membership',
        targetId: target.id,
      });
    });
  }

  /**
   * Last-owner protection. Locks the tenant's active owner rows so two concurrent demotions
   * cannot both pass the check.
   */
  private async assertNotLastOwner(tx: Tx, excludingMembershipId: string): Promise<void> {
    const { tenantId } = requireTenantContext();
    const owners = await tx.$queryRaw<{ id: string }[]>`
      SELECT m.id FROM memberships m
      JOIN roles r ON r.tenant_id = m.tenant_id AND r.id = m.role_id
      WHERE m.tenant_id = ${tenantId}::uuid AND m.status = 'ACTIVE' AND r.key = ${OWNER_ROLE_KEY}
      FOR UPDATE OF m`;
    if (!owners.some((o) => o.id !== excludingMembershipId)) {
      throw new AppException(
        409,
        'LAST_OWNER',
        'A workspace must keep at least one active owner. Make someone else owner first.',
      );
    }
  }
}
