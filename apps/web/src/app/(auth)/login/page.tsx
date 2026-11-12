'use client';

import {
  type AuthTokensResponse,
  type LoginResponse,
  type MessageResponse,
  loginMfaSchema,
  loginSchema,
} from '@crm/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { FormField } from '@/components/forms/form-field';
import { Alert, AuthPage, Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ApiError, apiFetch } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/auth-context';
import { applyApiError } from '@/lib/forms';
import { safeNextPath } from '@/lib/url-token';

function LoginForm() {
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get('next'));
  const { signedIn } = useAuth();
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const passwordForm = useForm({ resolver: zodResolver(loginSchema) });
  const mfaForm = useForm({
    resolver: zodResolver(loginMfaSchema),
    defaultValues: { mfaToken: '', code: '' },
  });

  const finish = (result: AuthTokensResponse) => {
    signedIn(result);
    router.push(next);
  };

  const onPassword = passwordForm.handleSubmit(async (values) => {
    setFormError(null);
    setUnverifiedEmail(null);
    try {
      const result = await apiFetch<LoginResponse>('/api/v1/auth/login', {
        method: 'POST',
        body: values,
        noRetry: true,
      });
      if (result.status === 'mfa_required') {
        setMfaToken(result.mfaToken);
        mfaForm.setValue('mfaToken', result.mfaToken);
      } else {
        finish(result);
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'EMAIL_NOT_VERIFIED')
        setUnverifiedEmail(values.email);
      setFormError(applyApiError(error, passwordForm.setError, ['email', 'password']));
    }
  });

  const onCode = mfaForm.handleSubmit(async (values) => {
    setFormError(null);
    try {
      finish(
        await apiFetch<AuthTokensResponse>('/api/v1/auth/login/mfa', {
          method: 'POST',
          body: values,
          noRetry: true,
        }),
      );
    } catch (error) {
      if (error instanceof ApiError && error.code === 'MFA_CHALLENGE_EXPIRED') setMfaToken(null);
      setFormError(applyApiError(error, mfaForm.setError, ['code']));
    }
  });

  const resend = async () => {
    if (!unverifiedEmail) return;
    const res = await apiFetch<MessageResponse>('/api/v1/auth/resend-verification', {
      method: 'POST',
      body: { email: unverifiedEmail },
      noRetry: true,
    }).catch(() => null);
    setInfo(res?.message ?? null);
  };

  return (
    <AuthPage>
      <Card>
        <CardHeader
          title={mfaToken ? 'Two-factor authentication' : 'Sign in'}
          description={
            mfaToken
              ? 'Enter the 6-digit code from your authenticator app, or a recovery code.'
              : undefined
          }
        />
        <div className="flex flex-col gap-4">
          {formError ? <Alert>{formError}</Alert> : null}
          {info ? <Alert tone="info">{info}</Alert> : null}
          {unverifiedEmail ? (
            <Button variant="outline" size="sm" onClick={() => void resend()}>
              Resend verification email
            </Button>
          ) : null}

          {!mfaToken ? (
            <form onSubmit={(e) => void onPassword(e)} className="flex flex-col gap-4" noValidate>
              <FormField
                id="email"
                label="Email"
                type="email"
                autoComplete="email"
                registration={passwordForm.register('email')}
                error={passwordForm.formState.errors.email}
              />
              <FormField
                id="password"
                label="Password"
                type="password"
                autoComplete="current-password"
                registration={passwordForm.register('password')}
                error={passwordForm.formState.errors.password}
              />
              <Button type="submit" disabled={passwordForm.formState.isSubmitting}>
                {passwordForm.formState.isSubmitting ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          ) : (
            <form onSubmit={(e) => void onCode(e)} className="flex flex-col gap-4" noValidate>
              <FormField
                id="code"
                label="Code"
                inputMode="text"
                autoComplete="one-time-code"
                autoFocus
                registration={mfaForm.register('code')}
                error={mfaForm.formState.errors.code}
              />
              <Button type="submit" disabled={mfaForm.formState.isSubmitting}>
                Verify
              </Button>
            </form>
          )}
        </div>
        <div className="mt-4 flex justify-between text-sm">
          <Link href="/forgot-password" className="text-primary underline-offset-4 hover:underline">
            Forgot password?
          </Link>
          <Link href="/register" className="text-primary underline-offset-4 hover:underline">
            Create account
          </Link>
        </div>
      </Card>
    </AuthPage>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
