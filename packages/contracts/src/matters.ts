import { z } from 'zod';
import type { StageTaskTemplateResponse } from './automation.js';
import { listQuerySchema, nullableText, uuidSchema } from './common.js';
import type { NamedRef } from './crm.js';

const name = (max: number) =>
  z.string().trim().min(1, 'Required').max(max, `Use at most ${max} characters`);
const nullableId = z.union([uuidSchema, z.null()]).optional();
const isoDateTime = z.iso.datetime({ offset: true, message: 'Use a full date and time' });
const nullableDateTime = z.union([isoDateTime, z.null()]).optional();
const booleanQuery = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');
const notEmpty = (v: object) => Object.keys(v).length > 0;

export const MATTER_STATUSES = ['OPEN', 'ON_HOLD', 'CLOSED', 'ARCHIVED'] as const;
export type MatterStatus = (typeof MATTER_STATUSES)[number];
export const TASK_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/**
 * DEC-13: new agencies get generic, editable example matter types with plain stages.
 * No visa subclasses, legal requirements or checklist rules are built in.
 * Keep in sync with the backfill in the Stage 5 migration.
 */
export const DEFAULT_MATTER_STAGES = [
  { name: 'Intake', isTerminal: false },
  { name: 'Collecting documents', isTerminal: false },
  { name: 'Preparing application', isTerminal: false },
  { name: 'Lodged', isTerminal: false },
  { name: 'Decision received', isTerminal: true },
] as const;
export const DEFAULT_MATTER_TYPES = [
  'Student',
  'Skilled',
  'Partner',
  'Employer-sponsored',
] as const;

// ───────── Configuration (Settings) ─────────

export const createMatterTypeSchema = z.object({
  name: name(120),
  description: nullableText(1000),
});
export const updateMatterTypeSchema = z
  .object({
    name: name(120).optional(),
    description: nullableText(1000),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .refine(notEmpty, 'Nothing to update');

export const createStageSchema = z.object({
  name: name(120),
  isTerminal: z.boolean().default(false),
});
export const updateStageSchema = z
  .object({
    name: name(120).optional(),
    isTerminal: z.boolean().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .refine(notEmpty, 'Nothing to update');

export const createChecklistTemplateItemSchema = z.object({
  title: name(300),
  isRequired: z.boolean().default(true),
});
export const updateChecklistTemplateItemSchema = z
  .object({
    title: name(300).optional(),
    isRequired: z.boolean().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .refine(notEmpty, 'Nothing to update');

export type CreateMatterTypeInput = z.infer<typeof createMatterTypeSchema>;
export type UpdateMatterTypeInput = z.infer<typeof updateMatterTypeSchema>;
export type CreateStageInput = z.infer<typeof createStageSchema>;
export type UpdateStageInput = z.infer<typeof updateStageSchema>;
export type CreateChecklistTemplateItemInput = z.infer<typeof createChecklistTemplateItemSchema>;
export type UpdateChecklistTemplateItemInput = z.infer<typeof updateChecklistTemplateItemSchema>;

// ───────── Matters ─────────

export const createMatterSchema = z.object({
  clientId: uuidSchema,
  matterTypeId: uuidSchema,
  title: name(200),
  description: nullableText(5000),
  /** Defaults to the client's branch. */
  branchId: nullableId,
  /** Staff to assign. Defaults to the person creating the matter (if staff). */
  assigneeMembershipIds: z.array(uuidSchema).max(20).optional(),
});
export const updateMatterSchema = z
  .object({
    title: name(200).optional(),
    description: nullableText(5000),
    branchId: nullableId,
  })
  .refine(notEmpty, 'Nothing to update');

/** Move to another stage and/or status. Every change is written to the status history. */
export const transitionMatterSchema = z
  .object({
    stageId: uuidSchema.optional(),
    status: z.enum(MATTER_STATUSES).optional(),
    reason: nullableText(500),
  })
  .refine((v) => v.stageId || v.status, 'Give a stage or a status');

export const matterListQuerySchema = listQuerySchema.extend({
  status: z.enum(MATTER_STATUSES).optional(),
  clientId: uuidSchema.optional(),
  matterTypeId: uuidSchema.optional(),
  mine: booleanQuery,
});

export const addAssignmentSchema = z.object({
  membershipId: uuidSchema,
  responsibility: nullableText(100),
});

export const createParticipantSchema = z
  .object({
    roleId: uuidSchema,
    clientId: uuidSchema.optional(),
    professionalId: uuidSchema.optional(),
    partnerOrgId: uuidSchema.optional(),
    notes: nullableText(500),
  })
  .refine(
    (v) => [v.clientId, v.professionalId, v.partnerOrgId].filter(Boolean).length === 1,
    'Choose exactly one client, professional or partner',
  );

const remindBeforeDue = (v: { dueAt?: string; remindAt?: string | null }) =>
  !v.dueAt || !v.remindAt || new Date(v.remindAt) <= new Date(v.dueAt);

export const createDeadlineSchema = z
  .object({ title: name(200), dueAt: isoDateTime, remindAt: nullableDateTime })
  .refine(remindBeforeDue, { path: ['remindAt'], message: 'Must be on or before the due time' });
export const updateDeadlineSchema = z
  .object({
    title: name(200).optional(),
    dueAt: isoDateTime.optional(),
    remindAt: nullableDateTime,
    completed: z.boolean().optional(),
  })
  .refine(notEmpty, 'Nothing to update')
  .refine(remindBeforeDue, { path: ['remindAt'], message: 'Must be on or before the due time' });

export const createChecklistItemSchema = z.object({
  title: name(300),
  isRequired: z.boolean().default(true),
});
export const updateChecklistItemSchema = z
  .object({ title: name(300).optional(), done: z.boolean().optional() })
  .refine(notEmpty, 'Nothing to update');

export type CreateMatterInput = z.infer<typeof createMatterSchema>;
export type UpdateMatterInput = z.infer<typeof updateMatterSchema>;
export type TransitionMatterInput = z.infer<typeof transitionMatterSchema>;
export type MatterListQuery = z.infer<typeof matterListQuerySchema>;
export type AddAssignmentInput = z.infer<typeof addAssignmentSchema>;
export type CreateParticipantInput = z.infer<typeof createParticipantSchema>;
export type CreateDeadlineInput = z.infer<typeof createDeadlineSchema>;
export type UpdateDeadlineInput = z.infer<typeof updateDeadlineSchema>;
export type CreateChecklistItemInput = z.infer<typeof createChecklistItemSchema>;
export type UpdateChecklistItemInput = z.infer<typeof updateChecklistItemSchema>;

// ───────── Tasks ─────────

const taskLinks = (v: {
  matterId?: string | null;
  clientId?: string | null;
  leadId?: string | null;
}) => [v.matterId, v.clientId, v.leadId].filter(Boolean).length <= 1;
const ONE_LINK = 'Link a task to at most one matter, client or lead';

export const createTaskSchema = z
  .object({
    title: name(200),
    description: nullableText(5000),
    priority: z.enum(TASK_PRIORITIES).default('MEDIUM'),
    dueAt: nullableDateTime,
    /** Defaults to the person creating it. */
    assigneeMembershipId: nullableId,
    matterId: nullableId,
    clientId: nullableId,
    leadId: nullableId,
  })
  .refine(taskLinks, ONE_LINK);
export const updateTaskSchema = z
  .object({
    title: name(200).optional(),
    description: nullableText(5000),
    priority: z.enum(TASK_PRIORITIES).optional(),
    status: z.enum(TASK_STATUSES).optional(),
    dueAt: nullableDateTime,
    assigneeMembershipId: nullableId,
  })
  .refine(notEmpty, 'Nothing to update');
export const taskListQuerySchema = listQuerySchema.extend({
  status: z.enum(TASK_STATUSES).optional(),
  /** Open + in progress. */
  active: booleanQuery,
  mine: booleanQuery,
  matterId: uuidSchema.optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;

// ───────── Responses ─────────

export interface MatterStageResponse {
  id: string;
  name: string;
  sortOrder: number;
  isTerminal: boolean;
  isActive: boolean;
  /** Only on matter-type responses (Settings). */
  taskTemplates?: StageTaskTemplateResponse[];
}

export interface ChecklistTemplateItemResponse {
  id: string;
  title: string;
  isRequired: boolean;
  sortOrder: number;
  isActive: boolean;
}

export interface MatterTypeResponse {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  stages: MatterStageResponse[];
  checklist: ChecklistTemplateItemResponse[];
}

export interface MatterSummary {
  id: string;
  reference: string;
  title: string;
  status: MatterStatus;
  type: NamedRef;
  stage: NamedRef | null;
  client: { id: string; clientNumber: string; displayName: string };
  branch: NamedRef | null;
  assignees: NamedRef[];
  openedAt: string;
  updatedAt: string;
}

export interface MatterAssignmentResponse {
  id: string;
  member: NamedRef;
  responsibility: string | null;
  assignedAt: string;
}

export interface MatterParticipantResponse {
  id: string;
  role: NamedRef;
  kind: 'client' | 'professional' | 'partner';
  party: NamedRef;
  notes: string | null;
}

export interface MatterDeadlineResponse {
  id: string;
  title: string;
  dueAt: string;
  remindAt: string | null;
  reminderSentAt: string | null;
  completedAt: string | null;
}

export interface ChecklistItemResponse {
  id: string;
  title: string;
  isRequired: boolean;
  sortOrder: number;
  completedAt: string | null;
  completedBy: NamedRef | null;
}

export interface MatterHistoryResponse {
  id: string;
  fromStatus: MatterStatus | null;
  toStatus: MatterStatus | null;
  fromStage: NamedRef | null;
  toStage: NamedRef | null;
  reason: string | null;
  changedBy: NamedRef;
  createdAt: string;
}

export interface MatterDetail extends MatterSummary {
  description: string | null;
  closedAt: string | null;
  stages: MatterStageResponse[];
  assignments: MatterAssignmentResponse[];
  participants: MatterParticipantResponse[];
  deadlines: MatterDeadlineResponse[];
  checklist: ChecklistItemResponse[];
  history: MatterHistoryResponse[];
}

export interface TaskResponse {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string | null;
  completedAt: string | null;
  assignee: NamedRef | null;
  createdBy: NamedRef;
  /** The linked record, or null. `hidden` = linked to a record you cannot see. */
  link:
    | { kind: 'matter' | 'client' | 'lead'; id: string; label: string }
    | { kind: 'matter' | 'client' | 'lead'; hidden: true }
    | null;
  createdAt: string;
}
