'use client';

import type { ClientDetail, ClientSummary, MatterSummary, Paginated } from '@crm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
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
import { formatDate } from '@/lib/form-values';
import { queryKeys } from '@/lib/queries';
import { useReferenceOptions } from '@/lib/use-options';
import { DocumentsPanel } from '../../_crm/documents-panel';
import { ConsentsPanel } from '../../_crm/sharing';
import { AppointmentsPanel, Timeline } from '../../_crm/timeline';
import { useWorkspace } from '../../workspace-context';
import { ClientForm, kindLabel } from '../client-form';

const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong.');

function Relationships({
  client,
  onChanged,
}: {
  client: ClientDetail;
  onChanged: (c: ClientDetail) => void;
}) {
  const { tenantId, slug, can } = useWorkspace();
  const canEdit = can('client:update');
  const types = useReferenceOptions(tenantId, 'RELATIONSHIP_TYPE');
  const [q, setQ] = useState('');
  const [toClientId, setToClientId] = useState('');
  const [typeId, setTypeId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const found = useQuery({
    queryKey: [...queryKeys.clients(tenantId), 'pick', q],
    queryFn: () =>
      apiFetch<Paginated<ClientSummary>>(`/api/v1/clients?q=${encodeURIComponent(q)}&limit=10`, {
        tenantId,
      }),
    enabled: canEdit && q.trim().length >= 2,
  });

  const add = async () => {
    setError(null);
    try {
      onChanged(
        await apiFetch<ClientDetail>(`/api/v1/clients/${client.id}/relationships`, {
          method: 'POST',
          tenantId,
          body: { toClientId, typeId },
        }),
      );
      setToClientId('');
      setQ('');
    } catch (e) {
      setError(errText(e));
    }
  };
  const remove = async (relId: string) => {
    setError(null);
    try {
      await apiFetch(`/api/v1/clients/${client.id}/relationships/${relId}`, {
        method: 'DELETE',
        tenantId,
      });
      onChanged({ ...client, relationships: client.relationships.filter((r) => r.id !== relId) });
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Related clients</h2>
      {error ? <Alert>{error}</Alert> : null}
      {client.relationships.length === 0 ? (
        <p className="text-sm text-muted-foreground">None recorded.</p>
      ) : null}
      {client.relationships.length ? (
        <ul className="divide-y rounded-md border">
          {client.relationships.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>
                {r.direction === 'to' ? 'Is ' : ''}
                <Badge>{r.type.name}</Badge> {r.direction === 'to' ? 'of ' : ''}
                <Link
                  className="text-primary underline-offset-4 hover:underline"
                  href={`/w/${slug}/clients/${r.other.id}`}
                >
                  {r.other.displayName}
                </Link>{' '}
                <span className="text-muted-foreground">({r.other.clientNumber})</span>
              </span>
              {canEdit ? (
                <Button size="sm" variant="ghost" onClick={() => void remove(r.id)}>
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {canEdit ? (
        <div className="flex flex-col gap-3 border-t pt-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rel-search">Find client</Label>
            <Input
              id="rel-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Name, email or number"
            />
          </div>
          {found.data?.data.length ? (
            <select
              aria-label="Related client"
              className="h-9 rounded-md border bg-card px-2 text-sm"
              value={toClientId}
              onChange={(e) => setToClientId(e.target.value)}
            >
              <option value="">Choose…</option>
              {found.data.data
                .filter((c) => c.id !== client.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName} ({c.clientNumber})
                  </option>
                ))}
            </select>
          ) : null}
          <select
            aria-label="Relationship type"
            className="h-9 rounded-md border bg-card px-2 text-sm"
            value={typeId}
            onChange={(e) => setTypeId(e.target.value)}
          >
            <option value="">Relationship…</option>
            {types.data
              ?.filter((t) => t.isActive)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
          <div>
            <Button size="sm" disabled={!toClientId || !typeId} onClick={() => void add()}>
              Add relationship
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function ClientMatters({ clientId }: { clientId: string }) {
  const { tenantId, slug, can } = useWorkspace();
  const matters = useQuery({
    queryKey: [...queryKeys.matters(tenantId), 'client', clientId],
    queryFn: () =>
      apiFetch<Paginated<MatterSummary>>(`/api/v1/matters?clientId=${clientId}&limit=50`, {
        tenantId,
      }),
    enabled: can('matter:read'),
  });
  if (!can('matter:read')) return null;
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Matters</h2>
        {can('matter:create') ? (
          <Link
            className="text-sm text-primary underline-offset-4 hover:underline"
            href={`/w/${slug}/matters?clientId=${clientId}`}
          >
            Open a matter
          </Link>
        ) : null}
      </div>
      {matters.data?.data.length ? (
        <ul className="divide-y rounded-md border text-sm">
          {matters.data.data.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <Link
                className="text-primary underline-offset-4 hover:underline"
                href={`/w/${slug}/matters/${x.id}`}
              >
                {x.reference} · {x.title}
              </Link>
              <span className="text-muted-foreground">
                {[x.type.name, x.stage?.name].filter(Boolean).join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      ) : matters.isSuccess ? (
        <p className="text-sm text-muted-foreground">No active matters.</p>
      ) : null}
    </Card>
  );
}

export default function ClientPage() {
  const { id } = useParams<{ id: string }>();
  const { tenantId, slug, can } = useWorkspace();
  const queryClient = useQueryClient();
  const key = queryKeys.client(tenantId, id);
  const client = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<ClientDetail>(`/api/v1/clients/${id}`, { tenantId }),
    enabled: can('client:read'),
  });

  if (!can('client:read')) return <ForbiddenState />;
  if (client.isPending) return <LoadingState />;
  if (client.isError) {
    return client.error instanceof ApiError && client.error.status === 404 ? (
      <EmptyState title="Client not found" />
    ) : (
      <ErrorState onRetry={() => void client.refetch()} />
    );
  }
  const c = client.data;
  const update = (saved: ClientDetail) => {
    queryClient.setQueryData(key, saved);
    void queryClient.invalidateQueries({ queryKey: queryKeys.clients(tenantId) });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href={`/w/${slug}/clients`}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          ← All clients
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold">{c.displayName}</h2>
          <Badge>{c.clientNumber}</Badge>
          <Badge>{kindLabel[c.kind]}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">Client since {formatDate(c.createdAt)}</p>
        {c.sourceLeads.length ? (
          <p className="text-sm">
            From lead{c.sourceLeads.length > 1 ? 's' : ''}:{' '}
            {c.sourceLeads.map((l, i) => (
              <span key={l.id}>
                {i ? ', ' : ''}
                <Link
                  className="text-primary underline-offset-4 hover:underline"
                  href={`/w/${slug}/leads/${l.id}`}
                >
                  {l.fullName}
                </Link>
                {[l.source?.name, l.referredBy ? `via ${l.referredBy.name}` : null].filter(Boolean)
                  .length
                  ? ` (${[l.source?.name, l.referredBy ? `via ${l.referredBy.name}` : null].filter(Boolean).join(', ')})`
                  : ''}
              </span>
            ))}
          </p>
        ) : null}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <Card>
            <h2 className="mb-4 text-lg font-semibold">Details</h2>
            {can('client:update') ? (
              <ClientForm client={c} onSaved={update} />
            ) : (
              <dl className="grid grid-cols-[120px_1fr] gap-2 text-sm">
                {(
                  [
                    ['Email', c.email],
                    ['Phone', c.phone],
                    ['Date of birth', c.dateOfBirth],
                    ['Nationality', c.nationality],
                    ['Address', c.addressLine],
                    ['Branch', c.branch?.name],
                    ['Notes', c.notes],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="whitespace-pre-wrap">{v || '—'}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>
          <ClientMatters clientId={id} />
          <DocumentsPanel target={{ clientId: id }} />
          <ConsentsPanel clientId={id} />
          <Relationships client={c} onChanged={update} />
        </div>
        <div className="flex flex-col gap-6">
          <Timeline subject={{ clientId: id }} canAdd={can('client:update')} />
          <AppointmentsPanel subject={{ clientId: id }} />
        </div>
      </div>
    </div>
  );
}
