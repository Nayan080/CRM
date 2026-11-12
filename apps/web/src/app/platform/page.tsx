'use client';

import {
  type Paginated,
  type PlanResponse,
  type PlatformTenantSummary,
  TENANT_STATUSES,
  type TenantStatus,
} from '@crm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { selectClass } from '@/components/forms/select-field';
import { SearchBox } from '@/components/search-box';
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
import { useAuth } from '@/lib/auth/auth-context';
import { RequireAuth } from '@/lib/auth/require-auth';
import { formatDate } from '@/lib/form-values';

const statusLabel: Record<TenantStatus, string> = {
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  PENDING_DELETION: 'Pending deletion',
};
const statusTone: Record<TenantStatus, 'success' | 'warning' | 'danger'> = {
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  PENDING_DELETION: 'danger',
};
const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong.');
const KEYS = { tenants: ['platform', 'tenants'], plans: ['platform', 'plans'] } as const;

function TenantRow({
  t,
  plans,
  canEdit,
}: {
  t: PlatformTenantSummary;
  plans: PlanResponse[];
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<TenantStatus>(t.status);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = async (body: object) => {
    setError(null);
    try {
      await apiFetch(`/api/v1/platform/tenants/${t.id}`, { method: 'PATCH', body });
      setReason('');
      await queryClient.invalidateQueries({ queryKey: KEYS.tenants });
      await queryClient.invalidateQueries({ queryKey: KEYS.plans });
    } catch (e) {
      setError(errText(e));
    }
  };
  const limit = t.plan?.maxStaffUsers;
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="font-medium">
            {t.name} <span className="text-muted-foreground">({t.slug})</span>{' '}
            <Badge tone={statusTone[t.status]}>{statusLabel[t.status]}</Badge>
          </span>
          <span className="text-xs text-muted-foreground">
            Staff {t.usage.staffUsers}
            {limit ? ` / ${limit}` : ''} · pending staff invites {t.usage.pendingStaffInvites} ·
            external {t.usage.externalUsers} · plan {t.plan?.name ?? 'none (no limits)'} · created{' '}
            {formatDate(t.createdAt)}
            {t.statusReason ? ` · reason: ${t.statusReason}` : ''}
          </span>
        </div>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {canEdit ? (
        <div className="flex flex-wrap items-end gap-2">
          <select
            aria-label={`Plan for ${t.name}`}
            className={`${selectClass} w-auto`}
            value={t.plan?.id ?? ''}
            onChange={(e) => void save({ planId: e.target.value || null })}
          >
            <option value="">No plan (no limits)</option>
            {plans
              .filter((p) => p.isActive || p.id === t.plan?.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.maxStaffUsers ? ` (${p.maxStaffUsers} staff)` : ' (unlimited)'}
                </option>
              ))}
          </select>
          <select
            aria-label={`Status for ${t.name}`}
            className={`${selectClass} w-auto`}
            value={status}
            onChange={(e) => setStatus(e.target.value as TenantStatus)}
          >
            {TENANT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel[s]}
              </option>
            ))}
          </select>
          <Input
            aria-label={`Reason for ${t.name}`}
            placeholder="Reason (required)"
            className="w-56"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={status === t.status || !reason.trim()}
            onClick={() => void save({ status, reason })}
          >
            Change status
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function Plans({ plans, canEdit }: { plans: PlanResponse[]; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ key: '', name: '', max: '' });
  const [error, setError] = useState<string | null>(null);
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/api/v1/platform/plans', {
        method: 'POST',
        body: { key: form.key, name: form.name, maxStaffUsers: form.max ? Number(form.max) : null },
      });
      setForm({ key: '', name: '', max: '' });
      await queryClient.invalidateQueries({ queryKey: KEYS.plans });
    } catch (err) {
      setError(errText(err));
    }
  };
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Plans</h2>
      <p className="text-xs text-muted-foreground">
        Usage limits only — there are no payments in this version.
      </p>
      {error ? <Alert>{error}</Alert> : null}
      {plans.length ? (
        <ul className="divide-y rounded-md border text-sm">
          {plans.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span>
                {p.name} <span className="text-muted-foreground">({p.key})</span> ·{' '}
                {p.maxStaffUsers ?? 'unlimited'} staff · {p.tenantCount} agenc
                {p.tenantCount === 1 ? 'y' : 'ies'} {p.isActive ? null : <Badge>Inactive</Badge>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No plans yet. Agencies without a plan have no limits.
        </p>
      )}
      {canEdit ? (
        <form
          onSubmit={(e) => void create(e)}
          className="flex flex-wrap items-end gap-2 border-t pt-3"
          noValidate
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="plan-key">Key</Label>
            <Input
              id="plan-key"
              value={form.key}
              onChange={(e) => setForm({ ...form, key: e.target.value })}
              placeholder="e.g. small"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="plan-name">Name</Label>
            <Input
              id="plan-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="plan-max">Max staff (blank = unlimited)</Label>
            <Input
              id="plan-max"
              type="number"
              min={1}
              value={form.max}
              onChange={(e) => setForm({ ...form, max: e.target.value })}
            />
          </div>
          <Button type="submit" size="sm" variant="outline">
            Add plan
          </Button>
        </form>
      ) : null}
    </Card>
  );
}

function PlatformAdmin() {
  const { state } = useAuth();
  const roles = state.status === 'authenticated' ? state.user.platformRoles : [];
  const canEdit = roles.includes('SUPER_ADMIN');
  const [search, setSearch] = useState('');
  const tenants = useQuery({
    queryKey: [...KEYS.tenants, search],
    queryFn: () =>
      apiFetch<Paginated<PlatformTenantSummary>>(
        `/api/v1/platform/tenants?limit=100${search ? `&q=${encodeURIComponent(search)}` : ''}`,
      ),
    enabled: roles.length > 0,
  });
  const plans = useQuery({
    queryKey: KEYS.plans,
    queryFn: () => apiFetch<PlanResponse[]>('/api/v1/platform/plans'),
    enabled: roles.length > 0,
  });

  if (!roles.length) return <ForbiddenState />;
  if (tenants.isError || plans.isError) {
    const e = tenants.error ?? plans.error;
    return e instanceof ApiError && e.status === 403 ? (
      <Alert>{e.message}</Alert>
    ) : (
      <ErrorState onRetry={() => void tenants.refetch()} />
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Platform</h1>
        <p className="text-sm text-muted-foreground">
          Agency metadata and usage only. Client, matter and document data is never shown here.
          {canEdit ? '' : ' Your role can view but not change.'}
        </p>
      </div>
      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Agencies</h2>
        <SearchBox label="Search agencies" onSearch={setSearch} />
        {tenants.isPending || plans.isPending ? <LoadingState /> : null}
        {tenants.data && !tenants.data.data.length ? <EmptyState title="No agencies" /> : null}
        {tenants.data?.data.length && plans.data ? (
          <ul className="divide-y rounded-md border">
            {tenants.data.data.map((t) => (
              <TenantRow
                key={`${t.id}:${t.status}:${t.plan?.id ?? ''}`}
                t={t}
                plans={plans.data}
                canEdit={canEdit}
              />
            ))}
          </ul>
        ) : null}
      </Card>
      {plans.data ? <Plans plans={plans.data} canEdit={canEdit} /> : null}
    </div>
  );
}

export default function PlatformPage() {
  return (
    <RequireAuth>
      <PlatformAdmin />
    </RequireAuth>
  );
}
