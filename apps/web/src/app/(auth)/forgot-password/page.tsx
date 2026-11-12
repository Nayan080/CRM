'use client';

import { type MessageResponse, emailOnlySchema } from '@crm/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { FormField } from '@/components/forms/form-field';
import { Alert, AuthPage, Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api/client';
import { applyApiError } from '@/lib/forms';

export default function ForgotPasswordPage() {
  const [done, setDone] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(emailOnlySchema) });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const res = await apiFetch<MessageResponse>('/api/v1/auth/password/forgot', {
        method: 'POST',
        body: values,
        noRetry: true,
      });
      setDone(res.message);
    } catch (error) {
      setFormError(applyApiError(error, form.setError, ['email']));
    }
  });

  return (
    <AuthPage>
      <Card>
        <CardHeader
          title="Reset your password"
          description="We'll email you a link that works for 30 minutes."
        />
        {done ? (
          <Alert tone="success">{done}</Alert>
        ) : (
          <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" noValidate>
            {formError ? <Alert>{formError}</Alert> : null}
            <FormField
              id="email"
              label="Email"
              type="email"
              autoComplete="email"
              registration={form.register('email')}
              error={form.formState.errors.email}
            />
            <Button type="submit" disabled={form.formState.isSubmitting}>
              Send reset link
            </Button>
          </form>
        )}
        <p className="mt-4 text-sm">
          <Link href="/login" className="text-primary underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        </p>
      </Card>
    </AuthPage>
  );
}
