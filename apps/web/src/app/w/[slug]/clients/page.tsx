'use client';

import type { ClientSummary } from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { SearchBox } from '@/components/search-box';
import {
  EmptyState,
  ErrorState,
  ForbiddenState,
  LoadingState,
  NoResultsState,
} from '@/components/states/state-view';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { queryKeys } from '@/lib/queries';
import { usePagedList } from '@/lib/use-paged-list';
import { useWorkspace } from '../workspace-context';
import { ClientForm } from './client-form';

const kindText = { INDIVIDUAL: 'Individual', BUSINESS: 'Business' } as const;

export default function ClientsPage() {
  const { tenantId, slug, can } = useWorkspace();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const list = usePagedList<ClientSummary>(
    queryKeys.clients(tenantId),
    '/api/v1/clients',
    tenantId,
    search,
  );
  if (!can('client:read')) return <ForbiddenState />;
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Clients</h2>
        <SearchBox label="Search clients" onSearch={setSearch} />
        {list.isPending ? <LoadingState /> : null}
        {list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : null}
        {list.isSuccess && rows.length === 0 ? (
          search ? (
            <NoResultsState query={search} />
          ) : (
            <EmptyState title="No clients yet" description="Convert a lead or add a client." />
          )
        ) : null}
        {rows.length ? (
          <ul className="divide-y rounded-md border bg-card">
            {rows.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="flex min-w-0 flex-col">
                  <Link
                    href={`/w/${slug}/clients/${c.id}`}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {c.displayName}
                  </Link>
                  <span className="text-sm text-muted-foreground">
                    {[c.clientNumber, c.email, c.phone, c.branch?.name].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <Badge>{kindText[c.kind]}</Badge>
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
              Load more
            </Button>
          </div>
        ) : null}
      </section>
      {can('client:create') ? (
        <aside>
          <Card>
            <h2 className="mb-4 text-lg font-semibold">Add a client</h2>
            <ClientForm
              onSaved={(c) => {
                void queryClient.invalidateQueries({ queryKey: queryKeys.clients(tenantId) });
                router.push(`/w/${slug}/clients/${c.id}`);
              }}
            />
          </Card>
        </aside>
      ) : null}
    </div>
  );
}
