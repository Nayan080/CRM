'use client';

import {
  MATTER_STATUSES,
  type MatterDetail,
  type MatterStatus,
  type MatterSummary,
} from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { selectClass } from '@/components/forms/select-field';
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
import { Alert, Card } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { ApiError, apiFetch } from '@/lib/api/client';
import { formatDate } from '@/lib/form-values';
import { queryKeys } from '@/lib/queries';
import { useBranches, useMatterTypes } from '@/lib/use-options';
import { usePagedList } from '@/lib/use-paged-list';
import { cn } from '@/lib/utils';
import { ClientPicker } from '../_crm/client-picker';
import { useWorkspace } from '../workspace-context';
import { matterStatusLabel, matterStatusTone } from './matter-status';

function NewMatterForm({ initialClientId }: { initialClientId: string }) {
  const { tenantId, slug, can } = useWorkspace();
  const router = useRouter();
  const queryClient = useQueryClient();
  const types = useMatterTypes(tenantId);
  const branches = useBranches(tenantId, can('branch:read'));
  const [clientId, setClientId] = useState(initialClientId);
  const [matterTypeId, setMatterTypeId] = useState('');
  const [title, setTitle] = useState('');
  const [branchId, setBranchId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!clientId || !matterTypeId || !title.trim()) {
      setError('Choose a client and a matter type, and give a title.');
      return;
    }
    setBusy(true);
    try {
      const created = await apiFetch<MatterDetail>('/api/v1/matters', {
        method: 'POST',
        tenantId,
        body: { clientId, matterTypeId, title, ...(branchId ? { branchId } : {}) },
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.matters(tenantId) });
      router.push(`/w/${slug}/matters/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" noValidate>
      {error ? <Alert>{error}</Alert> : null}
      {initialClientId ? (
        <p className="text-sm text-muted-foreground">For the client you came from.</p>
      ) : (
        <ClientPicker id="matter-client" label="Client" value={clientId} onChange={setClientId} />
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="matter-type">Matter type</Label>
        <select
          id="matter-type"
          className={selectClass}
          value={matterTypeId}
          onChange={(e) => setMatterTypeId(e.target.value)}
        >
          <option value="">Choose…</option>
          {types.data
            ?.filter((t) => t.isActive)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="matter-title">Title</Label>
        <Input
          id="matter-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
        />
      </div>
      {branches.data?.length ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="matter-branch">Branch (default: the client&apos;s branch)</Label>
          <select
            id="matter-branch"
            className={selectClass}
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
          >
            <option value="">Client&apos;s branch</option>
            {branches.data
              .filter((b) => b.isActive)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </select>
        </div>
      ) : null}
      <Button type="submit" disabled={busy}>
        Open matter
      </Button>
    </form>
  );
}

export default function MattersPage() {
  const { tenantId, slug, can } = useWorkspace();
  const params = useSearchParams();
  const forClient = params.get('clientId') ?? '';
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<MatterStatus | ''>('');
  const [mine, setMine] = useState(false);
  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (mine) qs.set('mine', 'true');
  if (forClient) qs.set('clientId', forClient);
  const list = usePagedList<MatterSummary>(
    [...queryKeys.matters(tenantId), qs.toString()],
    qs.toString() ? `/api/v1/matters?${qs.toString()}` : '/api/v1/matters',
    tenantId,
    search,
  );
  if (!can('matter:read')) return <ForbiddenState />;
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Matters</h2>
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Filter by status"
        >
          {(['', ...MATTER_STATUSES] as const).map((s) => (
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
              {s ? matterStatusLabel[s] : 'Not archived'}
            </button>
          ))}
          <label className="ml-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />{' '}
            Assigned to me
          </label>
        </div>
        <SearchBox label="Search matters" onSearch={setSearch} />
        {list.isPending ? <LoadingState /> : null}
        {list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : null}
        {list.isSuccess && rows.length === 0 ? (
          search ? (
            <NoResultsState query={search} />
          ) : (
            <EmptyState title="No matters here" description="Open a matter for a client." />
          )
        ) : null}
        {rows.length ? (
          <ul className="divide-y rounded-md border bg-card">
            {rows.map((x) => (
              <li
                key={x.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="flex min-w-0 flex-col">
                  <Link
                    href={`/w/${slug}/matters/${x.id}`}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {x.reference} · {x.title}
                  </Link>
                  <span className="text-sm text-muted-foreground">
                    {[
                      x.client.displayName,
                      x.type.name,
                      x.stage?.name,
                      x.assignees.map((a) => a.name).join(', ') || 'Unassigned',
                      `Opened ${formatDate(x.openedAt)}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
                <Badge tone={matterStatusTone[x.status]}>{matterStatusLabel[x.status]}</Badge>
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
      {can('matter:create') ? (
        <aside>
          <Card>
            <h2 className="mb-4 text-lg font-semibold">Open a matter</h2>
            <NewMatterForm initialClientId={forClient} />
          </Card>
        </aside>
      ) : null}
    </div>
  );
}
