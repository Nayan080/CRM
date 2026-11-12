import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ROLE_TEMPLATES, ROLE_TEMPLATES_VERSION } from '@crm/permissions';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service.js';

/**
 * Keeps every workspace's system roles identical to ROLE_TEMPLATES. System roles are not editable
 * by agencies, so re-applying them is safe. Only workspaces on an older template version are touched.
 */
@Injectable()
export class RoleSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RoleSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Best effort: the API must still start when the database is down (TenantGuard syncs lazily). */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const count = await this.syncOutdated();
      if (count > 0) this.logger.log(`Updated system roles in ${count} workspace(s)`);
    } catch (error) {
      this.logger.warn({ err: error }, 'System role sync skipped at start-up');
    }
  }

  async syncOutdated(): Promise<number> {
    // The tenants table has no RLS; role tables are written inside each tenant's own context.
    const outdated = await this.prisma.systemTx({}, (tx) =>
      tx.tenant.findMany({
        where: { rolesVersion: { lt: ROLE_TEMPLATES_VERSION } },
        select: { id: true },
      }),
    );
    for (const { id } of outdated) {
      await this.prisma.systemTx({ tenantId: id }, (tx) => applyRoleTemplates(tx, id));
    }
    return outdated.length;
  }
}

/**
 * Creates missing system roles and makes their permissions match the templates exactly.
 * Idempotent; safe to run concurrently for the same workspace.
 */
export async function applyRoleTemplates(tx: Tx, tenantId: string): Promise<Map<string, string>> {
  const roleIds = new Map<string, string>();
  for (const template of ROLE_TEMPLATES) {
    const role = await tx.role.upsert({
      where: { tenantId_key: { tenantId, key: template.key } },
      create: {
        tenantId,
        key: template.key,
        name: template.name,
        isSystem: true,
        requiresMfa: template.requiresMfa,
      },
      update: { name: template.name, requiresMfa: template.requiresMfa },
      select: { id: true },
    });
    roleIds.set(template.key, role.id);

    const wanted = new Map(template.grants.map((g) => [g.permission as string, g.scope]));
    const current = await tx.rolePermission.findMany({
      where: { roleId: role.id },
      select: { id: true, permission: true, scope: true },
    });
    const stale = current.filter((p) => !wanted.has(p.permission)).map((p) => p.id);
    if (stale.length) await tx.rolePermission.deleteMany({ where: { id: { in: stale } } });
    for (const p of current) {
      const scope = wanted.get(p.permission);
      if (scope && scope !== p.scope) {
        await tx.rolePermission.update({ where: { id: p.id }, data: { scope } });
      }
    }
    const have = new Set(current.map((p) => p.permission));
    const missing = [...wanted].filter(([permission]) => !have.has(permission));
    if (missing.length) {
      await tx.rolePermission.createMany({
        data: missing.map(([permission, scope]) => ({
          tenantId,
          roleId: role.id,
          permission,
          scope,
        })),
        skipDuplicates: true, // concurrent first requests may sync the same workspace
      });
    }
  }
  await tx.tenant.update({
    where: { id: tenantId },
    data: { rolesVersion: ROLE_TEMPLATES_VERSION },
  });
  return roleIds;
}
