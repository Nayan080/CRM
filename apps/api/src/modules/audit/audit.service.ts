import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context.js';
import { DB_NULL, type Tx } from '../../infra/prisma/prisma.service.js';

export interface AuditEvent {
  action: string;
  /** Defaults to the active tenant; null for tenant-less events (login, password reset). */
  tenantId?: string | null;
  targetType?: string;
  targetId?: string;
  /** Never put secrets, tokens or sensitive personal data here. */
  metadata?: Record<string, string | number | boolean | null>;
  actorUserId?: string | null;
}

/** Append-only audit trail. Written inside the same transaction as the change it describes. */
@Injectable()
export class AuditService {
  async record(tx: Tx, event: AuditEvent): Promise<void> {
    const ctx = RequestContext.get();
    // createMany = INSERT without RETURNING. With RLS, RETURNING would also require the row to pass
    // the SELECT policy, which tenant-less events (login, reset) intentionally don't.
    await tx.auditLog.createMany({
      data: {
        tenantId: event.tenantId === undefined ? (ctx?.tenantId ?? null) : event.tenantId,
        actorUserId: event.actorUserId === undefined ? (ctx?.userId ?? null) : event.actorUserId,
        actorMembershipId: ctx?.membershipId ?? null,
        action: event.action,
        targetType: event.targetType ?? null,
        targetId: event.targetId ?? null,
        requestId: ctx?.requestId ?? null,
        ipAddress: ctx?.ipAddress ?? null,
        metadata: event.metadata ?? DB_NULL,
      },
    });
  }
}
