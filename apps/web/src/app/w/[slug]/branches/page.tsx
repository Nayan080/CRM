'use client';

import { type BranchResponse, createBranchSchema } from '@crm/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { FormField } from '@/components/forms/form-field';
import {
  EmptyState,
  ErrorState,
  ForbiddenState,
  LoadingState,
} from '@/components/states/state-view';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { ApiError, apiFetch } from '@/lib/api/client';
import { applyApiError } from '@/lib/forms';
import { queryKeys } from '@/lib/queries';
import { useBranches } from '@/lib/use-options';
import { useWorkspace } from '../workspace-context';

function CreateBranchForm({ onCreated }: { onCreated: () => void }) {
  const { tenantId } = useWorkspace();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(createBranchSchema),
    defaultValues: { name: '', city: '', region: '', phone: '', timezone: '' },
  });
  const { errors, isSubmitting } = form.formState;
  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await apiFetch<BranchResponse>('/api/v1/branches', {
        method: 'POST',
        body: values,
        tenantId,
      });
      form.reset();
      onCreated();
    } catch (error) {
      setFormError(
        applyApiError(error, form.setError, ['name', 'city', 'region', 'phone', 'timezone']),
      );
    }
  });
  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" noValidate>
      {formError ? <Alert>{formError}</Alert> : null}
      <FormField
        id="branch-name"
        label="Branch name"
        registration={form.register('name')}
        error={errors.name}
      />
      <FormField
        id="branch-city"
        label="City / suburb"
        registration={form.register('city')}
        error={errors.city}
      />
      <FormField
        id="branch-region"
        label="State"
        registration={form.register('region')}
        error={errors.region}
      />
      <FormField
        id="branch-phone"
        label="Phone"
        type="tel"
        registration={form.register('phone')}
        error={errors.phone}
      />
      <FormField
        id="branch-timezone"
        label="Time zone"
        hint="Leave empty to use the agency's time zone"
        registration={form.register('timezone')}
        error={errors.timezone}
      />
      <Button type="submit" disabled={isSubmitting}>
        Add branch
      </Button>
    </form>
  );
}

export default function BranchesPage() {
  const { tenantId, can } = useWorkspace();
  const queryClient = useQueryClient();
  const allowed = can('branch:read');
  const canManage = can('branch:manage');
  const branches = useBranches(tenantId, allowed);
  const [error, setError] = useState<string | null>(null);

  if (!allowed) return <ForbiddenState />;

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.branches(tenantId) });
  const toggle = async (branch: BranchResponse) => {
    setError(null);
    try {
      await apiFetch(`/api/v1/branches/${branch.id}`, {
        method: 'PATCH',
        body: { isActive: !branch.isActive },
        tenantId,
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    }
    await refresh();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Branches</h2>
        {error ? <Alert>{error}</Alert> : null}
        {branches.isPending ? <LoadingState /> : null}
        {branches.isError ? <ErrorState onRetry={() => void branches.refetch()} /> : null}
        {branches.data?.length === 0 ? (
          <EmptyState
            title="No branches yet"
            description="Add a branch for each office or operating unit."
          />
        ) : null}
        {branches.data?.length ? (
          <ul className="divide-y rounded-md border bg-card">
            {branches.data.map((branch) => (
              <li
                key={branch.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="flex flex-col">
                  <span className="flex items-center gap-2 font-medium">
                    {branch.name}
                    {branch.isActive ? null : <Badge>Inactive</Badge>}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {[branch.city, branch.region].filter(Boolean).join(', ') || 'No address'} ·{' '}
                    {branch.memberCount} {branch.memberCount === 1 ? 'member' : 'members'}
                    {branch.timezone ? ` · ${branch.timezone}` : ''}
                  </span>
                </div>
                {canManage ? (
                  <Button variant="outline" size="sm" onClick={() => void toggle(branch)}>
                    {branch.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      {canManage ? (
        <aside>
          <Card>
            <h2 className="mb-4 text-lg font-semibold">Add a branch</h2>
            <CreateBranchForm onCreated={() => void refresh()} />
          </Card>
        </aside>
      ) : null}
    </div>
  );
}
