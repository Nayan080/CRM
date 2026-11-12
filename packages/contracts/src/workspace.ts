import { z } from 'zod';
import { emailSchema, passwordSchema, personNameSchema, tokenSchema } from './auth.js';
import { nullableEmail, nullableText, nullableUrl, timeZoneSchema, uuidSchema } from './common.js';

const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'app',
  'auth',
  'login',
  'logout',
  'platform',
  'register',
  'settings',
  'shared',
  'status',
  'support',
  'www',
  'w',
]);

export const tenantSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Use at least 3 characters')
  .max(40, 'Use at most 40 characters')
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    'Use lowercase letters, numbers and hyphens (not at the start or end)',
  )
  .refine((slug) => !RESERVED_SLUGS.has(slug), 'This address is reserved');

export const tenantNameSchema = z
  .string()
  .trim()
  .min(2, 'Use at least 2 characters')
  .max(100, 'Use at most 100 characters');

export const createTenantSchema = z.object({
  name: tenantNameSchema,
  slug: tenantSlugSchema,
});

/** Agency profile. All fields optional: send only what changes. */
export const updateTenantSchema = z
  .object({
    name: tenantNameSchema,
    legalName: nullableText(150),
    phone: nullableText(40),
    contactEmail: nullableEmail,
    website: nullableUrl,
    addressLine: nullableText(200),
    city: nullableText(100),
    region: nullableText(100),
    postcode: nullableText(20),
    timezone: timeZoneSchema,
  })
  .partial();
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

const branchIdsSchema = z.array(uuidSchema).max(50);

export const MEMBERSHIP_KINDS = ['STAFF', 'EXTERNAL'] as const;
export type MembershipKind = (typeof MEMBERSHIP_KINDS)[number];

export const roleKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z_]{1,40}$/, 'Invalid role');

/** STAFF invites need a role. EXTERNAL invites never get a role (DEC-09). */
export const createInvitationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('STAFF'),
    email: emailSchema,
    roleKey: roleKeySchema,
    branchIds: branchIdsSchema.optional(),
  }),
  z.object({ kind: z.literal('EXTERNAL'), email: emailSchema }),
]);

export const updateMemberSchema = z
  .object({
    roleKey: roleKeySchema.optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
    /** Replaces the member's branch list. */
    branchIds: branchIdsSchema.optional(),
  })
  .refine((v) => v.roleKey !== undefined || v.status !== undefined || v.branchIds !== undefined, {
    message: 'Provide roleKey, status and/or branchIds',
  });

export const acceptInvitationNewUserSchema = z.object({
  token: tokenSchema,
  name: personNameSchema,
  password: passwordSchema,
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type AcceptInvitationNewUserInput = z.infer<typeof acceptInvitationNewUserSchema>;

// ───────── Responses ─────────

export interface RoleSummary {
  key: string;
  name: string;
  requiresMfa: boolean;
}

export interface TenantResponse {
  id: string;
  slug: string;
  name: string;
  country: string;
  timezone: string;
  legalName: string | null;
  phone: string | null;
  contactEmail: string | null;
  website: string | null;
  addressLine: string | null;
  city: string | null;
  region: string | null;
  postcode: string | null;
}

export interface WorkspaceSummary {
  tenantId: string;
  slug: string;
  name: string;
  kind: MembershipKind;
  role: RoleSummary | null;
  /** True when this workspace needs MFA and the user has not enabled it yet. */
  mfaSetupRequired: boolean;
  /** SUSPENDED / PENDING_DELETION workspaces are listed but cannot be opened. */
  status: 'ACTIVE' | 'SUSPENDED' | 'PENDING_DELETION';
}

/** The caller's access in the active workspace (for showing/hiding UI; the API re-checks). */
export interface WorkspaceAccessResponse {
  tenant: TenantResponse;
  membershipId: string;
  kind: MembershipKind;
  role: RoleSummary | null;
  permissions: { permission: string; scope: 'OWN' | 'BRANCH' | 'TENANT' }[];
}

export interface MemberSummary {
  id: string;
  userId: string;
  name: string;
  email: string;
  kind: MembershipKind;
  status: 'ACTIVE' | 'SUSPENDED' | 'REMOVED';
  role: RoleSummary | null;
  branches: { id: string; name: string }[];
  joinedAt: string;
}

export interface InvitationSummary {
  id: string;
  email: string;
  kind: MembershipKind;
  role: RoleSummary | null;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  branchIds: string[];
  expiresAt: string;
  createdAt: string;
}

export interface InvitationPreviewResponse {
  tenantName: string;
  email: string;
  kind: MembershipKind;
  role: RoleSummary | null;
  expiresAt: string;
  /** Whether an account with this email already exists (decides login vs sign-up on the page). */
  accountExists: boolean;
}
