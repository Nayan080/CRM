import { z } from 'zod';
import { nullableText } from './common.js';
import { TASK_PRIORITIES, type TaskPriority } from './matters.js';

/** Stage task template: a task created automatically when a matter enters the stage. */
export const createStageTaskTemplateSchema = z.object({
  title: z.string().trim().min(1, 'Required').max(200),
  description: nullableText(2000),
  priority: z.enum(TASK_PRIORITIES).default('MEDIUM'),
  dueInDays: z.union([z.number().int().min(0).max(365), z.null()]).optional(),
  assignToMatterLead: z.boolean().default(true),
});
export const updateStageTaskTemplateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: nullableText(2000),
    priority: z.enum(TASK_PRIORITIES).optional(),
    dueInDays: z.union([z.number().int().min(0).max(365), z.null()]).optional(),
    assignToMatterLead: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export type CreateStageTaskTemplateInput = z.infer<typeof createStageTaskTemplateSchema>;
export type UpdateStageTaskTemplateInput = z.infer<typeof updateStageTaskTemplateSchema>;

export interface StageTaskTemplateResponse {
  id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  dueInDays: number | null;
  assignToMatterLead: boolean;
  isActive: boolean;
}

/** Agency automation switches (all off by default). */
export const automationSettingsSchema = z.object({
  /** e.g. [7, 1] = email assigned staff 7 days and 1 day before each deadline. Empty = off. */
  deadlineReminderDays: z
    .array(z.number().int().min(1).max(60))
    .max(3, 'At most three reminders')
    .refine((v) => new Set(v).size === v.length, 'Each value once')
    .transform((v) => [...v].sort((a, b) => b - a)),
  /** Remind the lead owner after this many days without activity. null = off. */
  leadFollowUpDays: z.union([z.number().int().min(1).max(90), z.null()]),
});
export type AutomationSettingsInput = z.infer<typeof automationSettingsSchema>;
export interface AutomationSettingsResponse {
  deadlineReminderDays: number[];
  leadFollowUpDays: number | null;
}
