import type { Tx } from '../../infra/prisma/prisma.service.js';

/**
 * Next number in a per-workspace sequence (e.g. client numbers). Atomic: concurrent callers never
 * get the same value. Runs inside the caller's transaction (and its RLS tenant context).
 */
export async function nextCounter(tx: Tx, tenantId: string, key: string): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO tenant_counters (tenant_id, key, value) VALUES (${tenantId}::uuid, ${key}, 1)
    ON CONFLICT (tenant_id, key) DO UPDATE SET value = tenant_counters.value + 1
    RETURNING value`;
  const value = rows[0]?.value;
  if (!value) throw new Error(`Counter ${key} failed`);
  return value;
}

export function formatNumber(prefix: string, value: number, width = 6): string {
  return `${prefix}-${String(value).padStart(width, '0')}`;
}
