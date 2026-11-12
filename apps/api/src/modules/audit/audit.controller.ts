import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@crm/permissions';
import { RequirePermission, TenantScoped } from '../../common/auth/decorators.js';
import { requireTenantContext } from '../../common/context/request-context.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

export interface AuditLogEntry {
  id: string;
  action: string;
  actorUserId: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  createdAt: string;
}

/** Latest workspace audit events (Owner/Admin). Pagination and filters come with the audit UI. */
@ApiTags('audit')
@TenantScoped()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission(PERMISSIONS.AUDIT_READ, 'TENANT')
  async list(): Promise<AuditLogEntry[]> {
    requireTenantContext();
    const rows = await this.prisma.tenantTx((tx) =>
      tx.auditLog.findMany({ orderBy: { id: 'desc' }, take: 100 }),
    );
    return rows.map((r) => ({
      id: r.id.toString(),
      action: r.action,
      actorUserId: r.actorUserId,
      targetType: r.targetType,
      targetId: r.targetId,
      metadata: r.metadata,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
