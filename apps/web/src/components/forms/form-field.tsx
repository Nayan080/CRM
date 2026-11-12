import type { InputHTMLAttributes } from 'react';
import type { FieldError, UseFormRegisterReturn } from 'react-hook-form';
import { Input, Label } from '@/components/ui/input';

interface FormFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'name'> {
  id: string;
  label: string;
  registration: UseFormRegisterReturn;
  error?: FieldError;
  hint?: string;
}

/** Label + input + accessible error/hint text. */
export function FormField({ id, label, registration, error, hint, ...inputProps }: FormFieldProps) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...registration}
        {...inputProps}
      />
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error.message}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
