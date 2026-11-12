'use client';

import { type PartnerDetail, type PartnerSummary, createPartnerSchema } from '@crm/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { FormField } from '@/components/forms/form-field';
import { SelectField, TextAreaField } from '@/components/forms/select-field';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/card';
import { apiFetch } from '@/lib/api/client';
import { applyApiError } from '@/lib/forms';
import { useReferenceOptions } from '@/lib/use-options';
import { useWorkspace } from '../workspace-context';

/** Create (no `partner`) or edit an existing partner organization. */
export function PartnerForm({
  partner,
  onSaved,
}: {
  partner?: PartnerDetail;
  onSaved: (saved: PartnerSummary) => void;
}) {
  const { tenantId } = useWorkspace();
  const types = useReferenceOptions(tenantId, 'PARTNER_TYPE');
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(createPartnerSchema),
    values: {
      name: partner?.name ?? '',
      typeId: partner?.type.id ?? '',
      website: partner?.website ?? '',
      email: partner?.email ?? '',
      phone: partner?.phone ?? '',
      notes: partner?.notes ?? '',
    },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const saved = await apiFetch<PartnerSummary>(
        partner ? `/api/v1/partners/${partner.id}` : '/api/v1/partners',
        {
          method: partner ? 'PATCH' : 'POST',
          body: values,
          tenantId,
        },
      );
      if (!partner) form.reset();
      onSaved(saved);
    } catch (error) {
      setFormError(
        applyApiError(error, form.setError, [
          'name',
          'typeId',
          'website',
          'email',
          'phone',
          'notes',
        ]),
      );
    }
  });

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" noValidate>
      {formError ? <Alert>{formError}</Alert> : null}
      <FormField
        id="partner-name"
        label="Organization name"
        registration={form.register('name')}
        error={errors.name}
      />
      <SelectField
        id="partner-type"
        label="Type"
        registration={form.register('typeId')}
        error={errors.typeId}
      >
        <option value="">Choose…</option>
        {types.data
          ?.filter((t) => t.isActive || t.id === partner?.type.id)
          .map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
      </SelectField>
      <FormField
        id="partner-website"
        label="Website"
        hint="e.g. https://example.com"
        registration={form.register('website')}
        error={errors.website}
      />
      <FormField
        id="partner-email"
        label="Email"
        type="email"
        registration={form.register('email')}
        error={errors.email}
      />
      <FormField
        id="partner-phone"
        label="Phone"
        type="tel"
        registration={form.register('phone')}
        error={errors.phone}
      />
      <TextAreaField
        id="partner-notes"
        label="Notes"
        registration={form.register('notes')}
        error={errors.notes}
      />
      <Button type="submit" disabled={isSubmitting}>
        {partner ? 'Save changes' : 'Add partner'}
      </Button>
    </form>
  );
}
