'use client';

import { type WorkspaceSummary, createTenantSchema } from '@crm/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { FormField } from '@/components/forms/form-field';
import { EmptyState, ErrorState, LoadingState } from '@/components/states/state-view';
import { Alert, Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api/client';
import { RequireAuth } from '@/lib/auth/require-auth';
import { applyApiError } from '@/lib/forms';
import { queryKeys } from '@/lib/queries';

function CreateWorkspaceForm({ onCreated }: { onCreated: (ws: WorkspaceSummary) => void }) {
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(createTenantSchema) });
  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      onCreated(
        await apiFetch<WorkspaceSummary>('/api/v1/tenants', { method: 'POST', body: values }),
      );
    } catch (error) {
      setFormError(applyApiError(error, form.setError, ['name', 'slug']));
    }
  });
  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" noValidate>
      {formError ? <Alert>{formError}</Alert> : null}
      <FormField
        id="name"
        label="Agency name"
        registration={form.register('name')}
        error={form.formState.errors.name}
      />
      <FormField
        id="slug"
        label="Workspace address"
        hint="Lowercase letters, numbers and hyphens, e.g. acme-migration"
        registration={form.register('slug')}
        error={form.formState.errors.slug}
      />
      <Button type="submit" disabled={form.formState.isSubmitting}>
        Create workspace
      </Button>
    </form>
  );
}

function Workspaces() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const query = useQuery({
    queryKey: queryKeys.workspaces,
    queryFn: () => apiFetch<WorkspaceSummary[]>('/api/v1/me/workspaces'),
  });
  const created = useMutation({
    mutationFn: (ws: WorkspaceSummary) => Promise.resolve(ws),
    onSuccess: async (ws) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      router.push(ws.mfaSetupRequired ? '/account/security?required=1' : `/w/${ws.slug}`);
    },
  });

  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />;

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Your workspaces</h1>
        <Button variant="outline" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? 'Cancel' : 'New workspace'}
        </Button>
      </div>

      {showCreate ? (
        <Card className="max-w-md">
          <CreateWorkspaceForm onCreated={(ws) => created.mutate(ws)} />
        </Card>
      ) : null}

      {query.data.length === 0 ? (
        <EmptyState
          title="No workspaces yet"
          description="Create a workspace for your agency, or ask your agency to invite you."
        />
      ) : (
        <ul className="divide-y rounded-md border bg-card">
          {query.data.map((ws) => (
            <li key={ws.tenantId} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="flex flex-col">
                <span className="font-medium">{ws.name}</span>
                <span className="text-sm text-muted-foreground">
                  {ws.kind === 'EXTERNAL' ? 'External collaborator' : ws.role?.name}
                </span>
              </div>
              {ws.status !== 'ACTIVE' ? (
                <span className="text-sm text-muted-foreground">
                  {ws.status === 'SUSPENDED' ? 'Suspended' : 'Closing'} — contact support
                </span>
              ) : ws.mfaSetupRequired ? (
                <Link
                  href="/account/security?required=1"
                  className="text-sm text-warning underline-offset-4 hover:underline"
                >
                  Set up two-factor to open
                </Link>
              ) : (
                <Link
                  href={`/w/${ws.slug}`}
                  className="text-sm text-primary underline-offset-4 hover:underline"
                >
                  Open
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function WorkspacesPage() {
  return (
    <RequireAuth>
      <Workspaces />
    </RequireAuth>
  );
}
