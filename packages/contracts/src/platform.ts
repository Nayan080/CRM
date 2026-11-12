import { z } from 'zod';
import { listQuerySchema, nullableText, uuidSchema } from './common.js';

export const PLATFORM_ROLES = ['SUPER_ADMIN', 'SUPPORT'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];
export const TENANT_STATUSES = ['ACTIVE', 'SUSPENDED', 'PENDING_DELETION'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

const limit = z.union([z.number().int().min(1).max(100_000), z.null()]);

export const createPlanSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{1,40}$/, 'Lower-case letters, numbers and dashes'),
  name: z.string().trim().min(1).max(80),
  /** null = no limit. */
  maxStaffUsers: limit,
});
export const updatePlanSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    maxStaffUsers: limit.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

/** Status changes need a reason (kept on the agency and in the audit log). */
export const updatePlatformTenantSchema = z
  .object({
    status: z.enum(TENANT_STATUSES).optional(),
    reason: nullableText(500),
    planId: z.union([uuidSchema, z.null()]).optional(),
  })
  .refine((v) => v.status !== undefined || v.planId !== undefined, 'Give a status or a plan')
  .refine((v) => v.status === undefined || !!v.reason, {
    path: ['reason'],
    message: 'Give a reason',
  });

export const platformTenantListQuerySchema = listQuerySchema.extend({
  status: z.enum(TENANT_STATUSES).optional(),
});

export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
export type UpdatePlatformTenantInput = z.infer<typeof updatePlatformTenantSchema>;
export type PlatformTenantListQuery = z.infer<typeof platformTenantListQuerySchema>;

export interface PlanResponse {
  id: string;
  key: string;
  name: string;
  maxStaffUsers: number | null;
  isActive: boolean;
  tenantCount: number;
}

/** Agency metadata only. Platform admins never see clients, matters or documents. */
export interface PlatformTenantSummary {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  statusReason: string | null;
  statusChangedAt: string | null;
  plan: { id: string; name: string; maxStaffUsers: number | null } | null;
  usage: { staffUsers: number; pendingStaffInvites: number; externalUsers: number };
  createdAt: string;
}
