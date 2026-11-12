'use client';

import type { WorkspaceAccessResponse, WorkspaceSummary } from '@crm/contracts';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { type ReactNode, createContext, useContext } from 'react';
import { EmptyState, ErrorState, LoadingState } from '@/components/states/state-view';
import { buttonVariants } from '@/components/ui/button';
import { ApiError, apiFetch } from '@/lib/api/client';
import { queryKeys } from '@/lib/queries';

interface WorkspaceContextValue {
  tenantId: string;
  slug: string;
  access: WorkspaceAccessResponse;
  /** UI convenience only — the API re-checks every permission. */
  can: (permission: string) => boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

/** Resolves the URL slug to a workspace the user belongs to, then loads their access in it. */
export function WorkspaceProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const workspaces = useQuery({
    queryKey: queryKeys.workspaces,
    queryFn: () => apiFetch<WorkspaceSummary[]>('/api/v1/me/workspaces'),
  });
  const workspace = workspaces.data?.find((w) => w.slug === slug);
  const tenantId = workspace?.tenantId;

  const access = useQuery({
    queryKey: queryKeys.access(tenantId ?? 'none'),
    queryFn: () => apiFetch<WorkspaceAccessResponse>('/api/v1/tenant/access', { tenantId }),
    enabled: !!tenantId && !workspace?.mfaSetupRequired,
  });

  if (workspaces.isPending) return <LoadingState />;
  if (workspaces.isError) return <ErrorState onRetry={() => void workspaces.refetch()} />;
  if (!workspace) {
    return (
      <EmptyState
        title="Workspace not found"
        description="It doesn't exist or you don't have access to it."
        action={
          <Link href="/workspaces" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Your workspaces
          </Link>
        }
      />
    );
  }
  if (workspace.mfaSetupRequired) {
    return (
      <EmptyState
        title="Two-factor authentication required"
        description="Your role in this workspace requires two-factor authentication."
        action={
          <Link href="/account/security?required=1" className={buttonVariants({ size: 'sm' })}>
            Set it up
          </Link>
        }
      />
    );
  }
  if (access.isPending) return <LoadingState />;
  if (access.isError) {
    const code = access.error instanceof ApiError ? access.error.code : undefined;
    if (code === 'MFA_REQUIRED') {
      return (
        <EmptyState
          title="Sign in again"
          description="This workspace needs you to sign in with your authenticator code."
          action={
            <Link href="/login" className={buttonVariants({ size: 'sm' })}>
              Sign in
            </Link>
          }
        />
      );
    }
    return <ErrorState onRetry={() => void access.refetch()} />;
  }

  const permissions = new Set(access.data.permissions.map((p) => p.permission));
  const value: WorkspaceContextValue = {
    tenantId: workspace.tenantId,
    slug,
    access: access.data,
    can: (permission) => permissions.has(permission),
  };
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return ctx;
}
