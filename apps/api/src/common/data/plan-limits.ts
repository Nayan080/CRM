import { AppException } from '../errors/app-exception.js';
import type { Tx } from '../../infra/prisma/prisma.service.js';

/**
 * Staff-user limit from the agency's plan (assigned by a platform admin; null = no limit).
 * Seats used = ACTIVE staff members + pending staff invitations (an invitation reserves a seat).
 * On acceptance, the invitation's own seat is excluded. EXTERNAL collaborators never count.
 * Runs with the tenant's RLS context.
 */
export async function assertStaffSeatAvailable(
  tx: Tx,
  tenantId: string,
  opts: { includePending: boolean; excludeInvitationId?: string },
): Promise<void> {
  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: { plan: { select: { maxStaffUsers: true } } },
  });
  const max = tenant?.plan?.maxStaffUsers;
  if (max === null || max === undefined) return;
  const active = await tx.membership.count({
    where: { tenantId, kind: 'STAFF', status: 'ACTIVE' },
  });
  const pending = opts.includePending
    ? await tx.invitation.count({
        where: {
          tenantId,
          kind: 'STAFF',
          status: 'PENDING',
          expiresAt: { gt: new Date() },
          ...(opts.excludeInvitationId ? { id: { not: opts.excludeInvitationId } } : {}),
        },
      })
    : 0;
  if (active + pending >= max) {
    throw new AppException(
      409,
      'PLAN_LIMIT_REACHED',
      `Your plan allows ${max} staff user${max === 1 ? '' : 's'}${
        opts.includePending ? ' (pending invitations count)' : ''
      }. Remove someone or ask the platform administrator to change the plan.`,
    );
  }
}
