'use client';

import type { PartnerSummary } from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { SearchBox } from '@/components/search-box';
import {
  EmptyState,
  ErrorState,
  ForbiddenState,
  LoadingState,
  NoResultsState,
} from '@/components/states/state-view';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { queryKeys } from '@/lib/queries';
import { usePagedList } from '@/lib/use-paged-list';
import { useWorkspace } from '../workspace-context';
import { PartnerForm } from './partner-form';

export default function PartnersPage() {
  const { tenantId, slug, can } = useWorkspace();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const allowed = can('directory:read');
  const list = usePagedList<PartnerSummary>(
    queryKeys.partners(tenantId),
    '/api/v1/partners',
    tenantId,
    search,
  );

  if (!allowed) return <ForbiddenState />;
  const rows = list.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Partner organizations</h2>
        <p className="text-sm text-muted-foreground">
          A directory of outside businesses. Listing a partner here does not give them access to
          your data.
        </p>
        <SearchBox label="Search partners" onSearch={setSearch} />
        {list.isPending ? <LoadingState /> : null}
        {list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : null}
        {list.isSuccess && rows.length === 0 ? (
          search ? (
            <NoResultsState query={search} />
          ) : (
            <EmptyState
              title="No partners yet"
              description="Add referral agencies, law firms, employers and other partners."
            />
          )
        ) : null}
        {rows.length ? (
          <ul className="divide-y rounded-md border bg-card">
            {rows.map((partner) => (
              <li
                key={partner.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="flex min-w-0 flex-col">
                  <Link
                    href={`/w/${slug}/partners/${partner.id}`}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {partner.name}
                  </Link>
                  <span className="text-sm text-muted-foreground">
                    {partner.type.name} · {partner.contactCount}{' '}
                    {partner.contactCount === 1 ? 'contact' : 'contacts'}
                  </span>
                </div>
                <span className="truncate text-sm text-muted-foreground">
                  {partner.email ?? partner.phone ?? ''}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {list.hasNextPage ? (
          <div>
            <Button
              variant="outline"
              onClick={() => void list.fetchNextPage()}
              disabled={list.isFetchingNextPage}
            >
              {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        ) : null}
      </section>
      {can('partner:manage') ? (
        <aside>
          <Card>
            <h2 className="mb-4 text-lg font-semibold">Add a partner</h2>
            <PartnerForm
              onSaved={() =>
                void queryClient.invalidateQueries({ queryKey: queryKeys.partners(tenantId) })
              }
            />
          </Card>
        </aside>
      ) : null}
    </div>
  );
}
