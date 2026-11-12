import type { Paginated } from '@crm/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { apiFetch } from './api/client';

/** Cursor-paginated list with optional search text ("Load more" pattern). */
export function usePagedList<T>(
  key: readonly unknown[],
  path: string,
  tenantId: string,
  search: string,
) {
  return useInfiniteQuery({
    queryKey: [...key, search],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '25' });
      if (search) params.set('q', search);
      if (pageParam) params.set('cursor', pageParam);
      return apiFetch<Paginated<T>>(
        `${path}${path.includes('?') ? '&' : '?'}${params.toString()}`,
        {
          tenantId,
        },
      );
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}
