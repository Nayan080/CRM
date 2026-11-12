import type {
  BranchResponse,
  MatterTypeResponse,
  ReferenceCategory,
  ReferenceOptionResponse,
} from '@crm/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api/client';
import { queryKeys } from './queries';

/** Values of a tenant-configurable list (profession types, partner types). */
export function useReferenceOptions(tenantId: string, category: ReferenceCategory, enabled = true) {
  return useQuery({
    queryKey: queryKeys.options(tenantId, category),
    queryFn: () =>
      apiFetch<ReferenceOptionResponse[]>(`/api/v1/reference-options?category=${category}`, {
        tenantId,
      }),
    enabled,
  });
}

export function useBranches(tenantId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.branches(tenantId),
    queryFn: () => apiFetch<BranchResponse[]>('/api/v1/branches', { tenantId }),
    enabled,
  });
}

export function useMatterTypes(tenantId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.matterTypes(tenantId),
    queryFn: () => apiFetch<MatterTypeResponse[]>('/api/v1/matter-types', { tenantId }),
    enabled,
  });
}
