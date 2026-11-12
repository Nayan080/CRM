import { z } from 'zod';

export const healthStatusSchema = z.enum(['ok', 'error']);

export const liveResponseSchema = z.object({
  status: z.literal('ok'),
});

export const readyResponseSchema = z.object({
  status: healthStatusSchema,
  checks: z.object({
    database: z.enum(['up', 'down']),
  }),
});

export type LiveResponse = z.infer<typeof liveResponseSchema>;
export type ReadyResponse = z.infer<typeof readyResponseSchema>;
