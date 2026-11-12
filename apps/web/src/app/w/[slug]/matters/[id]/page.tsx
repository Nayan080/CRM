'use client';

import type {
  MatterDetail,
  MatterStatus,
  MemberSummary,
  Paginated,
  PartnerSummary,
  ProfessionalSummary,
} from '@crm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { selectClass } from '@/components/forms/select-field';
import {
  EmptyState,
  ErrorState,
  ForbiddenState,
  LoadingState,
} from '@/components/states/state-view';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { ApiError, apiFetch } from '@/lib/api/client';
import { formatDate, formatDateTime, localToIso } from '@/lib/form-values';
import { queryKeys } from '@/lib/queries';
import { useReferenceOptions } from '@/lib/use-options';
import { ClientPicker } from '../../_crm/client-picker';
import { DocumentsPanel } from '../../_crm/documents-panel';
import { SharesPanel } from '../../_crm/sharing';
import { TasksPanel } from '../../_crm/tasks-panel';
import { AppointmentsPanel, Timeline } from '../../_crm/timeline';
import { useWorkspace } from '../../workspace-context';
import { matterStatusLabel, matterStatusTone } from '../matter-status';

type Run = (fn: () => Promise<MatterDetail>) => Promise<boolean>;

const STATUS_ACTIONS: { to: MatterStatus; label: string; from: MatterStatus[] }[] = [
  { to: 'ON_HOLD', label: 'Put on hold', from: ['OPEN'] },
  { to: 'OPEN', label: 'Re-open', from: ['ON_HOLD', 'CLOSED', 'ARCHIVED'] },
  { to: 'CLOSED', label: 'Close', from: ['OPEN', 'ON_HOLD'] },
  { to: 'ARCHIVED', label: 'Archive', from: ['CLOSED'] },
];

function Workflow({
  matter,
  run,
  editable,
}: {
  matter: MatterDetail;
  run: Run;
  editable: boolean;
}) {
  const { tenantId } = useWorkspace();
  const [stageId, setStageId] = useState(matter.stage?.id ?? '');
  const [reason, setReason] = useState('');
  const transition = (body: object) =>
    void run(() =>
      apiFetch<MatterDetail>(`/api/v1/matters/${matter.id}/transition`, {
        method: 'POST',
        tenantId,
        body: { ...body, ...(reason ? { reason } : {}) },
      }),
    ).then((ok) => ok && setReason(''));
  const active = matter.stages.filter((s) => s.isActive || s.id === matter.stage?.id);
  const position = active.findIndex((s) => s.id === matter.stage?.id);

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Workflow</h2>
      <ol className="flex flex-wrap gap-2" aria-label="Stages">
        {active.map((s, i) => (
          <li key={s.id}>
            <Badge
              tone={s.id === matter.stage?.id ? 'success' : i < position ? 'neutral' : 'neutral'}
            >
              {i + 1}. {s.name}
              {s.id === matter.stage?.id ? ' (current)' : ''}
            </Badge>
          </li>
        ))}
      </ol>
      {editable ? (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="move-stage">Stage</Label>
              <select
                id="move-stage"
                className={`${selectClass} w-auto`}
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
              >
                {active
                  .filter((s) => s.isActive)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="move-reason">Note (optional)</Label>
              <Input
                id="move-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
              />
            </div>
            <Button
              variant="outline"
              disabled={!stageId || stageId === matter.stage?.id}
              onClick={() => transition({ stageId })}
            >
              Move to stage
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {STATUS_ACTIONS.filter((a) => a.from.includes(matter.status)).map((a) => (
              <Button
                key={a.to}
                size="sm"
                variant="outline"
                onClick={() => transition({ status: a.to })}
              >
                {a.label}
              </Button>
            ))}
          </div>
        </>
      ) : null}
    </Card>
  );
}

function Team({ matter, run, editable }: { matter: MatterDetail; run: Run; editable: boolean }) {
  const { tenantId, can } = useWorkspace();
  const members = useQuery({
    queryKey: queryKeys.members(tenantId),
    queryFn: () => apiFetch<MemberSummary[]>('/api/v1/members', { tenantId }),
    enabled: editable && can('member:read'),
  });
  const [membershipId, setMembershipId] = useState('');
  const [responsibility, setResponsibility] = useState('');
  const assigned = new Set(matter.assignments.map((a) => a.member.id));
  const add = () =>
    void run(() =>
      apiFetch<MatterDetail>(`/api/v1/matters/${matter.id}/assignments`, {
        method: 'POST',
        tenantId,
        body: { membershipId, ...(responsibility ? { responsibility } : {}) },
      }),
    ).then((ok) => {
      if (ok) {
        setMembershipId('');
        setResponsibility('');
      }
    });

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Team</h2>
      {matter.assignments.length ? (
        <ul className="divide-y rounded-md border text-sm">
          {matter.assignments.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span>
                {a.member.name}
                {a.responsibility ? (
                  <span className="text-muted-foreground"> · {a.responsibility}</span>
                ) : null}
              </span>
              {editable ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void run(() =>
                      apiFetch<MatterDetail>(`/api/v1/matters/${matter.id}/assignments/${a.id}`, {
                        method: 'DELETE',
                        tenantId,
                      }),
                    )
                  }
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nobody assigned.</p>
      )}
      {editable && members.data ? (
        <div className="flex flex-wrap items-end gap-2 border-t pt-3">
          <select
            aria-label="Team member to assign"
            className={`${selectClass} w-auto`}
            value={membershipId}
            onChange={(e) => setMembershipId(e.target.value)}
          >
            <option value="">Assign someone…</option>
            {members.data
              .filter((x) => x.kind === 'STAFF' && x.status === 'ACTIVE' && !assigned.has(x.id))
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
          </select>
          <Input
            aria-label="Responsibility (optional)"
            placeholder="Responsibility (optional)"
            className="w-48"
            value={responsibility}
            onChange={(e) => setResponsibility(e.target.value)}
          />
          <Button size="sm" variant="outline" disabled={!membershipId} onClick={add}>
            Assign
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function Participants({
  matter,
  run,
  editable,
}: {
  matter: MatterDetail;
  run: Run;
  editable: boolean;
}) {
  const { tenantId, can } = useWorkspace();
  const roles = useReferenceOptions(tenantId, 'PARTICIPANT_ROLE', editable);
  const [kind, setKind] = useState<'client' | 'professional' | 'partner'>('client');
  const [roleId, setRoleId] = useState('');
  const [partyId, setPartyId] = useState('');
  const directory = can('directory:read') && editable;
  const professionals = useQuery({
    queryKey: [...queryKeys.professionals(tenantId), 'all'],
    queryFn: () =>
      apiFetch<Paginated<ProfessionalSummary>>('/api/v1/professionals?limit=100', { tenantId }),
    enabled: directory && kind === 'professional',
  });
  const partners = useQuery({
    queryKey: [...queryKeys.partners(tenantId), 'all'],
    queryFn: () => apiFetch<Paginated<PartnerSummary>>('/api/v1/partners?limit=100', { tenantId }),
    enabled: directory && kind === 'partner',
  });
  const field =
    kind === 'client' ? 'clientId' : kind === 'professional' ? 'professionalId' : 'partnerOrgId';
  const add = () =>
    void run(() =>
      apiFetch<MatterDetail>(`/api/v1/matters/${matter.id}/participants`, {
        method: 'POST',
        tenantId,
        body: { roleId, [field]: partyId },
      }),
    ).then((ok) => ok && setPartyId(''));

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">People & organizations involved</h2>
      {matter.participants.length ? (
        <ul className="divide-y rounded-md border text-sm">
          {matter.participants.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span>
                <Badge>{p.role.name}</Badge> {p.party.name}{' '}
                <span className="text-muted-foreground">
                  ({p.kind === 'partner' ? 'partner organization' : p.kind})
                </span>
              </span>
              {editable ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void run(() =>
                      apiFetch<MatterDetail>(`/api/v1/matters/${matter.id}/participants/${p.id}`, {
                        method: 'DELETE',
                        tenantId,
                      }),
                    )
                  }
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">None recorded.</p>
      )}
      {editable ? (
        <div className="flex flex-col gap-3 border-t pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="part-role">Role</Label>
              <select
                id="part-role"
                className={selectClass}
                value={roleId}
                onChange={(e) => setRoleId(e.target.value)}
              >
                <option value="">Choose…</option>
                {roles.data
                  ?.filter((r) => r.isActive)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="part-kind">Who</Label>
              <select
                id="part-kind"
                className={selectClass}
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as typeof kind);
                  setPartyId('');
                }}
              >
                <option value="client">A client record</option>
                {directory ? (
                  <option value="professional">A professional (directory)</option>
                ) : null}
                {directory ? <option value="partner">A partner organization</option> : null}
              </select>
            </div>
          </div>
          {kind === 'client' ? (
            <ClientPicker
              id="part-client"
              label="Client"
              value={partyId}
              onChange={setPartyId}
              exclude={matter.client.id}
            />
          ) : (
            <select
              aria-label={kind === 'professional' ? 'Professional' : 'Partner organization'}
              className={selectClass}
              value={partyId}
              onChange={(e) => setPartyId(e.target.value)}
            >
              <option value="">Choose…</option>
              {(kind === 'professional'
                ? (professionals.data?.data ?? []).map((x) => ({ id: x.id, name: x.fullName }))
                : (partners.data?.data ?? []).map((x) => ({ id: x.id, name: x.name }))
              ).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          )}
          <div>
            <Button size="sm" variant="outline" disabled={!roleId || !partyId} onClick={add}>
              Add
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function Deadlines({
  matter,
  run,
  editable,
}: {
  matter: MatterDetail;
  run: Run;
  editable: boolean;
}) {
  const { tenantId } = useWorkspace();
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [remindAt, setRemindAt] = useState('');
  const base = `/api/v1/matters/${matter.id}/deadlines`;
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !dueAt) return;
    void run(() =>
      apiFetch<MatterDetail>(base, {
        method: 'POST',
        tenantId,
        body: {
          title,
          dueAt: localToIso(dueAt),
          ...(remindAt ? { remindAt: localToIso(remindAt) } : {}),
        },
      }),
    ).then((ok) => {
      if (ok) {
        setTitle('');
        setDueAt('');
        setRemindAt('');
      }
    });
  };
  const [now] = useState(() => Date.now());

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Deadlines</h2>
      {matter.deadlines.length ? (
        <ul className="divide-y rounded-md border text-sm">
          {matter.deadlines.map((d) => {
            const overdue = !d.completedAt && new Date(d.dueAt).getTime() < now;
            return (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              >
                <label className="flex items-start gap-2">
                  {editable ? (
                    <input
                      type="checkbox"
                      className="mt-1"
                      aria-label={`Done: ${d.title}`}
                      checked={!!d.completedAt}
                      onChange={(e) =>
                        void run(() =>
                          apiFetch<MatterDetail>(`${base}/${d.id}`, {
                            method: 'PATCH',
                            tenantId,
                            body: { completed: e.target.checked },
                          }),
                        )
                      }
                    />
                  ) : null}
                  <span className="flex flex-col">
                    <span
                      className={
                        d.completedAt ? 'line-through text-muted-foreground' : 'font-medium'
                      }
                    >
                      {d.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Due {formatDateTime(d.dueAt)}
                      {d.remindAt
                        ? ` · reminder ${formatDateTime(d.remindAt)}${d.reminderSentAt ? ' (sent)' : ''}`
                        : ''}
                    </span>
                  </span>
                </label>
                <span className="flex items-center gap-2">
                  {overdue ? <Badge tone="danger">Overdue</Badge> : null}
                  {editable ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void run(() =>
                          apiFetch<MatterDetail>(`${base}/${d.id}`, { method: 'DELETE', tenantId }),
                        )
                      }
                    >
                      Remove
                    </Button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No deadlines.</p>
      )}
      {editable ? (
        <form onSubmit={add} className="flex flex-col gap-3 border-t pt-3" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dl-title">Deadline</Label>
            <Input
              id="dl-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dl-due">Due</Label>
              <Input
                id="dl-due"
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dl-remind">Email reminder to the team (optional)</Label>
              <Input
                id="dl-remind"
                type="datetime-local"
                value={remindAt}
                onChange={(e) => setRemindAt(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Button type="submit" size="sm" variant="outline">
              Add deadline
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}

function Checklist({
  matter,
  run,
  editable,
}: {
  matter: MatterDetail;
  run: Run;
  editable: boolean;
}) {
  const { tenantId } = useWorkspace();
  const [title, setTitle] = useState('');
  const base = `/api/v1/matters/${matter.id}/checklist`;
  const done = matter.checklist.filter((c) => c.completedAt).length;
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    void run(() =>
      apiFetch<MatterDetail>(base, { method: 'POST', tenantId, body: { title } }),
    ).then((ok) => ok && setTitle(''));
  };
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">
        Checklist{' '}
        {matter.checklist.length ? (
          <span className="text-sm font-normal text-muted-foreground">
            ({done}/{matter.checklist.length} done)
          </span>
        ) : null}
      </h2>
      {matter.checklist.length ? (
        <ul className="divide-y rounded-md border text-sm">
          {matter.checklist.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  disabled={!editable}
                  aria-label={`Done: ${c.title}`}
                  checked={!!c.completedAt}
                  onChange={(e) =>
                    void run(() =>
                      apiFetch<MatterDetail>(`${base}/${c.id}`, {
                        method: 'PATCH',
                        tenantId,
                        body: { done: e.target.checked },
                      }),
                    )
                  }
                />
                <span className="flex flex-col">
                  <span>
                    {c.title} {c.isRequired ? null : <Badge>Optional</Badge>}
                  </span>
                  {c.completedAt ? (
                    <span className="text-xs text-muted-foreground">
                      Done by {c.completedBy?.name ?? 'someone'} · {formatDate(c.completedAt)}
                    </span>
                  ) : null}
                </span>
              </label>
              {editable ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void run(() =>
                      apiFetch<MatterDetail>(`${base}/${c.id}`, { method: 'DELETE', tenantId }),
                    )
                  }
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No checklist items.</p>
      )}
      {editable ? (
        <form onSubmit={add} className="flex gap-2 border-t pt-3">
          <Input
            aria-label="New checklist item"
            placeholder="Add a checklist item"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={300}
          />
          <Button type="submit" size="sm" variant="outline">
            Add
          </Button>
        </form>
      ) : null}
    </Card>
  );
}

function History({ matter }: { matter: MatterDetail }) {
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">History</h2>
      <ol className="flex flex-col gap-2 text-sm">
        {matter.history.map((h) => (
          <li key={h.id} className="rounded-md border p-2">
            <span className="font-medium">
              {[
                h.toStatus
                  ? `Status: ${h.fromStatus ? `${matterStatusLabel[h.fromStatus]} → ` : ''}${matterStatusLabel[h.toStatus]}`
                  : null,
                h.toStage
                  ? `Stage: ${h.fromStage ? `${h.fromStage.name} → ` : ''}${h.toStage.name}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            {h.reason ? <p className="text-muted-foreground">{h.reason}</p> : null}
            <p className="text-xs text-muted-foreground">
              {h.changedBy.name} · {formatDateTime(h.createdAt)}
            </p>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export default function MatterPage() {
  const { id } = useParams<{ id: string }>();
  const { tenantId, slug, can } = useWorkspace();
  const queryClient = useQueryClient();
  const key = queryKeys.matter(tenantId, id);
  const matter = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<MatterDetail>(`/api/v1/matters/${id}`, { tenantId }),
    enabled: can('matter:read'),
  });
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);

  if (!can('matter:read')) return <ForbiddenState />;
  if (matter.isPending) return <LoadingState />;
  if (matter.isError) {
    return matter.error instanceof ApiError && matter.error.status === 404 ? (
      <EmptyState title="Matter not found" />
    ) : (
      <ErrorState onRetry={() => void matter.refetch()} />
    );
  }
  const x = matter.data;
  const canUpdate = can('matter:update');
  const editable = canUpdate && x.status !== 'ARCHIVED';
  const run: Run = async (fn) => {
    setError(null);
    try {
      queryClient.setQueryData(key, await fn());
      void queryClient.invalidateQueries({ queryKey: queryKeys.matters(tenantId) });
      // Stage changes can create tasks automatically (stage task templates).
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks(tenantId) });
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
      return false;
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href={`/w/${slug}/matters`}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          ← All matters
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold">
            {x.reference} · {x.title}
          </h2>
          <Badge tone={matterStatusTone[x.status]}>{matterStatusLabel[x.status]}</Badge>
          {x.stage ? <Badge>{x.stage.name}</Badge> : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {x.type.name} · Client{' '}
          <Link
            className="text-primary underline-offset-4 hover:underline"
            href={`/w/${slug}/clients/${x.client.id}`}
          >
            {x.client.displayName} ({x.client.clientNumber})
          </Link>
          {x.branch ? ` · ${x.branch.name}` : ''} · Opened {formatDate(x.openedAt)}
          {x.closedAt ? ` · Closed ${formatDate(x.closedAt)}` : ''}
        </p>
        {x.status === 'ARCHIVED' ? (
          <Alert tone="info">Archived matters are read-only. Re-open to make changes.</Alert>
        ) : null}
      </div>
      {error ? <Alert>{error}</Alert> : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <Workflow key={`${x.stage?.id}:${x.status}`} matter={x} run={run} editable={canUpdate} />
          {editable ? (
            <Card className="flex flex-wrap items-end gap-2">
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="matter-title-edit">Title</Label>
                <Input
                  id="matter-title-edit"
                  value={title ?? x.title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                />
              </div>
              <Button
                variant="outline"
                disabled={!title || title === x.title}
                onClick={() =>
                  void run(() =>
                    apiFetch<MatterDetail>(`/api/v1/matters/${id}`, {
                      method: 'PATCH',
                      tenantId,
                      body: { title },
                    }),
                  ).then((ok) => ok && setTitle(null))
                }
              >
                Save
              </Button>
            </Card>
          ) : null}
          <Checklist matter={x} run={run} editable={editable} />
          <DocumentsPanel target={{ matterId: id }} checklist={x.checklist} editable={editable} />
          <SharesPanel matterId={id} clientId={x.client.id} editable={editable} />
          <Deadlines matter={x} run={run} editable={editable} />
          <Team matter={x} run={run} editable={editable} />
          <Participants matter={x} run={run} editable={editable} />
          <History matter={x} />
        </div>
        <div className="flex flex-col gap-6">
          <TasksPanel matterId={id} />
          <Timeline subject={{ matterId: id }} canAdd={editable} />
          <AppointmentsPanel subject={{ matterId: id }} />
        </div>
      </div>
    </div>
  );
}
