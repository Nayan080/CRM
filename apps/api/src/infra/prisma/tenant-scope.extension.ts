import { Prisma } from '@crm/db';
import { RequestContext } from '../../common/context/request-context.js';

/** Prisma models that belong to one tenant. Every query on them is forced into the active tenant. */
export const TENANT_MODELS = new Set([
  'Role',
  'RolePermission',
  'Membership',
  'Invitation',
  'AuditLog',
  'Branch',
  'MembershipBranch',
  'ReferenceOption',
  'PartnerOrganization',
  'PartnerContact',
  'ProfessionalProfile',
  'Credential',
  'TenantCounter',
  'Lead',
  'Client',
  'ClientRelationship',
  'Activity',
  'Appointment',
  'MatterType',
  'MatterStage',
  'ChecklistTemplateItem',
  'Matter',
  'MatterAssignment',
  'MatterParticipant',
  'MatterDeadline',
  'ChecklistItem',
  'MatterStatusHistory',
  'Task',
  'Document',
  'DocumentVersion',
  'Consent',
  'ResourceShare',
  'ShareDocument',
  'StageTaskTemplate',
  'DeadlineReminderLog',
]);

const UNIQUE_WHERE_OPS = new Set(['findUnique', 'findUniqueOrThrow', 'update', 'delete', 'upsert']);
const FILTER_OPS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'updateManyAndReturn',
  'deleteMany',
]);

type Args = Record<string, unknown> & {
  where?: Record<string, unknown>;
  data?: Record<string, unknown> | Record<string, unknown>[];
  create?: Record<string, unknown>;
};

function withTenantData(data: Record<string, unknown>, tenantId: string, model: string) {
  if (data.tenantId !== undefined && data.tenantId !== tenantId) {
    throw new Error(`Cross-tenant write blocked on ${model}`);
  }
  return { ...data, tenantId };
}

/**
 * Isolation layer 3 (docs/ARCHITECTURE.md §8): adds `tenantId = <active tenant>` to every query
 * on tenant-owned models, so a forgotten filter cannot leak or modify another tenant's data.
 * Lookups by id then return "not found" for other tenants' ids (no IDOR/BOLA).
 * Row-Level Security in PostgreSQL is the independent backstop (layer 4).
 */
export const tenantScopeExtension = Prisma.defineExtension({
  name: 'tenant-scope',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!TENANT_MODELS.has(model)) return query(args);

        const tenantId = RequestContext.get()?.tenantId;
        if (!tenantId) {
          throw new Error(`Tenant context required for ${model}.${operation}`);
        }

        const a = { ...(args as Args) };
        if (UNIQUE_WHERE_OPS.has(operation)) {
          a.where = { ...(a.where ?? {}), tenantId };
          if (operation === 'upsert' && a.create)
            a.create = withTenantData(a.create, tenantId, model);
        } else if (FILTER_OPS.has(operation)) {
          a.where = { AND: [a.where ?? {}, { tenantId }] };
        } else if (operation === 'create') {
          a.data = withTenantData((a.data ?? {}) as Record<string, unknown>, tenantId, model);
        } else if (operation === 'createMany' || operation === 'createManyAndReturn') {
          const rows = Array.isArray(a.data) ? a.data : [a.data ?? {}];
          a.data = rows.map((row) => withTenantData(row, tenantId, model));
        } else {
          throw new Error(`Unsupported operation ${model}.${operation} on a tenant model`);
        }
        return query(a);
      },
    },
  },
});
