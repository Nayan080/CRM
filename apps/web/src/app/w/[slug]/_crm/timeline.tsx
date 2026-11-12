'use client';

import {
  ACTIVITY_TYPES,
  type ActivityResponse,
  type AppointmentResponse,
  type Paginated,
} from '@crm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { FormField } from '@/components/forms/form-field';
import { SelectField, TextAreaField } from '@/components/forms/select-field';
import { EmptyState, ErrorState, LoadingState } from '@/components/states/state-view';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { apiFetch } from '@/lib/api/client';
import { applyApiError } from '@/lib/forms';
import { cleanBody, formatDateTime, localToIso } from '@/lib/form-values';
import { queryKeys } from '@/lib/queries';
import { useWorkspace } from '../workspace-context';

export type Subject = { leadId: string } | { clientId: string } | { matterId: string };

const subjectKey = (s: Subject) =>
  'leadId' in s
    ? `lead:${s.leadId}`
    : 'clientId' in s
      ? `client:${s.clientId}`
      : `matter:${s.matterId}`;
const subjectQuery = (s: Subject) =>
  'leadId' in s
    ? `leadId=${s.leadId}`
    : 'clientId' in s
      ? `clientId=${s.clientId}`
      : `matterId=${s.matterId}`;
const typeLabel: Record<string, string> = {
  NOTE: 'Note',
  CALL: 'Call',
  EMAIL: 'Email',
  MEETING: 'Meeting',
};

/** Calls, emails, notes and meetings for one lead or client. */
export function Timeline({ subject, canAdd }: { subject: Subject; canAdd: boolean }) {
  const { tenantId } = useWorkspace();
  const queryClient = useQueryClient();
  const key = queryKeys.activities(tenantId, subjectKey(subject));
  const list = useQuery({
    queryKey: key,
    queryFn: () =>
      apiFetch<Paginated<ActivityResponse>>(
        `/api/v1/activities?${subjectQuery(subject)}&limit=50`,
        { tenantId },
      ),
  });
  const [error, setError] = useState<string | null>(null);
  const form = useForm({ defaultValues: { type: 'NOTE', summary: '', body: '' } });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await apiFetch('/api/v1/activities', {
        method: 'POST',
        tenantId,
        body: { ...subject, ...cleanBody(values, 'create') },
      });
      form.reset({ type: values.type, summary: '', body: '' });
      await queryClient.invalidateQueries({ queryKey: key });
    } catch (e) {
      setError(applyApiError(e, form.setError, ['summary', 'body']));
    }
  });

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Timeline</h2>
      {canAdd ? (
        <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-3" noValidate>
          {error ? <Alert>{error}</Alert> : null}
          <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
            <SelectField id="activity-type" label="Type" registration={form.register('type')}>
              {ACTIVITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {typeLabel[t]}
                </option>
              ))}
            </SelectField>
            <FormField
              id="activity-summary"
              label="Summary"
              registration={form.register('summary', { required: 'Required' })}
              error={form.formState.errors.summary}
            />
          </div>
          <TextAreaField
            id="activity-body"
            label="Details (optional)"
            registration={form.register('body')}
          />
          <div>
            <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
              Add to timeline
            </Button>
          </div>
        </form>
      ) : null}
      {list.isPending ? <LoadingState /> : null}
      {list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : null}
      {list.data?.data.length === 0 ? <EmptyState title="Nothing recorded yet" /> : null}
      {list.data?.data.length ? (
        <ol className="flex flex-col gap-3">
          {list.data.data.map((a) => (
            <li key={a.id} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{typeLabel[a.type]}</Badge>
                <span className="font-medium">{a.summary}</span>
              </div>
              {a.body ? (
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{a.body}</p>
              ) : null}
              <p className="mt-1 text-xs text-muted-foreground">
                {a.actor.name} · {formatDateTime(a.occurredAt)}
              </p>
            </li>
          ))}
        </ol>
      ) : null}
    </Card>
  );
}

/** Appointment list (optionally for one lead/client) with a booking form. */
export function AppointmentsPanel({
  subject,
  title = 'Consultations & appointments',
}: {
  subject?: Subject;
  title?: string;
}) {
  const { tenantId, can } = useWorkspace();
  const queryClient = useQueryClient();
  const canManage = can('appointment:manage');
  const path = `/api/v1/appointments?includeCancelled=true${subject ? `&${subjectQuery(subject)}` : ''}`;
  const key = [...queryKeys.appointments(tenantId), subject ? subjectKey(subject) : 'upcoming'];
  const list = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<AppointmentResponse[]>(path, { tenantId }),
    enabled: can('appointment:read'),
  });
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: {
      title: subject ? 'Consultation' : '',
      startsAt: '',
      endsAt: '',
      location: '',
      isConsultation: true,
    },
  });

  if (!can('appointment:read')) return null;

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    if (!v.startsAt || !v.endsAt) {
      setError('Choose a start and end time.');
      return;
    }
    try {
      await apiFetch('/api/v1/appointments', {
        method: 'POST',
        tenantId,
        body: {
          ...(subject ?? {}),
          title: v.title,
          location: v.location || undefined,
          isConsultation: v.isConsultation,
          startsAt: localToIso(v.startsAt),
          endsAt: localToIso(v.endsAt),
        },
      });
      form.reset();
      await queryClient.invalidateQueries({ queryKey: queryKeys.appointments(tenantId) });
    } catch (e) {
      setError(applyApiError(e, form.setError, ['title', 'location']));
    }
  });

  const cancel = async (id: string) => {
    setError(null);
    try {
      await apiFetch(`/api/v1/appointments/${id}/cancel`, { method: 'POST', tenantId });
    } catch (e) {
      setError(applyApiError(e, form.setError));
    }
    await queryClient.invalidateQueries({ queryKey: queryKeys.appointments(tenantId) });
  };

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {error ? <Alert>{error}</Alert> : null}
      {list.isPending ? <LoadingState /> : null}
      {list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : null}
      {list.data?.length === 0 ? <EmptyState title="No appointments" /> : null}
      {list.data?.length ? (
        <ul className="divide-y rounded-md border">
          {list.data.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
            >
              <div className="flex flex-col">
                <span className="font-medium">
                  {a.title} {a.isConsultation ? <Badge>Consultation</Badge> : null}
                </span>
                <span className="text-muted-foreground">
                  {formatDateTime(a.startsAt)} · {a.host.name}
                  {a.lead
                    ? ` · ${a.lead.fullName}`
                    : a.client
                      ? ` · ${a.client.displayName}`
                      : a.matter
                        ? ` · ${a.matter.reference}`
                        : ''}
                  {a.location ? ` · ${a.location}` : ''}
                </span>
              </div>
              {a.cancelledAt ? (
                <Badge tone="warning">Cancelled</Badge>
              ) : canManage ? (
                <Button size="sm" variant="ghost" onClick={() => void cancel(a.id)}>
                  Cancel
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {canManage ? (
        <form
          onSubmit={(e) => void onSubmit(e)}
          className="flex flex-col gap-3 border-t pt-4"
          noValidate
        >
          <h3 className="text-sm font-semibold">Book</h3>
          <FormField
            id="appt-title"
            label="Title"
            registration={form.register('title', { required: 'Required' })}
            error={form.formState.errors.title}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              id="appt-start"
              label="Starts"
              type="datetime-local"
              registration={form.register('startsAt')}
            />
            <FormField
              id="appt-end"
              label="Ends"
              type="datetime-local"
              registration={form.register('endsAt')}
            />
          </div>
          <FormField
            id="appt-location"
            label="Location (optional)"
            registration={form.register('location')}
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register('isConsultation')} /> Consultation
          </label>
          <div>
            <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
              Book appointment
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
