'use client';

import { LEAD_STATUSES, type LeadStatus, type LeadSummary } from '@crm/contracts';
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
import { formatDate } from '@/lib/form-values';
import { queryKeys } from '@/lib/queries';
import { usePagedList } from '@/lib/use-paged-list';
import { cn } from '@/lib/utils';
import { useWorkspace } from '../workspace-context';
import { LeadForm } from './lead-form';
import { leadStatusLabel, leadStatusTone } from './lead-status';

export default function LeadsPage() {
  const { tenantId, slug, can } = useWorkspace();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<LeadStatus | ''>('OPEN');
  const list = usePagedList<LeadSummary>(
    [...queryKeys.leads(tenantId), status],
    status ? `/api/v1/leads?status=${status}` : '/api/v1/leads',
    tenantId,
    search,
  );
  if (!can('lead:read')) return <ForbiddenState />;
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Leads & enquiries</h2>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
          {(['', ...LEAD_STATUSES] as const).map((s) => (
            <button
              key={s || 'all'}
              type="button"
              aria-pressed={status === s}
              onClick={() => setStatus(s)}
              className={cn(
                'rounded-md border px-3 py-1 text-sm',
                status === s ? 'bg-primary text-primary-foreground' : 'bg-card',
              )}
            >
              {s ? leadStatusLabel[s] : 'All'}
            </button>
          ))}
        </div>
        <SearchBox label="Search leads" onSearch={setSearch} />
        {list.isPending ? <LoadingState /> : null}
        {list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : null}
        {list.isSuccess && rows.length === 0 ? (
          search ? (
            <NoResultsState query={search} />
          ) : (
            <EmptyState title="No leads here" description="New enquiries appear here." />
          )
        ) : null}
        {rows.length ? (
          <ul className="divide-y rounded-md border bg-card">
            {rows.map((l) => (
              <li
                key={l.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="flex min-w-0 flex-col">
                  <Link
                    href={`/w/${slug}/leads/${l.id}`}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {l.fullName}
                  </Link>
                  <span className="text-sm text-muted-foreground">
                    {[
                      l.source?.name,
                      l.referredBy ? `via ${l.referredBy.name}` : null,
                      l.owner?.name ?? 'Unassigned',
                      formatDate(l.createdAt),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
                <Badge tone={leadStatusTone[l.status]}>{leadStatusLabel[l.status]}</Badge>
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
      {can('lead:create') ? (
        <aside>
          <Card>
            <h2 className="mb-4 text-lg font-semibold">Add a lead</h2>
            <LeadForm
              onSaved={(lead) => {
                void queryClient.invalidateQueries({ queryKey: queryKeys.leads(tenantId) });
                router.push(`/w/${slug}/leads/${lead.id}`);
              }}
            />
          </Card>
        </aside>
      ) : null}
    </div>
  );
}
