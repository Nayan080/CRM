'use client';

import { type MessageResponse, registerSchema } from '@crm/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { FormField } from '@/components/forms/form-field';
import { Alert, AuthPage, Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api/client';
import { applyApiError } from '@/lib/forms';

export default function RegisterPage() {
  const [done, setDone] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(registerSchema) });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const res = await apiFetch<MessageResponse>('/api/v1/auth/register', {
        method: 'POST',
        body: values,
        noRetry: true,
      });
      setDone(res.message);
    } catch (error) {
      setFormError(applyApiError(error, form.setError, ['name', 'email', 'password']));
    }
  });

  return (
    <AuthPage>
      <Card>
        <CardHeader
          title="Create your account"
          description="Agency owners start here. Team members join through an invitation."
        />
        {done ? (
          <Alert tone="success">{done} Check your inbox to verify your email.</Alert>
        ) : (
          <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" noValidate>
            {formError ? <Alert>{formError}</Alert> : null}
            <FormField
              id="name"
              label="Full name"
              autoComplete="name"
              registration={form.register('name')}
              error={errors.name}
            />
            <FormField
              id="email"
              label="Work email"
              type="email"
              autoComplete="email"
              registration={form.register('email')}
              error={errors.email}
            />
            <FormField
              id="password"
              label="Password"
              type="password"
              autoComplete="new-password"
              hint="At least 12 characters. A short sentence works well."
              registration={form.register('password')}
              error={errors.password}
            />
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating account…' : 'Create account'}
            </Button>
          </form>
        )}
        <p className="mt-4 text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="text-primary underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </Card>
    </AuthPage>
  );
}
