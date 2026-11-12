import { z } from 'zod';
import {
  nullableDate,
  nullableEmail,
  nullableText,
  nullableUrl,
  timeZoneSchema,
  uuidSchema,
} from './common.js';
import { REFERENCE_CATEGORIES, type ReferenceCategory } from './reference-defaults.js';

const requiredName = (label: string, max = 150) =>
  z
    .string({ message: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(max);

/** Required pick from a list (a select box sends '' when nothing is chosen). */
const requiredRef = z.uuid({ message: 'Choose a value from the list' });

const nullableTimeZone = z
  .union([z.literal(''), z.null(), timeZoneSchema])
  .optional()
  .transform((value) => (value === '' ? null : value));

// ───────── Branches ─────────

export const createBranchSchema = z.object({
  name: requiredName('Branch name', 100),
  addressLine: nullableText(200),
  city: nullableText(100),
  region: nullableText(100),
  postcode: nullableText(20),
  phone: nullableText(40),
  timezone: nullableTimeZone,
});
export const updateBranchSchema = createBranchSchema.partial().extend({
  isActive: z.boolean().optional(),
});
export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;

export interface BranchResponse {
  id: string;
  name: string;
  addressLine: string | null;
  city: string | null;
  region: string | null;
  postcode: string | null;
  phone: string | null;
  timezone: string | null;
  isActive: boolean;
  memberCount: number;
}

// ───────── Reference options (configurable lists) ─────────

export const referenceCategorySchema = z.enum(REFERENCE_CATEGORIES);
export const referenceListQuerySchema = z.object({ category: referenceCategorySchema });
export const createReferenceOptionSchema = z.object({
  category: referenceCategorySchema,
  name: requiredName('Name', 80),
});
export const updateReferenceOptionSchema = z
  .object({ name: requiredName('Name', 80).optional(), isActive: z.boolean().optional() })
  .refine((v) => v.name !== undefined || v.isActive !== undefined, {
    message: 'Provide name and/or isActive',
  });
export type CreateReferenceOptionInput = z.infer<typeof createReferenceOptionSchema>;
export type UpdateReferenceOptionInput = z.infer<typeof updateReferenceOptionSchema>;

export interface ReferenceOptionResponse {
  id: string;
  category: ReferenceCategory;
  key: string;
  name: string;
  isActive: boolean;
}

// ───────── Partner organizations and contacts ─────────

export const createPartnerSchema = z.object({
  name: requiredName('Organization name'),
  typeId: requiredRef,
  website: nullableUrl,
  email: nullableEmail,
  phone: nullableText(40),
  notes: nullableText(2000),
});
export const updatePartnerSchema = createPartnerSchema.partial();
export type CreatePartnerInput = z.infer<typeof createPartnerSchema>;
export type UpdatePartnerInput = z.infer<typeof updatePartnerSchema>;

export const createPartnerContactSchema = z.object({
  fullName: requiredName('Full name'),
  email: nullableEmail,
  phone: nullableText(40),
  position: nullableText(100),
});
export const updatePartnerContactSchema = createPartnerContactSchema.partial();
export type CreatePartnerContactInput = z.infer<typeof createPartnerContactSchema>;
export type UpdatePartnerContactInput = z.infer<typeof updatePartnerContactSchema>;

export interface PartnerContactResponse {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  position: string | null;
}

export interface PartnerSummary {
  id: string;
  name: string;
  type: { id: string; name: string };
  website: string | null;
  email: string | null;
  phone: string | null;
  contactCount: number;
}

export interface PartnerDetail extends PartnerSummary {
  notes: string | null;
  contacts: PartnerContactResponse[];
}

// ───────── Professional profiles and credentials ─────────

export const createProfessionalSchema = z.object({
  fullName: requiredName('Full name'),
  professionTypeId: requiredRef,
  email: nullableEmail,
  phone: nullableText(40),
  organizationName: nullableText(150),
  partnerOrgId: z
    .union([z.literal(''), z.null(), uuidSchema])
    .optional()
    .transform((value) => (value === '' ? null : value)),
  notes: nullableText(2000),
});
export const updateProfessionalSchema = createProfessionalSchema.partial();
export type CreateProfessionalInput = z.infer<typeof createProfessionalSchema>;
export type UpdateProfessionalInput = z.infer<typeof updateProfessionalSchema>;

const credentialFields = {
  credentialType: requiredName('Credential type', 100),
  issuer: requiredName('Issuer', 150),
  identifier: requiredName('Registration / licence number', 100),
  issuedOn: nullableDate,
  expiresOn: nullableDate,
};
const datesInOrder = (v: { issuedOn?: string | null; expiresOn?: string | null }) =>
  !v.issuedOn || !v.expiresOn || v.expiresOn >= v.issuedOn;
const datesMessage = { path: ['expiresOn'], message: 'Expiry date must be after the issue date' };

export const createCredentialSchema = z.object(credentialFields).refine(datesInOrder, datesMessage);
export const updateCredentialSchema = z
  .object(credentialFields)
  .partial()
  .refine(datesInOrder, datesMessage);
export type CreateCredentialInput = z.infer<typeof createCredentialSchema>;
export type UpdateCredentialInput = z.infer<typeof updateCredentialSchema>;

export const VERIFICATION_STATUSES = ['UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** Recording a verification decision. A note says what was checked (e.g. register lookup + date). */
export const verifyCredentialSchema = z.object({
  status: z.enum(VERIFICATION_STATUSES),
  note: nullableText(500),
});
export type VerifyCredentialInput = z.infer<typeof verifyCredentialSchema>;

export interface CredentialResponse {
  id: string;
  credentialType: string;
  issuer: string;
  identifier: string;
  issuedOn: string | null;
  expiresOn: string | null;
  /** What a person recorded. */
  status: VerificationStatus;
  /** True when the expiry date has passed — shown regardless of `status`. */
  isExpired: boolean;
  verifiedAt: string | null;
  verificationNote: string | null;
}

export interface ProfessionalSummary {
  id: string;
  fullName: string;
  professionType: { id: string; name: string };
  email: string | null;
  phone: string | null;
  organizationName: string | null;
  partnerOrg: { id: string; name: string } | null;
  credentialCount: number;
}

export interface ProfessionalDetail extends ProfessionalSummary {
  notes: string | null;
  credentials: CredentialResponse[];
}
