import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  DocumentListQuery,
  DocumentResponse,
  DocumentVersionResponse,
  Paginated,
  UpdateDocumentInput,
  UploadDocumentInput,
} from '@crm/contracts';
import { PERMISSIONS } from '@crm/permissions';
import { requireScope } from '../../common/auth/scope.js';
import { type TenantContext, requireTenantContext } from '../../common/context/request-context.js';
import { AppException } from '../../common/errors/app-exception.js';
import { uuidv7 } from '../../common/data/uuid.js';
import { checkUpload } from '../../common/files/file-type.js';
import { contains, pageArgs, toPage } from '../../common/pagination/pagination.js';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../../infra/storage/storage.js';
import { AuditService } from '../audit/audit.service.js';
import {
  clientScopeWhere,
  documentScopeWhere,
  invalidRef,
  matterScopeWhere,
  memberRef,
  memberRefSelect,
  notFound,
} from '../crm/access.js';
import { requireReferenceOption } from '../reference/reference.service.js';

const P = PERMISSIONS;
const DOC = 'Document';

export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  size: number;
}

export interface FileDownload {
  stream: Readable;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

const versionSelect = {
  id: true,
  versionNumber: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  scanStatus: true,
  createdAt: true,
  uploadedBy: memberRefSelect,
} as const;

const documentSelect = {
  id: true,
  title: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true } },
  client: { select: { id: true, clientNumber: true, displayName: true } },
  matter: { select: { id: true, reference: true } },
  checklistItem: { select: { id: true, title: true } },
  uploadedBy: memberRefSelect,
  versions: { orderBy: { versionNumber: 'desc' as const }, select: versionSelect },
} as const;

type Member = { id: string; user: { name: string } };
type VersionRow = Omit<DocumentVersionResponse, 'uploadedBy' | 'createdAt'> & {
  uploadedBy: Member;
  createdAt: Date;
};
type DocumentRow = Omit<
  DocumentResponse,
  'latest' | 'versions' | 'uploadedBy' | 'createdAt' | 'updatedAt'
> & {
  versions: VersionRow[];
  uploadedBy: Member;
  createdAt: Date;
  updatedAt: Date;
};

const ref = (m: Member) => memberRef(m) ?? { id: m.id, name: '' };
const toVersion = (v: VersionRow): DocumentVersionResponse => ({
  ...v,
  uploadedBy: ref(v.uploadedBy),
  createdAt: v.createdAt.toISOString(),
});

function toDocument(row: DocumentRow): DocumentResponse {
  const versions = row.versions.map(toVersion);
  const latest = versions[0];
  if (!latest) throw new Error('Document without a version');
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    client: row.client,
    matter: row.matter,
    checklistItem: row.checklistItem,
    latest,
    versions,
    uploadedBy: ref(row.uploadedBy),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');
const storageKey = (tenantId: string, documentId: string) =>
  `tenants/${tenantId}/documents/${documentId}/${randomUUID()}`;

export function rejectFile(message: string): AppException {
  return new AppException(400, 'FILE_REJECTED', message, [{ path: 'file', message }]);
}

@Injectable()
export class DocumentsService {
  private readonly log = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async list(query: DocumentListQuery): Promise<Paginated<DocumentResponse>> {
    const ctx = requireTenantContext();
    const scope = requireScope(P.DOCUMENT_READ, ctx);
    const rows = await this.prisma.tenantTx(async (tx) => {
      if (query.matterId) {
        const ok = await tx.matter.count({
          where: { AND: [{ id: query.matterId }, matterScopeWhere(scope, ctx)] },
        });
        if (!ok) throw notFound('Matter');
      } else {
        const ok = await tx.client.count({
          where: { AND: [{ id: query.clientId, deletedAt: null }, clientScopeWhere(scope, ctx)] },
        });
        if (!ok) throw notFound('Client');
      }
      return tx.document.findMany({
        where: {
          AND: [
            { deletedAt: null },
            query.matterId ? { matterId: query.matterId } : { clientId: query.clientId },
            documentScopeWhere(scope, ctx),
            query.q ? { title: contains(query.q) } : {},
          ],
        },
        select: documentSelect,
        ...pageArgs(query),
      });
    });
    return toPage(rows, query.limit, toDocument);
  }

  async get(id: string): Promise<DocumentResponse> {
    const ctx = requireTenantContext();
    const scope = requireScope(P.DOCUMENT_READ, ctx);
    const row = await this.prisma.tenantTx((tx) =>
      tx.document.findFirst({
        where: { AND: [{ id, deletedAt: null }, documentScopeWhere(scope, ctx)] },
        select: documentSelect,
      }),
    );
    if (!row) throw notFound(DOC);
    return toDocument(row);
  }

  async upload(
    fields: UploadDocumentInput,
    file: UploadedFile | undefined,
  ): Promise<DocumentResponse> {
    const ctx = requireTenantContext();
    const scope = requireScope(P.DOCUMENT_UPLOAD, ctx);
    const checked = this.check(file);
    // 1. Validate the target before touching storage.
    const target = await this.prisma.tenantTx((tx) => this.resolveTarget(tx, ctx, scope, fields));
    // 2. Store the file, then 3. record it. If recording fails, the stored object is unreferenced.
    const documentId = uuidv7();
    const key = storageKey(ctx.tenantId, documentId);
    await this.store(key, checked.buffer, checked.mimeType);
    try {
      return await this.prisma.tenantTx(async (tx) => {
        // Re-check inside the write transaction (the target may have changed meanwhile).
        await this.resolveTarget(tx, ctx, scope, fields);
        await tx.document.create({
          data: {
            id: documentId,
            tenantId: ctx.tenantId,
            clientId: target.clientId,
            matterId: target.matterId,
            checklistItemId: fields.checklistItemId ?? null,
            categoryId: fields.categoryId ?? null,
            title: fields.title || checked.fileName.replace(/\.[^.]+$/, ''),
            uploadedByMembershipId: ctx.membershipId,
          },
        });
        await this.createVersion(tx, ctx, documentId, 1, key, checked);
        await this.audit.record(tx, {
          action: 'document.uploaded',
          targetType: 'document',
          targetId: documentId,
          metadata: { version: 1, mimeType: checked.mimeType, sizeBytes: checked.buffer.length },
        });
        return this.load(tx, documentId);
      });
    } catch (error) {
      this.log.warn(`Upload recorded no document; unreferenced object left in storage (${key})`);
      throw error;
    }
  }

  async addVersion(id: string, file: UploadedFile | undefined): Promise<DocumentResponse> {
    const ctx = requireTenantContext();
    const scope = requireScope(P.DOCUMENT_UPLOAD, ctx);
    await this.prisma.tenantTx((tx) => this.requireDocument(tx, ctx, id, scope));
    const checked = this.check(file);
    const key = storageKey(ctx.tenantId, id);
    await this.store(key, checked.buffer, checked.mimeType);
    return this.prisma.tenantTx(async (tx) => {
      await this.requireDocument(tx, ctx, id, scope);
      const last = await tx.documentVersion.aggregate({
        where: { documentId: id },
        _max: { versionNumber: true },
      });
      const versionNumber = (last._max.versionNumber ?? 0) + 1;
      await this.createVersion(tx, ctx, id, versionNumber, key, checked);
      await tx.document.update({ where: { id }, data: { updatedAt: new Date() } });
      await this.audit.record(tx, {
        action: 'document.version_uploaded',
        targetType: 'document',
        targetId: id,
        metadata: {
          version: versionNumber,
          mimeType: checked.mimeType,
          sizeBytes: checked.buffer.length,
        },
      });
      return this.load(tx, id);
    });
  }

  async update(id: string, input: UpdateDocumentInput): Promise<DocumentResponse> {
    const ctx = requireTenantContext();
    const scope = requireScope(P.DOCUMENT_UPLOAD, ctx);
    requireScope(P.DOCUMENT_READ, ctx);
    return this.prisma.tenantTx(async (tx) => {
      const doc = await this.requireDocument(tx, ctx, id, scope);
      if (input.categoryId)
        await requireReferenceOption(tx, input.categoryId, 'DOCUMENT_CATEGORY', 'categoryId');
      if (input.checklistItemId)
        await this.requireChecklistItem(tx, doc.matterId, input.checklistItemId);
      await tx.document.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
          ...(input.checklistItemId !== undefined
            ? { checklistItemId: input.checklistItemId }
            : {}),
        },
      });
      await this.audit.record(tx, {
        action: 'document.updated',
        targetType: 'document',
        targetId: id,
        metadata: { fields: Object.keys(input).sort().join(',') },
      });
      return this.load(tx, id);
    });
  }

  /** Soft delete. Also removes the document from every external share at once. */
  async remove(id: string): Promise<void> {
    const ctx = requireTenantContext();
    const scope = requireScope(P.DOCUMENT_UPLOAD, ctx);
    requireScope(P.DOCUMENT_READ, ctx);
    await this.prisma.tenantTx(async (tx) => {
      await this.requireDocument(tx, ctx, id, scope);
      await tx.shareDocument.deleteMany({ where: { documentId: id } });
      await tx.document.update({
        where: { id },
        data: { deletedAt: new Date(), checklistItemId: null },
      });
      await this.audit.record(tx, {
        action: 'document.deleted',
        targetType: 'document',
        targetId: id,
      });
    });
  }

  /** Every download is audited before the file is streamed. */
  async download(id: string, versionId?: string): Promise<FileDownload> {
    const ctx = requireTenantContext();
    const scope = requireScope(P.DOCUMENT_DOWNLOAD, ctx);
    const version = await this.prisma.tenantTx(async (tx) => {
      const found = await tx.document.count({
        where: { AND: [{ id, deletedAt: null }, documentScopeWhere(scope, ctx)] },
      });
      if (!found) throw notFound(DOC);
      const v = await tx.documentVersion.findFirst({
        where: { documentId: id, ...(versionId ? { id: versionId } : {}) },
        orderBy: { versionNumber: 'desc' },
        select: {
          storageKey: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true,
          versionNumber: true,
        },
      });
      if (!v) throw notFound('Version');
      await this.audit.record(tx, {
        action: 'document.downloaded',
        targetType: 'document',
        targetId: id,
        metadata: { version: v.versionNumber },
      });
      return v;
    });
    return { ...version, stream: await this.open(version.storageKey) };
  }

  /** Used by external sharing: stream a version already authorized by the caller. */
  async open(key: string): Promise<Readable> {
    try {
      return await this.storage.get(key);
    } catch (error) {
      this.log.error(`Storage read failed: ${(error as Error).message}`);
      throw new AppException(
        503,
        'STORAGE_UNAVAILABLE',
        'The file is not available right now. Try again later.',
      );
    }
  }

  // ───────── helpers ─────────

  private check(file: UploadedFile | undefined) {
    if (!file) throw rejectFile('Choose a file to upload.');
    const result = checkUpload(file.buffer, file.originalname);
    if (!result.ok) throw rejectFile(result.message);
    return { ...result, buffer: file.buffer };
  }

  private async store(key: string, buffer: Buffer, mimeType: string) {
    try {
      await this.storage.put(key, buffer, mimeType);
    } catch (error) {
      this.log.error(`Storage write failed: ${(error as Error).message}`);
      throw new AppException(
        503,
        'STORAGE_UNAVAILABLE',
        'Files cannot be stored right now. Try again later.',
      );
    }
  }

  private async createVersion(
    tx: Tx,
    ctx: TenantContext,
    documentId: string,
    versionNumber: number,
    key: string,
    file: { buffer: Buffer; mimeType: string; fileName: string },
  ) {
    await tx.documentVersion.createMany({
      data: {
        tenantId: ctx.tenantId,
        documentId,
        versionNumber,
        storageKey: key,
        fileName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.buffer.length,
        sha256: sha256(file.buffer),
        uploadedByMembershipId: ctx.membershipId,
      },
    });
  }

  /** The client (and matter, if given) must be within the caller's upload scope. */
  private async resolveTarget(
    tx: Tx,
    ctx: TenantContext,
    scope: ReturnType<typeof requireScope>,
    fields: UploadDocumentInput,
  ): Promise<{ clientId: string; matterId: string | null }> {
    let clientId = fields.clientId;
    let matterId: string | null = null;
    if (fields.matterId) {
      const matter = await tx.matter.findFirst({
        where: { AND: [{ id: fields.matterId }, matterScopeWhere(scope, ctx)] },
        select: { id: true, clientId: true, status: true },
      });
      if (!matter) throw invalidRef('matterId', 'Choose a matter you can work on');
      if (matter.status === 'ARCHIVED') {
        throw new AppException(
          409,
          'MATTER_ARCHIVED',
          'Archived matters cannot get new documents.',
        );
      }
      if (clientId && clientId !== matter.clientId)
        throw invalidRef('clientId', 'The matter belongs to another client');
      clientId = matter.clientId;
      matterId = matter.id;
    } else {
      const client = await tx.client.count({
        where: { AND: [{ id: clientId, deletedAt: null }, clientScopeWhere(scope, ctx)] },
      });
      if (!client) throw invalidRef('clientId', 'Choose a client you can work on');
    }
    if (fields.categoryId)
      await requireReferenceOption(tx, fields.categoryId, 'DOCUMENT_CATEGORY', 'categoryId');
    if (fields.checklistItemId)
      await this.requireChecklistItem(tx, matterId, fields.checklistItemId);
    return { clientId: clientId ?? '', matterId };
  }

  private async requireChecklistItem(tx: Tx, matterId: string | null, itemId: string) {
    const ok = matterId ? await tx.checklistItem.count({ where: { id: itemId, matterId } }) : 0;
    if (!ok) throw invalidRef('checklistItemId', "Choose an item from this matter's checklist");
  }

  private async requireDocument(
    tx: Tx,
    ctx: TenantContext,
    id: string,
    scope: ReturnType<typeof requireScope>,
  ) {
    const doc = await tx.document.findFirst({
      where: { AND: [{ id, deletedAt: null }, documentScopeWhere(scope, ctx)] },
      select: { matterId: true, matter: { select: { status: true } } },
    });
    if (!doc) throw notFound(DOC);
    if (doc.matter?.status === 'ARCHIVED') {
      throw new AppException(
        409,
        'MATTER_ARCHIVED',
        'Documents on archived matters cannot be changed.',
      );
    }
    return doc;
  }

  private async load(tx: Tx, id: string): Promise<DocumentResponse> {
    const row = await tx.document.findUnique({ where: { id }, select: documentSelect });
    if (!row) throw notFound(DOC);
    return toDocument(row);
  }
}
