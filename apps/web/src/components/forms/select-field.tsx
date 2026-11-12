import type { ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import type { FieldError, UseFormRegisterReturn } from 'react-hook-form';
import { Label } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export const selectClass =
  'h-9 w-full rounded-md border bg-card px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive';

interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'name'> {
  id: string;
  label: string;
  registration: UseFormRegisterReturn;
  error?: FieldError;
  children: ReactNode;
}

export function SelectField({
  id,
  label,
  registration,
  error,
  children,
  ...props
}: SelectFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        className={selectClass}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...registration}
        {...props}
      >
        {children}
      </select>
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error.message}
        </p>
      ) : null}
    </div>
  );
}

interface TextAreaFieldProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'name'> {
  id: string;
  label: string;
  registration: UseFormRegisterReturn;
  error?: FieldError;
}

export function TextAreaField({
  id,
  label,
  registration,
  error,
  className,
  ...props
}: TextAreaFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <textarea
        id={id}
        rows={3}
        className={cn(
          'w-full rounded-md border bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
        aria-invalid={error ? true : undefined}
        {...registration}
        {...props}
      />
      {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
    </div>
  );
}
