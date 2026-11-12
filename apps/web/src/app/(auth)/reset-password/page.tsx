'use client';

import { type MessageResponse, passwordSchema } from '@crm/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { FormField } from '@/components/forms/form-field';
import { Alert, AuthPage, Card, CardHeader } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { apiFetch } from '@/lib/api/client';
import { applyApiError } from '@/lib/forms';
import { takeTokenFromHash } from '@/lib/url-token';
import { useBrowserValue } from '@/lib/use-browser-value';

const schema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: 'Passwords do not match',
  });

export default function ResetPasswordPage() {
  const token = useBrowserValue('token', takeTokenFromHash);
  const [done, setDone] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(schema) });

  const onSubmit = form.handleSubmit(async ({ password }) => {
    setFormError(null);
    try {
      const res = await apiFetch<MessageResponse>('/api/v1/auth/password/reset', {
        method: 'POST',
        body: { token, password },
        noRetry: true,
      });
      setDone(res.message);
    } catch (error) {
      setFormError(applyApiError(error, form.setError, ['password']));
    }
  });

  return (
    <AuthPage>
      <Card>
        <CardHeader
          title="Choose a new password"
          description="You'll be signed out on all devices."
        />
        {token === null ? (
          <Alert>This link is incomplete or already used. Request a new one.</Alert>
        ) : null}
        {done ? (
          <div className="flex flex-col gap-4">
            <Alert tone="success">{done}</Alert>
            <Link href="/login" className={buttonVariants()}>
              Sign in
            </Link>
          </div>
        ) : token ? (
          <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" noValidate>
            {formError ? <Alert>{formError}</Alert> : null}
            <FormField
              id="password"
              label="New password"
              type="password"
              autoComplete="new-password"
              hint="At least 12 characters."
              registration={form.register('password')}
              error={form.formState.errors.password}
            />
            <FormField
              id="confirm"
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              registration={form.register('confirm')}
              error={form.formState.errors.confirm}
            />
            <Button type="submit" disabled={form.formState.isSubmitting}>
              Change password
            </Button>
          </form>
        ) : null}
      </Card>
    </AuthPage>
  );
}
