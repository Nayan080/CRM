'use client';

import type { ConvertLeadResponse, DuplicateResponse, LeadDetail } from '@crm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
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
import { formatDateTime } from '@/lib/form-values';
import { queryKeys } from '@/lib/queries';
import { AppointmentsPanel, Timeline } from '../../_crm/timeline';
import { useWorkspace } from '../../workspace-context';
import { LeadForm } from '../lead-form';
import { leadStatusLabel, leadStatusTone } from '../lead-status';

const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong.');

/** Check for an existing client first; then link to it or create a new one. */
function ConvertPanel({
  lead,
  onDone,
}: {
  lead: LeadDetail;
  onDone: (r: ConvertLeadResponse) => void;
}) {
  const { tenantId, can } = useWorkspace();
  const [dob, setDob] = useState('');
  const [kind, setKind] = useState<'INDIVIDUAL' | 'BUSINESS'>('INDIVIDUAL');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const params = new URLSearchParams();
  if (lead.email) params.set('email', lead.email);
  if (lead.phone) params.set('phone', lead.phone);
  if (dob) {
    params.set('name', lead.fullName);
    params.set('dateOfBirth', dob);
  }
  const dupes = useQuery({
    queryKey: ['tenant', tenantId, 'duplicates', params.toString()],
    queryFn: () =>
      apiFetch<DuplicateResponse>(`/api/v1/clients/duplicates?${params.toString()}`, { tenantId }),
    enabled: params.toString().length > 0 && can('client:read'),
  });

  const convert = async (body: object) => {
    setBusy(true);
    setError(null);
    try {
      onDone(
        await apiFetch<ConvertLeadResponse>(`/api/v1/leads/${lead.id}/convert`, {
          method: 'POST',
          tenantId,
          body,
        }),
      );
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Convert to client</h2>
      <p className="text-sm text-muted-foreground">
        Check for an existing client first to avoid duplicates. The lead keeps its source and
        referrer.
      </p>
      {error ? <Alert>{error}</Alert> : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="convert-dob">Date of birth (optional, improves matching)</Label>
        <Input id="convert-dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
      </div>
      {dupes.data?.candidates.length ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Possible existing clients</p>
          <ul className="divide-y rounded-md border">
            {dupes.data.candidates.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>
                  {c.displayName}{' '}
                  <span className="text-muted-foreground">
                    ({c.clientNumber}) · matches {c.reasons.join(', ').replaceAll('_', ' ')}
                  </span>
                </span>
                {can('client:update') ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void convert({ mode: 'link', clientId: c.id })}
                  >
                    Link to this client
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : dupes.isSuccess ? (
        <p className="text-sm text-muted-foreground">No existing client matches.</p>
      ) : null}
      {dupes.data?.hiddenMatches ? (
        <Alert tone="info">
          {dupes.data.hiddenMatches} possible match(es) you can&apos;t see. Ask an admin before
          creating a new client.
        </Alert>
      ) : null}
      {can('client:create') ? (
        <div className="flex flex-wrap items-end gap-3 border-t pt-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="convert-kind">New client type</Label>
            <select
              id="convert-kind"
              className="h-9 rounded-md border bg-card px-2 text-sm"
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              <option value="INDIVIDUAL">Individual</option>
              <option value="BUSINESS">Business</option>
            </select>
          </div>
          <Button
            disabled={busy}
            onClick={() =>
              void convert({
                mode: 'new',
                client: {
                  kind,
                  displayName: lead.fullName,
                  ...(lead.email ? { email: lead.email } : {}),
                  ...(lead.phone ? { phone: lead.phone } : {}),
                  ...(kind === 'INDIVIDUAL' && dob ? { dateOfBirth: dob } : {}),
                },
              })
            }
          >
            Create new client
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

export default function LeadPage() {
  const { id } = useParams<{ id: string }>();
  const { tenantId, slug, can } = useWorkspace();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [lostReason, setLostReason] = useState('');
  const key = queryKeys.lead(tenantId, id);
  const lead = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<LeadDetail>(`/api/v1/leads/${id}`, { tenantId }),
    enabled: can('lead:read'),
  });

  if (!can('lead:read')) return <ForbiddenState />;
  if (lead.isPending) return <LoadingState />;
  if (lead.isError) {
    return lead.error instanceof ApiError && lead.error.status === 404 ? (
      <EmptyState title="Lead not found" />
    ) : (
      <ErrorState onRetry={() => void lead.refetch()} />
    );
  }
  const l = lead.data;
  const editable = can('lead:update') && l.status !== 'CONVERTED';
  const refresh = (saved?: LeadDetail) => {
    if (saved) queryClient.setQueryData(key, saved);
    void queryClient.invalidateQueries({ queryKey: queryKeys.leads(tenantId) });
  };
  const setStatus = async (status: 'OPEN' | 'LOST') => {
    setError(null);
    try {
      refresh(
        await apiFetch<LeadDetail>(`/api/v1/leads/${id}`, {
          method: 'PATCH',
          tenantId,
          body: { status, ...(status === 'LOST' ? { lostReason: lostReason || null } : {}) },
        }),
      );
    } catch (e) {
      setError(errText(e));
    }
  };
  const remove = async () => {
    try {
      await apiFetch(`/api/v1/leads/${id}`, { method: 'DELETE', tenantId });
      refresh();
      router.push(`/w/${slug}/leads`);
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href={`/w/${slug}/leads`}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          ← All leads
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold">{l.fullName}</h2>
          <Badge tone={leadStatusTone[l.status]}>{leadStatusLabel[l.status]}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {[
            l.source?.name,
            l.referredBy
              ? `Referred by ${l.referredBy.name}${l.referredContact ? ` (${l.referredContact.name})` : ''}`
              : null,
            `Created ${formatDateTime(l.createdAt)}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {l.convertedClient ? (
          <Alert tone="success">
            Converted to client{' '}
            <Link className="underline" href={`/w/${slug}/clients/${l.convertedClient.id}`}>
              {l.convertedClient.displayName} ({l.convertedClient.clientNumber})
            </Link>
            .
          </Alert>
        ) : null}
        {l.status === 'LOST' && l.lostReason ? (
          <p className="text-sm">Lost: {l.lostReason}</p>
        ) : null}
      </div>
      {error ? <Alert>{error}</Alert> : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          {editable ? (
            <Card>
              <h2 className="mb-4 text-lg font-semibold">Details</h2>
              <LeadForm lead={l} onSaved={refresh} />
            </Card>
          ) : null}
          {editable ? (
            <Card className="flex flex-wrap items-end gap-3">
              {l.status === 'OPEN' ? (
                <>
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label htmlFor="lost-reason">Reason (optional)</Label>
                    <Input
                      id="lost-reason"
                      value={lostReason}
                      onChange={(e) => setLostReason(e.target.value)}
                    />
                  </div>
                  <Button variant="outline" onClick={() => void setStatus('LOST')}>
                    Mark as lost
                  </Button>
                </>
              ) : (
                <Button variant="outline" onClick={() => void setStatus('OPEN')}>
                  Reopen lead
                </Button>
              )}
              {can('lead:delete') ? (
                <Button variant="destructive" onClick={() => void remove()}>
                  Delete lead
                </Button>
              ) : null}
            </Card>
          ) : null}
          {editable && l.status === 'OPEN' ? (
            <ConvertPanel
              lead={l}
              onDone={(r) => {
                refresh(r.lead);
                void queryClient.invalidateQueries({ queryKey: queryKeys.clients(tenantId) });
                void queryClient.invalidateQueries({
                  queryKey: queryKeys.client(tenantId, r.client.id),
                });
                router.push(`/w/${slug}/clients/${r.client.id}`);
              }}
            />
          ) : null}
        </div>
        <div className="flex flex-col gap-6">
          <Timeline subject={{ leadId: id }} canAdd={can('lead:update')} />
          <AppointmentsPanel subject={{ leadId: id }} />
        </div>
      </div>
    </div>
  );
}
