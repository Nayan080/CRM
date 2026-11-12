import { z } from 'zod';

/**
 * RFC 9457 "Problem Details for HTTP APIs" — the single error shape for every API error.
 * Extension members: `code` (stable machine-readable), `requestId` (for support/log lookup),
 * `errors` (field-level validation issues).
 */
export const fieldErrorSchema = z.object({
  path: z.string(),
  message: z.string(),
});

export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: z.string(),
  requestId: z.string().optional(),
  errors: z.array(fieldErrorSchema).optional(),
});

export type FieldError = z.infer<typeof fieldErrorSchema>;
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';
