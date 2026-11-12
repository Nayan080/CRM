'use client';

import type {
  LeadDetail,
  MemberSummary,
  Paginated,
  PartnerDetail,
  PartnerSummary,
} from '@crm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { FormField } from '@/components/forms/form-field';
import { SelectField, TextAreaField } from '@/components/forms/select-field';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/card';
import { apiFetch } from '@/lib/api/client';
import { cleanBody } from '@/lib/form-values';
import { applyApiError } from '@/lib/forms';
import { queryKeys } from '@/lib/queries';
import { useBranches, useReferenceOptions } from '@/lib/use-options';
import { useWorkspace } from '../workspace-context';

const FIELDS = [
  'fullName',
  'email',
  'phone',
  'sourceId',
  'referredByPartnerId',
  'referredByContactId',
  'interest',
  'notes',
  'branchId',
  'ownerMembershipId',
] as const;

/** Create (no `lead`) or edit a lead. The API re-checks scope and every reference. */
export function LeadForm({
  lead,
  onSaved,
}: {
  lead?: LeadDetail;
  onSaved: (saved: LeadDetail) => void;
}) {
  const { tenantId, can } = useWorkspace();
  const sources = useReferenceOptions(tenantId, 'LEAD_SOURCE');
  const branches = useBranches(tenantId, can('branch:read'));
  const members = useQuery({
    queryKey: queryKeys.members(tenantId),
    queryFn: () => apiFetch<MemberSummary[]>('/api/v1/members', { tenantId }),
    enabled: can('member:read'),
  });
  const partners = useQuery({
    queryKey: [...queryKeys.partners(tenantId), 'all'],
    queryFn: () => apiFetch<Paginated<PartnerSummary>>('/api/v1/partners?limit=100', { tenantId }),
    enabled: can('directory:read'),
  });
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm({
    values: {
      fullName: lead?.fullName ?? '',
      email: lead?.email ?? '',
      phone: lead?.phone ?? '',
      sourceId: lead?.source?.id ?? '',
      referredByPartnerId: lead?.referredBy?.id ?? '',
      referredByContactId: lead?.referredContact?.id ?? '',
      interest: lead?.interest ?? '',
      notes: lead?.notes ?? '',
      branchId: lead?.branch?.id ?? '',
      ownerMembershipId: lead?.owner?.id ?? '',
    },
  });
  const partnerId = useWatch({ control: form.control, name: 'referredByPartnerId' });
  const partner = useQuery({
    queryKey: queryKeys.partner(tenantId, partnerId),
    queryFn: () => apiFetch<PartnerDetail>(`/api/v1/partners/${partnerId}`, { tenantId }),
    enabled: !!partnerId,
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const body = cleanBody(values, lead ? 'update' : 'create');
    if (!lead && !values.ownerMembershipId) delete body.ownerMembershipId; // defaults to me
    try {
      const saved = await apiFetch<LeadDetail>(
        lead ? `/api/v1/leads/${lead.id}` : '/api/v1/leads',
        {
          method: lead ? 'PATCH' : 'POST',
          body,
          tenantId,
        },
      );
      if (!lead) form.reset();
      onSaved(saved);
    } catch (error) {
      setFormError(applyApiError(error, form.setError, [...FIELDS]));
    }
  });

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" noValidate>
      {formError ? <Alert>{formError}</Alert> : null}
      <FormField
        id="lead-name"
        label="Full name"
        registration={form.register('fullName', { required: 'Required' })}
        error={errors.fullName}
      />
      <FormField
        id="lead-email"
        label="Email"
        type="email"
        registration={form.register('email')}
        error={errors.email}
      />
      <FormField
        id="lead-phone"
        label="Phone"
        registration={form.register('phone')}
        error={errors.phone}
      />
      <SelectField
        id="lead-source"
        label="Source"
        registration={form.register('sourceId')}
        error={errors.sourceId}
      >
        <option value="">Not recorded</option>
        {sources.data
          ?.filter((o) => o.isActive || o.id === lead?.source?.id)
          .map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
      </SelectField>
      {can('directory:read') ? (
        <>
          <SelectField
            id="lead-partner"
            label="Referred by partner (optional)"
            registration={form.register('referredByPartnerId', {
              onChange: () => form.setValue('referredByContactId', ''),
            })}
            error={errors.referredByPartnerId}
          >
            <option value="">None</option>
            {partners.data?.data.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>
          {partnerId ? (
            <SelectField
              id="lead-contact"
              label="Referring contact (optional)"
              registration={form.register('referredByContactId')}
              error={errors.referredByContactId}
            >
              <option value="">None</option>
              {partner.data?.contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fullName}
                </option>
              ))}
            </SelectField>
          ) : null}
        </>
      ) : null}
      <FormField
        id="lead-interest"
        label="Interest"
        registration={form.register('interest')}
        error={errors.interest}
      />
      {branches.data?.length ? (
        <SelectField
          id="lead-branch"
          label="Branch"
          registration={form.register('branchId')}
          error={errors.branchId}
        >
          <option value="">No branch</option>
          {branches.data
            .filter((b) => b.isActive || b.id === lead?.branch?.id)
            .map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
        </SelectField>
      ) : null}
      {members.data ? (
        <SelectField
          id="lead-owner"
          label="Owner"
          registration={form.register('ownerMembershipId')}
          error={errors.ownerMembershipId}
        >
          <option value="">{lead ? 'Unassigned' : 'Me'}</option>
          {members.data
            .filter((m) => m.kind === 'STAFF' && m.status === 'ACTIVE')
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </SelectField>
      ) : null}
      <TextAreaField
        id="lead-notes"
        label="Notes"
        registration={form.register('notes')}
        error={errors.notes}
      />
      <Button type="submit" disabled={isSubmitting}>
        {lead ? 'Save changes' : 'Add lead'}
      </Button>
    </form>
  );
}
