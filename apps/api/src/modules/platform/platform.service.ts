import { Injectable } from '@nestjs/common';
import type {
  CreatePlanInput,
  Paginated,
  PlanResponse,
  PlatformTenantListQuery,
  PlatformTenantSummary,
  UpdatePlanInput,
  UpdatePlatformTenantInput,
} from '@crm/contracts';
import { requireUserId } from '../../common/context/request-context.js';
import { AppException } from '../../common/errors/app-exception.js';
import { contains, pageArgs, toPage } from '../../common/pagination/pagination.js';
import { PrismaService, isUniqueViolation } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';

const tenantSelect = {
  id: true,
  slug: true,
  name: true,
  status: true,
  statusReason: true,
  statusChangedAt: true,
  createdAt: true,
  plan: { select: { id: true, name: true, maxStaffUsers: true } },
} as const;

type TenantRow = {
  id: string;
  slug: string;
  name: string;
  status: PlatformTenantSummary['status'];
  statusReason: string | null;
  statusChangedAt: Date | null;
  createdAt: Date;
  plan: PlatformTenantSummary['plan'];
};

const notFound = () => new AppException(404, 'NOT_FOUND', 'Workspace not found.');

/**
 * Platform administration. Reads only agency metadata and member counts (never clients, matters,
 * documents or audit details). Counts are read per agency inside that agency's RLS context.
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listTenants(query: PlatformTenantListQuery): Promise<Paginated<PlatformTenantSummary>> {
    const rows = await this.prisma.systemTx({}, (tx) =>
      tx.tenant.findMany({
        where: {
          ...(query.status ? { status: query.status } : {}),
          ...(query.q ? { OR: [{ name: contains(query.q) }, { slug: contains(query.q) }] } : {}),
        },
        select: tenantSelect,
        ...pageArgs(query),
      }),
    );
    const page = toPage(rows, query.limit, (r) => r);
    return { ...page, data: await Promise.all(page.data.map((r) => this.withUsage(r))) };
  }

  async getTenant(id: string): Promise<PlatformTenantSummary> {
    const row = await this.prisma.systemTx({}, (tx) =>
      tx.tenant.findUnique({ where: { id }, select: tenantSelect }),
    );
    if (!row) throw notFound();
    return this.withUsage(row);
  }

  /** Suspend, re-activate, mark for offboarding, or change the plan. Recorded in the agency's audit log. */
  async updateTenant(id: string, input: UpdatePlatformTenantInput): Promise<PlatformTenantSummary> {
    const actorUserId = requireUserId();
    await this.prisma.systemTx({ tenantId: id }, async (tx) => {
      const current = await tx.tenant.findUnique({ where: { id }, select: { status: true } });
      if (!current) throw notFound();
      if (input.planId) {
        const plan = await tx.plan.count({ where: { id: input.planId, isActive: true } });
        if (!plan) {
          throw new AppException(400, 'INVALID_REFERENCE', 'Choose an active plan.', [
            { path: 'planId', message: 'Choose an active plan' },
          ]);
        }
      }
      const statusChanged = input.status !== undefined && input.status !== current.status;
      await tx.tenant.update({
        where: { id },
        data: {
          ...(input.planId !== undefined ? { planId: input.planId } : {}),
          ...(statusChanged
            ? {
                status: input.status,
                statusReason: input.reason ?? null,
                statusChangedAt: new Date(),
              }
            : {}),
        },
      });
      if (statusChanged) {
        // Signing everyone out of a suspended agency is not needed: every request re-checks status.
        await this.audit.record(tx, {
          action: 'platform.tenant_status_changed',
          tenantId: id,
          actorUserId,
          targetType: 'tenant',
          targetId: id,
          metadata: { from: current.status, to: input.status ?? '', reason: input.reason ?? '' },
        });
      }
      if (input.planId !== undefined) {
        await this.audit.record(tx, {
          action: 'platform.tenant_plan_changed',
          tenantId: id,
          actorUserId,
          targetType: 'tenant',
          targetId: id,
          metadata: { planId: input.planId ?? 'none' },
        });
      }
    });
    return this.getTenant(id);
  }

  // ───────── Plans ─────────

  async listPlans(): Promise<PlanResponse[]> {
    const rows = await this.prisma.systemTx({}, (tx) =>
      tx.plan.findMany({
        orderBy: { name: 'asc' },
        select: {
          id: true,
          key: true,
          name: true,
          maxStaffUsers: true,
          isActive: true,
          _count: { select: { tenants: true } },
        },
      }),
    );
    return rows.map(({ _count, ...p }) => ({ ...p, tenantCount: _count.tenants }));
  }

  async createPlan(input: CreatePlanInput): Promise<PlanResponse> {
    const actorUserId = requireUserId();
    try {
      const plan = await this.prisma.systemTx({}, async (tx) => {
        const p = await tx.plan.create({ data: input, select: { id: true } });
        await this.audit.record(tx, {
          action: 'platform.plan_created',
          tenantId: null,
          actorUserId,
          targetType: 'plan',
          targetId: p.id,
        });
        return p;
      });
      return (await this.listPlans()).find((p) => p.id === plan.id)!;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppException(409, 'PLAN_EXISTS', 'A plan with that key already exists.', [
          { path: 'key', message: 'Already used' },
        ]);
      }
      throw error;
    }
  }

  async updatePlan(id: string, input: UpdatePlanInput): Promise<PlanResponse> {
    const actorUserId = requireUserId();
    await this.prisma.systemTx({}, async (tx) => {
      if (!(await tx.plan.count({ where: { id } })))
        throw new AppException(404, 'NOT_FOUND', 'Plan not found.');
      await tx.plan.update({ where: { id }, data: input });
      await this.audit.record(tx, {
        action: 'platform.plan_updated',
        tenantId: null,
        actorUserId,
        targetType: 'plan',
        targetId: id,
        metadata: { fields: Object.keys(input).sort().join(',') },
      });
    });
    return (await this.listPlans()).find((p) => p.id === id)!;
  }

  // ───────── helpers ─────────

  private async withUsage(row: TenantRow): Promise<PlatformTenantSummary> {
    const usage = await this.prisma.systemTx({ tenantId: row.id }, async (tx) => ({
      staffUsers: await tx.membership.count({
        where: { tenantId: row.id, kind: 'STAFF', status: 'ACTIVE' },
      }),
      externalUsers: await tx.membership.count({
        where: { tenantId: row.id, kind: 'EXTERNAL', status: 'ACTIVE' },
      }),
      pendingStaffInvites: await tx.invitation.count({
        where: {
          tenantId: row.id,
          kind: 'STAFF',
          status: 'PENDING',
          expiresAt: { gt: new Date() },
        },
      }),
    }));
    return {
      ...row,
      statusChangedAt: row.statusChangedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      usage,
    };
  }
}
