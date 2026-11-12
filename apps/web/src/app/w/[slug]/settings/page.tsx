'use client';

import {
  type ReferenceCategory,
  type ReferenceOptionResponse,
  type TenantResponse,
  updateTenantSchema,
} from '@crm/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useForm } from 'react-hook-form';
import { FormField } from '@/components/forms/form-field';
import { ErrorState, ForbiddenState, LoadingState } from '@/components/states/state-view';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ApiError, apiFetch } from '@/lib/api/client';
import { applyApiError } from '@/lib/forms';
import { queryKeys } from '@/lib/queries';
import { useReferenceOptions } from '@/lib/use-options';
import { useWorkspace } from '../workspace-context';
import { AutomationSettings } from './automation';
import { MatterTypesSettings } from './matter-types';

const PROFILE_FIELDS = [
  'name',
  'legalName',
  'phone',
  'contactEmail',
  'website',
  'addressLine',
  'city',
  'region',
  'postcode',
  'timezone',
] as const;

function ProfileForm({ tenant }: { tenant: TenantResponse }) {
  const { tenantId } = useWorkspace();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const form = useForm({
    resolver: zodResolver(updateTenantSchema),
    values: {
      name: tenant.name,
      legalName: tenant.legalName ?? '',
      phone: tenant.phone ?? '',
      contactEmail: tenant.contactEmail ?? '',
      website: tenant.website ?? '',
      addressLine: tenant.addressLine ?? '',
      city: tenant.city ?? '',
      region: tenant.region ?? '',
      postcode: tenant.postcode ?? '',
      timezone: tenant.timezone,
    },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setMessage(null);
    try {
      await apiFetch<TenantResponse>('/api/v1/tenant', { method: 'PATCH', body: values, tenantId });
      await queryClient.invalidateQueries({ queryKey: ['tenant', tenantId] });
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      setMessage({ tone: 'success', text: 'Agency profile saved.' });
    } catch (error) {
      const text = applyApiError(error, form.setError, PROFILE_FIELDS);
      if (text) setMessage({ tone: 'error', text });
    }
  });

  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold">Agency profile</h2>
      <form onSubmit={(e) => void onSubmit(e)} className="grid gap-4 sm:grid-cols-2" noValidate>
        {message ? (
          <div className="sm:col-span-2">
            <Alert tone={message.tone}>{message.text}</Alert>
          </div>
        ) : null}
        <FormField
          id="name"
          label="Agency name"
          registration={form.register('name')}
          error={errors.name}
        />
        <FormField
          id="legalName"
          label="Legal name"
          registration={form.register('legalName')}
          error={errors.legalName}
        />
        <FormField
          id="phone"
          label="Phone"
          type="tel"
          registration={form.register('phone')}
          error={errors.phone}
        />
        <FormField
          id="contactEmail"
          label="Contact email"
          type="email"
          registration={form.register('contactEmail')}
          error={errors.contactEmail}
        />
        <FormField
          id="website"
          label="Website"
          hint="Full address, e.g. https://example.com"
          registration={form.register('website')}
          error={errors.website}
        />
        <FormField
          id="timezone"
          label="Time zone"
          hint="e.g. Australia/Sydney"
          registration={form.register('timezone')}
          error={errors.timezone}
        />
        <FormField
          id="addressLine"
          label="Street address"
          registration={form.register('addressLine')}
          error={errors.addressLine}
        />
        <FormField
          id="city"
          label="City / suburb"
          registration={form.register('city')}
          error={errors.city}
        />
        <FormField
          id="region"
          label="State"
          registration={form.register('region')}
          error={errors.region}
        />
        <FormField
          id="postcode"
          label="Postcode"
          registration={form.register('postcode')}
          error={errors.postcode}
        />
        <div className="sm:col-span-2">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save profile'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function OptionList({
  category,
  title,
  help,
}: {
  category: ReferenceCategory;
  title: string;
  help: string;
}) {
  const { tenantId } = useWorkspace();
  const queryClient = useQueryClient();
  const options = useReferenceOptions(tenantId, category);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.options(tenantId, category) });
  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    }
    await refresh();
  };
  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    void run(async () => {
      await apiFetch('/api/v1/reference-options', {
        method: 'POST',
        body: { category, name },
        tenantId,
      });
      setName('');
    });
  };
  const toggle = (option: ReferenceOptionResponse) =>
    void run(() =>
      apiFetch(`/api/v1/reference-options/${option.id}`, {
        method: 'PATCH',
        body: { isActive: !option.isActive },
        tenantId,
      }),
    );

  return (
    <Card className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{help}</p>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {options.isPending ? <LoadingState /> : null}
      {options.isError ? <ErrorState onRetry={() => void options.refetch()} /> : null}
      {options.data ? (
        <ul className="divide-y rounded-md border">
          {options.data.map((option) => (
            <li
              key={option.id}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            >
              <span className="flex items-center gap-2">
                {option.name}
                {option.isActive ? null : <Badge>Inactive</Badge>}
              </span>
              <Button variant="ghost" size="sm" onClick={() => toggle(option)}>
                {option.isActive ? 'Deactivate' : 'Activate'}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <form onSubmit={add} className="flex gap-2">
        <Input
          aria-label={`New value for ${title}`}
          placeholder="Add a value"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
        />
        <Button type="submit" variant="outline">
          Add
        </Button>
      </form>
    </Card>
  );
}

export default function SettingsPage() {
  const { tenantId, can } = useWorkspace();
  const allowed = can('tenant:update');
  const tenant = useQuery({
    queryKey: queryKeys.tenant(tenantId),
    queryFn: () => apiFetch<TenantResponse>('/api/v1/tenant', { tenantId }),
    enabled: allowed,
  });

  if (!allowed) return <ForbiddenState />;
  if (tenant.isPending) return <LoadingState />;
  if (tenant.isError) return <ErrorState onRetry={() => void tenant.refetch()} />;

  return (
    <div className="flex flex-col gap-6">
      <ProfileForm tenant={tenant.data} />
      <div className="grid gap-6 lg:grid-cols-2">
        <OptionList
          category="PROFESSION_TYPE"
          title="Profession types"
          help="Labels for the professional directory. A label never grants access or implies legal authority."
        />
        <OptionList
          category="PARTNER_TYPE"
          title="Partner types"
          help="Categories for partner organizations."
        />
        <OptionList
          category="LEAD_SOURCE"
          title="Lead sources"
          help="Where enquiries come from. Referral partners are recorded separately on each lead."
        />
        <OptionList
          category="RELATIONSHIP_TYPE"
          title="Client relationship types"
          help="How linked client records relate, e.g. family member or dependant."
        />
        <OptionList
          category="PARTICIPANT_ROLE"
          title="Matter participant roles"
          help="Roles of people and organizations involved in a matter, e.g. dependant or sponsor."
        />
      </div>
      <AutomationSettings />
      <MatterTypesSettings />
    </div>
  );
}
