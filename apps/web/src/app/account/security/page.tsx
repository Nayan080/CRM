'use client';

import {
  type MfaSetupResponse,
  type RecoveryCodesResponse,
  type SessionSummary,
  mfaEnableSchema,
} from '@crm/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { FormField } from '@/components/forms/form-field';
import { ErrorState, LoadingState } from '@/components/states/state-view';
import { Alert, Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/auth-context';
import { RequireAuth } from '@/lib/auth/require-auth';
import { applyApiError } from '@/lib/forms';
import { queryKeys } from '@/lib/queries';

function MfaSection() {
  const { state, reloadUser } = useAuth();
  const queryClient = useQueryClient();
  const required = useSearchParams().get('required') === '1';
  const [setup, setSetup] = useState<MfaSetupResponse | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(mfaEnableSchema) });

  if (state.status !== 'authenticated') return null;

  const start = async () => {
    setError(null);
    try {
      setSetup(await apiFetch<MfaSetupResponse>('/api/v1/me/mfa/setup', { method: 'POST' }));
    } catch (e) {
      setError(applyApiError(e, form.setError));
    }
  };

  const confirm = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await apiFetch<RecoveryCodesResponse>('/api/v1/me/mfa/enable', {
        method: 'POST',
        body: values,
      });
      setCodes(res.recoveryCodes);
      setSetup(null);
      await reloadUser();
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
    } catch (e) {
      setError(applyApiError(e, form.setError, ['code']));
    }
  });

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Two-factor authentication</h2>
      {required && !state.user.mfaEnabled ? (
        <Alert tone="info">
          Your role (Owner or Admin) requires two-factor authentication before you can open the
          workspace.
        </Alert>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}

      {codes ? (
        <div className="flex flex-col gap-3">
          <Alert tone="success">Two-factor authentication is on.</Alert>
          <p className="text-sm">
            Save these recovery codes somewhere safe (e.g. a password manager). Each works once if
            you lose your phone.
            <strong> They will not be shown again.</strong>
          </p>
          <ul className="grid grid-cols-2 gap-2 rounded-md border bg-muted p-3 font-mono text-sm">
            {codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      ) : state.user.mfaEnabled ? (
        <Alert tone="success">Two-factor authentication is on.</Alert>
      ) : setup ? (
        <form onSubmit={(e) => void confirm(e)} className="flex flex-col gap-4" noValidate>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>
              Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…).
            </li>
            <li>
              Add an account using this setup key:
              <code className="mt-1 block break-all rounded-md bg-muted px-2 py-1 font-mono">
                {setup.secret}
              </code>
              <span className="text-xs text-muted-foreground">
                On a phone you can also open:{' '}
                <a href={setup.otpauthUri} className="text-primary underline">
                  add to authenticator
                </a>
              </span>
            </li>
            <li>Enter the 6-digit code it shows.</li>
          </ol>
          <FormField
            id="code"
            label="6-digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            registration={form.register('code')}
            error={form.formState.errors.code}
          />
          <Button type="submit" disabled={form.formState.isSubmitting}>
            Turn on two-factor
          </Button>
        </form>
      ) : (
        <div>
          <Button onClick={() => void start()}>Set up two-factor authentication</Button>
        </div>
      )}
    </Card>
  );
}

function SessionsSection() {
  const query = useQuery({
    queryKey: queryKeys.sessions,
    queryFn: () => apiFetch<SessionSummary[]>('/api/v1/me/sessions'),
  });
  const revoke = async (id: string) => {
    await apiFetch<void>(`/api/v1/me/sessions/${id}`, { method: 'DELETE' });
    await query.refetch();
  };
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Signed-in devices</h2>
      {query.isPending ? <LoadingState /> : null}
      {query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : null}
      {query.data ? (
        <ul className="divide-y rounded-md border">
          {query.data.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-4 px-3 py-2 text-sm">
              <div className="flex min-w-0 flex-col">
                <span className="truncate">{s.userAgent ?? 'Unknown device'}</span>
                <span className="text-xs text-muted-foreground">
                  Last active {new Date(s.lastUsedAt).toLocaleString('en-AU')}
                  {s.current ? ' · this device' : ''}
                </span>
              </div>
              {!s.current ? (
                <Button variant="outline" size="sm" onClick={() => void revoke(s.id)}>
                  Sign out
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

export default function SecurityPage() {
  return (
    <RequireAuth>
      <section className="mx-auto flex max-w-2xl flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">Account security</h1>
        <Suspense>
          <MfaSection />
        </Suspense>
        <SessionsSection />
      </section>
    </RequireAuth>
  );
}
