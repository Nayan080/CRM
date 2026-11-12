import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from './api/client';

/**
 * Turn an API error into form feedback: field errors go next to their inputs; anything else becomes
 * one message for the form. Never shows raw technical details.
 */
export function applyApiError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[] = [],
): string | null {
  if (!(error instanceof ApiError))
    return 'Something went wrong. Check your connection and try again.';
  let general: string | null = error.problem?.detail ?? error.message;
  for (const fieldError of error.problem?.errors ?? []) {
    const field = fieldError.path as Path<T>;
    if (fields.includes(field)) {
      setError(field, { type: 'server', message: fieldError.message });
      general = null;
    }
  }
  if (error.status === 429) return 'Too many attempts. Wait a minute and try again.';
  return general;
}
