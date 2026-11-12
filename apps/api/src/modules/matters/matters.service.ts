import { Injectable } from '@nestjs/common';
import type {
  AddAssignmentInput,
  CreateChecklistItemInput,
  CreateDeadlineInput,
  CreateMatterInput,
  CreateParticipantInput,
  MatterDetail,
  MatterListQuery,
  MatterStatus,
  MatterSummary,
  Paginated,
  TransitionMatterInput,
  UpdateChecklistItemInput,
  UpdateDeadlineInput,
  UpdateMatterInput,
} from '@crm/contracts';
import { PERMISSIONS, type PermissionScope } from '@crm/permissions';
import { assertBranchInScope, requireScope, scopeOf } from '../../common/auth/scope.js';
import { type TenantContext, requireTenantContext } from '../../common/context/request-context.js';
import { formatNumber, nextCounter } from '../../common/data/counters.js';
import { AppException } from '../../common/errors/app-exception.js';
import { contains, pageArgs, toPage } from '../../common/pagination/pagination.js';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import {
  clientScopeWhere,
  invalidRef,
  matterScopeWhere,
  memberRef,
  memberRefSelect,
  notFound,
  requireActiveBranch,
  requireActiveStaff,
} from '../crm/access.js';
import { requireReferenceOption } from '../reference/reference.service.js';

const P = PERMISSIONS;
const MATTER = 'Matter';
const named = { select: { id: true, name: true } } as const;
const activeAssignments = {
  where: { unassignedAt: null },
  orderBy: { assignedAt: 'asc' as const },
  select: { id: true, responsibility: true, assignedAt: true, membership: memberRefSelect },
} as const;

const summarySelect = {
  id: true,
  reference: true,
  title: true,
  status: true,
  openedAt: true,
  updatedAt: true,
  matterType: named,
  stage: named,
  branch: named,
  client: { select: { id: true, clientNumber: true, displayName: true } },
  assignments: activeAssignments,
} as const;

const detailSelect = {
  ...summarySelect,
  description: true,
  closedAt: true,
  matterType: {
    select: {
      id: true,
      name: true,
      stages: {
        orderBy: { sortOrder: 'asc' as const },
        select: { id: true, name: true, sortOrder: true, isTerminal: true, isActive: true },
      },
    },
  },
  participants: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      notes: true,
      role: named,
      client: { select: { id: true, displayName: true } },
      professional: { select: { id: true, fullName: true } },
      partnerOrg: { select: { id: true, name: true } },
    },
  },
  deadlines: {
    orderBy: { dueAt: 'asc' as const },
    select: {
      id: true,
      title: true,
      dueAt: true,
      remindAt: true,
      reminderSentAt: true,
      completedAt: true,
    },
  },
  checklist: {
    orderBy: { sortOrder: 'asc' as const },
    select: {
      id: true,
      title: true,
      isRequired: true,
      sortOrder: true,
      completedAt: true,
      completedBy: memberRefSelect,
    },
  },
  history: {
    orderBy: { createdAt: 'desc' as const },
    take: 100,
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      fromStageId: true,
      toStageId: true,
      reason: true,
      createdAt: true,
      changedBy: memberRefSelect,
    },
  },
} as const;

type Member = { id: string; user: { name: string } };
type SummaryRow = {
  id: string;
  reference: string;
  title: string;
  status: MatterStatus;
  openedAt: Date;
  updatedAt: Date;
  matterType: { id: string; name: string };
  stage: { id: string; name: string } | null;
  branch: { id: string; name: string } | null;
  client: { id: string; clientNumber: string; displayName: string };
  assignments: {
    id: string;
    responsibility: string | null;
    assignedAt: Date;
    membership: Member;
  }[];
};

const iso = (d: Date | null) => d?.toISOString() ?? null;
const ref = (m: Member) => memberRef(m) ?? { id: m.id, name: '' };

function toSummary(row: SummaryRow): MatterSummary {
  return {
    id: row.id,
    reference: row.reference,
    title: row.title,
    status: row.status,
    type: { id: row.matterType.id, name: row.matterType.name },
    stage: row.stage,
    client: row.client,
    branch: row.branch,
    assignees: row.assignments.map((a) => ref(a.membership)),
    openedAt: row.openedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type DetailRow = Omit<SummaryRow, 'matterType'> & {
  description: string | null;
  closedAt: Date | null;
  matterType: {
    id: string;
    name: string;
    stages: {
      id: string;
      name: string;
      sortOrder: number;
      isTerminal: boolean;
      isActive: boolean;
    }[];
  };
  participants: {
    id: string;
    notes: string | null;
    role: { id: string; name: string };
    client: { id: string; displayName: string } | null;
    professional: { id: string; fullName: string } | null;
    partnerOrg: { id: string; name: string } | null;
  }[];
  deadlines: {
    id: string;
    title: string;
    dueAt: Date;
    remindAt: Date | null;
    reminderSentAt: Date | null;
    completedAt: Date | null;
  }[];
  checklist: {
    id: string;
    title: string;
    isRequired: boolean;
    sortOrder: number;
    completedAt: Date | null;
    completedBy: Member | null;
  }[];
  history: {
    id: string;
    fromStatus: MatterStatus | null;
    toStatus: MatterStatus | null;
    fromStageId: string | null;
    toStageId: string | null;
    reason: string | null;
    createdAt: Date;
    changedBy: Member;
  }[];
};

function toDetail(row: DetailRow): MatterDetail {
  const stageName = new Map(row.matterType.stages.map((s) => [s.id, s.name]));
  const stageRef = (id: string | null) => (id ? { id, name: stageName.get(id) ?? '' } : null);
  return {
    ...toSummary(row),
    description: row.description,
    closedAt: iso(row.closedAt),
    stages: row.matterType.stages,
    assignments: row.assignments.map((a) => ({
      id: a.id,
      member: ref(a.membership),
      responsibility: a.responsibility,
      assignedAt: a.assignedAt.toISOString(),
    })),
    participants: row.participants.map((p) => {
      const party = p.client
        ? { kind: 'client' as const, party: { id: p.client.id, name: p.client.displayName } }
        : p.professional
          ? {
              kind: 'professional' as const,
              party: { id: p.professional.id, name: p.professional.fullName },
            }
          : {
              kind: 'partner' as const,
              party: { id: p.partnerOrg?.id ?? '', name: p.partnerOrg?.name ?? '' },
            };
      return { id: p.id, role: p.role, notes: p.notes, ...party };
    }),
    deadlines: row.deadlines.map((d) => ({
      id: d.id,
      title: d.title,
      dueAt: d.dueAt.toISOString(),
      remindAt: iso(d.remindAt),
      reminderSentAt: iso(d.reminderSentAt),
      completedAt: iso(d.completedAt),
    })),
    checklist: row.checklist.map((c) => ({
      id: c.id,
      title: c.title,
      isRequired: c.isRequired,
      sortOrder: c.sortOrder,
      completedAt: iso(c.completedAt),
      completedBy: c.completedBy ? ref(c.completedBy) : null,
    })),
    history: row.history.map((h) => ({
      id: h.id,
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      fromStage: stageRef(h.fromStageId),
      toStage: stageRef(h.toStageId),
      reason: h.reason,
      changedBy: ref(h.changedBy),
      createdAt: h.createdAt.toISOString(),
    })),
  };
}

const outOfScope = (message: string, path?: string) =>
  new AppException(403, 'OUT_OF_SCOPE', message, path ? [{ path, message }] : undefined);

@Injectable()
export class MattersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: MatterListQuery): Promise<Paginated<MatterSummary>> {
    const ctx = requireTenantContext();
    const scope = requireScope(P.MATTER_READ, ctx);
    const rows = await this.prisma.tenantTx((tx) =>
      tx.matter.findMany({
        where: {
          AND: [
            matterScopeWhere(scope, ctx),
            query.status ? { status: query.status } : { status: { not: 'ARCHIVED' } },
            query.clientId ? { clientId: query.clientId } : {},
            query.matterTypeId ? { matterTypeId: query.matterTypeId } : {},
            query.mine
              ? { assignments: { some: { membershipId: ctx.membershipId, unassignedAt: null } } }
              : {},
            query.q
              ? {
                  OR: [
                    { reference: contains(query.q) },
                    { title: contains(query.q) },
                    { client: { displayName: contains(query.q) } },
                  ],
                }
              : {},
          ],
        },
        select: summarySelect,
        ...pageArgs(query),
      }),
    );
    return toPage(rows, query.limit, toSummary);
  }

  async get(id: string): Promise<MatterDetail> {
    const ctx = requireTenantContext();
    const scope = requireScope(P.MATTER_READ, ctx);
    return this.prisma.tenantTx(async (tx) => {
      if (!(await tx.matter.count({ where: { AND: [{ id }, matterScopeWhere(scope, ctx)] } })))
        throw notFound(MATTER);
      return this.load(tx, id);
    });
  }

  async create(input: CreateMatterInput): Promise<MatterDetail> {
    const ctx = requireTenantContext();
    const scope = requireScope(P.MATTER_CREATE, ctx);
    return this.prisma.tenantTx(async (tx) => {
      const clientScope = scopeOf(P.CLIENT_READ, ctx);
      const client = clientScope
        ? await tx.client.findFirst({
            where: {
              AND: [{ id: input.clientId, deletedAt: null }, clientScopeWhere(clientScope, ctx)],
            },
            select: { id: true, branchId: true },
          })
        : null;
      if (!client) throw invalidRef('clientId', 'Choose a client you can see');

      const type = await tx.matterType.findFirst({
        where: { id: input.matterTypeId, isActive: true },
        select: {
          id: true,
          stages: {
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
            take: 1,
            select: { id: true },
          },
          checklist: {
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
            select: { title: true, isRequired: true },
          },
        },
      });
      if (!type) throw invalidRef('matterTypeId', 'Choose an active matter type');

      const branchId = input.branchId === undefined ? client.branchId : input.branchId;
      assertBranchInScope(scope, branchId, ctx);
      if (branchId) await requireActiveBranch(tx, branchId);

      const assignees = [...new Set(input.assigneeMembershipIds ?? [ctx.membershipId])];
      for (const membershipId of assignees) {
        await this.checkAssignee(tx, ctx, scope, membershipId, 'assigneeMembershipIds');
      }

      const stageId = type.stages[0]?.id ?? null;
      const number = await nextCounter(tx, ctx.tenantId, 'matter');
      const matter = await tx.matter.create({
        data: {
          tenantId: ctx.tenantId,
          reference: formatNumber('M', number),
          title: input.title,
          description: input.description ?? null,
          clientId: client.id,
          matterTypeId: type.id,
          stageId,
          branchId: branchId ?? null,
          createdByMembershipId: ctx.membershipId,
        },
        select: { id: true },
      });
      if (assignees.length) {
        await tx.matterAssignment.createMany({
          data: assignees.map((membershipId) => ({
            tenantId: ctx.tenantId,
            matterId: matter.id,
            membershipId,
          })),
        });
      }
      if (type.checklist.length) {
        await tx.checklistItem.createMany({
          data: type.checklist.map((item, i) => ({
            tenantId: ctx.tenantId,
            matterId: matter.id,
            title: item.title,
            isRequired: item.isRequired,
            sortOrder: i + 1,
          })),
        });
      }
      await tx.matterStatusHistory.createMany({
        data: {
          tenantId: ctx.tenantId,
          matterId: matter.id,
          toStatus: 'OPEN',
          toStageId: stageId,
          changedByMembershipId: ctx.membershipId,
        },
      });
      if (stageId) await this.applyStageTasks(tx, ctx, matter.id, stageId);
      await this.audit.record(tx, {
        action: 'matter.created',
        targetType: 'matter',
        targetId: matter.id,
      });
      return this.load(tx, matter.id);
    });
  }

  async update(id: string, input: UpdateMatterInput): Promise<MatterDetail> {
    const ctx = requireTenantContext();
    return this.prisma.tenantTx(async (tx) => {
      const { scope } = await this.requireEditable(tx, ctx, id);
      if (input.branchId !== undefined) {
        assertBranchInScope(scope, input.branchId, ctx);
        if (input.branchId) await requireActiveBranch(tx, input.branchId);
      }
      await tx.matter.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.branchId !== undefined ? { branchId: input.branchId } : {}),
        },
      });
      await this.audit.record(tx, {
        action: 'matter.updated',
        targetType: 'matter',
        targetId: id,
        metadata: { fields: Object.keys(input).sort().join(',') },
      });
      return this.load(tx, id);
    });
  }

  /** Stage and/or status change. Writes one history row. Archived matters can only be re-opened. */
  async transition(id: string, input: TransitionMatterInput): Promise<MatterDetail> {
    const ctx = requireTenantContext();
    return this.prisma.tenantTx(async (tx) => {
      const { current } = await this.requireEditable(tx, ctx, id, { allowArchived: true });
      if (current.status === 'ARCHIVED' && input.status !== 'OPEN') {
        throw new AppException(409, 'MATTER_ARCHIVED', 'Re-open the matter before changing it.');
      }
      let toStageId: string | undefined;
      if (input.stageId && input.stageId !== current.stageId) {
        const stage = await tx.matterStage.count({
          where: { id: input.stageId, matterTypeId: current.matterTypeId, isActive: true },
        });
        if (!stage) throw invalidRef('stageId', 'Choose an active stage of this matter type');
        toStageId = input.stageId;
      }
      const toStatus = input.status && input.status !== current.status ? input.status : undefined;
      if (!toStageId && !toStatus) {
        throw new AppException(409, 'NO_CHANGE', 'The matter is already at that stage and status.');
      }
      const closing = toStatus === 'CLOSED' || toStatus === 'ARCHIVED';
      await tx.matter.update({
        where: { id },
        data: {
          ...(toStageId ? { stageId: toStageId } : {}),
          ...(toStatus ? { status: toStatus } : {}),
          ...(toStatus ? { closedAt: closing ? (current.closedAt ?? new Date()) : null } : {}),
        },
      });
      await tx.matterStatusHistory.createMany({
        data: {
          tenantId: ctx.tenantId,
          matterId: id,
          fromStatus: toStatus ? current.status : null,
          toStatus: toStatus ?? null,
          fromStageId: toStageId ? current.stageId : null,
          toStageId: toStageId ?? null,
          reason: input.reason ?? null,
          changedByMembershipId: ctx.membershipId,
        },
      });
      if (toStageId) await this.applyStageTasks(tx, ctx, id, toStageId);
      await this.audit.record(tx, {
        action: 'matter.transitioned',
        targetType: 'matter',
        targetId: id,
        metadata: {
          ...(toStatus ? { status: toStatus } : {}),
          ...(toStageId ? { stage: 'changed' } : {}),
        },
      });
      return this.load(tx, id);
    });
  }

  // ───────── Assignments ─────────

  async addAssignment(id: string, input: AddAssignmentInput): Promise<MatterDetail> {
    const ctx = requireTenantContext();
    return this.prisma.tenantTx(async (tx) => {
      const { scope } = await this.requireEditable(tx, ctx, id);
      this.requireStaffingScope(scope);
      await this.checkAssignee(tx, ctx, scope, input.membershipId, 'membershipId');
      const existing = await tx.matterAssignment.count({
        where: { matterId: id, membershipId: input.membershipId, unassignedAt: null },
      });
      if (existing) {
        throw new AppException(409, 'ALREADY_ASSIGNED', 'This person is already assigned.', [
          { path: 'membershipId', message: 'Already assigned' },
        ]);
      }
      await tx.matterAssignment.create({
        data: {
          tenantId: ctx.tenantId,
          matterId: id,
          membershipId: input.membershipId,
          responsibility: input.responsibility ?? null,
        },
      });
      await this.touch(tx, id);
      await this.audit.record(tx, {
        action: 'matter.assigned',
        targetType: 'matter',
        targetId: id,
        metadata: { membershipId: input.membershipId },
      });
      return this.load(tx, id);
    });
  }

  async removeAssignment(id: string, assignmentId: string): Promise<MatterDetail> {
    const ctx = requireTenantContext();
    return this.prisma.tenantTx(async (tx) => {
      const { scope } = await this.requireEditable(tx, ctx, id);
      this.requireStaffingScope(scope);
      const done = await tx.matterAssignment.updateMany({
        where: { id: assignmentId, matterId: id, unassignedAt: null },
        data: { unassignedAt: new Date() },
      });
      if (!done.count) throw notFound('Assignment');
      await this.touch(tx, id);
      await this.audit.record(tx, {
        action: 'matter.unassigned',
        targetType: 'matter',
        targetId: id,
      });
      return this.load(tx, id);
    });
  }

  // ───────── Participants ─────────

  async addParticipant(id: string, input: CreateParticipantInput): Promise<MatterDetail> {
    const ctx = requireTenantContext();
    return this.prisma.tenantTx(async (tx) => {
      await this.requireEditable(tx, ctx, id);
      await requireReferenceOption(tx, input.roleId, 'PARTICIPANT_ROLE', 'roleId');
      if (input.clientId) {
        const clientScope = scopeOf(P.CLIENT_READ, ctx);
        const found = clientScope
          ? await tx.client.count({
              where: {
                AND: [{ id: input.clientId, deletedAt: null }, clientScopeWhere(clientScope, ctx)],
              },
            })
          : 0;
        if (!found) throw invalidRef('clientId', 'Choose a client you can see');
      }
      if (input.professionalId) {
        const found = await tx.professionalProfile.count({
          where: { id: input.professionalId, deletedAt: null },
        });
        if (!found) throw invalidRef('professionalId', 'Choose a professional from the directory');
      }
      if (input.partnerOrgId) {
        const found = await tx.partnerOrganization.count({
          where: { id: input.partnerOrgId, deletedAt: null },
        });
        if (!found) throw invalidRef('partnerOrgId', 'Choose a partner from the directory');
      }
      await tx.matterParticipant.create({
        data: {
          tenantId: ctx.tenantId,
          matterId: id,
          roleId: input.roleId,
          clientId: input.clientId ?? null,
          professionalId: input.professionalId ?? null,
          partnerOrgId: input.partnerOrgId ?? null,
          notes: input.notes ?? null,
        },
      });
      await this.touch(tx, id);
      await this.audit.record(tx, {
        action: 'matter.participant_added',
        targetType: 'matter',
        targetId: id,
      });
      return this.load(tx, id);
    });
  }

  async removeParticipant(id: string, participantId: string): Promise<MatterDetail> {
    const ctx = requireTenantContext();
    return this.prisma.tenantTx(async (tx) => {
      await this.requireEditable(tx, ctx, id);
      const done = await tx.matterParticipant.deleteMany({
        where: { id: participantId, matterId: id },
      });
      if (!done.count) throw notFound('Participant');
      await this.touch(tx, id);
      await this.audit.record(tx, {
        action: 'matter.participant_removed',
        targetType: 'matter',
        targetId: id,
      });
      return this.load(tx, id);
    });
  }

  // ───────── Deadlines ─────────

  async addDeadline(id: string, input: CreateDeadlineInput): Promise<MatterDetail> {
    const ctx = requireTenantContext();
    return this.prisma.tenantTx(async (tx) => {
      await this.requireEditable(tx, ctx, id);
      await tx.matterDeadline.create({
        data: {
          tenantId: ctx.tenantId,
          matterId: id,
          title: input.title,
          dueAt: new Date(input.dueAt),
          remindAt: input.remindAt ? new Date(input.remindAt) : null,
        },
      });
      await this.touch(tx, id);
      await this.audit.record(tx, {
        action: 'matter.deadline_added',
        targetType: 'matter',
        targetId: id,
      });
      return this.load(tx, id);
    });
  }

  async updateDeadline(
    id: string,
    deadlineId: string,
    input: UpdateDeadlineInput,
  ): Promise<MatterDetail> {
    const ctx = requireTenantContext();
    return this.prisma.tenantTx(async (tx) => {
      await this.requireEditable(tx, ctx, id);
      const current = await tx.matterDeadline.findFirst({
        where: { id: deadlineId, matterId: id },
        select: { dueAt: true, remindAt: true, completedAt: true },
      });
      if (!current) throw notFound('Deadline');
      const dueAt = input.dueAt ? new Date(input.dueAt) : current.dueAt;
      const remindAt =
        input.remindAt === undefined
          ? current.remindAt
          : input.remindAt
            ? new Date(input.remindAt)
            : null;
      if (remindAt && remindAt > dueAt) {
        throw new AppException(
          400,
          'VALIDATION_FAILED',
          'The reminder must be on or before the due time.',
          [{ path: 'remindAt', message: 'Must be on or before the due time' }],
        );
      }
      const reminderChanged =
        input.remindAt !== undefined &&
        (remindAt?.getTime() ?? null) !== (current.remindAt?.getTime() ?? null);
      await tx.matterDeadline.update({
        where: { id: deadlineId },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          dueAt,
          remindAt,
          ...(reminderChanged ? { reminderSentAt: null } : {}),
          ...(input.completed !== undefined
            ? { completedAt: input.completed ? (current.completedAt ?? new Date()) : null }
            : {}),
        },
      });
      await this.touch(tx, id);
      await this.audit.record(tx, {
        action: 'matter.deadline_updated',
        targetType: 'matter',
        targetId: id,
      });
      return this.load(tx, id);
    });
  }

  async removeDeadline(id: string, deadlineId: string): Promise<MatterDetail> {
    const ctx = requireTenantContext();
    return this.prisma.tenantTx(async (tx) => {
      await this.requireEditable(tx, ctx, id);
      const done = await tx.matterDeadline.deleteMany({ where: { id: deadlineId, matterId: id } });
      if (!done.count) throw notFound('Deadline');
      await this.touch(tx, id);
      await this.audit.record(tx, {
        action: 'matter.deadline_removed',
        targetType: 'matter',
        targetId: id,
      });
      return this.load(tx, id);
    });
  }

  // ───────── Checklist ─────────

  async addChecklistItem(id: string, input: CreateChecklistItemInput): Promise<MatterDetail> {
    const ctx = requireTenantContext();
    return this.prisma.tenantTx(async (tx) => {
      await this.requireEditable(tx, ctx, id);
      const max = await tx.checklistItem.aggregate({
        where: { matterId: id },
        _max: { sortOrder: true },
      });
      await tx.checklistItem.create({
        data: {
          tenantId: ctx.tenantId,
          matterId: id,
          title: input.title,
          isRequired: input.isRequired,
          sortOrder: (max._max.sortOrder ?? 0) + 1,
        },
      });
      await this.touch(tx, id);
      return this.load(tx, id);
    });
  }

  async updateChecklistItem(
    id: string,
    itemId: string,
    input: UpdateChecklistItemInput,
  ): Promise<MatterDetail> {
    const ctx = requireTenantContext();
    return this.prisma.tenantTx(async (tx) => {
      await this.requireEditable(tx, ctx, id);
      const current = await tx.checklistItem.findFirst({
        where: { id: itemId, matterId: id },
        select: { completedAt: true },
      });
      if (!current) throw notFound('Checklist item');
      const completing = input.done === true && !current.completedAt;
      await tx.checklistItem.update({
        where: { id: itemId },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(completing
            ? { completedAt: new Date(), completedByMembershipId: ctx.membershipId }
            : {}),
          ...(input.done === false ? { completedAt: null, completedByMembershipId: null } : {}),
        },
      });
      await this.touch(tx, id);
      if (input.done !== undefined) {
        await this.audit.record(tx, {
          action: input.done ? 'matter.checklist_done' : 'matter.checklist_reopened',
          targetType: 'matter',
          targetId: id,
        });
      }
      return this.load(tx, id);
    });
  }

  async removeChecklistItem(id: string, itemId: string): Promise<MatterDetail> {
    const ctx = requireTenantContext();
    return this.prisma.tenantTx(async (tx) => {
      await this.requireEditable(tx, ctx, id);
      if (!(await tx.checklistItem.count({ where: { id: itemId, matterId: id } })))
        throw notFound('Checklist item');
      // Documents filed against this item stay on the matter.
      await tx.document.updateMany({
        where: { checklistItemId: itemId },
        data: { checklistItemId: null },
      });
      await tx.checklistItem.deleteMany({ where: { id: itemId, matterId: id } });
      await this.touch(tx, id);
      return this.load(tx, id);
    });
  }

  // ───────── helpers ─────────

  private async load(tx: Tx, id: string): Promise<MatterDetail> {
    const row = await tx.matter.findUnique({ where: { id }, select: detailSelect });
    if (!row) throw notFound(MATTER);
    return toDetail(row);
  }

  /** 404 unless the caller may update this matter; 409 if archived (unless allowed). */
  private async requireEditable(
    tx: Tx,
    ctx: TenantContext,
    id: string,
    opts: { allowArchived?: boolean } = {},
  ) {
    const scope = requireScope(P.MATTER_UPDATE, ctx);
    const current = await tx.matter.findFirst({
      where: { AND: [{ id }, matterScopeWhere(scope, ctx)] },
      select: { status: true, stageId: true, matterTypeId: true, closedAt: true },
    });
    if (!current) throw notFound(MATTER);
    if (current.status === 'ARCHIVED' && !opts.allowArchived) {
      throw new AppException(
        409,
        'MATTER_ARCHIVED',
        'Archived matters cannot be changed. Re-open it first.',
      );
    }
    return { scope, current };
  }

  /** Changing who works on a matter changes who can see it, so OWN scope cannot do it. */
  private requireStaffingScope(scope: PermissionScope) {
    if (scope === 'OWN') throw outOfScope('Ask a manager to change who is assigned.');
  }

  private async checkAssignee(
    tx: Tx,
    ctx: TenantContext,
    scope: PermissionScope,
    membershipId: string,
    field: string,
  ) {
    await requireActiveStaff(tx, membershipId, field);
    if (membershipId === ctx.membershipId) return;
    if (scope === 'OWN') throw outOfScope('You can only assign yourself.', field);
    if (scope === 'BRANCH') {
      const shares = await tx.membershipBranch.count({
        where: { membershipId, branchId: { in: ctx.branchIds } },
      });
      if (!shares) throw outOfScope('Choose someone from your branches.', field);
    }
  }

  /**
   * Stage 8 automation: create the stage's preset tasks on this matter. Each template creates at
   * most one task per matter (re-entering a stage does not duplicate it unless it was cancelled).
   */
  private async applyStageTasks(tx: Tx, ctx: TenantContext, matterId: string, stageId: string) {
    const templates = await tx.stageTaskTemplate.findMany({
      where: { stageId, isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        title: true,
        description: true,
        priority: true,
        dueInDays: true,
        assignToMatterLead: true,
      },
    });
    if (!templates.length) return;
    const existing = await tx.task.findMany({
      where: {
        matterId,
        templateId: { in: templates.map((t) => t.id) },
        status: { not: 'CANCELLED' },
      },
      select: { templateId: true },
    });
    const done = new Set(existing.map((t) => t.templateId));
    const lead = await tx.matterAssignment.findFirst({
      where: { matterId, unassignedAt: null, membership: { status: 'ACTIVE' } },
      orderBy: { assignedAt: 'asc' },
      select: { membershipId: true },
    });
    const now = Date.now();
    const rows = templates
      .filter((t) => !done.has(t.id))
      .map((t) => ({
        tenantId: ctx.tenantId,
        matterId,
        templateId: t.id,
        title: t.title,
        description: t.description,
        priority: t.priority,
        dueAt: t.dueInDays === null ? null : new Date(now + t.dueInDays * 86_400_000),
        assigneeMembershipId: t.assignToMatterLead ? (lead?.membershipId ?? null) : null,
        createdByMembershipId: ctx.membershipId,
      }));
    if (rows.length) await tx.task.createMany({ data: rows });
  }

  private async touch(tx: Tx, id: string) {
    await tx.matter.update({ where: { id }, data: { updatedAt: new Date() } });
  }
}
