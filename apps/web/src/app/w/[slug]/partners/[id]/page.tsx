'use client';

import {
  type PartnerContactResponse,
  type PartnerDetail,
  createPartnerContactSchema,
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
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { ApiError, apiFetch } from '@/lib/api/client';
import { applyApiError } from '@/lib/forms';
import { queryKeys } from '@/lib/queries';
import { useWorkspace } from '../../workspace-context';
import { PartnerForm } from '../partner-form';

function ContactForm({ partnerId, onSaved }: { partnerId: string; onSaved: () => void }) {
  const { tenantId } = useWorkspace();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(createPartnerContactSchema),
    defaultValues: { fullName: '', email: '', phone: '', position: '' },
  });
  const { errors, isSubmitting } = form.formState;
  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await apiFetch<PartnerContactResponse>(`/api/v1/partners/${partnerId}/contacts`, {
        method: 'POST',
        body: values,
        tenantId,
      });
      form.reset();
      onSaved();
    } catch (error) {
      setFormError(applyApiError(error, form.setError, ['fullName', 'email', 'phone', 'position']));
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
        id="contact-name"
        label="Full name"
        registration={form.register('fullName')}
        error={errors.fullName}
      />
      <FormField
        id="contact-position"
        label="Position"
        registration={form.register('position')}
        error={errors.position}
      />
      <FormField
        id="contact-email"
        label="Email"
        type="email"
        registration={form.register('email')}
        error={errors.email}
      />
      <FormField
        id="contact-phone"
        label="Phone"
        type="tel"
        registration={form.register('phone')}
        error={errors.phone}
      />
      <div className="sm:col-span-2">
        <Button type="submit" disabled={isSubmitting}>
          Add contact
        </Button>
      </div>
    </form>
  );
}

export default function PartnerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { tenantId, slug, can } = useWorkspace();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const allowed = can('directory:read');
  const canManage = can('partner:manage');
  const partner = useQuery({
    queryKey: queryKeys.partner(tenantId, id),
    queryFn: () => apiFetch<PartnerDetail>(`/api/v1/partners/${id}`, { tenantId }),
    enabled: allowed,
  });

  if (!allowed) return <ForbiddenState />;
  if (partner.isPending) return <LoadingState />;
  if (partner.isError) {
    return partner.error instanceof ApiError && partner.error.status === 404 ? (
      <EmptyState title="Partner not found" description="It may have been archived." />
    ) : (
      <ErrorState onRetry={() => void partner.refetch()} />
    );
  }

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.partner(tenantId, id) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.partners(tenantId) });
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
  const data = partner.data;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/w/${slug}/partners`}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          ← All partners
        </Link>
        <h2 className="mt-2 text-xl font-semibold">{data.name}</h2>
        <p className="text-sm text-muted-foreground">{data.type.name}</p>
      </div>
      {error ? <Alert>{error}</Alert> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="mb-4 text-lg font-semibold">Details</h3>
          {canManage ? (
            <PartnerForm partner={data} onSaved={() => void refresh()} />
          ) : (
            <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">Website</dt>
              <dd>{data.website ?? '—'}</dd>
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
          <h3 className="text-lg font-semibold">Contacts</h3>
          {data.contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No contacts yet.</p>
          ) : null}
          {data.contacts.length ? (
            <ul className="divide-y rounded-md border">
              {data.contacts.map((contact) => (
                <li
                  key={contact.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="font-medium">{contact.fullName}</span>
                    <span className="truncate text-muted-foreground">
                      {[contact.position, contact.email, contact.phone]
                        .filter(Boolean)
                        .join(' · ') || 'No details'}
                    </span>
                  </div>
                  {canManage ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void run(() =>
                          apiFetch(`/api/v1/partners/${id}/contacts/${contact.id}`, {
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
          ) : null}
          {canManage ? <ContactForm partnerId={id} onSaved={() => void refresh()} /> : null}
        </Card>
      </div>

      {canManage ? (
        <div>
          <Button
            variant="destructive"
            onClick={() =>
              void run(
                () => apiFetch(`/api/v1/partners/${id}`, { method: 'DELETE', tenantId }),
                () => router.push(`/w/${slug}/partners`),
              )
            }
          >
            Archive partner
          </Button>
        </div>
      ) : null}
    </div>
  );
}
