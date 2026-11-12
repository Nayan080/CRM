'use client';

import type { MessageResponse } from '@crm/contracts';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { LoadingState } from '@/components/states/state-view';
import { Alert, AuthPage, Card, CardHeader } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { ApiError, apiFetch } from '@/lib/api/client';
import { takeTokenFromHash } from '@/lib/url-token';
import { useBrowserValue } from '@/lib/use-browser-value';

type Status =
  { kind: 'working' } | { kind: 'ok'; message: string } | { kind: 'error'; message: string };

export default function VerifyEmailPage() {
  const token = useBrowserValue('token', takeTokenFromHash);
  const [result, setResult] = useState<Status>({ kind: 'working' });
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return; // StrictMode runs effects twice in dev; link is single-use
    started.current = true;
    apiFetch<MessageResponse>('/api/v1/auth/verify-email', {
      method: 'POST',
      body: { token },
      noRetry: true,
    })
      .then((res) => setResult({ kind: 'ok', message: res.message }))
      .catch((error: unknown) =>
        setResult({
          kind: 'error',
          message: error instanceof ApiError ? error.message : 'Could not verify. Try again.',
        }),
      );
  }, [token]);

  const status: Status =
    token === null
      ? { kind: 'error', message: 'This link is incomplete. Open it again from your email.' }
      : result;

  return (
    <AuthPage>
      <Card>
        <CardHeader title="Verify email" />
        {status.kind === 'working' ? <LoadingState label="Verifying…" /> : null}
        {status.kind === 'ok' ? (
          <div className="flex flex-col gap-4">
            <Alert tone="success">{status.message}</Alert>
            <Link href="/login" className={buttonVariants()}>
              Sign in
            </Link>
          </div>
        ) : null}
        {status.kind === 'error' ? (
          <div className="flex flex-col gap-4">
            <Alert>{status.message}</Alert>
            <Link href="/login" className={buttonVariants({ variant: 'outline' })}>
              Back to sign in
            </Link>
          </div>
        ) : null}
      </Card>
    </AuthPage>
  );
}
