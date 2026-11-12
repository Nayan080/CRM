'use client';

import {
  type CreateInvitationInput,
  type InvitationSummary,
  type MemberSummary,
  emailSchema,
  roleKeySchema,
} from '@crm/contracts';
import { ROLE_TEMPLATES } from '@crm/permissions';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { FormField } from '@/components/forms/form-field';
import {
  EmptyState,
  ErrorState,
  ForbiddenState,
  LoadingState,
} from '@/components/states/state-view';
import { Alert, Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/input';
import { ApiError, apiFetch } from '@/lib/api/client';
import { applyApiError } from '@/lib/forms';
import { queryKeys } from '@/lib/queries';
import { useBranches } from '@/lib/use-options';
import { useWorkspace } from '../workspace-context';
import { MemberBranches } from './member-branches';

const selectClass =
  'h-9 rounded-md border bg-card px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring';

const inviteFormSchema = z
  .object({ email: emailSchema, kind: z.enum(['STAFF', 'EXTERNAL']), roleKey: z.string() })
  .refine((v) => v.kind === 'EXTERNAL' || roleKeySchema.safeParse(v.roleKey).success, {
    path: ['roleKey'],
    message: 'Choose a role',
  });

function InviteForm({ tenantId, onInvited }: { tenantId: string; onInvited: () => void }) {
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const form = useForm({
    resolver: zodResolver(inviteFormSchema),
    defaultValues: { email: '', kind: 'STAFF' as const, roleKey: 'migration_agent' },
  });
  const kind = useWatch({ control: form.control, name: 'kind' });

  const onSubmit = form.handleSubmit(async (values) => {
    setMessage(null);
    const body: CreateInvitationInput =
      values.kind === 'EXTERNAL'
        ? { kind: 'EXTERNAL', email: values.email }
        : { kind: 'STAFF', email: values.email, roleKey: values.roleKey };
    try {
      await apiFetch<InvitationSummary>('/api/v1/invitations', { method: 'POST', body, tenantId });
      setMessage({ tone: 'success', text: `Invitation sent to ${values.email}.` });
      form.reset({ email: '', kind: values.kind, roleKey: values.roleKey });
      onInvited();
    } catch (error) {
      const text = applyApiError(error, form.setError, ['email', 'roleKey']);
      if (text) setMessage({ tone: 'error', text });
    }
  });

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" noValidate>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      <FormField
        id="invite-email"
        label="Email"
        type="email"
        registration={form.register('email')}
        error={form.formState.errors.email}
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invite-kind">Access type</Label>
        <select id="invite-kind" className={selectClass} {...form.register('kind')}>
          <option value="STAFF">Team member (has a role)</option>
          <option value="EXTERNAL">External collaborator (sees only shared items)</option>
        </select>
      </div>
      {kind === 'STAFF' ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-role">Role</Label>
          <select id="invite-role" className={selectClass} {...form.register('roleKey')}>
            {ROLE_TEMPLATES.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
              </option>
            ))}
          </select>
          {form.formState.errors.roleKey ? (
            <p className="text-sm text-destructive">{form.formState.errors.roleKey.message}</p>
          ) : null}
        </div>
      ) : null}
      <Button type="submit" disabled={form.formState.isSubmitting}>
        Send invitation
      </Button>
    </form>
  );
}

function errorText(error: unknown) {
  return error instanceof ApiError ? error.message : 'Something went wrong.';
}

export default function TeamPage() {
  const { tenantId, access, can } = useWorkspace();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const canManage = can('member:manage');
  const canInvite = can('member:invite');

  const members = useQuery({
    queryKey: queryKeys.members(tenantId),
    queryFn: () => apiFetch<MemberSummary[]>('/api/v1/members', { tenantId }),
    enabled: can('member:read'),
  });
  const branches = useBranches(tenantId, can('branch:read'));
  const invitations = useQuery({
    queryKey: queryKeys.invitations(tenantId),
    queryFn: () => apiFetch<InvitationSummary[]>('/api/v1/invitations', { tenantId }),
    enabled: canInvite,
  });

  if (!can('member:read')) return <ForbiddenState />;

  const run = async (action: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(errorText(error));
    } finally {
      await queryClient.invalidateQueries({ queryKey: ['tenant', tenantId] });
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-6">
        {actionError ? <Alert>{actionError}</Alert> : null}
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Members</h2>
          {members.isPending ? <LoadingState /> : null}
          {members.isError ? <ErrorState onRetry={() => void members.refetch()} /> : null}
          {members.data ? (
            <ul className="divide-y rounded-md border bg-card">
              {members.data.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="font-medium">
                      {m.name}{' '}
                      {m.id === access.membershipId ? (
                        <span className="text-muted-foreground">(you)</span>
                      ) : null}
                    </span>
                    <span className="truncate text-sm text-muted-foreground">{m.email}</span>
                    {m.kind === 'STAFF' ? (
                      <MemberBranches
                        memberName={m.name}
                        current={m.branches}
                        branches={branches.data ?? []}
                        canEdit={canManage}
                        onSave={(branchIds) =>
                          run(() =>
                            apiFetch(`/api/v1/members/${m.id}`, {
                              method: 'PATCH',
                              body: { branchIds },
                              tenantId,
                            }),
                          )
                        }
                      />
                    ) : null}
                    {m.status === 'SUSPENDED' ? (
                      <span className="text-xs text-warning">Suspended</span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {m.kind === 'EXTERNAL' ? (
                      <span className="text-sm text-muted-foreground">External</span>
                    ) : canManage ? (
                      <select
                        aria-label={`Role for ${m.name}`}
                        className={selectClass}
                        value={m.role?.key}
                        onChange={(e) =>
                          void run(() =>
                            apiFetch(`/api/v1/members/${m.id}`, {
                              method: 'PATCH',
                              body: { roleKey: e.target.value },
                              tenantId,
                            }),
                          )
                        }
                      >
                        {ROLE_TEMPLATES.map((r) => (
                          <option key={r.key} value={r.key}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-sm">{m.role?.name}</span>
                    )}
                    {canManage && m.id !== access.membershipId ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            void run(() =>
                              apiFetch(`/api/v1/members/${m.id}`, {
                                method: 'PATCH',
                                body: { status: m.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' },
                                tenantId,
                              }),
                            )
                          }
                        >
                          {m.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() =>
                            void run(() =>
                              apiFetch(`/api/v1/members/${m.id}`, { method: 'DELETE', tenantId }),
                            )
                          }
                        >
                          Remove
                        </Button>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {canInvite ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Pending invitations</h2>
            {invitations.isPending ? <LoadingState /> : null}
            {invitations.isError ? <ErrorState onRetry={() => void invitations.refetch()} /> : null}
            {invitations.data?.length === 0 ? <EmptyState title="No pending invitations" /> : null}
            {invitations.data?.length ? (
              <ul className="divide-y rounded-md border bg-card">
                {invitations.data.map((i) => (
                  <li
                    key={i.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{i.email}</span>
                      <span className="text-muted-foreground">
                        {i.kind === 'EXTERNAL' ? 'External collaborator' : i.role?.name} ·{' '}
                        {i.status === 'EXPIRED'
                          ? 'Expired'
                          : `Expires ${new Date(i.expiresAt).toLocaleDateString('en-AU')}`}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void run(() =>
                            apiFetch(`/api/v1/invitations/${i.id}/resend`, {
                              method: 'POST',
                              tenantId,
                            }),
                          )
                        }
                      >
                        Resend
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          void run(() =>
                            apiFetch(`/api/v1/invitations/${i.id}`, { method: 'DELETE', tenantId }),
                          )
                        }
                      >
                        Cancel
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}
      </div>

      {canInvite ? (
        <aside>
          <Card>
            <h2 className="mb-4 text-lg font-semibold">Invite someone</h2>
            <InviteForm
              tenantId={tenantId}
              onInvited={() =>
                void queryClient.invalidateQueries({ queryKey: queryKeys.invitations(tenantId) })
              }
            />
          </Card>
        </aside>
      ) : null}
    </div>
  );
}
