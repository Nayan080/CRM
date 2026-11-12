import { Injectable } from '@nestjs/common';
import type {
  ConsentListQuery,
  ConsentResponse,
  CreateConsentInput,
  CreateShareInput,
  ShareListQuery,
  ShareResponse,
  SharedMatter,
  UpdateShareInput,
} from '@crm/contracts';
import { PERMISSIONS } from '@crm/permissions';
import { requireScope } from '../../common/auth/scope.js';
import { type TenantContext, requireTenantContext } from '../../common/context/request-context.js';
import { AppException } from '../../common/errors/app-exception.js';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import {
  clientScopeWhere,
  invalidRef,
  matterScopeWhere,
  memberRef,
  memberRefSelect,
  notFound,
} from '../crm/access.js';
import { DocumentsService, type FileDownload } from './documents.service.js';

const P = PERMISSIONS;

const consentSelect = {
  id: true,
  purpose: true,
  recipient: true,
  method: true,
  givenAt: true,
  notes: true,
  withdrawnAt: true,
  createdAt: true,
  recordedBy: memberRefSelect,
} as const;

type Member = { id: string; user: { name: string } };
const ref = (m: Member) => memberRef(m) ?? { id: m.id, name: '' };

function toConsent(row: {
  id: string;
  purpose: string;
  recipient: string | null;
  method: ConsentResponse['method'];
  givenAt: Date;
  notes: string | null;
  withdrawnAt: Date | null;
  createdAt: Date;
  recordedBy: Member;
}): ConsentResponse {
  return {
    ...row,
    givenAt: row.givenAt.toISOString(),
    withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    recordedBy: ref(row.recordedBy),
  };
}

const shareSelect = {
  id: true,
  purpose: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
  matter: { select: { id: true, reference: true, title: true } },
  grantee: { select: { id: true, user: { select: { name: true, email: true } } } },
  consent: { select: { id: true, purpose: true, withdrawnAt: true } },
  createdBy: memberRefSelect,
  documents: {
    where: { document: { deletedAt: null } },
    orderBy: { createdAt: 'asc' as const },
    select: { document: { select: { id: true, title: true } } },
  },
} as const;

type ShareRow = {
  id: string;
  purpose: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  matter: { id: string; reference: string; title: string };
  grantee: { id: string; user: { name: string; email: string } };
  consent: { id: string; purpose: string; withdrawnAt: Date | null } | null;
  createdBy: Member;
  documents: { document: { id: string; title: string } }[];
};

const isActive = (s: { revokedAt: Date | null; expiresAt: Date | null }, now = new Date()) =>
  !s.revokedAt && (!s.expiresAt || s.expiresAt > now);

function toShare(row: ShareRow): ShareResponse {
  return {
    id: row.id,
    matter: row.matter,
    grantee: { id: row.grantee.id, name: row.grantee.user.name, email: row.grantee.user.email },
    consent: row.consent
      ? { ...row.consent, withdrawnAt: row.consent.withdrawnAt?.toISOString() ?? null }
      : null,
    purpose: row.purpose,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    active: isActive(row),
    documents: row.documents.map((d) => d.document),
    createdBy: ref(row.createdBy),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Where clause for shares the caller (an EXTERNAL member) can use right now. */
function myActiveShares(ctx: TenantContext) {
  return {
    granteeMembershipId: ctx.membershipId,
    revokedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    grantee: { status: 'ACTIVE' as const, kind: 'EXTERNAL' as const },
  };
}

@Injectable()
export class SharingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly documents: DocumentsService,
  ) {}

  // ───────── Consents (client records) ─────────

  async listConsents(query: ConsentListQuery): Promise<ConsentResponse[]> {
    const ctx = requireTenantContext();
    const scope = requireScope(P.CLIENT_READ, ctx);
    const rows = await this.prisma.tenantTx(async (tx) => {
      await this.requireClient(tx, ctx, query.clientId, scope);
      return tx.consent.findMany({
        where: { clientId: query.clientId },
        orderBy: { givenAt: 'desc' },
        select: consentSelect,
      });
    });
    return rows.map(toConsent);
  }

  async createConsent(input: CreateConsentInput): Promise<ConsentResponse> {
    const ctx = requireTenantContext();
    const scope = requireScope(P.CLIENT_UPDATE, ctx);
    return this.prisma.tenantTx(async (tx) => {
      await this.requireClient(tx, ctx, input.clientId, scope);
      const row = await tx.consent.create({
        data: {
          tenantId: ctx.tenantId,
          clientId: input.clientId,
          purpose: input.purpose,
          recipient: input.recipient ?? null,
          method: input.method,
          givenAt: new Date(input.givenAt),
          notes: input.notes ?? null,
          recordedByMembershipId: ctx.membershipId,
        },
        select: consentSelect,
      });
      await this.audit.record(tx, {
        action: 'consent.recorded',
        targetType: 'consent',
        targetId: row.id,
      });
      return toConsent(row);
    });
  }

  async withdrawConsent(id: string): Promise<ConsentResponse> {
    const ctx = requireTenantContext();
    const scope = requireScope(P.CLIENT_UPDATE, ctx);
    return this.prisma.tenantTx(async (tx) => {
      const found = await tx.consent.findFirst({
        where: { id, client: clientScopeWhere(scope, ctx) },
        select: { id: true },
      });
      if (!found) throw notFound('Consent');
      await tx.consent.updateMany({
        where: { id, withdrawnAt: null },
        data: { withdrawnAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'consent.withdrawn',
        targetType: 'consent',
        targetId: id,
      });
      return toConsent(
        await tx.consent.findUniqueOrThrow({ where: { id }, select: consentSelect }),
      );
    });
  }

  // ───────── Shares (staff with share:manage) ─────────

  async listShares(query: ShareListQuery): Promise<ShareResponse[]> {
    const ctx = requireTenantContext();
    requireScope(P.SHARE_MANAGE, ctx);
    const rows = await this.prisma.tenantTx(async (tx) => {
      await this.requireMatter(tx, ctx, query.matterId);
      return tx.resourceShare.findMany({
        where: { matterId: query.matterId },
        orderBy: { createdAt: 'desc' },
        select: shareSelect,
      });
    });
    return rows.map(toShare);
  }

  async createShare(input: CreateShareInput): Promise<ShareResponse> {
    const ctx = requireTenantContext();
    requireScope(P.SHARE_MANAGE, ctx);
    return this.prisma.tenantTx(async (tx) => {
      const matter = await this.requireMatter(tx, ctx, input.matterId);
      const grantee = await tx.membership.count({
        where: { id: input.granteeMembershipId, kind: 'EXTERNAL', status: 'ACTIVE' },
      });
      if (!grantee) {
        throw invalidRef(
          'granteeMembershipId',
          'Choose an active external collaborator (invited as external)',
        );
      }
      const existing = await tx.resourceShare.count({
        where: {
          matterId: input.matterId,
          granteeMembershipId: input.granteeMembershipId,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      });
      if (existing) {
        throw new AppException(
          409,
          'ALREADY_SHARED',
          'This matter is already shared with that person. Edit that share instead.',
        );
      }
      if (input.consentId) await this.requireUsableConsent(tx, input.consentId, matter.clientId);
      this.requireFuture(input.expiresAt);
      await this.requireMatterDocuments(tx, input.matterId, input.documentIds);
      const share = await tx.resourceShare.create({
        data: {
          tenantId: ctx.tenantId,
          matterId: input.matterId,
          granteeMembershipId: input.granteeMembershipId,
          consentId: input.consentId ?? null,
          purpose: input.purpose ?? null,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          createdByMembershipId: ctx.membershipId,
        },
        select: { id: true },
      });
      await this.setDocuments(tx, ctx, share.id, input.documentIds);
      await this.audit.record(tx, {
        action: 'share.created',
        targetType: 'matter',
        targetId: input.matterId,
        metadata: {
          shareId: share.id,
          grantee: input.granteeMembershipId,
          documents: input.documentIds.length,
          consent: input.consentId ? 'recorded' : 'none',
        },
      });
      return toShare(
        await tx.resourceShare.findUniqueOrThrow({ where: { id: share.id }, select: shareSelect }),
      );
    });
  }

  async updateShare(id: string, input: UpdateShareInput): Promise<ShareResponse> {
    const ctx = requireTenantContext();
    requireScope(P.SHARE_MANAGE, ctx);
    return this.prisma.tenantTx(async (tx) => {
      const share = await this.requireShare(tx, ctx, id);
      if (share.revokedAt)
        throw new AppException(409, 'SHARE_REVOKED', 'Revoked shares cannot be changed.');
      if (input.expiresAt !== undefined) this.requireFuture(input.expiresAt);
      if (input.documentIds) {
        await this.requireMatterDocuments(tx, share.matterId, input.documentIds);
        await tx.shareDocument.deleteMany({ where: { shareId: id } });
        await this.setDocuments(tx, ctx, id, input.documentIds);
      }
      if (input.expiresAt !== undefined) {
        await tx.resourceShare.update({
          where: { id },
          data: { expiresAt: input.expiresAt ? new Date(input.expiresAt) : null },
        });
      }
      await this.audit.record(tx, {
        action: 'share.updated',
        targetType: 'matter',
        targetId: share.matterId,
        metadata: { shareId: id, fields: Object.keys(input).sort().join(',') },
      });
      return toShare(
        await tx.resourceShare.findUniqueOrThrow({ where: { id }, select: shareSelect }),
      );
    });
  }

  /** Takes effect on the external member's next request. */
  async revokeShare(id: string): Promise<ShareResponse> {
    const ctx = requireTenantContext();
    requireScope(P.SHARE_MANAGE, ctx);
    return this.prisma.tenantTx(async (tx) => {
      const share = await this.requireShare(tx, ctx, id);
      await tx.resourceShare.updateMany({
        where: { id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'share.revoked',
        targetType: 'matter',
        targetId: share.matterId,
        metadata: { shareId: id },
      });
      return toShare(
        await tx.resourceShare.findUniqueOrThrow({ where: { id }, select: shareSelect }),
      );
    });
  }

  // ───────── Shared with me (EXTERNAL members) ─────────

  async sharedWithMe(): Promise<SharedMatter[]> {
    const ctx = requireTenantContext();
    const rows = await this.prisma.tenantTx((tx) =>
      tx.resourceShare.findMany({
        where: myActiveShares(ctx),
        orderBy: { createdAt: 'desc' },
        select: sharedSelect,
      }),
    );
    return rows.map(toShared);
  }

  async sharedMatter(shareId: string): Promise<SharedMatter> {
    const ctx = requireTenantContext();
    const row = await this.prisma.tenantTx((tx) =>
      tx.resourceShare.findFirst({
        where: { id: shareId, ...myActiveShares(ctx) },
        select: sharedSelect,
      }),
    );
    if (!row) throw notFound('Shared matter');
    return toShared(row);
  }

  async downloadShared(shareId: string, documentId: string): Promise<FileDownload> {
    const ctx = requireTenantContext();
    const version = await this.prisma.tenantTx(async (tx) => {
      const allowed = await tx.shareDocument.count({
        where: { shareId, documentId, share: myActiveShares(ctx), document: { deletedAt: null } },
      });
      if (!allowed) throw notFound('Document');
      const v = await tx.documentVersion.findFirst({
        where: { documentId },
        orderBy: { versionNumber: 'desc' },
        select: {
          storageKey: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true,
          versionNumber: true,
        },
      });
      if (!v) throw notFound('Document');
      await this.audit.record(tx, {
        action: 'document.downloaded',
        targetType: 'document',
        targetId: documentId,
        metadata: { version: v.versionNumber, via: 'share', shareId },
      });
      return v;
    });
    return { ...version, stream: await this.documents.open(version.storageKey) };
  }

  // ───────── helpers ─────────

  private async requireClient(
    tx: Tx,
    ctx: TenantContext,
    clientId: string,
    scope: ReturnType<typeof requireScope>,
  ) {
    const ok = await tx.client.count({
      where: { AND: [{ id: clientId, deletedAt: null }, clientScopeWhere(scope, ctx)] },
    });
    if (!ok) throw notFound('Client');
  }

  /** Sharing a matter also requires being able to see it. */
  private async requireMatter(tx: Tx, ctx: TenantContext, matterId: string) {
    const scope = requireScope(P.MATTER_READ, ctx);
    const matter = await tx.matter.findFirst({
      where: { AND: [{ id: matterId }, matterScopeWhere(scope, ctx)] },
      select: { id: true, clientId: true },
    });
    if (!matter) throw notFound('Matter');
    return matter;
  }

  private async requireShare(tx: Tx, ctx: TenantContext, id: string) {
    const share = await tx.resourceShare.findFirst({
      where: { id },
      select: { matterId: true, revokedAt: true },
    });
    if (!share) throw notFound('Share');
    await this.requireMatter(tx, ctx, share.matterId);
    return share;
  }

  private async requireUsableConsent(tx: Tx, consentId: string, clientId: string) {
    const consent = await tx.consent.findFirst({
      where: { id: consentId, clientId },
      select: { withdrawnAt: true },
    });
    if (!consent)
      throw invalidRef('consentId', "Choose a consent recorded for this matter's client");
    if (consent.withdrawnAt) {
      throw new AppException(400, 'CONSENT_WITHDRAWN', 'That consent was withdrawn.', [
        { path: 'consentId', message: 'This consent was withdrawn' },
      ]);
    }
  }

  private requireFuture(expiresAt: string | null | undefined) {
    if (expiresAt && new Date(expiresAt) <= new Date()) {
      throw new AppException(400, 'VALIDATION_FAILED', 'The expiry must be in the future.', [
        { path: 'expiresAt', message: 'Must be in the future' },
      ]);
    }
  }

  /** Only documents filed on this matter can be shared through it. */
  private async requireMatterDocuments(tx: Tx, matterId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return;
    const found = await tx.document.count({
      where: { id: { in: unique }, matterId, deletedAt: null },
    });
    if (found !== unique.length)
      throw invalidRef('documentIds', 'Choose documents filed on this matter');
  }

  private async setDocuments(tx: Tx, ctx: TenantContext, shareId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return;
    await tx.shareDocument.createMany({
      data: unique.map((documentId) => ({ tenantId: ctx.tenantId, shareId, documentId })),
    });
  }
}

const sharedSelect = {
  id: true,
  purpose: true,
  expiresAt: true,
  createdBy: { select: { user: { select: { name: true } } } },
  matter: {
    select: {
      reference: true,
      title: true,
      status: true,
      matterType: { select: { name: true } },
      stage: { select: { name: true } },
      client: { select: { displayName: true } },
    },
  },
  documents: {
    where: { document: { deletedAt: null } },
    orderBy: { createdAt: 'asc' as const },
    select: {
      document: {
        select: {
          id: true,
          title: true,
          updatedAt: true,
          category: { select: { name: true } },
          versions: {
            orderBy: { versionNumber: 'desc' as const },
            take: 1,
            select: { fileName: true, mimeType: true, sizeBytes: true },
          },
        },
      },
    },
  },
} as const;

type SharedRow = {
  id: string;
  purpose: string | null;
  expiresAt: Date | null;
  createdBy: { user: { name: string } };
  matter: {
    reference: string;
    title: string;
    status: SharedMatter['matter']['status'];
    matterType: { name: string };
    stage: { name: string } | null;
    client: { displayName: string };
  };
  documents: {
    document: {
      id: string;
      title: string;
      updatedAt: Date;
      category: { name: string } | null;
      versions: { fileName: string; mimeType: string; sizeBytes: number }[];
    };
  }[];
};

/** Deliberately minimal: no client contact details, notes, team, history or other documents. */
function toShared(row: SharedRow): SharedMatter {
  return {
    shareId: row.id,
    purpose: row.purpose,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    sharedBy: row.createdBy.user.name,
    matter: {
      reference: row.matter.reference,
      title: row.matter.title,
      type: row.matter.matterType.name,
      stage: row.matter.stage?.name ?? null,
      status: row.matter.status,
      clientName: row.matter.client.displayName,
    },
    documents: row.documents.flatMap(({ document: d }) => {
      const v = d.versions[0];
      return v
        ? [
            {
              id: d.id,
              title: d.title,
              category: d.category?.name ?? null,
              fileName: v.fileName,
              mimeType: v.mimeType,
              sizeBytes: v.sizeBytes,
              updatedAt: d.updatedAt.toISOString(),
            },
          ]
        : [];
    }),
  };
}
