import { z } from 'zod';

export const uuidSchema = z.uuid({ message: 'Invalid id' });

/**
 * Optional free-text field for create AND update forms.
 * - omitted (undefined) = "no change" on update
 * - null or empty string = "clear the value"
 */
export function nullableText(max: number) {
  return z
    .union([z.string().trim().max(max, `Use at most ${max} characters`), z.null()])
    .optional()
    .transform((value) => (value === '' ? null : value));
}

export const nullableEmail = z
  .union([
    z.literal(''),
    z.null(),
    z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address').max(254)),
  ])
  .optional()
  .transform((value) => (value === '' ? null : value));

export const nullableUrl = z
  .union([
    z.literal(''),
    z.null(),
    z.string().trim().max(300).pipe(z.url('Enter a full web address, e.g. https://example.com')),
  ])
  .optional()
  .transform((value) => (value === '' ? null : value));

/** Date as YYYY-MM-DD (no time, no time zone). */
export const nullableDate = z
  .union([z.literal(''), z.null(), z.iso.date('Use the format YYYY-MM-DD')])
  .optional()
  .transform((value) => (value === '' ? null : value));

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** IANA time zone name, e.g. Australia/Sydney. */
export const timeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, 'Unknown time zone (use a name like Australia/Sydney)');

/** Query string for list endpoints: cursor pagination + optional search text. */
export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: uuidSchema.optional(),
  q: z.string().trim().max(100).optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export interface Paginated<T> {
  data: T[];
  /** Pass as `cursor` to get the next page; null when there are no more rows. */
  nextCursor: string | null;
}
