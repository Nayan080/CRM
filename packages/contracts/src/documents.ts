import { z } from 'zod';
import { listQuerySchema, nullableText, uuidSchema } from './common.js';
import type { NamedRef } from './crm.js';
import type { MatterStatus } from './matters.js';

const name = (max: number) =>
  z.string().trim().min(1, 'Required').max(max, `Use at most ${max} characters`);
const nullableId = z.union([uuidSchema, z.null()]).optional();
const isoDateTime = z.iso.datetime({ offset: true, message: 'Use a full date and time' });
const notEmpty = (v: object) => Object.keys(v).length > 0;

/** Upload rules (decided 2026-11-10). The server checks the file's content, not just its name. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const ALLOWED_UPLOADS = [
  { mimeType: 'application/pdf', extensions: ['pdf'], label: 'PDF' },
  { mimeType: 'image/jpeg', extensions: ['jpg', 'jpeg'], label: 'JPG' },
  { mimeType: 'image/png', extensions: ['png'], label: 'PNG' },
  {
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extensions: ['docx'],
    label: 'DOCX',
  },
] as const;
export const UPLOAD_ACCEPT = ALLOWED_UPLOADS.flatMap((a) => a.extensions.map((e) => `.${e}`)).join(
  ',',
);

// ───────── Documents ─────────

/** Multipart form fields sent with the file. A document belongs to a client and optionally a matter. */
export const uploadDocumentSchema = z
  .object({
    clientId: uuidSchema.optional(),
    matterId: uuidSchema.optional(),
    title: z.string().trim().max(200).optional(),
    categoryId: uuidSchema.optional(),
    checklistItemId: uuidSchema.optional(),
  })
  .refine((v) => v.clientId || v.matterId, 'Give a client or a matter');

export const updateDocumentSchema = z
  .object({ title: name(200).optional(), categoryId: nullableId, checklistItemId: nullableId })
  .refine(notEmpty, 'Nothing to update');

export const documentListQuerySchema = listQuerySchema
  .extend({ clientId: uuidSchema.optional(), matterId: uuidSchema.optional() })
  .refine((v) => !!v.clientId !== !!v.matterId, 'Give exactly one of clientId or matterId');

export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;
export type DocumentListQuery = z.infer<typeof documentListQuerySchema>;

// ───────── Consents ─────────

export const CONSENT_METHODS = ['WRITTEN', 'VERBAL', 'ELECTRONIC'] as const;
export type ConsentMethod = (typeof CONSENT_METHODS)[number];

export const createConsentSchema = z.object({
  clientId: uuidSchema,
  purpose: name(300),
  recipient: nullableText(200),
  method: z.enum(CONSENT_METHODS),
  givenAt: isoDateTime,
  notes: nullableText(2000),
});
export const consentListQuerySchema = z.object({ clientId: uuidSchema });

export type CreateConsentInput = z.infer<typeof createConsentSchema>;
export type ConsentListQuery = z.infer<typeof consentListQuerySchema>;

// ───────── Shares (to EXTERNAL members, DEC-09; consent optional, DEC-14) ─────────

export const createShareSchema = z.object({
  matterId: uuidSchema,
  granteeMembershipId: uuidSchema,
  documentIds: z.array(uuidSchema).max(100).default([]),
  consentId: uuidSchema.optional(),
  purpose: nullableText(300),
  expiresAt: z.union([isoDateTime, z.null()]).optional(),
});
export const updateShareSchema = z
  .object({
    documentIds: z.array(uuidSchema).max(100).optional(),
    expiresAt: z.union([isoDateTime, z.null()]).optional(),
  })
  .refine(notEmpty, 'Nothing to update');
export const shareListQuerySchema = z.object({ matterId: uuidSchema });

export type CreateShareInput = z.infer<typeof createShareSchema>;
export type UpdateShareInput = z.infer<typeof updateShareSchema>;
export type ShareListQuery = z.infer<typeof shareListQuerySchema>;

// ───────── Responses ─────────

export type ScanStatus = 'NOT_SCANNED' | 'CLEAN' | 'INFECTED';

export interface DocumentVersionResponse {
  id: string;
  versionNumber: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  scanStatus: ScanStatus;
  uploadedBy: NamedRef;
  createdAt: string;
}

export interface DocumentResponse {
  id: string;
  title: string;
  category: NamedRef | null;
  client: { id: string; clientNumber: string; displayName: string };
  matter: { id: string; reference: string } | null;
  checklistItem: { id: string; title: string } | null;
  latest: DocumentVersionResponse;
  versions: DocumentVersionResponse[];
  uploadedBy: NamedRef;
  createdAt: string;
  updatedAt: string;
}

export interface ConsentResponse {
  id: string;
  purpose: string;
  recipient: string | null;
  method: ConsentMethod;
  givenAt: string;
  notes: string | null;
  withdrawnAt: string | null;
  recordedBy: NamedRef;
  createdAt: string;
}

export interface ShareResponse {
  id: string;
  matter: { id: string; reference: string; title: string };
  grantee: { id: string; name: string; email: string };
  consent: { id: string; purpose: string; withdrawnAt: string | null } | null;
  purpose: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  /** Not revoked and not expired. */
  active: boolean;
  documents: { id: string; title: string }[];
  createdBy: NamedRef;
  createdAt: string;
}

/** What an EXTERNAL member sees: only the shared matter's basics and the selected documents. */
export interface SharedDocument {
  id: string;
  title: string;
  category: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  updatedAt: string;
}

export interface SharedMatter {
  shareId: string;
  purpose: string | null;
  expiresAt: string | null;
  sharedBy: string;
  matter: {
    reference: string;
    title: string;
    type: string;
    stage: string | null;
    status: MatterStatus;
    clientName: string;
  };
  documents: SharedDocument[];
}
