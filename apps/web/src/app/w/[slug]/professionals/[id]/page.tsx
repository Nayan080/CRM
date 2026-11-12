'use client';

import {
  type CredentialResponse,
  type ProfessionalDetail,
  type VerificationStatus,
  createCredentialSchema,
} from '@crm/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
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
import { useWorkspace } from '../../workspace-context';
import { ProfessionalForm } from '../professional-form';

const STATUS_LABEL: Record<
  VerificationStatus,
  { text: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }
> = {
  UNVERIFIED: { text: 'Not verified', tone: 'neutral' },
  PENDING: { text: 'Verification pending', tone: 'warning' },
  VERIFIED: { text: 'Verified by your agency', tone: 'success' },
  REJECTED: { text: 'Rejected', tone: 'danger' },
};

const formatDate = (value: string | null) =>
  value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-AU') : '—';

function CredentialForm({
  professionalId,
  onSaved,
}: {
  professionalId: string;
  onSaved: () => void;
}) {
  const { tenantId } = useWorkspace();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(createCredentialSchema),
    defaultValues: { credentialType: '', issuer: '', identifier: '', issuedOn: '', expiresOn: '' },
  });
  const { errors, isSubmitting } = form.formState;
  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await apiFetch<CredentialResponse>(`/api/v1/professionals/${professionalId}/credentials`, {
        method: 'POST',
        body: values,
        tenantId,
      });
      form.reset();
      onSaved();
    } catch (error) {
      setFormError(
        applyApiError(error, form.setError, [
          'credentialType',
          'issuer',
          'identifier',
          'issuedOn',
          'expiresOn',
        ]),
      );
    }
  });
  return (
    <form onSubmit={(e) => void onSubmit(e)} className="grid gap-4 sm:grid-cols-2" noValidate>
      {formError ? (
        <div className="sm:col-span-2">
          <Alert>{formError}</Alert>
        </div>
      ) : null}
      <FormField
        id="cred-type"
        label="Credential type"
        hint="e.g. registration, practising certificate"
        registration={form.register('credentialType')}
        error={errors.credentialType}
      />
      <FormField
        id="cred-issuer"
        label="Issued by"
        registration={form.register('issuer')}
        error={errors.issuer}
      />
      <FormField
        id="cred-identifier"
        label="Registration / licence number"
        registration={form.register('identifier')}
        error={errors.identifier}
      />
      <div />
      <FormField
        id="cred-issued"
        label="Issue date"
        type="date"
        registration={form.register('issuedOn')}
        error={errors.issuedOn}
      />
      <FormField
        id="cred-expires"
        label="Expiry date"
        type="date"
        registration={form.register('expiresOn')}
        error={errors.expiresOn}
      />
      <div className="sm:col-span-2">
        <Button type="submit" disabled={isSubmitting}>
          Add credential
        </Button>
      </div>
    </form>
  );
}

export default function ProfessionalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { tenantId, slug, can } = useWorkspace();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const allowed = can('directory:read');
  const canManage = can('directory:manage');
  const professional = useQuery({
    queryKey: queryKeys.professional(tenantId, id),
    queryFn: () => apiFetch<ProfessionalDetail>(`/api/v1/professionals/${id}`, { tenantId }),
    enabled: allowed,
  });

  if (!allowed) return <ForbiddenState />;
  if (professional.isPending) return <LoadingState />;
  if (professional.isError) {
    return professional.error instanceof ApiError && professional.error.status === 404 ? (
      <EmptyState
        title="Professional not found"
        description="The profile may have been archived."
      />
    ) : (
      <ErrorState onRetry={() => void professional.refetch()} />
    );
  }

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.professional(tenantId, id) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.professionals(tenantId) });
  };
  const run = async (action: () => Promise<unknown>, after?: () => void) => {
    setError(null);
    try {
      await action();
      await refresh();
      after?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    }
  };
  const setStatus = (credential: CredentialResponse, status: VerificationStatus) =>
    void run(() =>
      apiFetch(`/api/v1/professionals/${id}/credentials/${credential.id}/verification`, {
        method: 'POST',
        body: { status },
        tenantId,
      }),
    );
  const data = professional.data;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/w/${slug}/professionals`}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          ← All professionals
        </Link>
        <h2 className="mt-2 text-xl font-semibold">{data.fullName}</h2>
        <p className="text-sm text-muted-foreground">
          {data.professionType.name}
          {data.partnerOrg
            ? ` · ${data.partnerOrg.name}`
            : data.organizationName
              ? ` · ${data.organizationName}`
              : ''}
        </p>
      </div>
      {error ? <Alert>{error}</Alert> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="mb-4 text-lg font-semibold">Details</h3>
          {canManage ? (
            <ProfessionalForm professional={data} onSaved={() => void refresh()} />
          ) : (
            <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">Email</dt>
              <dd>{data.email ?? '—'}</dd>
              <dt className="text-muted-foreground">Phone</dt>
              <dd>{data.phone ?? '—'}</dd>
              <dt className="text-muted-foreground">Notes</dt>
              <dd className="whitespace-pre-wrap">{data.notes ?? '—'}</dd>
            </dl>
          )}
        </Card>

        <Card className="flex flex-col gap-4">
          <div>
            <h3 className="text-lg font-semibold">Credentials</h3>
            <p className="text-sm text-muted-foreground">
              Recorded as provided. “Verified” means a person at your agency checked it — the system
              does not check registers itself.
            </p>
          </div>
          {data.credentials.length === 0 ? (
            <p className="text-sm text-muted-foreground">No credentials recorded.</p>
          ) : null}
          {data.credentials.length ? (
            <ul className="divide-y rounded-md border">
              {data.credentials.map((credential) => {
                const label = STATUS_LABEL[credential.status];
                return (
                  <li key={credential.id} className="flex flex-col gap-2 px-3 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {credential.credentialType} · {credential.identifier}
                      </span>
                      <span className="flex gap-2">
                        <Badge tone={label.tone}>{label.text}</Badge>
                        {credential.isExpired ? <Badge tone="danger">Expired</Badge> : null}
                      </span>
                    </div>
                    <span className="text-muted-foreground">
                      {credential.issuer} · Issued {formatDate(credential.issuedOn)} · Expires{' '}
                      {formatDate(credential.expiresOn)}
                    </span>
                    {credential.verificationNote ? (
                      <span className="text-muted-foreground">
                        Note: {credential.verificationNote}
                      </span>
                    ) : null}
                    {canManage ? (
                      <div className="flex flex-wrap gap-2">
                        {credential.status !== 'VERIFIED' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setStatus(credential, 'VERIFIED')}
                          >
                            Mark verified
                          </Button>
                        ) : null}
                        {credential.status !== 'REJECTED' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setStatus(credential, 'REJECTED')}
                          >
                            Reject
                          </Button>
                        ) : null}
                        {credential.status !== 'UNVERIFIED' ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setStatus(credential, 'UNVERIFIED')}
                          >
                            Reset
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            void run(() =>
                              apiFetch(`/api/v1/professionals/${id}/credentials/${credential.id}`, {
                                method: 'DELETE',
                                tenantId,
                              }),
                            )
                          }
                        >
                          Delete
                        </Button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
          {canManage ? <CredentialForm professionalId={id} onSaved={() => void refresh()} /> : null}
        </Card>
      </div>

      {canManage ? (
        <div>
          <Button
            variant="destructive"
            onClick={() =>
              void run(
                () => apiFetch(`/api/v1/professionals/${id}`, { method: 'DELETE', tenantId }),
                () => router.push(`/w/${slug}/professionals`),
              )
            }
          >
            Archive profile
          </Button>
        </div>
      ) : null}
    </div>
  );
}
