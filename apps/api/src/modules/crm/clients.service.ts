import { Injectable } from '@nestjs/common';
import type {
  ClientDetail,
  ClientRelationshipResponse,
  ClientSummary,
  CreateClientInput,
  CreateRelationshipInput,
  DuplicateCandidate,
  DuplicateQuery,
  DuplicateResponse,
  ListQuery,
  Paginated,
  UpdateClientInput,
} from '@crm/contracts';
import { PERMISSIONS } from '@crm/permissions';
import { assertBranchInScope, requireScope } from '../../common/auth/scope.js';
import { type TenantContext, requireTenantContext } from '../../common/context/request-context.js';
import { formatNumber, nextCounter } from '../../common/data/counters.js';
import { phoneDigits, phoneMatchKey } from '../../common/data/phone.js';
import { AppException } from '../../common/errors/app-exception.js';
import { contains, pageArgs, toPage } from '../../common/pagination/pagination.js';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { requireReferenceOption } from '../reference/reference.service.js';
import { clientScopeWhere, notFound, requireActiveBranch } from './access.js';

const named = { select: { id: true, name: true } } as const;

export const clientSummarySelect = {
  id: true,
  clientNumber: true,
  kind: true,
  displayName: true,
  email: true,
  phone: true,
  createdAt: true,
  branch: named,
} as const;

const otherSelect = { select: { id: true, clientNumber: true, displayName: true } } as const;

const detailSelect = {
  ...clientSummarySelect,
  dateOfBirth: true,
  nationality: true,
  addressLine: true,
  notes: true,
  relationsFrom: { select: { id: true, notes: true, type: named, toClient: otherSelect } },
  relationsTo: { select: { id: true, notes: true, type: named, fromClient: otherSelect } },
  sourceLeads: {
    where: { deletedAt: null },
    select: { id: true, fullName: true, source: named, referredBy: named },
  },
} as const;

type SummaryRow = Omit<ClientSummary, 'createdAt'> & { createdAt: Date };

export function toClientSummary(row: SummaryRow): ClientSummary {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

type Other = { id: string; clientNumber: string; displayName: string };
type DetailRow = SummaryRow & {
  dateOfBirth: Date | null;
  nationality: string | null;
  addressLine: string | null;
  notes: string | null;
  relationsFrom: {
    id: string;
    notes: string | null;
    type: { id: string; name: string };
    toClient: Other;
  }[];
  relationsTo: {
    id: string;
    notes: string | null;
    type: { id: string; name: string };
    fromClient: Other;
  }[];
  sourceLeads: ClientDetail['sourceLeads'];
};

function toDetail(row: DetailRow): ClientDetail {
  const {
    relationsFrom,
    relationsTo,
    dateOfBirth,
    sourceLeads,
    nationality,
    addressLine,
    notes,
    ...summary
  } = row;
  const relationships: ClientRelationshipResponse[] = [
    ...relationsFrom.map((r) => ({
      id: r.id,
      type: r.type,
      direction: 'from' as const,
      other: r.toClient,
      notes: r.notes,
    })),
    ...relationsTo.map((r) => ({
      id: r.id,
      type: r.type,
      direction: 'to' as const,
      other: r.fromClient,
      notes: r.notes,
    })),
  ];
  return {
    ...toClientSummary(summary),
    dateOfBirth: dateOfBirth ? dateOfBirth.toISOString().slice(0, 10) : null,
    nationality,
    addressLine,
    notes,
    relationships,
    sourceLeads,
  };
}

const CLIENT = 'Client';
const toDate = (d: string | null | undefined) =>
  d ? new Date(`${d}T00:00:00Z`) : d === null ? null : undefined;

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListQuery): Promise<Paginated<ClientSummary>> {
    const ctx = requireTenantContext();
    const scope = requireScope(PERMISSIONS.CLIENT_READ, ctx);
    const rows = await this.prisma.tenantTx((tx) =>
      tx.client.findMany({
        where: {
          AND: [
            { deletedAt: null },
            clientScopeWhere(scope, ctx),
            query.q
              ? {
                  OR: [
                    { displayName: contains(query.q) },
                    { email: contains(query.q) },
                    { clientNumber: contains(query.q) },
                    { phone: contains(query.q) },
                  ],
                }
              : {},
          ],
        },
        select: clientSummarySelect,
        ...pageArgs(query),
      }),
    );
    return toPage(rows, query.limit, toClientSummary);
  }

  async get(id: string): Promise<ClientDetail> {
    const ctx = requireTenantContext();
    const scope = requireScope(PERMISSIONS.CLIENT_READ, ctx);
    const row = await this.prisma.tenantTx((tx) =>
      tx.client.findFirst({
        where: { AND: [{ id, deletedAt: null }, clientScopeWhere(scope, ctx)] },
        select: detailSelect,
      }),
    );
    if (!row) throw notFound(CLIENT);
    return toDetail(row);
  }

  async create(input: CreateClientInput): Promise<ClientDetail> {
    const ctx = requireTenantContext();
    return this.prisma.tenantTx(async (tx) => {
      const { id } = await this.createInTx(tx, ctx, input);
      return toDetail(await tx.client.findUniqueOrThrow({ where: { id }, select: detailSelect }));
    });
  }

  /** Shared by "new client" and "convert lead → new client". */
  async createInTx(tx: Tx, ctx: TenantContext, input: CreateClientInput): Promise<{ id: string }> {
    const scope = requireScope(PERMISSIONS.CLIENT_CREATE, ctx);
    assertBranchInScope(scope, input.branchId, ctx);
    if (input.branchId) await requireActiveBranch(tx, input.branchId);
    const number = await nextCounter(tx, ctx.tenantId, 'client');
    const client = await tx.client.create({
      data: {
        tenantId: ctx.tenantId,
        clientNumber: formatNumber('C', number),
        kind: input.kind,
        displayName: input.displayName,
        email: input.email ?? null,
        phone: input.phone ?? null,
        phoneDigits: phoneDigits(input.phone),
        dateOfBirth: toDate(input.dateOfBirth) ?? null,
        nationality: input.nationality ?? null,
        addressLine: input.addressLine ?? null,
        notes: input.notes ?? null,
        branchId: input.branchId ?? null,
        createdByMembershipId: ctx.membershipId,
      },
      select: { id: true },
    });
    await this.audit.record(tx, {
      action: 'client.created',
      targetType: 'client',
      targetId: client.id,
    });
    return client;
  }

  async update(id: string, input: UpdateClientInput): Promise<ClientDetail> {
    const ctx = requireTenantContext();
    const scope = requireScope(PERMISSIONS.CLIENT_UPDATE, ctx);
    return this.prisma.tenantTx(async (tx) => {
      const current = await tx.client.findFirst({
        where: { AND: [{ id, deletedAt: null }, clientScopeWhere(scope, ctx)] },
        select: { kind: true, dateOfBirth: true },
      });
      if (!current) throw notFound(CLIENT);
      const kind = input.kind ?? current.kind;
      if (
        kind === 'BUSINESS' &&
        (input.dateOfBirth || (input.dateOfBirth === undefined && current.dateOfBirth))
      ) {
        throw new AppException(
          400,
          'VALIDATION_FAILED',
          'Business clients have no date of birth.',
          [{ path: 'dateOfBirth', message: 'Only for individual clients' }],
        );
      }
      if (input.branchId !== undefined) {
        assertBranchInScope(scope, input.branchId, ctx);
        if (input.branchId) await requireActiveBranch(tx, input.branchId);
      }
      await tx.client.update({
        where: { id },
        data: {
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.phone !== undefined
            ? { phone: input.phone, phoneDigits: phoneDigits(input.phone) }
            : {}),
          ...(input.dateOfBirth !== undefined ? { dateOfBirth: toDate(input.dateOfBirth) } : {}),
          ...(input.nationality !== undefined ? { nationality: input.nationality } : {}),
          ...(input.addressLine !== undefined ? { addressLine: input.addressLine } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.branchId !== undefined ? { branchId: input.branchId } : {}),
        },
      });
      // Field names only — never the personal values themselves.
      await this.audit.record(tx, {
        action: 'client.updated',
        targetType: 'client',
        targetId: id,
        metadata: { fields: Object.keys(input).sort().join(',') },
      });
      return toDetail(await tx.client.findUniqueOrThrow({ where: { id }, select: detailSelect }));
    });
  }

  /**
   * Possible existing clients for the details given (email, phone, or name + birth date).
   * Matches the caller may not see are only counted, never shown.
   */
  async duplicates(query: DuplicateQuery): Promise<DuplicateResponse> {
    const ctx = requireTenantContext();
    const scope = requireScope(PERMISSIONS.CLIENT_READ, ctx);
    const email = query.email?.toLowerCase();
    const phoneKey = phoneMatchKey(query.phone);
    const or = [
      ...(email ? [{ email: { equals: email, mode: 'insensitive' as const } }] : []),
      ...(phoneKey ? [{ phoneDigits: { endsWith: phoneKey } }] : []),
      ...(query.name && query.dateOfBirth
        ? [
            {
              displayName: { equals: query.name, mode: 'insensitive' as const },
              dateOfBirth: toDate(query.dateOfBirth),
            },
          ]
        : []),
    ];
    if (or.length === 0) return { candidates: [], hiddenMatches: 0 };

    return this.prisma.tenantTx(async (tx) => {
      const matches = await tx.client.findMany({
        where: { deletedAt: null, OR: or },
        select: { ...clientSummarySelect, phoneDigits: true, dateOfBirth: true },
        take: 50,
      });
      const visible = new Set(
        (
          await tx.client.findMany({
            where: {
              AND: [{ id: { in: matches.map((m) => m.id) } }, clientScopeWhere(scope, ctx)],
            },
            select: { id: true },
          })
        ).map((c) => c.id),
      );
      const candidates: DuplicateCandidate[] = matches
        .filter((m) => visible.has(m.id))
        .slice(0, 10)
        .map((m) => ({
          id: m.id,
          clientNumber: m.clientNumber,
          displayName: m.displayName,
          email: m.email,
          phone: m.phone,
          reasons: [
            ...(email && m.email?.toLowerCase() === email ? (['email'] as const) : []),
            ...(phoneKey && m.phoneDigits?.endsWith(phoneKey) ? (['phone'] as const) : []),
            ...(query.name &&
            query.dateOfBirth &&
            m.displayName.toLowerCase() === query.name.toLowerCase() &&
            m.dateOfBirth?.toISOString().slice(0, 10) === query.dateOfBirth
              ? (['name_and_birth_date'] as const)
              : []),
          ],
        }));
      return { candidates, hiddenMatches: matches.filter((m) => !visible.has(m.id)).length };
    });
  }

  async addRelationship(clientId: string, input: CreateRelationshipInput): Promise<ClientDetail> {
    const ctx = requireTenantContext();
    const updateScope = requireScope(PERMISSIONS.CLIENT_UPDATE, ctx);
    const readScope = requireScope(PERMISSIONS.CLIENT_READ, ctx);
    if (input.toClientId === clientId) {
      throw new AppException(400, 'VALIDATION_FAILED', 'A client cannot be related to itself.', [
        { path: 'toClientId', message: 'Choose another client' },
      ]);
    }
    return this.prisma.tenantTx(async (tx) => {
      const from = await tx.client.findFirst({
        where: { AND: [{ id: clientId, deletedAt: null }, clientScopeWhere(updateScope, ctx)] },
        select: { id: true },
      });
      if (!from) throw notFound(CLIENT);
      const to = await tx.client.findFirst({
        where: {
          AND: [{ id: input.toClientId, deletedAt: null }, clientScopeWhere(readScope, ctx)],
        },
        select: { id: true },
      });
      if (!to) {
        throw new AppException(400, 'INVALID_REFERENCE', 'Choose an existing client.', [
          { path: 'toClientId', message: 'Choose an existing client' },
        ]);
      }
      await requireReferenceOption(tx, input.typeId, 'RELATIONSHIP_TYPE', 'typeId');
      const exists = await tx.clientRelationship.count({
        where: { fromClientId: clientId, toClientId: input.toClientId, typeId: input.typeId },
      });
      if (exists)
        throw new AppException(409, 'RELATIONSHIP_EXISTS', 'This relationship already exists.');
      const rel = await tx.clientRelationship.create({
        data: {
          tenantId: ctx.tenantId,
          fromClientId: clientId,
          toClientId: input.toClientId,
          typeId: input.typeId,
          notes: input.notes ?? null,
        },
        select: { id: true },
      });
      await this.audit.record(tx, {
        action: 'client.relationship_added',
        targetType: 'client',
        targetId: clientId,
        metadata: { relationshipId: rel.id },
      });
      return toDetail(
        await tx.client.findUniqueOrThrow({ where: { id: clientId }, select: detailSelect }),
      );
    });
  }

  async removeRelationship(clientId: string, relationshipId: string): Promise<void> {
    const ctx = requireTenantContext();
    const scope = requireScope(PERMISSIONS.CLIENT_UPDATE, ctx);
    await this.prisma.tenantTx(async (tx) => {
      const client = await tx.client.findFirst({
        where: { AND: [{ id: clientId, deletedAt: null }, clientScopeWhere(scope, ctx)] },
        select: { id: true },
      });
      if (!client) throw notFound(CLIENT);
      const deleted = await tx.clientRelationship.deleteMany({
        where: { id: relationshipId, OR: [{ fromClientId: clientId }, { toClientId: clientId }] },
      });
      if (deleted.count !== 1) throw notFound('Relationship');
      await this.audit.record(tx, {
        action: 'client.relationship_removed',
        targetType: 'client',
        targetId: clientId,
        metadata: { relationshipId },
      });
    });
  }
}
