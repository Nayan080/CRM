import { Injectable } from '@nestjs/common';
import type {
  DocumentsReport,
  LeadsReport,
  MatterStatus,
  MattersReport,
  ReportPeriod,
  ReportQuery,
  WorkloadReport,
} from '@crm/contracts';
import { PERMISSIONS } from '@crm/permissions';
import { requireScope } from '../../common/auth/scope.js';
import { type TenantContext, requireTenantContext } from '../../common/context/request-context.js';
import { AppException } from '../../common/errors/app-exception.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { leadScopeWhere, matterScopeWhere, taskScopeWhere } from '../crm/access.js';

const P = PERMISSIONS;
const DAY = 86_400_000;
const OPEN_STATUSES: MatterStatus[] = ['OPEN', 'ON_HOLD'];
/** Rows read into memory for medians / monthly series. Reports say so if this is reached. */
const ROW_CAP = 50_000;

/**
 * Period in UTC days: [from 00:00, to+1 00:00). Default: the last 90 days including today.
 * (Times are UTC; agency time zones are a known limitation of this first version.)
 */
export function resolvePeriod(
  q: ReportQuery,
  now = new Date(),
): { period: ReportPeriod; gte: Date; lt: Date } {
  const today = now.toISOString().slice(0, 10);
  const to = q.to ?? today;
  const from =
    q.from ?? new Date(Date.parse(`${to}T00:00:00Z`) - 89 * DAY).toISOString().slice(0, 10);
  const gte = new Date(`${from}T00:00:00Z`);
  const lt = new Date(Date.parse(`${to}T00:00:00Z`) + DAY);
  if (lt.getTime() - gte.getTime() > 731 * DAY) {
    throw new AppException(400, 'VALIDATION_FAILED', 'Choose a period of at most two years.', [
      { path: 'from', message: 'At most two years' },
    ]);
  }
  return { period: { from, to }, gte, lt };
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const m = s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
  return Math.round(m * 10) / 10;
}

const monthOf = (d: Date) => d.toISOString().slice(0, 7);

function monthsBetween(gte: Date, lt: Date): string[] {
  const out: string[] = [];
  const cur = new Date(Date.UTC(gte.getUTCFullYear(), gte.getUTCMonth(), 1));
  while (cur < lt) {
    out.push(monthOf(cur));
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return out;
}

const AGEING = [
  { label: '0–30 days', max: 30 },
  { label: '31–90 days', max: 90 },
  { label: '91–180 days', max: 180 },
  { label: 'Over 180 days', max: Infinity },
];

/** Reports never widen access: every count also applies the caller's scope for that data. */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async leads(q: ReportQuery): Promise<LeadsReport> {
    const ctx = requireTenantContext();
    const scope = requireScope(P.LEAD_READ, ctx);
    const { period, gte, lt } = resolvePeriod(q);
    const base = {
      AND: [
        { deletedAt: null },
        leadScopeWhere(scope, ctx),
        q.branchId ? { branchId: q.branchId } : {},
      ],
    };
    const created = { AND: [base, { createdAt: { gte, lt } }] };
    return this.prisma.tenantTx(async (tx) => {
      const byStatus = await tx.lead.groupBy({
        by: ['status'],
        where: created,
        _count: { _all: true },
      });
      const count = (s: string) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
      const total = byStatus.reduce((n, r) => n + r._count._all, 0);
      const convertedInPeriod = await tx.lead.findMany({
        where: { AND: [base, { status: 'CONVERTED', convertedAt: { gte, lt } }] },
        select: { createdAt: true, convertedAt: true },
        take: ROW_CAP,
      });

      const sourceAll = await tx.lead.groupBy({
        by: ['sourceId'],
        where: created,
        _count: { _all: true },
      });
      const sourceConv = await tx.lead.groupBy({
        by: ['sourceId'],
        where: { AND: [created, { status: 'CONVERTED' }] },
        _count: { _all: true },
      });
      const partnerAll = await tx.lead.groupBy({
        by: ['referredByPartnerId'],
        where: { AND: [created, { referredByPartnerId: { not: null } }] },
        _count: { _all: true },
      });
      const partnerConv = await tx.lead.groupBy({
        by: ['referredByPartnerId'],
        where: { AND: [created, { status: 'CONVERTED', referredByPartnerId: { not: null } }] },
        _count: { _all: true },
      });
      const sourceIds = sourceAll.map((r) => r.sourceId).filter((v): v is string => !!v);
      const partnerIds = partnerAll
        .map((r) => r.referredByPartnerId)
        .filter((v): v is string => !!v);
      const sources = await tx.referenceOption.findMany({
        where: { id: { in: sourceIds } },
        select: { id: true, name: true },
      });
      const partners = await tx.partnerOrganization.findMany({
        where: { id: { in: partnerIds } },
        select: { id: true, name: true },
      });

      const createdRows = await tx.lead.findMany({
        where: created,
        select: { createdAt: true },
        take: ROW_CAP,
      });
      const months = monthsBetween(gte, lt).map((month) => ({ month, created: 0, converted: 0 }));
      const byMonth = new Map(months.map((m) => [m.month, m]));
      for (const r of createdRows) {
        const m = byMonth.get(monthOf(r.createdAt));
        if (m) m.created += 1;
      }
      for (const r of convertedInPeriod) {
        const m = r.convertedAt ? byMonth.get(monthOf(r.convertedAt)) : undefined;
        if (m) m.converted += 1;
      }

      return {
        period,
        totals: {
          created: total,
          converted: count('CONVERTED'),
          lost: count('LOST'),
          open: count('OPEN'),
          conversionRate: total ? Math.round((count('CONVERTED') / total) * 1000) / 10 : null,
        },
        bySource: sourceAll
          .map((r) => ({
            source: r.sourceId ? (sources.find((s) => s.id === r.sourceId) ?? null) : null,
            created: r._count._all,
            converted: sourceConv.find((c) => c.sourceId === r.sourceId)?._count._all ?? 0,
          }))
          .sort((a, b) => b.created - a.created),
        byPartner: partnerAll
          .map((r) => ({
            partner: partners.find((p) => p.id === r.referredByPartnerId) ?? {
              id: r.referredByPartnerId ?? '',
              name: '',
            },
            created: r._count._all,
            converted:
              partnerConv.find((c) => c.referredByPartnerId === r.referredByPartnerId)?._count
                ._all ?? 0,
          }))
          .sort((a, b) => b.created - a.created),
        medianDaysToConvert: median(
          convertedInPeriod
            .filter((r) => r.convertedAt)
            .map((r) => (r.convertedAt!.getTime() - r.createdAt.getTime()) / DAY),
        ),
        byMonth: months,
      };
    });
  }

  async matters(q: ReportQuery): Promise<MattersReport> {
    const ctx = requireTenantContext();
    const scope = requireScope(P.MATTER_READ, ctx);
    const { period, gte, lt } = resolvePeriod(q);
    const base = {
      AND: [matterScopeWhere(scope, ctx), q.branchId ? { branchId: q.branchId } : {}],
    };
    const open = { AND: [base, { status: { in: OPEN_STATUSES } }] };
    const now = new Date();
    return this.prisma.tenantTx(async (tx) => {
      const status = await tx.matter.groupBy({
        by: ['status'],
        where: base,
        _count: { _all: true },
      });
      const byType = await tx.matter.groupBy({
        by: ['matterTypeId'],
        where: open,
        _count: { _all: true },
      });
      const byStage = await tx.matter.groupBy({
        by: ['matterTypeId', 'stageId'],
        where: open,
        _count: { _all: true },
      });
      const byBranch = await tx.matter.groupBy({
        by: ['branchId'],
        where: open,
        _count: { _all: true },
      });
      const types = await tx.matterType.findMany({ select: { id: true, name: true } });
      const stages = await tx.matterStage.findMany({ select: { id: true, name: true } });
      const branches = await tx.branch.findMany({ select: { id: true, name: true } });
      const named = (list: { id: string; name: string }[], id: string | null) =>
        id ? (list.find((x) => x.id === id) ?? { id, name: '' }) : null;

      const openRows = await tx.matter.findMany({
        where: open,
        select: { openedAt: true },
        take: ROW_CAP,
      });
      const ageing = AGEING.map((b) => ({ label: b.label, count: 0 }));
      for (const r of openRows) {
        const days = (now.getTime() - r.openedAt.getTime()) / DAY;
        const i = AGEING.findIndex((b) => days <= b.max);
        ageing[i]!.count += 1;
      }

      const overdueWhere = { completedAt: null, dueAt: { lt: now }, matter: open };
      const overdueCount = await tx.matterDeadline.count({ where: overdueWhere });
      const overdue = await tx.matterDeadline.findMany({
        where: overdueWhere,
        orderBy: { dueAt: 'asc' },
        take: 20,
        select: {
          title: true,
          dueAt: true,
          matter: { select: { id: true, reference: true, title: true } },
        },
      });

      const byStatus = { OPEN: 0, ON_HOLD: 0, CLOSED: 0, ARCHIVED: 0 } as Record<
        MatterStatus,
        number
      >;
      for (const r of status) byStatus[r.status] = r._count._all;

      return {
        period,
        byStatus,
        openByType: byType
          .map((r) => ({ type: named(types, r.matterTypeId)!, count: r._count._all }))
          .sort((a, b) => b.count - a.count),
        openByStage: byStage
          .map((r) => ({
            type: named(types, r.matterTypeId)!,
            stage: named(stages, r.stageId),
            count: r._count._all,
          }))
          .sort((a, b) => a.type.name.localeCompare(b.type.name) || b.count - a.count),
        openByBranch: byBranch
          .map((r) => ({ branch: named(branches, r.branchId), count: r._count._all }))
          .sort((a, b) => b.count - a.count),
        ageing,
        openedInPeriod: await tx.matter.count({
          where: { AND: [base, { openedAt: { gte, lt } }] },
        }),
        closedInPeriod: await tx.matter.count({
          where: { AND: [base, { closedAt: { gte, lt } }] },
        }),
        overdueDeadlines: {
          count: overdueCount,
          items: overdue.map((d) => ({
            matterId: d.matter.id,
            reference: d.matter.reference,
            title: d.matter.title,
            deadline: d.title,
            dueAt: d.dueAt.toISOString(),
          })),
        },
      };
    });
  }

  /** Per staff member the caller can see: open matters, open/overdue tasks, deadlines in 14 days. */
  async workload(): Promise<WorkloadReport> {
    const ctx = requireTenantContext();
    const memberScope = requireScope(P.MEMBER_READ, ctx);
    const matterScope = requireScope(P.MATTER_READ, ctx);
    const taskScope = requireScope(P.TASK_READ, ctx);
    const now = new Date();
    return this.prisma.tenantTx(async (tx) => {
      const members = await tx.membership.findMany({
        where: {
          kind: 'STAFF',
          status: 'ACTIVE',
          ...this.memberVisibility(memberScope, ctx),
        },
        select: { id: true, user: { select: { name: true } } },
        orderBy: { joinedAt: 'asc' },
      });
      const ids = members.map((m) => m.id);
      const openMatter = {
        AND: [matterScopeWhere(matterScope, ctx), { status: { in: OPEN_STATUSES } }],
      };
      const matters = await tx.matterAssignment.groupBy({
        by: ['membershipId'],
        where: { membershipId: { in: ids }, unassignedAt: null, matter: openMatter },
        _count: { _all: true },
      });
      const activeTask = {
        AND: [
          taskScopeWhere(taskScope, ctx),
          { status: { in: ['OPEN' as const, 'IN_PROGRESS' as const] } },
        ],
      };
      const tasks = await tx.task.groupBy({
        by: ['assigneeMembershipId'],
        where: { AND: [activeTask, { assigneeMembershipId: { in: ids } }] },
        _count: { _all: true },
      });
      const overdue = await tx.task.groupBy({
        by: ['assigneeMembershipId'],
        where: { AND: [activeTask, { assigneeMembershipId: { in: ids }, dueAt: { lt: now } }] },
        _count: { _all: true },
      });
      const soon = await tx.matterDeadline.findMany({
        where: {
          completedAt: null,
          dueAt: { gte: now, lt: new Date(now.getTime() + 14 * DAY) },
          matter: openMatter,
        },
        select: {
          matter: {
            select: {
              assignments: { where: { unassignedAt: null }, select: { membershipId: true } },
            },
          },
        },
        take: ROW_CAP,
      });
      const deadlineCount = new Map<string, number>();
      for (const d of soon) {
        for (const a of d.matter.assignments)
          deadlineCount.set(a.membershipId, (deadlineCount.get(a.membershipId) ?? 0) + 1);
      }
      return {
        rows: members.map((m) => ({
          member: { id: m.id, name: m.user.name },
          openMatters: matters.find((r) => r.membershipId === m.id)?._count._all ?? 0,
          openTasks: tasks.find((r) => r.assigneeMembershipId === m.id)?._count._all ?? 0,
          overdueTasks: overdue.find((r) => r.assigneeMembershipId === m.id)?._count._all ?? 0,
          deadlinesNext14Days: deadlineCount.get(m.id) ?? 0,
        })),
      };
    });
  }

  /** From the audit log, so it needs audit access (Owner/Admin by default). */
  async documents(q: ReportQuery): Promise<DocumentsReport> {
    const ctx = requireTenantContext();
    requireScope(P.AUDIT_READ, ctx);
    requireScope(P.DOCUMENT_READ, ctx);
    const { period, gte, lt } = resolvePeriod(q);
    const now = new Date();
    return this.prisma.tenantTx(async (tx) => {
      const downloadsWhere = { action: 'document.downloaded', createdAt: { gte, lt } };
      const top = await tx.auditLog.groupBy({
        by: ['targetId'],
        where: downloadsWhere,
        _count: { _all: true },
        orderBy: { _count: { targetId: 'desc' } },
        take: 10,
      });
      const docIds = top.map((t) => t.targetId).filter((v): v is string => !!v);
      const docs = await tx.document.findMany({
        where: { id: { in: docIds } },
        select: { id: true, title: true },
      });
      return {
        period,
        uploads: await tx.documentVersion.count({ where: { createdAt: { gte, lt } } }),
        downloads: await tx.auditLog.count({ where: downloadsWhere }),
        downloadsViaShare: await tx.auditLog.count({
          where: { ...downloadsWhere, metadata: { path: ['via'], equals: 'share' } },
        }),
        activeShares: await tx.resourceShare.count({
          where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        }),
        sharesCreated: await tx.resourceShare.count({ where: { createdAt: { gte, lt } } }),
        sharesRevoked: await tx.resourceShare.count({ where: { revokedAt: { gte, lt } } }),
        topDownloaded: top.flatMap((t) => {
          const d = docs.find((x) => x.id === t.targetId);
          return d ? [{ document: d, downloads: t._count._all }] : [];
        }),
      };
    });
  }

  private memberVisibility(scope: ReturnType<typeof requireScope>, ctx: TenantContext) {
    if (scope === 'TENANT') return {};
    if (scope === 'OWN') return { id: ctx.membershipId };
    return {
      OR: [{ id: ctx.membershipId }, { branches: { some: { branchId: { in: ctx.branchIds } } } }],
    };
  }
}
