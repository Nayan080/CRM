'use client';

import {
  TASK_PRIORITIES,
  type MemberSummary,
  type Paginated,
  type TaskResponse,
  type TaskStatus,
} from '@crm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { selectClass } from '@/components/forms/select-field';
import { EmptyState, ErrorState, LoadingState } from '@/components/states/state-view';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { ApiError, apiFetch } from '@/lib/api/client';
import { formatDateTime, localToIso } from '@/lib/form-values';
import { queryKeys } from '@/lib/queries';
import { useWorkspace } from '../workspace-context';

const priorityLabel = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', URGENT: 'Urgent' } as const;
const statusLabel: Record<TaskStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  DONE: 'Done',
  CANCELLED: 'Cancelled',
};

function LinkLabel({ link }: { link: TaskResponse['link'] }) {
  const { slug } = useWorkspace();
  if (!link) return null;
  if ('hidden' in link) return <span> · linked {link.kind} (no access)</span>;
  const path = link.kind === 'matter' ? 'matters' : link.kind === 'client' ? 'clients' : 'leads';
  return (
    <span>
      {' · '}
      <Link
        className="text-primary underline-offset-4 hover:underline"
        href={`/w/${slug}/${path}/${link.id}`}
      >
        {link.label}
      </Link>
    </span>
  );
}

/** Task list with a quick-add form. `matterId` scopes it to one matter. */
export function TasksPanel({
  matterId,
  title = 'Tasks',
  initialFilter = 'active',
}: {
  matterId?: string;
  title?: string;
  initialFilter?: 'active' | 'mine' | 'all';
}) {
  const { tenantId, can } = useWorkspace();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState(initialFilter);
  const qs = new URLSearchParams({ limit: '50' });
  if (matterId) qs.set('matterId', matterId);
  if (filter === 'active') qs.set('active', 'true');
  if (filter === 'mine') {
    qs.set('mine', 'true');
    qs.set('active', 'true');
  }
  const key = [...queryKeys.tasks(tenantId), qs.toString()];
  const list = useQuery({
    queryKey: key,
    queryFn: () =>
      apiFetch<Paginated<TaskResponse>>(`/api/v1/tasks?${qs.toString()}`, { tenantId }),
    enabled: can('task:read'),
  });
  const members = useQuery({
    queryKey: queryKeys.members(tenantId),
    queryFn: () => apiFetch<MemberSummary[]>('/api/v1/members', { tenantId }),
    enabled: can('member:read') && can('task:manage'),
  });
  const [form, setForm] = useState({ title: '', priority: 'MEDIUM', dueAt: '', assignee: '' });
  const [error, setError] = useState<string | null>(null);

  if (!can('task:read')) return null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.tasks(tenantId) });
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
      return false;
    }
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    const ok = await run(() =>
      apiFetch('/api/v1/tasks', {
        method: 'POST',
        tenantId,
        body: {
          title: form.title,
          priority: form.priority,
          ...(form.dueAt ? { dueAt: localToIso(form.dueAt) } : {}),
          ...(form.assignee ? { assigneeMembershipId: form.assignee } : {}),
          ...(matterId ? { matterId } : {}),
        },
      }),
    );
    if (ok) setForm({ title: '', priority: 'MEDIUM', dueAt: '', assignee: '' });
  };
  const setStatus = (t: TaskResponse, status: TaskStatus) =>
    void run(() =>
      apiFetch(`/api/v1/tasks/${t.id}`, { method: 'PATCH', tenantId, body: { status } }),
    );

  const rows = list.data?.data ?? [];
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <select
          aria-label="Show tasks"
          className={`${selectClass} w-auto`}
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
        >
          <option value="active">Open</option>
          <option value="mine">Open, assigned to me</option>
          <option value="all">All</option>
        </select>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {list.isPending ? <LoadingState /> : null}
      {list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : null}
      {list.isSuccess && rows.length === 0 ? <EmptyState title="No tasks" /> : null}
      {rows.length ? (
        <ul className="divide-y rounded-md border">
          {rows.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
            >
              <div className="flex min-w-0 items-start gap-2">
                {can('task:manage') ? (
                  <input
                    type="checkbox"
                    aria-label={`Done: ${t.title}`}
                    className="mt-1"
                    checked={t.status === 'DONE'}
                    onChange={(e) => setStatus(t, e.target.checked ? 'DONE' : 'OPEN')}
                  />
                ) : null}
                <div className="flex flex-col">
                  <span
                    className={
                      t.status === 'DONE' ? 'line-through text-muted-foreground' : 'font-medium'
                    }
                  >
                    {t.title}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t.assignee?.name ?? 'Unassigned'}
                    {t.dueAt ? ` · due ${formatDateTime(t.dueAt)}` : ''}
                    {matterId ? null : <LinkLabel link={t.link} />}
                  </span>
                </div>
              </div>
              <span className="flex items-center gap-2">
                {t.priority === 'HIGH' || t.priority === 'URGENT' ? (
                  <Badge tone={t.priority === 'URGENT' ? 'danger' : 'warning'}>
                    {priorityLabel[t.priority]}
                  </Badge>
                ) : null}
                {t.status !== 'OPEN' && t.status !== 'DONE' ? (
                  <Badge>{statusLabel[t.status]}</Badge>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {can('task:manage') ? (
        <form
          onSubmit={(e) => void add(e)}
          className="flex flex-col gap-3 border-t pt-4"
          noValidate
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`task-title-${matterId ?? 'all'}`}>New task</Label>
            <Input
              id={`task-title-${matterId ?? 'all'}`}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              maxLength={200}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`task-priority-${matterId ?? 'all'}`}>Priority</Label>
              <select
                id={`task-priority-${matterId ?? 'all'}`}
                className={selectClass}
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
              >
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {priorityLabel[p]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`task-due-${matterId ?? 'all'}`}>Due (optional)</Label>
              <Input
                id={`task-due-${matterId ?? 'all'}`}
                type="datetime-local"
                value={form.dueAt}
                onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
              />
            </div>
            {members.data ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`task-assignee-${matterId ?? 'all'}`}>Assignee</Label>
                <select
                  id={`task-assignee-${matterId ?? 'all'}`}
                  className={selectClass}
                  value={form.assignee}
                  onChange={(e) => setForm({ ...form, assignee: e.target.value })}
                >
                  <option value="">Me</option>
                  {members.data
                    .filter((x) => x.kind === 'STAFF' && x.status === 'ACTIVE')
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                </select>
              </div>
            ) : null}
          </div>
          <div>
            <Button type="submit" size="sm">
              Add task
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
