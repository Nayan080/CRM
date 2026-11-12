'use client';

import {
  CONSENT_METHODS,
  type ConsentMethod,
  type ConsentResponse,
  type DocumentResponse,
  type MemberSummary,
  type Paginated,
  type ShareResponse,
} from '@crm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { selectClass } from '@/components/forms/select-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { ApiError, apiFetch } from '@/lib/api/client';
import { formatDate, formatDateTime } from '@/lib/form-values';
import { queryKeys } from '@/lib/queries';
import { useWorkspace } from '../workspace-context';

const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong.');
const methodLabel: Record<ConsentMethod, string> = {
  WRITTEN: 'Written',
  VERBAL: 'Verbal',
  ELECTRONIC: 'Electronic',
};
const endOfDay = (date: string) => new Date(`${date}T23:59:59`).toISOString();

function useConsents(clientId: string) {
  const { tenantId, can } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.consents(tenantId, clientId),
    queryFn: () =>
      apiFetch<ConsentResponse[]>(`/api/v1/consents?clientId=${clientId}`, { tenantId }),
    enabled: can('client:read'),
  });
}

/** Client page: the client's recorded consents. */
export function ConsentsPanel({ clientId }: { clientId: string }) {
  const { tenantId, can } = useWorkspace();
  const queryClient = useQueryClient();
  const consents = useConsents(clientId);
  const [form, setForm] = useState({ purpose: '', recipient: '', method: 'WRITTEN', givenAt: '' });
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: queryKeys.consents(tenantId, clientId) });
      return true;
    } catch (e) {
      setError(errText(e));
      return false;
    }
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.purpose.trim() || !form.givenAt) {
      setError('Give a purpose and the date consent was given.');
      return;
    }
    const ok = await run(() =>
      apiFetch('/api/v1/consents', {
        method: 'POST',
        tenantId,
        body: {
          clientId,
          purpose: form.purpose,
          method: form.method,
          givenAt: new Date(`${form.givenAt}T12:00:00`).toISOString(),
          ...(form.recipient ? { recipient: form.recipient } : {}),
        },
      }),
    );
    if (ok) setForm({ purpose: '', recipient: '', method: 'WRITTEN', givenAt: '' });
  };

  return (
    <Card className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">Consents</h2>
        <p className="text-xs text-muted-foreground">
          Record what the client agreed to, e.g. sharing information with an external lawyer.
          Whether consent is needed for a share is your agency&apos;s decision.
        </p>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {consents.data?.length ? (
        <ul className="divide-y rounded-md border text-sm">
          {consents.data.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="flex flex-col">
                <span className="font-medium">
                  {c.purpose} {c.withdrawnAt ? <Badge tone="warning">Withdrawn</Badge> : null}
                </span>
                <span className="text-xs text-muted-foreground">
                  {methodLabel[c.method]} · {formatDate(c.givenAt)}
                  {c.recipient ? ` · to ${c.recipient}` : ''} · recorded by {c.recordedBy.name}
                </span>
              </span>
              {!c.withdrawnAt && can('client:update') ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void run(() =>
                      apiFetch(`/api/v1/consents/${c.id}/withdraw`, { method: 'POST', tenantId }),
                    )
                  }
                >
                  Mark withdrawn
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : consents.isSuccess ? (
        <p className="text-sm text-muted-foreground">None recorded.</p>
      ) : null}
      {can('client:update') ? (
        <form
          onSubmit={(e) => void add(e)}
          className="flex flex-col gap-3 border-t pt-3"
          noValidate
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="consent-purpose">Purpose</Label>
            <Input
              id="consent-purpose"
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
              maxLength={300}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="consent-recipient">Recipient (optional)</Label>
              <Input
                id="consent-recipient"
                value={form.recipient}
                onChange={(e) => setForm({ ...form, recipient: e.target.value })}
                maxLength={200}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="consent-method">How</Label>
              <select
                id="consent-method"
                className={selectClass}
                value={form.method}
                onChange={(e) => setForm({ ...form, method: e.target.value })}
              >
                {CONSENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {methodLabel[m]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="consent-date">Given on</Label>
              <Input
                id="consent-date"
                type="date"
                value={form.givenAt}
                onChange={(e) => setForm({ ...form, givenAt: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Button type="submit" size="sm" variant="outline">
              Record consent
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}

/** Matter page: share this matter with external collaborators (DEC-09, consent optional DEC-14). */
export function SharesPanel({
  matterId,
  clientId,
  editable,
}: {
  matterId: string;
  clientId: string;
  editable: boolean;
}) {
  const { tenantId, can } = useWorkspace();
  const queryClient = useQueryClient();
  const allowed = can('share:manage');
  const shares = useQuery({
    queryKey: queryKeys.shares(tenantId, matterId),
    queryFn: () => apiFetch<ShareResponse[]>(`/api/v1/shares?matterId=${matterId}`, { tenantId }),
    enabled: allowed,
  });
  const members = useQuery({
    queryKey: queryKeys.members(tenantId),
    queryFn: () => apiFetch<MemberSummary[]>('/api/v1/members', { tenantId }),
    enabled: allowed && can('member:read'),
  });
  const documents = useQuery({
    queryKey: [...queryKeys.documents(tenantId), `matterId=${matterId}`],
    queryFn: () =>
      apiFetch<Paginated<DocumentResponse>>(`/api/v1/documents?matterId=${matterId}&limit=100`, {
        tenantId,
      }),
    enabled: allowed && can('document:read'),
  });
  const consents = useConsents(clientId);
  const [grantee, setGrantee] = useState('');
  const [docIds, setDocIds] = useState<string[]>([]);
  const [consentId, setConsentId] = useState('');
  const [purpose, setPurpose] = useState('');
  const [expires, setExpires] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!allowed) return null;
  const externals =
    members.data?.filter((m) => m.kind === 'EXTERNAL' && m.status === 'ACTIVE') ?? [];
  const docs = documents.data?.data ?? [];
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: queryKeys.shares(tenantId, matterId) });
      return true;
    } catch (e) {
      setError(errText(e));
      return false;
    }
  };
  const toggle = (id: string) =>
    setDocIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!grantee) {
      setError('Choose who to share with.');
      return;
    }
    const ok = await run(() =>
      apiFetch('/api/v1/shares', {
        method: 'POST',
        tenantId,
        body: {
          matterId,
          granteeMembershipId: grantee,
          documentIds: docIds,
          ...(consentId ? { consentId } : {}),
          ...(purpose ? { purpose } : {}),
          ...(expires ? { expiresAt: endOfDay(expires) } : {}),
        },
      }),
    );
    if (ok) {
      setGrantee('');
      setDocIds([]);
      setConsentId('');
      setPurpose('');
      setExpires('');
    }
  };

  return (
    <Card className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">External sharing</h2>
        <p className="text-xs text-muted-foreground">
          An external collaborator sees only this matter&apos;s title, type, stage, status and
          client name, plus the documents you tick. Revoking takes effect immediately.
        </p>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {shares.data?.length ? (
        <ul className="divide-y rounded-md border text-sm">
          {shares.data.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="flex flex-col">
                <span className="font-medium">
                  {s.grantee.name}{' '}
                  {s.active ? (
                    <Badge tone="success">Active</Badge>
                  ) : (
                    <Badge>{s.revokedAt ? 'Revoked' : 'Expired'}</Badge>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {s.documents.length} document{s.documents.length === 1 ? '' : 's'}
                  {s.documents.length ? `: ${s.documents.map((d) => d.title).join(', ')}` : ''}
                  {s.expiresAt ? ` · until ${formatDate(s.expiresAt)}` : ''}
                  {s.consent ? ` · consent: ${s.consent.purpose}` : ' · no consent recorded'} · by{' '}
                  {s.createdBy.name}, {formatDateTime(s.createdAt)}
                </span>
              </span>
              {s.active ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void run(() =>
                      apiFetch(`/api/v1/shares/${s.id}/revoke`, { method: 'POST', tenantId }),
                    )
                  }
                >
                  Revoke
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : shares.isSuccess ? (
        <p className="text-sm text-muted-foreground">Not shared with anyone.</p>
      ) : null}
      {editable ? (
        <form
          onSubmit={(e) => void create(e)}
          className="flex flex-col gap-3 border-t pt-3"
          noValidate
        >
          {members.isSuccess && !externals.length ? (
            <p className="text-sm text-muted-foreground">
              No external collaborators yet. Invite one from the Team page as &quot;External&quot;.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="share-grantee">Share with</Label>
              <select
                id="share-grantee"
                className={selectClass}
                value={grantee}
                onChange={(e) => setGrantee(e.target.value)}
              >
                <option value="">Choose an external collaborator…</option>
                {externals.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.email})
                  </option>
                ))}
              </select>
            </div>
          )}
          {docs.length ? (
            <fieldset className="flex flex-col gap-1">
              <legend className="text-sm font-medium">Documents to include</legend>
              {docs.map((d) => (
                <label key={d.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={docIds.includes(d.id)}
                    onChange={() => toggle(d.id)}
                  />{' '}
                  {d.title}
                </label>
              ))}
            </fieldset>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="share-consent">Consent (optional)</Label>
              <select
                id="share-consent"
                className={selectClass}
                value={consentId}
                onChange={(e) => setConsentId(e.target.value)}
              >
                <option value="">None</option>
                {consents.data
                  ?.filter((c) => !c.withdrawnAt)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.purpose}
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="share-purpose">Purpose (optional)</Label>
              <Input
                id="share-purpose"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                maxLength={300}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="share-expires">Ends on (optional)</Label>
              <Input
                id="share-expires"
                type="date"
                value={expires}
                onChange={(e) => setExpires(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Button type="submit" size="sm" variant="outline">
              Share
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
