import { Injectable } from '@nestjs/common';
import type {
  ActivityListQuery,
  ActivityResponse,
  AppointmentListQuery,
  AppointmentResponse,
  CreateActivityInput,
  CreateAppointmentInput,
  Paginated,
  UpdateAppointmentInput,
} from '@crm/contracts';
import { PERMISSIONS, type PermissionScope } from '@crm/permissions';
import { requireScope } from '../../common/auth/scope.js';
import { type TenantContext, requireTenantContext } from '../../common/context/request-context.js';
import { AppException } from '../../common/errors/app-exception.js';
import { pageArgs, toPage } from '../../common/pagination/pagination.js';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import {
  appointmentScopeWhere,
  clientScopeWhere,
  invalidRef,
  leadScopeWhere,
  matterScopeWhere,
  memberRef,
  memberRefSelect,
  notFound,
  requireActiveStaff,
} from './access.js';

type Subject = { leadId?: string; clientId?: string; matterId?: string };

/** Throws 404 unless the caller may (read|update) the lead/client/matter the timeline belongs to. */
async function requireSubject(
  tx: Tx,
  ctx: TenantContext,
  subject: Subject,
  action: 'read' | 'update',
) {
  if (subject.leadId) {
    const scope = requireScope(
      action === 'read' ? PERMISSIONS.LEAD_READ : PERMISSIONS.LEAD_UPDATE,
      ctx,
    );
    const found = await tx.lead.count({
      where: { AND: [{ id: subject.leadId, deletedAt: null }, leadScopeWhere(scope, ctx)] },
    });
    if (!found) throw notFound('Lead');
    return;
  }
  if (subject.matterId) {
    const scope = requireScope(
      action === 'read' ? PERMISSIONS.MATTER_READ : PERMISSIONS.MATTER_UPDATE,
      ctx,
    );
    const found = await tx.matter.count({
      where: { AND: [{ id: subject.matterId }, matterScopeWhere(scope, ctx)] },
    });
    if (!found) throw notFound('Matter');
    return;
  }
  const scope = requireScope(
    action === 'read' ? PERMISSIONS.CLIENT_READ : PERMISSIONS.CLIENT_UPDATE,
    ctx,
  );
  const found = await tx.client.count({
    where: { AND: [{ id: subject.clientId, deletedAt: null }, clientScopeWhere(scope, ctx)] },
  });
  if (!found) throw notFound('Client');
}

const activitySelect = {
  id: true,
  type: true,
  summary: true,
  body: true,
  occurredAt: true,
  actor: memberRefSelect,
} as const;

const appointmentSelect = {
  id: true,
  title: true,
  startsAt: true,
  endsAt: true,
  location: true,
  notes: true,
  isConsultation: true,
  cancelledAt: true,
  host: memberRefSelect,
  lead: { select: { id: true, fullName: true } },
  client: { select: { id: true, displayName: true, clientNumber: true } },
  matter: { select: { id: true, reference: true, title: true } },
} as const;

type AppointmentRow = Omit<AppointmentResponse, 'host' | 'startsAt' | 'endsAt' | 'cancelledAt'> & {
  host: { id: string; user: { name: string } };
  startsAt: Date;
  endsAt: Date;
  cancelledAt: Date | null;
};

function toAppointment(row: AppointmentRow): AppointmentResponse {
  return {
    ...row,
    host: memberRef(row.host) ?? { id: row.host.id, name: '' },
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
  };
}

@Injectable()
export class TimelineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───────── Activities ─────────

  async listActivities(query: ActivityListQuery): Promise<Paginated<ActivityResponse>> {
    const ctx = requireTenantContext();
    const rows = await this.prisma.tenantTx(async (tx) => {
      await requireSubject(tx, ctx, query, 'read');
      return tx.activity.findMany({
        where: query.leadId
          ? { leadId: query.leadId }
          : query.matterId
            ? { matterId: query.matterId }
            : { clientId: query.clientId },
        select: activitySelect,
        ...pageArgs(query),
      });
    });
    return toPage(rows, query.limit, (r) => ({
      ...r,
      occurredAt: r.occurredAt.toISOString(),
      actor: memberRef(r.actor) ?? { id: '', name: '' },
    }));
  }

  async createActivity(input: CreateActivityInput): Promise<ActivityResponse> {
    const ctx = requireTenantContext();
    return this.prisma.tenantTx(async (tx) => {
      await requireSubject(tx, ctx, input, 'update');
      const row = await tx.activity.create({
        data: {
          tenantId: ctx.tenantId,
          leadId: input.leadId ?? null,
          clientId: input.clientId ?? null,
          matterId: input.matterId ?? null,
          type: input.type,
          summary: input.summary,
          body: input.body ?? null,
          occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
          actorMembershipId: ctx.membershipId,
        },
        select: activitySelect,
      });
      return {
        ...row,
        occurredAt: row.occurredAt.toISOString(),
        actor: memberRef(row.actor) ?? { id: '', name: '' },
      };
    });
  }

  // ───────── Appointments / consultations ─────────

  async listAppointments(query: AppointmentListQuery): Promise<AppointmentResponse[]> {
    const ctx = requireTenantContext();
    const scope = requireScope(PERMISSIONS.APPOINTMENT_READ, ctx);
    const from = query.from ? new Date(query.from) : new Date(Date.now() - 12 * 60 * 60 * 1000);
    const rows = await this.prisma.tenantTx(async (tx) => {
      if (query.leadId) await requireSubject(tx, ctx, { leadId: query.leadId }, 'read');
      if (query.clientId) await requireSubject(tx, ctx, { clientId: query.clientId }, 'read');
      if (query.matterId) await requireSubject(tx, ctx, { matterId: query.matterId }, 'read');
      return tx.appointment.findMany({
        where: {
          AND: [
            appointmentScopeWhere(scope, ctx),
            query.leadId || query.clientId || query.matterId
              ? {}
              : { startsAt: { gte: from, ...(query.to ? { lt: new Date(query.to) } : {}) } },
            query.mine ? { hostMembershipId: ctx.membershipId } : {},
            query.leadId ? { leadId: query.leadId } : {},
            query.clientId ? { clientId: query.clientId } : {},
            query.matterId ? { matterId: query.matterId } : {},
            query.includeCancelled ? {} : { cancelledAt: null },
          ],
        },
        orderBy: { startsAt: 'asc' },
        take: 200,
        select: appointmentSelect,
      });
    });
    return rows.map(toAppointment);
  }

  async createAppointment(input: CreateAppointmentInput): Promise<AppointmentResponse> {
    const ctx = requireTenantContext();
    const scope = requireScope(PERMISSIONS.APPOINTMENT_MANAGE, ctx);
    const hostId = input.hostMembershipId ?? ctx.membershipId;
    return this.prisma.tenantTx(async (tx) => {
      await this.validate(tx, ctx, scope, { ...input, hostMembershipId: hostId });
      const row = await tx.appointment.create({
        data: {
          tenantId: ctx.tenantId,
          title: input.title,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          location: input.location ?? null,
          notes: input.notes ?? null,
          isConsultation: input.isConsultation,
          hostMembershipId: hostId,
          leadId: input.leadId ?? null,
          clientId: input.clientId ?? null,
          matterId: input.matterId ?? null,
          createdByMembershipId: ctx.membershipId,
        },
        select: appointmentSelect,
      });
      await this.audit.record(tx, {
        action: 'appointment.created',
        targetType: 'appointment',
        targetId: row.id,
      });
      return toAppointment(row);
    });
  }

  async updateAppointment(id: string, input: UpdateAppointmentInput): Promise<AppointmentResponse> {
    const ctx = requireTenantContext();
    const scope = requireScope(PERMISSIONS.APPOINTMENT_MANAGE, ctx);
    return this.prisma.tenantTx(async (tx) => {
      const current = await tx.appointment.findFirst({
        where: { AND: [{ id }, appointmentScopeWhere(scope, ctx)] },
        select: { startsAt: true, endsAt: true, cancelledAt: true },
      });
      if (!current) throw notFound('Appointment');
      if (current.cancelledAt)
        throw new AppException(
          409,
          'APPOINTMENT_CANCELLED',
          'Cancelled appointments cannot be changed.',
        );
      const startsAt = input.startsAt ? new Date(input.startsAt) : current.startsAt;
      const endsAt = input.endsAt ? new Date(input.endsAt) : current.endsAt;
      if (endsAt <= startsAt) {
        throw new AppException(400, 'VALIDATION_FAILED', 'The end must be after the start.', [
          { path: 'endsAt', message: 'Must be after the start' },
        ]);
      }
      await this.validate(tx, ctx, scope, input);
      const row = await tx.appointment.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          startsAt,
          endsAt,
          ...(input.location !== undefined ? { location: input.location } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.isConsultation !== undefined ? { isConsultation: input.isConsultation } : {}),
          ...(input.hostMembershipId !== undefined
            ? { hostMembershipId: input.hostMembershipId }
            : {}),
          ...(input.leadId !== undefined ? { leadId: input.leadId } : {}),
          ...(input.clientId !== undefined ? { clientId: input.clientId } : {}),
          ...(input.matterId !== undefined ? { matterId: input.matterId } : {}),
        },
        select: appointmentSelect,
      });
      await this.audit.record(tx, {
        action: 'appointment.updated',
        targetType: 'appointment',
        targetId: id,
      });
      return toAppointment(row);
    });
  }

  async cancelAppointment(id: string): Promise<AppointmentResponse> {
    const ctx = requireTenantContext();
    const scope = requireScope(PERMISSIONS.APPOINTMENT_MANAGE, ctx);
    return this.prisma.tenantTx(async (tx) => {
      const found = await tx.appointment.count({
        where: { AND: [{ id }, appointmentScopeWhere(scope, ctx)] },
      });
      if (!found) throw notFound('Appointment');
      await tx.appointment.updateMany({
        where: { id, cancelledAt: null },
        data: { cancelledAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'appointment.cancelled',
        targetType: 'appointment',
        targetId: id,
      });
      return toAppointment(
        await tx.appointment.findUniqueOrThrow({ where: { id }, select: appointmentSelect }),
      );
    });
  }

  /** Host must be an active team member within the caller's scope; links must be visible records. */
  private async validate(
    tx: Tx,
    ctx: TenantContext,
    scope: PermissionScope,
    v: {
      hostMembershipId?: string;
      leadId?: string | null;
      clientId?: string | null;
      matterId?: string | null;
    },
  ): Promise<void> {
    if (v.hostMembershipId) {
      await requireActiveStaff(tx, v.hostMembershipId, 'hostMembershipId');
      if (scope === 'OWN' && v.hostMembershipId !== ctx.membershipId) {
        throw new AppException(403, 'OUT_OF_SCOPE', 'You can only book appointments you host.');
      }
      if (scope === 'BRANCH' && v.hostMembershipId !== ctx.membershipId) {
        const shares = await tx.membershipBranch.count({
          where: { membershipId: v.hostMembershipId, branchId: { in: ctx.branchIds } },
        });
        if (!shares)
          throw new AppException(403, 'OUT_OF_SCOPE', 'Choose a host from your branches.');
      }
    }
    for (const field of ['leadId', 'clientId', 'matterId'] as const) {
      const id = v[field];
      if (!id) continue;
      try {
        await requireSubject(tx, ctx, { [field]: id }, 'read');
      } catch (error) {
        if (error instanceof AppException && error.getStatus() === 404) {
          throw invalidRef(field, 'Choose a lead, client or matter you can see');
        }
        throw error;
      }
    }
  }
}
