import { Injectable } from '@nestjs/common';
import type {
  CreateTaskInput,
  Paginated,
  TaskListQuery,
  TaskResponse,
  UpdateTaskInput,
} from '@crm/contracts';
import { PERMISSIONS, type PermissionScope } from '@crm/permissions';
import { requireScope, scopeOf } from '../../common/auth/scope.js';
import { type TenantContext, requireTenantContext } from '../../common/context/request-context.js';
import { AppException } from '../../common/errors/app-exception.js';
import { contains, pageArgs, toPage } from '../../common/pagination/pagination.js';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import {
  clientScopeWhere,
  invalidRef,
  leadScopeWhere,
  matterScopeWhere,
  memberRef,
  memberRefSelect,
  notFound,
  requireActiveStaff,
  taskScopeWhere,
} from '../crm/access.js';

const P = PERMISSIONS;
const TASK = 'Task';

const taskSelect = {
  id: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  dueAt: true,
  completedAt: true,
  createdAt: true,
  matterId: true,
  clientId: true,
  leadId: true,
  assignee: memberRefSelect,
  createdBy: memberRefSelect,
  matter: { select: { reference: true, title: true } },
  client: { select: { clientNumber: true, displayName: true } },
  lead: { select: { fullName: true } },
} as const;

type Member = { id: string; user: { name: string } };
type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: TaskResponse['status'];
  priority: TaskResponse['priority'];
  dueAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  matterId: string | null;
  clientId: string | null;
  leadId: string | null;
  assignee: Member | null;
  createdBy: Member;
  matter: { reference: string; title: string } | null;
  client: { clientNumber: string; displayName: string } | null;
  lead: { fullName: string } | null;
};

/** Ids of linked records the caller may read (a task can point at a record they cannot see). */
interface Visible {
  matters: Set<string>;
  clients: Set<string>;
  leads: Set<string>;
}

async function visibleLinks(tx: Tx, ctx: TenantContext, rows: TaskRow[]): Promise<Visible> {
  const ids = (key: 'matterId' | 'clientId' | 'leadId') => [
    ...new Set(rows.map((r) => r[key]).filter((v): v is string => !!v)),
  ];
  const pick = async <T extends { id: string }>(
    list: string[],
    run: (ids: string[]) => Promise<T[]>,
  ) => new Set(list.length ? (await run(list)).map((r) => r.id) : []);
  const ms = scopeOf(P.MATTER_READ, ctx);
  const cs = scopeOf(P.CLIENT_READ, ctx);
  const ls = scopeOf(P.LEAD_READ, ctx);
  return {
    matters: ms
      ? await pick(ids('matterId'), (in_) =>
          tx.matter.findMany({
            where: { AND: [{ id: { in: in_ } }, matterScopeWhere(ms, ctx)] },
            select: { id: true },
          }),
        )
      : new Set(),
    clients: cs
      ? await pick(ids('clientId'), (in_) =>
          tx.client.findMany({
            where: { AND: [{ id: { in: in_ } }, clientScopeWhere(cs, ctx)] },
            select: { id: true },
          }),
        )
      : new Set(),
    leads: ls
      ? await pick(ids('leadId'), (in_) =>
          tx.lead.findMany({
            where: { AND: [{ id: { in: in_ } }, leadScopeWhere(ls, ctx)] },
            select: { id: true },
          }),
        )
      : new Set(),
  };
}

function toTask(row: TaskRow, visible: Visible): TaskResponse {
  let link: TaskResponse['link'] = null;
  if (row.matterId) {
    link =
      visible.matters.has(row.matterId) && row.matter
        ? {
            kind: 'matter',
            id: row.matterId,
            label: `${row.matter.reference} · ${row.matter.title}`,
          }
        : { kind: 'matter', hidden: true };
  } else if (row.clientId) {
    link =
      visible.clients.has(row.clientId) && row.client
        ? {
            kind: 'client',
            id: row.clientId,
            label: `${row.client.displayName} (${row.client.clientNumber})`,
          }
        : { kind: 'client', hidden: true };
  } else if (row.leadId) {
    link =
      visible.leads.has(row.leadId) && row.lead
        ? { kind: 'lead', id: row.leadId, label: row.lead.fullName }
        : { kind: 'lead', hidden: true };
  }
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueAt: row.dueAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    assignee: memberRef(row.assignee),
    createdBy: memberRef(row.createdBy) ?? { id: row.createdBy.id, name: '' },
    link,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: TaskListQuery): Promise<Paginated<TaskResponse>> {
    const ctx = requireTenantContext();
    const scope = requireScope(P.TASK_READ, ctx);
    return this.prisma.tenantTx(async (tx) => {
      if (query.matterId) await this.requireMatter(tx, ctx, query.matterId, 'read');
      const rows = await tx.task.findMany({
        where: {
          AND: [
            taskScopeWhere(scope, ctx),
            query.status ? { status: query.status } : {},
            query.active ? { status: { in: ['OPEN', 'IN_PROGRESS'] } } : {},
            query.mine ? { assigneeMembershipId: ctx.membershipId } : {},
            query.matterId ? { matterId: query.matterId } : {},
            query.q ? { title: contains(query.q) } : {},
          ],
        },
        select: taskSelect,
        ...pageArgs(query),
      });
      const visible = await visibleLinks(tx, ctx, rows);
      return toPage(rows, query.limit, (r) => toTask(r, visible));
    });
  }

  async create(input: CreateTaskInput): Promise<TaskResponse> {
    const ctx = requireTenantContext();
    const scope = requireScope(P.TASK_MANAGE, ctx);
    const assignee =
      input.assigneeMembershipId === undefined ? ctx.membershipId : input.assigneeMembershipId;
    return this.prisma.tenantTx(async (tx) => {
      if (assignee) await this.checkAssignee(tx, ctx, scope, assignee);
      if (input.matterId) await this.requireMatter(tx, ctx, input.matterId, 'link');
      if (input.clientId) await this.requireClient(tx, ctx, input.clientId);
      if (input.leadId) await this.requireLead(tx, ctx, input.leadId);
      const row = await tx.task.create({
        data: {
          tenantId: ctx.tenantId,
          title: input.title,
          description: input.description ?? null,
          priority: input.priority,
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          assigneeMembershipId: assignee ?? null,
          matterId: input.matterId ?? null,
          clientId: input.clientId ?? null,
          leadId: input.leadId ?? null,
          createdByMembershipId: ctx.membershipId,
        },
        select: taskSelect,
      });
      await this.audit.record(tx, { action: 'task.created', targetType: 'task', targetId: row.id });
      return toTask(row, await visibleLinks(tx, ctx, [row]));
    });
  }

  async update(id: string, input: UpdateTaskInput): Promise<TaskResponse> {
    const ctx = requireTenantContext();
    const scope = requireScope(P.TASK_MANAGE, ctx);
    return this.prisma.tenantTx(async (tx) => {
      const current = await tx.task.findFirst({
        where: { AND: [{ id }, taskScopeWhere(scope, ctx)] },
        select: { status: true, completedAt: true },
      });
      if (!current) throw notFound(TASK);
      if (input.assigneeMembershipId)
        await this.checkAssignee(tx, ctx, scope, input.assigneeMembershipId);
      const done = input.status === 'DONE';
      const row = await tx.task.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.dueAt !== undefined
            ? { dueAt: input.dueAt ? new Date(input.dueAt) : null }
            : {}),
          ...(input.assigneeMembershipId !== undefined
            ? { assigneeMembershipId: input.assigneeMembershipId }
            : {}),
          ...(input.status !== undefined
            ? {
                status: input.status,
                completedAt: done ? (current.completedAt ?? new Date()) : null,
              }
            : {}),
        },
        select: taskSelect,
      });
      await this.audit.record(tx, {
        action: 'task.updated',
        targetType: 'task',
        targetId: id,
        metadata: { fields: Object.keys(input).sort().join(',') },
      });
      return toTask(row, await visibleLinks(tx, ctx, [row]));
    });
  }

  async remove(id: string): Promise<void> {
    const ctx = requireTenantContext();
    const scope = requireScope(P.TASK_MANAGE, ctx);
    await this.prisma.tenantTx(async (tx) => {
      const found = await tx.task.count({ where: { AND: [{ id }, taskScopeWhere(scope, ctx)] } });
      if (!found) throw notFound(TASK);
      await tx.task.deleteMany({ where: { id } });
      await this.audit.record(tx, { action: 'task.deleted', targetType: 'task', targetId: id });
    });
  }

  // ───────── helpers ─────────

  private async checkAssignee(
    tx: Tx,
    ctx: TenantContext,
    scope: PermissionScope,
    membershipId: string,
  ) {
    await requireActiveStaff(tx, membershipId, 'assigneeMembershipId');
    if (membershipId === ctx.membershipId) return;
    if (scope === 'OWN') {
      throw new AppException(403, 'OUT_OF_SCOPE', 'You can only assign tasks to yourself.', [
        { path: 'assigneeMembershipId', message: 'You can only assign tasks to yourself' },
      ]);
    }
    if (scope === 'BRANCH') {
      const shares = await tx.membershipBranch.count({
        where: { membershipId, branchId: { in: ctx.branchIds } },
      });
      if (!shares) {
        throw new AppException(403, 'OUT_OF_SCOPE', 'Choose someone from your branches.', [
          { path: 'assigneeMembershipId', message: 'Choose someone from your branches' },
        ]);
      }
    }
  }

  /** 'read' → 404 when not visible (list filter); 'link' → 400 invalid reference. */
  private async requireMatter(tx: Tx, ctx: TenantContext, matterId: string, mode: 'read' | 'link') {
    const scope = scopeOf(P.MATTER_READ, ctx);
    const found = scope
      ? await tx.matter.count({ where: { AND: [{ id: matterId }, matterScopeWhere(scope, ctx)] } })
      : 0;
    if (!found)
      throw mode === 'read'
        ? notFound('Matter')
        : invalidRef('matterId', 'Choose a matter you can see');
  }

  private async requireClient(tx: Tx, ctx: TenantContext, clientId: string) {
    const scope = scopeOf(P.CLIENT_READ, ctx);
    const found = scope
      ? await tx.client.count({
          where: { AND: [{ id: clientId, deletedAt: null }, clientScopeWhere(scope, ctx)] },
        })
      : 0;
    if (!found) throw invalidRef('clientId', 'Choose a client you can see');
  }

  private async requireLead(tx: Tx, ctx: TenantContext, leadId: string) {
    const scope = scopeOf(P.LEAD_READ, ctx);
    const found = scope
      ? await tx.lead.count({
          where: { AND: [{ id: leadId, deletedAt: null }, leadScopeWhere(scope, ctx)] },
        })
      : 0;
    if (!found) throw invalidRef('leadId', 'Choose a lead you can see');
  }
}
