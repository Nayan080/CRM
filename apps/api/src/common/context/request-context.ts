import { AsyncLocalStorage } from 'node:async_hooks';
import type { PermissionScope } from '@crm/permissions';

export interface Grant {
  permission: string;
  scope: PermissionScope;
}

/**
 * Per-request security context. Filled step by step by the guards:
 * AuthGuard → user + session; TenantGuard → verified tenant + membership + grants.
 * Never trust a value here that a guard did not set from verified data.
 */
export interface RequestContextStore {
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  userId?: string;
  sessionId?: string;
  sessionMfaVerified?: boolean;
  tenantId?: string;
  membershipId?: string;
  membershipKind?: 'STAFF' | 'EXTERNAL';
  roleKey?: string | null;
  grants?: Grant[];
  /** Branches the member works in (used by BRANCH-scoped permissions). */
  branchIds?: string[];
}

const storage = new AsyncLocalStorage<RequestContextStore>();

export const RequestContext = {
  run<T>(store: RequestContextStore, fn: () => T): T {
    return storage.run(store, fn);
  },
  get(): RequestContextStore | undefined {
    return storage.getStore();
  },
  /** Current store; throws if called outside a request (a programming error). */
  require(): RequestContextStore {
    const store = storage.getStore();
    if (!store) throw new Error('No request context');
    return store;
  },
};

export interface TenantContext extends RequestContextStore {
  userId: string;
  tenantId: string;
  membershipId: string;
  membershipKind: 'STAFF' | 'EXTERNAL';
  grants: Grant[];
  branchIds: string[];
}

/** For tenant-scoped code paths. Throws (500) if TenantGuard did not run — fail closed. */
export function requireTenantContext(): TenantContext {
  const ctx = RequestContext.get();
  if (!ctx?.tenantId || !ctx.userId || !ctx.membershipId || !ctx.membershipKind || !ctx.grants) {
    throw new Error('Tenant context is required but missing');
  }
  ctx.branchIds ??= [];
  return ctx as TenantContext;
}

export function requireUserId(): string {
  const userId = RequestContext.get()?.userId;
  if (!userId) throw new Error('Authenticated user is required but missing');
  return userId;
}
