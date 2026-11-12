'use client';

import {
  type AuthTokensResponse,
  type InvitationPreviewResponse,
  type WorkspaceSummary,
  passwordSchema,
  personNameSchema,
} from '@crm/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { FormField } from '@/components/forms/form-field';
import { LoadingState } from '@/components/states/state-view';
import { Alert, AuthPage, Card, CardHeader } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { ApiError, apiFetch } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/auth-context';
import { applyApiError } from '@/lib/forms';
import { takeTokenFromHash } from '@/lib/url-token';
import { useBrowserValue } from '@/lib/use-browser-value';

const newAccountSchema = z.object({ name: personNameSchema, password: passwordSchema });
/** Keep the token for this tab only, so it survives the sign-in detour but not the browser. */
const STORAGE_KEY = 'crm_pending_invite';

function readToken(): string | null {
  const fromHash = takeTokenFromHash();
  try {
    if (fromHash) sessionStorage.setItem(STORAGE_KEY, fromHash);
    return fromHash ?? sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return fromHash;
  }
}

function clearToken() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable: nothing to clear */
  }
}

export default function InvitePage() {
  const router = useRouter();
  const { state, signedIn } = useAuth();
  const token = useBrowserValue('invite', readToken);
  const [preview, setPreview] = useState<InvitationPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(newAccountSchema) });

  useEffect(() => {
    if (!token) return;
    apiFetch<InvitationPreviewResponse>('/api/v1/invitations/preview', {
      method: 'POST',
      body: { token },
      noRetry: true,
    })
      .then(setPreview)
      .catch((e: unknown) => {
        clearToken();
        setError(e instanceof ApiError ? e.message : 'Could not load this invitation.');
      });
  }, [token]);

  const goToWorkspace = (ws: WorkspaceSummary) => {
    clearToken();
    router.push(ws.mfaSetupRequired ? '/account/security?required=1' : `/w/${ws.slug}`);
  };

  const acceptAsSignedIn = async () => {
    setError(null);
    try {
      goToWorkspace(
        await apiFetch<WorkspaceSummary>('/api/v1/invitations/accept', {
          method: 'POST',
          body: { token },
        }),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not accept the invitation.');
    }
  };

  const createAccount = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const result = await apiFetch<AuthTokensResponse>('/api/v1/invitations/accept-new', {
        method: 'POST',
        body: { token, ...values },
        noRetry: true,
      });
      signedIn(result);
      clearToken();
      router.push('/workspaces');
    } catch (e) {
      setError(applyApiError(e, form.setError, ['name', 'password']));
    }
  });

  if (token === undefined || (token && !preview && !error)) {
    return <LoadingState label="Loading invitation…" />;
  }

  return (
    <AuthPage>
      <Card>
        <CardHeader
          title={preview ? `Join ${preview.tenantName}` : 'Invitation'}
          description={
            preview
              ? preview.kind === 'EXTERNAL'
                ? 'As an external collaborator you will only see items the agency shares with you.'
                : `Role: ${preview.role?.name ?? '—'}`
              : undefined
          }
        />
        <div className="flex flex-col gap-4">
          {!token ? (
            <Alert>This invitation link is incomplete. Open it again from your email.</Alert>
          ) : null}
          {error ? <Alert>{error}</Alert> : null}

          {preview && state.status === 'authenticated' ? (
            state.user.email === preview.email ? (
              <Button onClick={() => void acceptAsSignedIn()}>Accept invitation</Button>
            ) : (
              <Alert tone="info">
                This invitation is for {preview.email}, but you are signed in as {state.user.email}.
                Sign out and sign in with the invited email.
              </Alert>
            )
          ) : null}

          {preview && state.status === 'anonymous' && preview.accountExists ? (
            <>
              <Alert tone="info">
                You already have an account ({preview.email}). Sign in to accept.
              </Alert>
              <Link href="/login?next=/invite" className={buttonVariants()}>
                Sign in to accept
              </Link>
            </>
          ) : null}

          {preview && state.status === 'anonymous' && !preview.accountExists ? (
            <form
              onSubmit={(e) => void createAccount(e)}
              className="flex flex-col gap-4"
              noValidate
            >
              <p className="text-sm text-muted-foreground">
                Create your account for <strong>{preview.email}</strong>.
              </p>
              <FormField
                id="name"
                label="Full name"
                autoComplete="name"
                registration={form.register('name')}
                error={form.formState.errors.name}
              />
              <FormField
                id="password"
                label="Password"
                type="password"
                autoComplete="new-password"
                hint="At least 12 characters."
                registration={form.register('password')}
                error={form.formState.errors.password}
              />
              <Button type="submit" disabled={form.formState.isSubmitting}>
                Create account and join
              </Button>
            </form>
          ) : null}
        </div>
      </Card>
    </AuthPage>
  );
}
