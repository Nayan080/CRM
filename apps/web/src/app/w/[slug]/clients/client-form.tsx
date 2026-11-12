'use client';

import { CLIENT_KINDS, type ClientDetail } from '@crm/contracts';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { FormField } from '@/components/forms/form-field';
import { SelectField, TextAreaField } from '@/components/forms/select-field';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/card';
import { apiFetch } from '@/lib/api/client';
import { cleanBody } from '@/lib/form-values';
import { applyApiError } from '@/lib/forms';
import { useBranches } from '@/lib/use-options';
import { useWorkspace } from '../workspace-context';

const FIELDS = [
  'kind',
  'displayName',
  'email',
  'phone',
  'dateOfBirth',
  'nationality',
  'addressLine',
  'notes',
  'branchId',
] as const;
const kindLabel = { INDIVIDUAL: 'Individual', BUSINESS: 'Business' } as const;

/** Create (no `client`) or edit a client. The API re-checks scope and every reference. */
export function ClientForm({
  client,
  onSaved,
}: {
  client?: ClientDetail;
  onSaved: (saved: ClientDetail) => void;
}) {
  const { tenantId, can } = useWorkspace();
  const branches = useBranches(tenantId, can('branch:read'));
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm({
    values: {
      kind: client?.kind ?? 'INDIVIDUAL',
      displayName: client?.displayName ?? '',
      email: client?.email ?? '',
      phone: client?.phone ?? '',
      dateOfBirth: client?.dateOfBirth ?? '',
      nationality: client?.nationality ?? '',
      addressLine: client?.addressLine ?? '',
      notes: client?.notes ?? '',
      branchId: client?.branch?.id ?? '',
    },
  });
  const kind = useWatch({ control: form.control, name: 'kind' });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const body = cleanBody(values, client ? 'update' : 'create');
    if (values.kind === 'BUSINESS') {
      if (client) body.dateOfBirth = null;
      else delete body.dateOfBirth;
    }
    try {
      const saved = await apiFetch<ClientDetail>(
        client ? `/api/v1/clients/${client.id}` : '/api/v1/clients',
        {
          method: client ? 'PATCH' : 'POST',
          body,
          tenantId,
        },
      );
      if (!client) form.reset();
      onSaved(saved);
    } catch (error) {
      setFormError(applyApiError(error, form.setError, [...FIELDS]));
    }
  });

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" noValidate>
      {formError ? <Alert>{formError}</Alert> : null}
      <SelectField
        id="client-kind"
        label="Type"
        registration={form.register('kind')}
        error={errors.kind}
      >
        {CLIENT_KINDS.map((k) => (
          <option key={k} value={k}>
            {kindLabel[k]}
          </option>
        ))}
      </SelectField>
      <FormField
        id="client-name"
        label={kind === 'BUSINESS' ? 'Business name' : 'Full name'}
        registration={form.register('displayName', { required: 'Required' })}
        error={errors.displayName}
      />
      <FormField
        id="client-email"
        label="Email"
        type="email"
        registration={form.register('email')}
        error={errors.email}
      />
      <FormField
        id="client-phone"
        label="Phone"
        registration={form.register('phone')}
        error={errors.phone}
      />
      {kind === 'INDIVIDUAL' ? (
        <FormField
          id="client-dob"
          label="Date of birth"
          type="date"
          registration={form.register('dateOfBirth')}
          error={errors.dateOfBirth}
        />
      ) : null}
      <FormField
        id="client-nationality"
        label="Nationality"
        registration={form.register('nationality')}
        error={errors.nationality}
      />
      <FormField
        id="client-address"
        label="Address"
        registration={form.register('addressLine')}
        error={errors.addressLine}
      />
      {branches.data?.length ? (
        <SelectField
          id="client-branch"
          label="Branch"
          registration={form.register('branchId')}
          error={errors.branchId}
        >
          <option value="">No branch</option>
          {branches.data
            .filter((b) => b.isActive || b.id === client?.branch?.id)
            .map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
        </SelectField>
      ) : null}
      <TextAreaField
        id="client-notes"
        label="Notes"
        registration={form.register('notes')}
        error={errors.notes}
      />
      <Button type="submit" disabled={isSubmitting}>
        {client ? 'Save changes' : 'Add client'}
      </Button>
    </form>
  );
}

export { kindLabel };
