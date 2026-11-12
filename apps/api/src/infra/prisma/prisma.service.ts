import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Prisma, createPrismaClient, type PrismaClient } from '@crm/db';
import { RequestContext, requireTenantContext } from '../../common/context/request-context.js';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { tenantScopeExtension } from './tenant-scope.extension.js';

/** A transaction client. Query extensions don't change types, so both kinds share this type. */
export type Tx = Prisma.TransactionClient;

/** Per-transaction PostgreSQL settings read by Row-Level Security policies. */
export interface RlsSettings {
  tenantId?: string | null;
  userId?: string | null;
  inviteTokenHash?: string | null;
}

const TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

/**
 * The only owner of the database client. All data access goes through a transaction that first
 * sets the RLS settings, so PostgreSQL itself enforces tenant isolation (fail closed: no settings →
 * no tenant rows visible).
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  private readonly base: PrismaClient;
  private readonly scoped;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.base = createPrismaClient({ connectionString: config.databaseUrl });
    this.scoped = this.base.$extends(tenantScopeExtension);
  }

  /**
   * Tenant-scoped work for the current request (after TenantGuard).
   * Queries on tenant models are auto-filtered to the active tenant AND checked by RLS.
   */
  tenantTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const ctx = requireTenantContext();
    return this.scoped.$transaction(async (tx) => {
      await applyRls(tx as unknown as Tx, { tenantId: ctx.tenantId, userId: ctx.userId });
      return fn(tx as unknown as Tx);
    }, TX_OPTIONS);
  }

  /**
   * Identity/cross-tenant flows (login, my workspaces, tenant creation, invitation accept).
   * No automatic tenant filter, but RLS still applies with exactly the settings given here.
   * Keep usage small and reviewed.
   */
  systemTx<T>(settings: RlsSettings, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.base.$transaction(async (tx) => {
      await applyRls(tx, {
        userId: settings.userId ?? RequestContext.get()?.userId ?? null,
        tenantId: settings.tenantId ?? null,
        inviteTokenHash: settings.inviteTokenHash ?? null,
      });
      return fn(tx);
    }, TX_OPTIONS);
  }

  /** Lightweight readiness probe with a hard timeout. */
  async isHealthy(timeoutMs = 2_000): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.base.$queryRaw`SELECT 1`,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Database health check timed out')), timeoutMs);
        }),
      ]);
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.base.$disconnect();
  }
}

/** Sets (or changes, mid-transaction) the RLS settings. `true` = local to this transaction. */
export async function applyRls(tx: Tx, settings: RlsSettings): Promise<void> {
  await tx.$queryRaw`SELECT
    set_config('app.tenant_id', ${settings.tenantId ?? ''}, true),
    set_config('app.user_id', ${settings.userId ?? ''}, true),
    set_config('app.invite_token_hash', ${settings.inviteTokenHash ?? ''}, true)`;
}

/** Switch the RLS tenant inside an open system transaction (e.g. right after creating a tenant). */
export async function setRlsTenant(tx: Tx, tenantId: string): Promise<void> {
  await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
}

/** Stores SQL NULL in a JSON column. */
export const DB_NULL = Prisma.DbNull;

/** True for a unique-constraint violation (e.g. a duplicate slug). */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
