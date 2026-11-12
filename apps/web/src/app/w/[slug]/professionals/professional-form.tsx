'use client';

import {
  type PartnerSummary,
  type ProfessionalDetail,
  type ProfessionalSummary,
  createProfessionalSchema,
} from '@crm/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { FormField } from '@/components/forms/form-field';
import { SelectField, TextAreaField } from '@/components/forms/select-field';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/card';
import { apiFetch } from '@/lib/api/client';
import { applyApiError } from '@/lib/forms';
import { queryKeys } from '@/lib/queries';
import { useReferenceOptions } from '@/lib/use-options';
import { usePagedList } from '@/lib/use-paged-list';
import { useWorkspace } from '../workspace-context';

/** Create (no `professional`) or edit a directory profile. */
export function ProfessionalForm({
  professional,
  onSaved,
}: {
  professional?: ProfessionalDetail;
  onSaved: (saved: ProfessionalSummary) => void;
}) {
  const { tenantId } = useWorkspace();
  const types = useReferenceOptions(tenantId, 'PROFESSION_TYPE');
  const partners = usePagedList<PartnerSummary>(
    queryKeys.partners(tenantId),
    '/api/v1/partners',
    tenantId,
    '',
  );
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(createProfessionalSchema),
    values: {
      fullName: professional?.fullName ?? '',
      professionTypeId: professional?.professionType.id ?? '',
      email: professional?.email ?? '',
      phone: professional?.phone ?? '',
      organizationName: professional?.organizationName ?? '',
      partnerOrgId: professional?.partnerOrg?.id ?? '',
      notes: professional?.notes ?? '',
    },
  });
  const { errors, isSubmitting } = form.formState;
  const partnerRows = partners.data?.pages.flatMap((page) => page.data) ?? [];

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const saved = await apiFetch<ProfessionalSummary>(
        professional ? `/api/v1/professionals/${professional.id}` : '/api/v1/professionals',
        { method: professional ? 'PATCH' : 'POST', body: values, tenantId },
      );
      if (!professional) form.reset();
      onSaved(saved);
    } catch (error) {
      setFormError(
        applyApiError(error, form.setError, [
          'fullName',
          'professionTypeId',
          'email',
          'phone',
          'organizationName',
          'partnerOrgId',
          'notes',
        ]),
      );
    }
  });

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" noValidate>
      {formError ? <Alert>{formError}</Alert> : null}
      <FormField
        id="pro-name"
        label="Full name"
        registration={form.register('fullName')}
        error={errors.fullName}
      />
      <SelectField
        id="pro-type"
        label="Profession"
        registration={form.register('professionTypeId')}
        error={errors.professionTypeId}
      >
        <option value="">Choose…</option>
        {types.data
          ?.filter((t) => t.isActive || t.id === professional?.professionType.id)
          .map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
      </SelectField>
      <FormField
        id="pro-email"
        label="Email"
        type="email"
        registration={form.register('email')}
        error={errors.email}
      />
      <FormField
        id="pro-phone"
        label="Phone"
        type="tel"
        registration={form.register('phone')}
        error={errors.phone}
      />
      <SelectField
        id="pro-partner"
        label="Partner organization (optional)"
        registration={form.register('partnerOrgId')}
        error={errors.partnerOrgId}
      >
        <option value="">None</option>
        {partnerRows.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </SelectField>
      <FormField
        id="pro-org"
        label="Organization name (if not a listed partner)"
        registration={form.register('organizationName')}
        error={errors.organizationName}
      />
      <TextAreaField
        id="pro-notes"
        label="Notes"
        registration={form.register('notes')}
        error={errors.notes}
      />
      <Button type="submit" disabled={isSubmitting}>
        {professional ? 'Save changes' : 'Add professional'}
      </Button>
    </form>
  );
}
