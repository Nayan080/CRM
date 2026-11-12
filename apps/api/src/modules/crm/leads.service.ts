import { Injectable } from '@nestjs/common';
import type {
  ConvertLeadInput,
  ConvertLeadResponse,
  CreateLeadInput,
  LeadDetail,
  LeadListQuery,
  LeadSummary,
  Paginated,
  UpdateLeadInput,
} from '@crm/contracts';
import { PERMISSIONS } from '@crm/permissions';
import { assertBranchInScope, requireScope } from '../../common/auth/scope.js';
import { type TenantContext, requireTenantContext } from '../../common/context/request-context.js';
import { phoneDigits } from '../../common/data/phone.js';
import { AppException } from '../../common/errors/app-exception.js';
import { contains, pageArgs, toPage } from '../../common/pagination/pagination.js';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { requireReferenceOption } from '../reference/reference.service.js';
import {
  clientScopeWhere,
  leadScopeWhere,
  memberRef,
  memberRefSelect,
  notFound,
  requireActiveBranch,
  requireActiveStaff,
  requirePartner,
  requirePartnerContact,
} from './access.js';
import { ClientsService, clientSummarySelect, toClientSummary } from './clients.service.js';

const named = { select: { id: true, name: true } } as const;

const summarySelect = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  status: true,
  createdAt: true,
  source: named,
  referredBy: named,
  owner: memberRefSelect,
  branch: named,
} as const;

const detailSelect = {
  ...summarySelect,
  interest: true,
  notes: true,
  lostReason: true,
  convertedAt: true,
  referredContact: { select: { id: true, fullName: true } },
  convertedClient: { select: { id: true, clientNumber: true, displayName: true } },
} as const;

type SummaryRow = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  status: LeadSummary['status'];
  createdAt: Date;
  source: { id: string; name: string } | null;
  referredBy: { id: string; name: string } | null;
  owner: { id: string; user: { name: string } } | null;
  branch: { id: string; name: string } | null;
};
type DetailRow = SummaryRow & {
  interest: string | null;
  notes: string | null;
  lostReason: string | null;
  convertedAt: Date | null;
  referredContact: { id: string; fullName: string } | null;
  convertedClient: LeadDetail['convertedClient'];
};

function toSummary(row: SummaryRow): LeadSummary {
  return { ...row, owner: memberRef(row.owner), createdAt: row.createdAt.toISOString() };
}

function toDetail(row: DetailRow): LeadDetail {
  return {
    ...toSummary(row),
    interest: row.interest,
    notes: row.notes,
    lostReason: row.lostReason,
    referredContact: row.referredContact
      ? { id: row.referredContact.id, name: row.referredContact.fullName }
      : null,
    convertedClient: row.convertedClient,
    convertedAt: row.convertedAt?.toISOString() ?? null,
  };
}

const LEAD = 'Lead';

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clients: ClientsService,
  ) {}

  async list(query: LeadListQuery): Promise<Paginated<LeadSummary>> {
    const ctx = requireTenantContext();
    const scope = requireScope(PERMISSIONS.LEAD_READ, ctx);
    const rows = await this.prisma.tenantTx((tx) =>
      tx.lead.findMany({
        where: {
          AND: [
            { deletedAt: null },
            leadScopeWhere(scope, ctx),
            query.status ? { status: query.status } : {},
            query.mine ? { ownerMembershipId: ctx.membershipId } : {},
            query.q
              ? {
                  OR: [
                    { fullName: contains(query.q) },
                    { email: contains(query.q) },
                    { phone: contains(query.q) },
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

  async get(id: string): Promise<LeadDetail> {
    const ctx = requireTenantContext();
    const scope = requireScope(PERMISSIONS.LEAD_READ, ctx);
    const row = await this.prisma.tenantTx((tx) =>
      tx.lead.findFirst({
        where: { AND: [{ id, deletedAt: null }, leadScopeWhere(scope, ctx)] },
        select: detailSelect,
      }),
    );
    if (!row) throw notFound(LEAD);
    return toDetail(row);
  }

  async create(input: CreateLeadInput): Promise<LeadDetail> {
    const ctx = requireTenantContext();
    const scope = requireScope(PERMISSIONS.LEAD_CREATE, ctx);
    // People who may only see their own leads always own what they create.
    const owner =
      scope === 'OWN' || input.ownerMembershipId === undefined
        ? ctx.membershipId
        : input.ownerMembershipId;
    if (
      scope === 'OWN' &&
      input.ownerMembershipId &&
      input.ownerMembershipId !== ctx.membershipId
    ) {
      throw new AppException(403, 'OUT_OF_SCOPE', 'You can only create leads you own.');
    }
    assertBranchInScope(scope, input.branchId, ctx);
    return this.prisma.tenantTx(async (tx) => {
      await this.validateRefs(tx, { ...input, ownerMembershipId: owner });
      const lead = await tx.lead.create({
        data: {
          tenantId: ctx.tenantId,
          fullName: input.fullName,
          email: input.email ?? null,
          phone: input.phone ?? null,
          phoneDigits: phoneDigits(input.phone),
          sourceId: input.sourceId ?? null,
          referredByPartnerId: input.referredByPartnerId ?? null,
          referredByContactId: input.referredByContactId ?? null,
          interest: input.interest ?? null,
          notes: input.notes ?? null,
          branchId: input.branchId ?? null,
          ownerMembershipId: owner,
          createdByMembershipId: ctx.membershipId,
        },
        select: detailSelect,
      });
      await this.audit.record(tx, {
        action: 'lead.created',
        targetType: 'lead',
        targetId: lead.id,
      });
      return toDetail(lead);
    });
  }

  async update(id: string, input: UpdateLeadInput): Promise<LeadDetail> {
    const ctx = requireTenantContext();
    const scope = requireScope(PERMISSIONS.LEAD_UPDATE, ctx);
    return this.prisma.tenantTx(async (tx) => {
      const current = await tx.lead.findFirst({
        where: { AND: [{ id, deletedAt: null }, leadScopeWhere(scope, ctx)] },
        select: { id: true, status: true, referredByPartnerId: true },
      });
      if (!current) throw notFound(LEAD);
      if (current.status === 'CONVERTED') {
        throw new AppException(
          409,
          'LEAD_CONVERTED',
          'Converted leads are read-only. Edit the client instead.',
        );
      }
      if (
        scope === 'OWN' &&
        input.ownerMembershipId !== undefined &&
        input.ownerMembershipId !== ctx.membershipId
      ) {
        throw new AppException(403, 'OUT_OF_SCOPE', 'Ask a manager to reassign this lead.');
      }
      if (input.branchId !== undefined) assertBranchInScope(scope, input.branchId, ctx);
      await this.validateRefs(tx, {
        ...input,
        referredByPartnerId:
          input.referredByPartnerId === undefined
            ? current.referredByPartnerId
            : input.referredByPartnerId,
      });
      const lead = await tx.lead.update({
        where: { id },
        data: {
          ...pick(input, [
            'fullName',
            'email',
            'interest',
            'notes',
            'sourceId',
            'referredByPartnerId',
            'referredByContactId',
            'branchId',
            'ownerMembershipId',
          ]),
          ...(input.phone !== undefined
            ? { phone: input.phone, phoneDigits: phoneDigits(input.phone) }
            : {}),
          ...(input.status !== undefined
            ? {
                status: input.status,
                lostReason: input.status === 'LOST' ? (input.lostReason ?? null) : null,
              }
            : input.lostReason !== undefined
              ? { lostReason: input.lostReason }
              : {}),
        },
        select: detailSelect,
      });
      await this.audit.record(tx, {
        action:
          input.status && input.status !== current.status
            ? `lead.${input.status === 'LOST' ? 'lost' : 'reopened'}`
            : 'lead.updated',
        targetType: 'lead',
        targetId: id,
      });
      return toDetail(lead);
    });
  }

  async remove(id: string): Promise<void> {
    const ctx = requireTenantContext();
    const scope = requireScope(PERMISSIONS.LEAD_DELETE, ctx);
    await this.prisma.tenantTx(async (tx) => {
      const lead = await tx.lead.findFirst({
        where: { AND: [{ id, deletedAt: null }, leadScopeWhere(scope, ctx)] },
        select: { status: true },
      });
      if (!lead) throw notFound(LEAD);
      if (lead.status === 'CONVERTED') {
        throw new AppException(
          409,
          'LEAD_CONVERTED',
          'Converted leads are kept for source attribution.',
        );
      }
      await tx.lead.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(tx, { action: 'lead.deleted', targetType: 'lead', targetId: id });
    });
  }

  /**
   * Turns a lead into a client: either a NEW client, or a LINK to an existing one (to avoid
   * duplicates). Safe to retry: linking an already-converted lead to the same client returns the
   * same result. The lead keeps its source and referrer for attribution.
   */
  async convert(id: string, input: ConvertLeadInput): Promise<ConvertLeadResponse> {
    const ctx = requireTenantContext();
    const scope = requireScope(PERMISSIONS.LEAD_UPDATE, ctx);
    return this.prisma.tenantTx(async (tx) => {
      const lead = await tx.lead.findFirst({
        where: { AND: [{ id, deletedAt: null }, leadScopeWhere(scope, ctx)] },
        select: { id: true, status: true, branchId: true, convertedClientId: true },
      });
      if (!lead) throw notFound(LEAD);

      if (lead.status === 'CONVERTED') {
        if (input.mode === 'link' && input.clientId === lead.convertedClientId) {
          return this.conversionResult(tx, id, lead.convertedClientId, false);
        }
        throw new AppException(409, 'LEAD_ALREADY_CONVERTED', 'This lead was already converted.');
      }
      if (lead.status !== 'OPEN') {
        throw new AppException(409, 'LEAD_NOT_OPEN', 'Reopen the lead before converting it.');
      }

      let clientId: string;
      if (input.mode === 'new') {
        const client = await this.clients.createInTx(tx, ctx, {
          ...input.client,
          branchId: input.client.branchId === undefined ? lead.branchId : input.client.branchId,
        });
        clientId = client.id;
      } else {
        const updateScope = requireScope(PERMISSIONS.CLIENT_UPDATE, ctx);
        const client = await tx.client.findFirst({
          where: {
            AND: [{ id: input.clientId, deletedAt: null }, clientScopeWhere(updateScope, ctx)],
          },
          select: { id: true },
        });
        if (!client) throw notFound('Client');
        clientId = client.id;
      }

      const claimed = await tx.lead.updateMany({
        where: { id, status: 'OPEN' },
        data: { status: 'CONVERTED', convertedClientId: clientId, convertedAt: new Date() },
      });
      if (claimed.count !== 1)
        throw new AppException(409, 'LEAD_ALREADY_CONVERTED', 'This lead was already converted.');
      await this.audit.record(tx, {
        action: 'lead.converted',
        targetType: 'lead',
        targetId: id,
        metadata: { clientId, mode: input.mode },
      });
      return this.conversionResult(tx, id, clientId, input.mode === 'new');
    });
  }

  private async conversionResult(
    tx: Tx,
    leadId: string,
    clientId: string | null,
    created: boolean,
  ) {
    const [lead, client] = await Promise.all([
      tx.lead.findUniqueOrThrow({ where: { id: leadId }, select: detailSelect }),
      tx.client.findUniqueOrThrow({ where: { id: clientId ?? '' }, select: clientSummarySelect }),
    ]);
    return { lead: toDetail(lead), client: toClientSummary(client), created };
  }

  private async validateRefs(
    tx: Tx,
    v: Pick<
      CreateLeadInput,
      'sourceId' | 'referredByPartnerId' | 'referredByContactId' | 'branchId' | 'ownerMembershipId'
    >,
  ): Promise<void> {
    if (v.sourceId) await requireReferenceOption(tx, v.sourceId, 'LEAD_SOURCE', 'sourceId');
    if (v.referredByPartnerId)
      await requirePartner(tx, v.referredByPartnerId, 'referredByPartnerId');
    if (v.referredByContactId) {
      await requirePartnerContact(
        tx,
        v.referredByContactId,
        v.referredByPartnerId,
        'referredByContactId',
      );
    }
    if (v.branchId) await requireActiveBranch(tx, v.branchId);
    if (v.ownerMembershipId) await requireActiveStaff(tx, v.ownerMembershipId, 'ownerMembershipId');
  }
}

/** Copy only the keys that were provided (undefined = no change). */
export function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const key of keys) if (obj[key] !== undefined) out[key] = obj[key];
  return out;
}

export type { TenantContext };
