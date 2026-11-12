import { z } from 'zod';
import {
  listQuerySchema,
  nullableDate,
  nullableEmail,
  nullableText,
  uuidSchema,
} from './common.js';

/** Optional reference to another record: omitted = no change, null = clear. */
const nullableId = z.union([uuidSchema, z.null()]).optional();
const isoDateTime = z.iso.datetime({ offset: true, message: 'Use a full date and time' });
const name = (max: number) =>
  z.string().trim().min(1, 'Required').max(max, `Use at most ${max} characters`);
const booleanQuery = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');

// ───────── Leads ─────────

export const LEAD_STATUSES = ['OPEN', 'CONVERTED', 'LOST'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

const leadFields = {
  fullName: name(150),
  email: nullableEmail,
  phone: nullableText(40),
  sourceId: nullableId,
  referredByPartnerId: nullableId,
  referredByContactId: nullableId,
  interest: nullableText(500),
  notes: nullableText(5000),
  branchId: nullableId,
  ownerMembershipId: nullableId,
};

export const createLeadSchema = z.object(leadFields);
export const updateLeadSchema = z
  .object({
    ...leadFields,
    fullName: leadFields.fullName.optional(),
    /** CONVERTED is set only by conversion. */
    status: z.enum(['OPEN', 'LOST']).optional(),
    lostReason: nullableText(500),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const leadListQuerySchema = listQuerySchema.extend({
  status: z.enum(LEAD_STATUSES).optional(),
  mine: booleanQuery,
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;
export type LeadListQuery = z.infer<typeof leadListQuerySchema>;

// ───────── Clients ─────────

export const CLIENT_KINDS = ['INDIVIDUAL', 'BUSINESS'] as const;
export type ClientKind = (typeof CLIENT_KINDS)[number];

const clientFields = {
  kind: z.enum(CLIENT_KINDS),
  displayName: name(200),
  email: nullableEmail,
  phone: nullableText(40),
  dateOfBirth: nullableDate,
  nationality: nullableText(80),
  addressLine: nullableText(300),
  notes: nullableText(5000),
  branchId: nullableId,
};

const dobOnlyForIndividuals = (v: { kind?: ClientKind; dateOfBirth?: string | null }) =>
  !(v.kind === 'BUSINESS' && v.dateOfBirth);

export const createClientSchema = z
  .object(clientFields)
  .refine(dobOnlyForIndividuals, { path: ['dateOfBirth'], message: 'Only for individual clients' });

export const updateClientSchema = z
  .object({
    ...clientFields,
    kind: clientFields.kind.optional(),
    displayName: clientFields.displayName.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update')
  .refine(dobOnlyForIndividuals, { path: ['dateOfBirth'], message: 'Only for individual clients' });

export const duplicateQuerySchema = z
  .object({
    email: z.string().trim().max(254).optional(),
    phone: z.string().trim().max(40).optional(),
    name: z.string().trim().max(200).optional(),
    dateOfBirth: z.iso.date().optional(),
  })
  .refine(
    (v) => v.email || v.phone || (v.name && v.dateOfBirth),
    'Give an email, a phone, or a name with a date of birth',
  );

export const createRelationshipSchema = z.object({
  toClientId: uuidSchema,
  typeId: uuidSchema,
  notes: nullableText(500),
});

/** Convert a lead: create a new client from it, or link it to an existing client (no duplicate). */
export const convertLeadSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('new'), client: createClientSchema }),
  z.object({ mode: z.literal('link'), clientId: uuidSchema }),
]);

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type DuplicateQuery = z.infer<typeof duplicateQuerySchema>;
export type CreateRelationshipInput = z.infer<typeof createRelationshipSchema>;
export type ConvertLeadInput = z.infer<typeof convertLeadSchema>;

// ───────── Activities ─────────

export const ACTIVITY_TYPES = ['NOTE', 'CALL', 'EMAIL', 'MEETING'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

const oneSubject = (v: { leadId?: string; clientId?: string; matterId?: string }) =>
  [v.leadId, v.clientId, v.matterId].filter(Boolean).length === 1;
const ONE_SUBJECT = 'Give exactly one of leadId, clientId or matterId';

export const createActivitySchema = z
  .object({
    leadId: uuidSchema.optional(),
    clientId: uuidSchema.optional(),
    matterId: uuidSchema.optional(),
    type: z.enum(ACTIVITY_TYPES),
    summary: name(200),
    body: nullableText(5000),
    occurredAt: isoDateTime.optional(),
  })
  .refine(oneSubject, ONE_SUBJECT);

export const activityListQuerySchema = listQuerySchema
  .extend({
    leadId: uuidSchema.optional(),
    clientId: uuidSchema.optional(),
    matterId: uuidSchema.optional(),
  })
  .refine(oneSubject, ONE_SUBJECT);

export type CreateActivityInput = z.infer<typeof createActivitySchema>;
export type ActivityListQuery = z.infer<typeof activityListQuerySchema>;

// ───────── Appointments / consultations ─────────

const appointmentFields = {
  title: name(200),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  location: nullableText(300),
  notes: nullableText(2000),
  isConsultation: z.boolean().default(false),
  /** Defaults to the person creating it. */
  hostMembershipId: uuidSchema.optional(),
  leadId: nullableId,
  clientId: nullableId,
  matterId: nullableId,
};
const endsAfterStarts = (v: { startsAt?: string; endsAt?: string }) =>
  !v.startsAt || !v.endsAt || new Date(v.endsAt) > new Date(v.startsAt);

export const createAppointmentSchema = z
  .object(appointmentFields)
  .refine(endsAfterStarts, { path: ['endsAt'], message: 'Must be after the start' });

export const updateAppointmentSchema = z
  .object({
    ...appointmentFields,
    title: appointmentFields.title.optional(),
    startsAt: isoDateTime.optional(),
    endsAt: isoDateTime.optional(),
    isConsultation: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update')
  .refine(endsAfterStarts, { path: ['endsAt'], message: 'Must be after the start' });

export const appointmentListQuerySchema = z.object({
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  mine: booleanQuery,
  leadId: uuidSchema.optional(),
  clientId: uuidSchema.optional(),
  matterId: uuidSchema.optional(),
  includeCancelled: booleanQuery,
});

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>;
export type AppointmentListQuery = z.infer<typeof appointmentListQuerySchema>;

// ───────── Responses ─────────

export interface NamedRef {
  id: string;
  name: string;
}

export interface LeadSummary {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  status: LeadStatus;
  source: NamedRef | null;
  referredBy: NamedRef | null;
  owner: NamedRef | null;
  branch: NamedRef | null;
  createdAt: string;
}

export interface LeadDetail extends LeadSummary {
  interest: string | null;
  notes: string | null;
  lostReason: string | null;
  referredContact: NamedRef | null;
  convertedClient: { id: string; clientNumber: string; displayName: string } | null;
  convertedAt: string | null;
}

export interface ClientSummary {
  id: string;
  clientNumber: string;
  kind: ClientKind;
  displayName: string;
  email: string | null;
  phone: string | null;
  branch: NamedRef | null;
  createdAt: string;
}

export interface ClientRelationshipResponse {
  id: string;
  type: NamedRef;
  /** "from": this client → other. "to": other → this client. */
  direction: 'from' | 'to';
  other: { id: string; clientNumber: string; displayName: string };
  notes: string | null;
}

export interface ClientDetail extends ClientSummary {
  dateOfBirth: string | null;
  nationality: string | null;
  addressLine: string | null;
  notes: string | null;
  relationships: ClientRelationshipResponse[];
  /** Leads converted into this client (source attribution). */
  sourceLeads: {
    id: string;
    fullName: string;
    source: NamedRef | null;
    referredBy: NamedRef | null;
  }[];
}

export interface DuplicateCandidate {
  id: string;
  clientNumber: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  reasons: ('email' | 'phone' | 'name_and_birth_date')[];
}

export interface DuplicateResponse {
  candidates: DuplicateCandidate[];
  /** Matches outside what the caller may see (no details given). */
  hiddenMatches: number;
}

export interface ConvertLeadResponse {
  lead: LeadDetail;
  client: ClientSummary;
  /** True if the client was newly created by this conversion. */
  created: boolean;
}

export interface ActivityResponse {
  id: string;
  type: ActivityType;
  summary: string;
  body: string | null;
  occurredAt: string;
  actor: NamedRef;
}

export interface AppointmentResponse {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  notes: string | null;
  isConsultation: boolean;
  host: NamedRef;
  lead: { id: string; fullName: string } | null;
  client: { id: string; displayName: string; clientNumber: string } | null;
  matter: { id: string; reference: string; title: string } | null;
  cancelledAt: string | null;
}
