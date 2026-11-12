import { Injectable } from '@nestjs/common';
import type {
  UpdateTenantInput,
  CreateTenantInput,
  TenantResponse,
  WorkspaceAccessResponse,
  WorkspaceSummary,
} from '@crm/contracts';
import { OWNER_ROLE_KEY, ROLE_TEMPLATES } from '@crm/permissions';
import { requireTenantContext, requireUserId } from '../../common/context/request-context.js';
import { AppException } from '../../common/errors/app-exception.js';
import {
  PrismaService,
  isUniqueViolation,
  setRlsTenant,
} from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { applyRoleTemplates } from './role-sync.service.js';
import { seedMatterTypeDefaults } from '../matters/matter-defaults.js';
import { ReferenceService } from '../reference/reference.service.js';

function toTenantResponse(t: TenantResponse): TenantResponse {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    country: t.country,
    timezone: t.timezone,
    legalName: t.legalName,
    phone: t.phone,
    contactEmail: t.contactEmail,
    website: t.website,
    addressLine: t.addressLine,
    city: t.city,
    region: t.region,
    postcode: t.postcode,
  };
}

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly reference: ReferenceService,
  ) {}

  /**
   * Creates a workspace: tenant + the 9 system roles (copied from templates) + the caller as OWNER.
   * One transaction: all or nothing. Public registration can never create platform admins.
   */
  async create(input: CreateTenantInput): Promise<WorkspaceSummary> {
    const userId = requireUserId();
    try {
      return await this.prisma.systemTx({ userId }, async (tx) => {
        const user = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { emailVerifiedAt: true, mfaEnabledAt: true },
        });
        if (!user.emailVerifiedAt) {
          throw new AppException(403, 'EMAIL_NOT_VERIFIED', 'Verify your email address first.');
        }

        const tenant = await tx.tenant.create({ data: { name: input.name, slug: input.slug } });
        // From here on, RLS allows writes for this new tenant only.
        await setRlsTenant(tx, tenant.id);
        const roleIds = await applyRoleTemplates(tx, tenant.id);
        const ownerRoleId = roleIds.get(OWNER_ROLE_KEY) ?? '';
        await this.reference.seedDefaults(tx, tenant.id);
        await seedMatterTypeDefaults(tx, tenant.id);
        await tx.membership.create({
          data: { tenantId: tenant.id, userId, roleId: ownerRoleId, kind: 'STAFF' },
        });
        await this.audit.record(tx, {
          action: 'tenant.created',
          tenantId: tenant.id,
          targetType: 'tenant',
          targetId: tenant.id,
          metadata: { slug: tenant.slug },
        });
        const ownerTemplate = ROLE_TEMPLATES.find((r) => r.key === OWNER_ROLE_KEY);
        return {
          tenantId: tenant.id,
          slug: tenant.slug,
          name: tenant.name,
          kind: 'STAFF' as const,
          role: { key: OWNER_ROLE_KEY, name: ownerTemplate?.name ?? 'Owner', requiresMfa: true },
          mfaSetupRequired: !user.mfaEnabledAt,
          status: 'ACTIVE',
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppException(409, 'SLUG_TAKEN', 'That workspace address is already taken.', [
          { path: 'slug', message: 'Already taken' },
        ]);
      }
      throw error;
    }
  }

  async current(): Promise<TenantResponse> {
    const { tenantId } = requireTenantContext();
    const tenant = await this.prisma.tenantTx((tx) =>
      tx.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
    );
    return toTenantResponse(tenant);
  }

  async update(input: UpdateTenantInput): Promise<TenantResponse> {
    const { tenantId } = requireTenantContext();
    const tenant = await this.prisma.tenantTx(async (tx) => {
      const updated = await tx.tenant.update({ where: { id: tenantId }, data: input });
      await this.audit.record(tx, {
        action: 'tenant.updated',
        targetType: 'tenant',
        targetId: tenantId,
      });
      return updated;
    });
    return toTenantResponse(tenant);
  }

  /** The caller's own access in this workspace (no permission needed; external members too). */
  async access(): Promise<WorkspaceAccessResponse> {
    const ctx = requireTenantContext();
    return this.prisma.tenantTx(async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
      const role = ctx.roleKey
        ? await tx.role.findUnique({
            where: { tenantId_key: { tenantId: ctx.tenantId, key: ctx.roleKey } },
            select: { key: true, name: true, requiresMfa: true },
          })
        : null;
      return {
        tenant: toTenantResponse(tenant),
        membershipId: ctx.membershipId,
        kind: ctx.membershipKind,
        role,
        permissions: ctx.grants.map((g) => ({ permission: g.permission, scope: g.scope })),
      };
    });
  }
}
