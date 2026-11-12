'use client';

import type { ProfessionalSummary } from '@crm/contracts';
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
import { ProfessionalForm } from './professional-form';

export default function ProfessionalsPage() {
  const { tenantId, slug, can } = useWorkspace();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const allowed = can('directory:read');
  const list = usePagedList<ProfessionalSummary>(
    queryKeys.professionals(tenantId),
    '/api/v1/professionals',
    tenantId,
    search,
  );

  if (!allowed) return <ForbiddenState />;
  const rows = list.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Professional directory</h2>
        <p className="text-sm text-muted-foreground">
          People your agency works with. A profile is not a login and does not confirm that someone
          is authorised to give migration or legal advice.
        </p>
        <SearchBox label="Search professionals" onSearch={setSearch} />
        {list.isPending ? <LoadingState /> : null}
        {list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : null}
        {list.isSuccess && rows.length === 0 ? (
          search ? (
            <NoResultsState query={search} />
          ) : (
            <EmptyState
              title="No professionals yet"
              description="Add agents, lawyers, accountants and other professionals."
            />
          )
        ) : null}
        {rows.length ? (
          <ul className="divide-y rounded-md border bg-card">
            {rows.map((pro) => (
              <li
                key={pro.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="flex min-w-0 flex-col">
                  <Link
                    href={`/w/${slug}/professionals/${pro.id}`}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {pro.fullName}
                  </Link>
                  <span className="text-sm text-muted-foreground">
                    {pro.professionType.name}
                    {pro.partnerOrg
                      ? ` · ${pro.partnerOrg.name}`
                      : pro.organizationName
                        ? ` · ${pro.organizationName}`
                        : ''}
                  </span>
                </div>
                <span className="text-sm text-muted-foreground">
                  {pro.credentialCount} {pro.credentialCount === 1 ? 'credential' : 'credentials'}
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
      {can('directory:manage') ? (
        <aside>
          <Card>
            <h2 className="mb-4 text-lg font-semibold">Add a professional</h2>
            <ProfessionalForm
              onSaved={() =>
                void queryClient.invalidateQueries({ queryKey: queryKeys.professionals(tenantId) })
              }
            />
          </Card>
        </aside>
      ) : null}
    </div>
  );
}
