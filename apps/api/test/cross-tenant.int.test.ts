/**
 * Mandatory cross-tenant isolation suite (docs/ARCHITECTURE.md §15).
 *
 * 1. Route registry: every @TenantScoped route in the running app MUST have an attack case below.
 *    Routes are discovered from the live application, so a new tenant route without a case fails CI.
 * 2. Attacker = Owner of tenant A (strongest normal user). For every tenant route:
 *    a) header X-Tenant-Id = B (a workspace they don't belong to) → 404, no data.
 *    b) header = A but target ids from tenant B (IDOR/BOLA) → 404, B unchanged.
 * 3. Bodies in tenant A that reference tenant B's ids are rejected.
 */
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IS_TENANT_SCOPED } from '../src/common/auth/decorators.js';
import {
  type SignedInUser,
  inviteNewUser,
  ownerWithWorkspace,
  tenantHeaders,
} from './helpers/flows.js';
import { type TestApp, createTestApp, uniqueEmail } from './helpers/test-app.js';

interface Ids {
  memberId: string;
  invitationId: string;
  branchId: string;
  optionId: string;
  partnerTypeId: string;
  partnerId: string;
  contactId: string;
  professionalId: string;
  credentialId: string;
  // Stage 4
  leadId: string;
  leadSourceId: string;
  clientId: string;
  otherClientId: string;
  relationshipTypeId: string;
  relationshipId: string;
  appointmentId: string;
  // Stage 5
  matterTypeId: string;
  stageId: string;
  templateItemId: string;
  participantRoleId: string;
  matterId: string;
  assignmentId: string;
  participantId: string;
  deadlineId: string;
  checklistItemId: string;
  taskId: string;
  // Stage 6
  documentId: string;
  versionId: string;
  consentId: string;
  shareId: string;
  externalMemberId: string;
  // Stage 8
  stageTaskTemplateId: string;
  secondStageId: string;
}

interface AttackCase {
  /** Builds the path; `ids` are the VICTIM tenant's ids. */
  path: (ids: Ids) => string;
  body?: Record<string, unknown> | ((ids: Ids) => Record<string, unknown>);
  /** Route acts on a specific record id (IDOR check applies). */
  usesId?: boolean;
}

const inOneHour = () => {
  const start = new Date(Date.now() + 60 * 60 * 1000);
  return {
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 30 * 60 * 1000).toISOString(),
  };
};

const credentialBody = { credentialType: 'MARN', issuer: 'OMARA', identifier: '0000001' };

/** One entry per tenant-scoped route: "METHOD /path/with/:params". */
const CASES: Record<string, AttackCase> = {
  // ── Stage 2
  'GET /api/v1/tenant/access': { path: () => '/api/v1/tenant/access' },
  'GET /api/v1/tenant': { path: () => '/api/v1/tenant' },
  'PATCH /api/v1/tenant': { path: () => '/api/v1/tenant', body: { name: 'Hacked Name' } },
  'GET /api/v1/members': { path: () => '/api/v1/members' },
  'PATCH /api/v1/members/:id': {
    path: (ids) => `/api/v1/members/${ids.memberId}`,
    body: { status: 'SUSPENDED' },
    usesId: true,
  },
  'DELETE /api/v1/members/:id': { path: (ids) => `/api/v1/members/${ids.memberId}`, usesId: true },
  'POST /api/v1/invitations': {
    path: () => '/api/v1/invitations',
    body: { kind: 'EXTERNAL', email: 'attacker@example.test' },
  },
  'GET /api/v1/invitations': { path: () => '/api/v1/invitations' },
  'POST /api/v1/invitations/:id/resend': {
    path: (ids) => `/api/v1/invitations/${ids.invitationId}/resend`,
    usesId: true,
  },
  'DELETE /api/v1/invitations/:id': {
    path: (ids) => `/api/v1/invitations/${ids.invitationId}`,
    usesId: true,
  },
  'GET /api/v1/audit-logs': { path: () => '/api/v1/audit-logs' },
  // ── Stage 3: branches
  'GET /api/v1/branches': { path: () => '/api/v1/branches' },
  'POST /api/v1/branches': { path: () => '/api/v1/branches', body: { name: 'Attacker Branch' } },
  'PATCH /api/v1/branches/:id': {
    path: (ids) => `/api/v1/branches/${ids.branchId}`,
    body: { name: 'Hacked Branch' },
    usesId: true,
  },
  // ── Stage 3: configurable lists
  'GET /api/v1/reference-options': {
    path: () => '/api/v1/reference-options?category=PROFESSION_TYPE',
  },
  'POST /api/v1/reference-options': {
    path: () => '/api/v1/reference-options',
    body: { category: 'PROFESSION_TYPE', name: 'Attacker Type' },
  },
  'PATCH /api/v1/reference-options/:id': {
    path: (ids) => `/api/v1/reference-options/${ids.optionId}`,
    body: { name: 'Hacked Option' },
    usesId: true,
  },
  // ── Stage 3: partners
  'GET /api/v1/partners': { path: () => '/api/v1/partners' },
  'POST /api/v1/partners': { path: () => '/api/v1/partners', body: { name: 'X' } },
  'GET /api/v1/partners/:id': { path: (ids) => `/api/v1/partners/${ids.partnerId}`, usesId: true },
  'PATCH /api/v1/partners/:id': {
    path: (ids) => `/api/v1/partners/${ids.partnerId}`,
    body: { name: 'Hacked Partner' },
    usesId: true,
  },
  'DELETE /api/v1/partners/:id': {
    path: (ids) => `/api/v1/partners/${ids.partnerId}`,
    usesId: true,
  },
  'POST /api/v1/partners/:id/contacts': {
    path: (ids) => `/api/v1/partners/${ids.partnerId}/contacts`,
    body: { fullName: 'Planted Contact' },
    usesId: true,
  },
  'PATCH /api/v1/partners/:id/contacts/:contactId': {
    path: (ids) => `/api/v1/partners/${ids.partnerId}/contacts/${ids.contactId}`,
    body: { fullName: 'Hacked Contact' },
    usesId: true,
  },
  'DELETE /api/v1/partners/:id/contacts/:contactId': {
    path: (ids) => `/api/v1/partners/${ids.partnerId}/contacts/${ids.contactId}`,
    usesId: true,
  },
  // ── Stage 3: professionals and credentials
  'GET /api/v1/professionals': { path: () => '/api/v1/professionals' },
  'POST /api/v1/professionals': { path: () => '/api/v1/professionals', body: { fullName: 'X' } },
  'GET /api/v1/professionals/:id': {
    path: (ids) => `/api/v1/professionals/${ids.professionalId}`,
    usesId: true,
  },
  'PATCH /api/v1/professionals/:id': {
    path: (ids) => `/api/v1/professionals/${ids.professionalId}`,
    body: { fullName: 'Hacked Professional' },
    usesId: true,
  },
  'DELETE /api/v1/professionals/:id': {
    path: (ids) => `/api/v1/professionals/${ids.professionalId}`,
    usesId: true,
  },
  'POST /api/v1/professionals/:id/credentials': {
    path: (ids) => `/api/v1/professionals/${ids.professionalId}/credentials`,
    body: credentialBody,
    usesId: true,
  },
  'PATCH /api/v1/professionals/:id/credentials/:credentialId': {
    path: (ids) => `/api/v1/professionals/${ids.professionalId}/credentials/${ids.credentialId}`,
    body: { issuer: 'Hacked Issuer' },
    usesId: true,
  },
  'POST /api/v1/professionals/:id/credentials/:credentialId/verification': {
    path: (ids) =>
      `/api/v1/professionals/${ids.professionalId}/credentials/${ids.credentialId}/verification`,
    body: { status: 'VERIFIED' },
    usesId: true,
  },
  'DELETE /api/v1/professionals/:id/credentials/:credentialId': {
    path: (ids) => `/api/v1/professionals/${ids.professionalId}/credentials/${ids.credentialId}`,
    usesId: true,
  },
  // ───────── Stage 4 ─────────
  'GET /api/v1/leads': { path: () => '/api/v1/leads' },
  'POST /api/v1/leads': { path: () => '/api/v1/leads', body: { fullName: 'Attacker Lead' } },
  'GET /api/v1/leads/:id': { path: (ids) => `/api/v1/leads/${ids.leadId}`, usesId: true },
  'PATCH /api/v1/leads/:id': {
    path: (ids) => `/api/v1/leads/${ids.leadId}`,
    body: { fullName: 'Hacked Lead' },
    usesId: true,
  },
  'DELETE /api/v1/leads/:id': { path: (ids) => `/api/v1/leads/${ids.leadId}`, usesId: true },
  'POST /api/v1/leads/:id/convert': {
    path: (ids) => `/api/v1/leads/${ids.leadId}/convert`,
    body: { mode: 'new', client: { kind: 'INDIVIDUAL', displayName: 'Hacked Client' } },
    usesId: true,
  },
  'GET /api/v1/clients': { path: () => '/api/v1/clients' },
  'GET /api/v1/clients/duplicates': {
    path: () => '/api/v1/clients/duplicates?email=victim@example.test',
  },
  'POST /api/v1/clients': {
    path: () => '/api/v1/clients',
    body: { kind: 'INDIVIDUAL', displayName: 'Attacker Client' },
  },
  'GET /api/v1/clients/:id': { path: (ids) => `/api/v1/clients/${ids.clientId}`, usesId: true },
  'PATCH /api/v1/clients/:id': {
    path: (ids) => `/api/v1/clients/${ids.clientId}`,
    body: { displayName: 'Hacked Client' },
    usesId: true,
  },
  'POST /api/v1/clients/:id/relationships': {
    path: (ids) => `/api/v1/clients/${ids.clientId}/relationships`,
    body: (ids) => ({ toClientId: ids.otherClientId, typeId: ids.relationshipTypeId }),
    usesId: true,
  },
  'DELETE /api/v1/clients/:id/relationships/:relationshipId': {
    path: (ids) => `/api/v1/clients/${ids.clientId}/relationships/${ids.relationshipId}`,
    usesId: true,
  },
  'GET /api/v1/activities': {
    path: (ids) => `/api/v1/activities?leadId=${ids.leadId}`,
    usesId: true,
  },
  'POST /api/v1/activities': {
    path: () => '/api/v1/activities',
    body: (ids) => ({ leadId: ids.leadId, type: 'NOTE', summary: 'Injected note' }),
    usesId: true,
  },
  'GET /api/v1/appointments': { path: () => '/api/v1/appointments' },
  'POST /api/v1/appointments': {
    path: () => '/api/v1/appointments',
    body: () => ({ title: 'Attacker Meeting', ...inOneHour() }),
  },
  'PATCH /api/v1/appointments/:id': {
    path: (ids) => `/api/v1/appointments/${ids.appointmentId}`,
    body: { title: 'Hacked Meeting' },
    usesId: true,
  },
  'POST /api/v1/appointments/:id/cancel': {
    path: (ids) => `/api/v1/appointments/${ids.appointmentId}/cancel`,
    usesId: true,
  },
  // ───────── Stage 5: matter types (settings) ─────────
  'GET /api/v1/matter-types': { path: () => '/api/v1/matter-types' },
  'POST /api/v1/matter-types': {
    path: () => '/api/v1/matter-types',
    body: { name: 'Attacker Type' },
  },
  'GET /api/v1/matter-types/:id': {
    path: (ids) => `/api/v1/matter-types/${ids.matterTypeId}`,
    usesId: true,
  },
  'PATCH /api/v1/matter-types/:id': {
    path: (ids) => `/api/v1/matter-types/${ids.matterTypeId}`,
    body: { name: 'Hacked Type' },
    usesId: true,
  },
  'DELETE /api/v1/matter-types/:id': {
    path: (ids) => `/api/v1/matter-types/${ids.matterTypeId}`,
    usesId: true,
  },
  'POST /api/v1/matter-types/:id/stages': {
    path: (ids) => `/api/v1/matter-types/${ids.matterTypeId}/stages`,
    body: { name: 'Planted Stage' },
    usesId: true,
  },
  'PATCH /api/v1/matter-types/:id/stages/:stageId': {
    path: (ids) => `/api/v1/matter-types/${ids.matterTypeId}/stages/${ids.stageId}`,
    body: { name: 'Hacked Stage' },
    usesId: true,
  },
  'DELETE /api/v1/matter-types/:id/stages/:stageId': {
    path: (ids) => `/api/v1/matter-types/${ids.matterTypeId}/stages/${ids.stageId}`,
    usesId: true,
  },
  'POST /api/v1/matter-types/:id/checklist': {
    path: (ids) => `/api/v1/matter-types/${ids.matterTypeId}/checklist`,
    body: { title: 'Planted Item' },
    usesId: true,
  },
  'PATCH /api/v1/matter-types/:id/checklist/:itemId': {
    path: (ids) => `/api/v1/matter-types/${ids.matterTypeId}/checklist/${ids.templateItemId}`,
    body: { title: 'Hacked Item' },
    usesId: true,
  },
  'DELETE /api/v1/matter-types/:id/checklist/:itemId': {
    path: (ids) => `/api/v1/matter-types/${ids.matterTypeId}/checklist/${ids.templateItemId}`,
    usesId: true,
  },
  // ───────── Stage 5: matters ─────────
  'GET /api/v1/matters': { path: () => '/api/v1/matters' },
  'POST /api/v1/matters': {
    path: () => '/api/v1/matters',
    body: (ids) => ({
      clientId: ids.clientId,
      matterTypeId: ids.matterTypeId,
      title: 'Attacker Matter',
    }),
  },
  'GET /api/v1/matters/:id': { path: (ids) => `/api/v1/matters/${ids.matterId}`, usesId: true },
  'PATCH /api/v1/matters/:id': {
    path: (ids) => `/api/v1/matters/${ids.matterId}`,
    body: { title: 'Hacked Matter' },
    usesId: true,
  },
  'POST /api/v1/matters/:id/transition': {
    path: (ids) => `/api/v1/matters/${ids.matterId}/transition`,
    body: { status: 'CLOSED' },
    usesId: true,
  },
  'POST /api/v1/matters/:id/assignments': {
    path: (ids) => `/api/v1/matters/${ids.matterId}/assignments`,
    body: (ids) => ({ membershipId: ids.memberId }),
    usesId: true,
  },
  'DELETE /api/v1/matters/:id/assignments/:assignmentId': {
    path: (ids) => `/api/v1/matters/${ids.matterId}/assignments/${ids.assignmentId}`,
    usesId: true,
  },
  'POST /api/v1/matters/:id/participants': {
    path: (ids) => `/api/v1/matters/${ids.matterId}/participants`,
    body: (ids) => ({ roleId: ids.participantRoleId, clientId: ids.otherClientId }),
    usesId: true,
  },
  'DELETE /api/v1/matters/:id/participants/:participantId': {
    path: (ids) => `/api/v1/matters/${ids.matterId}/participants/${ids.participantId}`,
    usesId: true,
  },
  'POST /api/v1/matters/:id/deadlines': {
    path: (ids) => `/api/v1/matters/${ids.matterId}/deadlines`,
    body: () => ({ title: 'Planted Deadline', dueAt: inOneHour().startsAt }),
    usesId: true,
  },
  'PATCH /api/v1/matters/:id/deadlines/:deadlineId': {
    path: (ids) => `/api/v1/matters/${ids.matterId}/deadlines/${ids.deadlineId}`,
    body: { completed: true },
    usesId: true,
  },
  'DELETE /api/v1/matters/:id/deadlines/:deadlineId': {
    path: (ids) => `/api/v1/matters/${ids.matterId}/deadlines/${ids.deadlineId}`,
    usesId: true,
  },
  'POST /api/v1/matters/:id/checklist': {
    path: (ids) => `/api/v1/matters/${ids.matterId}/checklist`,
    body: { title: 'Planted Item' },
    usesId: true,
  },
  'PATCH /api/v1/matters/:id/checklist/:itemId': {
    path: (ids) => `/api/v1/matters/${ids.matterId}/checklist/${ids.checklistItemId}`,
    body: { done: true },
    usesId: true,
  },
  'DELETE /api/v1/matters/:id/checklist/:itemId': {
    path: (ids) => `/api/v1/matters/${ids.matterId}/checklist/${ids.checklistItemId}`,
    usesId: true,
  },
  // ───────── Stage 5: tasks ─────────
  'GET /api/v1/tasks': { path: (ids) => `/api/v1/tasks?matterId=${ids.matterId}`, usesId: true },
  'POST /api/v1/tasks': { path: () => '/api/v1/tasks', body: { title: 'Attacker Task' } },
  'PATCH /api/v1/tasks/:id': {
    path: (ids) => `/api/v1/tasks/${ids.taskId}`,
    body: { status: 'DONE' },
    usesId: true,
  },
  'DELETE /api/v1/tasks/:id': { path: (ids) => `/api/v1/tasks/${ids.taskId}`, usesId: true },
  // ───────── Stage 6: documents ─────────
  'GET /api/v1/documents': {
    path: (ids) => `/api/v1/documents?matterId=${ids.matterId}`,
    usesId: true,
  },
  // Multipart upload: the foreign-reference case is in the Stage 6 body attacks below.
  'POST /api/v1/documents': {
    path: () => '/api/v1/documents',
    body: (ids) => ({ clientId: ids.clientId }),
  },
  'GET /api/v1/documents/:id': {
    path: (ids) => `/api/v1/documents/${ids.documentId}`,
    usesId: true,
  },
  'PATCH /api/v1/documents/:id': {
    path: (ids) => `/api/v1/documents/${ids.documentId}`,
    body: { title: 'Hacked Document' },
    usesId: true,
  },
  'DELETE /api/v1/documents/:id': {
    path: (ids) => `/api/v1/documents/${ids.documentId}`,
    usesId: true,
  },
  'POST /api/v1/documents/:id/versions': {
    path: (ids) => `/api/v1/documents/${ids.documentId}/versions`,
    usesId: true,
  },
  'GET /api/v1/documents/:id/download': {
    path: (ids) => `/api/v1/documents/${ids.documentId}/download`,
    usesId: true,
  },
  'GET /api/v1/documents/:id/versions/:versionId/download': {
    path: (ids) => `/api/v1/documents/${ids.documentId}/versions/${ids.versionId}/download`,
    usesId: true,
  },
  // ───────── Stage 6: consents ─────────
  'GET /api/v1/consents': {
    path: (ids) => `/api/v1/consents?clientId=${ids.clientId}`,
    usesId: true,
  },
  'POST /api/v1/consents': {
    path: () => '/api/v1/consents',
    body: (ids) => ({
      clientId: ids.clientId,
      purpose: 'Planted consent',
      method: 'VERBAL',
      givenAt: new Date().toISOString(),
    }),
    usesId: true,
  },
  'POST /api/v1/consents/:id/withdraw': {
    path: (ids) => `/api/v1/consents/${ids.consentId}/withdraw`,
    usesId: true,
  },
  // ───────── Stage 6: shares ─────────
  'GET /api/v1/shares': { path: (ids) => `/api/v1/shares?matterId=${ids.matterId}`, usesId: true },
  'POST /api/v1/shares': {
    path: () => '/api/v1/shares',
    body: (ids) => ({
      matterId: ids.matterId,
      granteeMembershipId: ids.externalMemberId,
      documentIds: [ids.documentId],
    }),
    usesId: true,
  },
  'PATCH /api/v1/shares/:id': {
    path: (ids) => `/api/v1/shares/${ids.shareId}`,
    body: { documentIds: [] },
    usesId: true,
  },
  'POST /api/v1/shares/:id/revoke': {
    path: (ids) => `/api/v1/shares/${ids.shareId}/revoke`,
    usesId: true,
  },
  // ───────── Stage 8: automation ─────────
  'POST /api/v1/matter-types/:id/stages/:stageId/tasks': {
    path: (ids) => `/api/v1/matter-types/${ids.matterTypeId}/stages/${ids.stageId}/tasks`,
    body: { title: 'Planted auto task' },
    usesId: true,
  },
  'PATCH /api/v1/matter-types/:id/stages/:stageId/tasks/:templateId': {
    path: (ids) =>
      `/api/v1/matter-types/${ids.matterTypeId}/stages/${ids.secondStageId}/tasks/${ids.stageTaskTemplateId}`,
    body: { title: 'Hacked auto task' },
    usesId: true,
  },
  'DELETE /api/v1/matter-types/:id/stages/:stageId/tasks/:templateId': {
    path: (ids) =>
      `/api/v1/matter-types/${ids.matterTypeId}/stages/${ids.secondStageId}/tasks/${ids.stageTaskTemplateId}`,
    usesId: true,
  },
  'GET /api/v1/automation-settings': { path: () => '/api/v1/automation-settings' },
  'PUT /api/v1/automation-settings': {
    path: () => '/api/v1/automation-settings',
    body: { deadlineReminderDays: [1], leadFollowUpDays: 1 },
  },
  // ───────── Stage 7: reports (aggregates only; the victim's data never counts) ─────────
  'GET /api/v1/reports/leads': { path: () => '/api/v1/reports/leads' },
  'GET /api/v1/reports/matters': { path: () => '/api/v1/reports/matters' },
  'GET /api/v1/reports/workload': { path: () => '/api/v1/reports/workload' },
  'GET /api/v1/reports/documents': { path: () => '/api/v1/reports/documents' },
  'GET /api/v1/shared': { path: () => '/api/v1/shared' },
  'GET /api/v1/shared/:shareId': {
    path: (ids) => `/api/v1/shared/${ids.shareId}`,
    usesId: true,
  },
  'GET /api/v1/shared/:shareId/documents/:documentId/download': {
    path: (ids) => `/api/v1/shared/${ids.shareId}/documents/${ids.documentId}/download`,
    usesId: true,
  },
};

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n');

const bodyOf = (attack: AttackCase, ids: Ids) =>
  typeof attack.body === 'function' ? attack.body(ids) : attack.body;

/** Reads every controller of the running app, so the list can't drift from the code. */
function tenantScopedRoutes(t: TestApp): string[] {
  const routes: string[] = [];
  for (const moduleRef of t.app.get(ModulesContainer).values()) {
    for (const wrapper of moduleRef.controllers.values()) {
      const controller = wrapper.metatype as (new (...args: never[]) => unknown) | null;
      if (!controller) continue;
      const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
      const classScoped = Reflect.getMetadata(IS_TENANT_SCOPED, controller) === true;
      const proto = controller.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const methodPath = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (methodPath === undefined || method === undefined) continue;
        if (!classScoped && Reflect.getMetadata(IS_TENANT_SCOPED, handler) !== true) continue;
        const full = ['api/v1', base, methodPath]
          .map((p) => p.replace(/^\/|\/$/g, ''))
          .filter(Boolean)
          .join('/');
        routes.push(`${RequestMethod[method]} /${full}`);
      }
    }
  }
  return [...new Set(routes)].sort();
}

let t: TestApp;
let attacker: SignedInUser;
let tenantA: string;
let victimOwner: SignedInUser;
let tenantB: string;
let victim: Ids;
let attackerPartnerId: string;

const idOf = (res: request.Response) => (res.body as { id: string }).id;

function api(user: SignedInUser, tenantId: string) {
  const headers = tenantHeaders(user, tenantId);
  return {
    get: (path: string) => request(t.server).get(path).set(headers),
    post: (path: string, body: object) => request(t.server).post(path).set(headers).send(body),
    put: (path: string, body: object) => request(t.server).put(path).set(headers).send(body),
  };
}

beforeAll(async () => {
  t = await createTestApp();
  const a = await ownerWithWorkspace(t, 'xt-a');
  attacker = a.owner;
  tenantA = a.tenantId;
  const b = await ownerWithWorkspace(t, 'xt-b');
  victimOwner = b.owner;
  tenantB = b.tenantId;
  const B = api(victimOwner, tenantB);

  const victimAgent = await inviteNewUser(
    t,
    victimOwner,
    tenantB,
    { kind: 'STAFF', roleKey: 'migration_agent' },
    'xt-agent',
  );
  const pending = await B.post('/api/v1/invitations', {
    kind: 'STAFF',
    roleKey: 'receptionist',
    email: uniqueEmail('xt-pending'),
  }).expect(201);
  const members = await B.get('/api/v1/members');
  const agentRow = (members.body as { id: string; userId: string }[]).find(
    (m) => m.userId === victimAgent.userId,
  );

  const branch = await B.post('/api/v1/branches', { name: 'Victim Branch' }).expect(201);
  const professionTypes = await B.get('/api/v1/reference-options?category=PROFESSION_TYPE');
  const partnerTypes = await B.get('/api/v1/reference-options?category=PARTNER_TYPE');
  const optionId = (professionTypes.body as { id: string }[])[0]?.id ?? '';
  const partnerTypeId = (partnerTypes.body as { id: string }[])[0]?.id ?? '';
  const partner = await B.post('/api/v1/partners', {
    name: 'Victim Partner',
    typeId: partnerTypeId,
  }).expect(201);
  const contact = await B.post(`/api/v1/partners/${idOf(partner)}/contacts`, {
    fullName: 'Victim Contact',
  }).expect(201);
  const professional = await B.post('/api/v1/professionals', {
    fullName: 'Victim Professional',
    professionTypeId: optionId,
  }).expect(201);
  const credential = await B.post(
    `/api/v1/professionals/${idOf(professional)}/credentials`,
    credentialBody,
  ).expect(201);

  const firstOption = async (category: string) => {
    const res = await B.get(`/api/v1/reference-options?category=${category}`).expect(200);
    return (res.body as { id: string }[])[0]?.id ?? '';
  };
  const leadSourceId = await firstOption('LEAD_SOURCE');
  const relationshipTypeId = await firstOption('RELATIONSHIP_TYPE');
  const lead = await B.post('/api/v1/leads', {
    fullName: 'Victim Lead',
    email: 'victim@example.test',
    sourceId: leadSourceId,
    referredByPartnerId: idOf(partner),
    referredByContactId: idOf(contact),
    branchId: idOf(branch),
  }).expect(201);
  const client = await B.post('/api/v1/clients', {
    kind: 'INDIVIDUAL',
    displayName: 'Victim Client',
    email: 'victim@example.test',
  }).expect(201);
  const otherClient = await B.post('/api/v1/clients', {
    kind: 'INDIVIDUAL',
    displayName: 'Victim Dependant',
  }).expect(201);
  const related = await B.post(`/api/v1/clients/${idOf(client)}/relationships`, {
    toClientId: idOf(otherClient),
    typeId: relationshipTypeId,
  }).expect(201);
  const relationshipId =
    (related.body as { relationships: { id: string }[] }).relationships[0]?.id ?? '';
  await B.post('/api/v1/activities', {
    leadId: idOf(lead),
    type: 'CALL',
    summary: 'Victim call',
  }).expect(201);
  const appointment = await B.post('/api/v1/appointments', {
    title: 'Victim Consultation',
    isConsultation: true,
    leadId: idOf(lead),
    ...inOneHour(),
  }).expect(201);

  // Stage 5
  const types = await B.get('/api/v1/matter-types').expect(200);
  const type = (types.body as { id: string; stages: { id: string }[] }[])[0];
  const matterTypeId = type?.id ?? '';
  const withItem = await B.post(`/api/v1/matter-types/${matterTypeId}/checklist`, {
    title: 'Victim template item',
  }).expect(201);
  const templateItemId = (withItem.body as { checklist: { id: string }[] }).checklist[0]?.id ?? '';
  const participantRoleId = await firstOption('PARTICIPANT_ROLE');
  const matter = await B.post('/api/v1/matters', {
    clientId: idOf(client),
    matterTypeId,
    title: 'Victim Matter',
    branchId: idOf(branch),
  }).expect(201);
  const matterId = idOf(matter);
  const assigned = await B.post(`/api/v1/matters/${matterId}/assignments`, {
    membershipId: agentRow?.id,
  }).expect(201);
  const participated = await B.post(`/api/v1/matters/${matterId}/participants`, {
    roleId: participantRoleId,
    clientId: idOf(otherClient),
  }).expect(201);
  const withDeadline = await B.post(`/api/v1/matters/${matterId}/deadlines`, {
    title: 'Victim Deadline',
    dueAt: inOneHour().endsAt,
  }).expect(201);
  type MatterBody = {
    assignments: { id: string; member: { id: string } }[];
    participants: { id: string }[];
    deadlines: { id: string }[];
    checklist: { id: string }[];
  };
  const task = await B.post('/api/v1/tasks', { title: 'Victim Task', matterId }).expect(201);
  // Template on the second stage (the victim matter stays on the first, so no task is created).
  const secondStage = type?.stages[1]?.id ?? '';
  const withAuto = await B.post(
    `/api/v1/matter-types/${matterTypeId}/stages/${secondStage}/tasks`,
    {
      title: 'Victim auto task',
    },
  ).expect(201);
  const stageTaskTemplateId =
    (withAuto.body as { stages: { id: string; taskTemplates: { id: string }[] }[] }).stages.find(
      (st) => st.id === secondStage,
    )?.taskTemplates[0]?.id ?? '';
  await B.put('/api/v1/automation-settings', {
    deadlineReminderDays: [7],
    leadFollowUpDays: null,
  }).expect(200);

  // Stage 6
  const uploaded = await request(t.server)
    .post('/api/v1/documents')
    .set(tenantHeaders(victimOwner, tenantB))
    .field('matterId', matterId)
    .field('title', 'Victim Passport')
    .attach('file', PDF, 'passport.pdf')
    .expect(201);
  const consent = await B.post('/api/v1/consents', {
    clientId: idOf(client),
    purpose: 'Share with external lawyer',
    method: 'WRITTEN',
    givenAt: new Date().toISOString(),
  }).expect(201);
  const external = await inviteNewUser(t, victimOwner, tenantB, { kind: 'EXTERNAL' }, 'xt-ext');
  const membersNow = await B.get('/api/v1/members');
  const externalMemberId =
    (membersNow.body as { id: string; userId: string }[]).find((m) => m.userId === external.userId)
      ?.id ?? '';
  const share = await B.post('/api/v1/shares', {
    matterId,
    granteeMembershipId: externalMemberId,
    documentIds: [idOf(uploaded)],
    consentId: idOf(consent),
  }).expect(201);

  victim = {
    matterTypeId,
    stageId: type?.stages[0]?.id ?? '',
    templateItemId,
    participantRoleId,
    matterId,
    assignmentId:
      (assigned.body as MatterBody).assignments.find((a) => a.member.id === agentRow?.id)?.id ?? '',
    participantId: (participated.body as MatterBody).participants[0]?.id ?? '',
    deadlineId: (withDeadline.body as MatterBody).deadlines[0]?.id ?? '',
    checklistItemId: (matter.body as MatterBody).checklist[0]?.id ?? '',
    taskId: idOf(task),
    stageTaskTemplateId,
    secondStageId: secondStage,
    documentId: idOf(uploaded),
    versionId: (uploaded.body as { latest: { id: string } }).latest.id,
    consentId: idOf(consent),
    shareId: idOf(share),
    externalMemberId,
    leadId: idOf(lead),
    leadSourceId,
    clientId: idOf(client),
    otherClientId: idOf(otherClient),
    relationshipTypeId,
    relationshipId,
    appointmentId: idOf(appointment),
    memberId: agentRow?.id ?? '',
    invitationId: idOf(pending),
    branchId: idOf(branch),
    optionId,
    partnerTypeId,
    partnerId: idOf(partner),
    contactId: idOf(contact),
    professionalId: idOf(professional),
    credentialId: idOf(credential),
  };

  // The attacker's own partner, used for the "own parent + victim child" attack.
  const A = api(attacker, tenantA);
  const ownTypes = await A.get('/api/v1/reference-options?category=PARTNER_TYPE');
  const ownPartner = await A.post('/api/v1/partners', {
    name: 'Attacker Partner',
    typeId: (ownTypes.body as { id: string }[])[0]?.id,
  }).expect(201);
  attackerPartnerId = idOf(ownPartner);
});

afterAll(async () => {
  await t.close();
});

function send(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: Record<string, unknown>,
) {
  const r = request(t.server);
  const req =
    method === 'GET'
      ? r.get(path)
      : method === 'POST'
        ? r.post(path)
        : method === 'PATCH'
          ? r.patch(path)
          : method === 'PUT'
            ? r.put(path)
            : method === 'DELETE'
              ? r.delete(path)
              : (() => {
                  throw new Error(`Unsupported method ${method}`);
                })();
  return body ? req.set(headers).send(body) : req.set(headers);
}

describe('route registry', () => {
  it('every tenant-scoped route has a cross-tenant attack case (and no stale cases)', () => {
    expect(tenantScopedRoutes(t)).toEqual(Object.keys(CASES).sort());
  });
});

describe('attack: header points at another tenant', () => {
  for (const [route, attack] of Object.entries(CASES)) {
    it(`${route} → 404 WORKSPACE_NOT_FOUND`, async () => {
      const [method] = route.split(' ');
      const res = await send(
        method ?? 'GET',
        attack.path(victim),
        tenantHeaders(attacker, tenantB),
        bodyOf(attack, victim),
      );
      expect(res.status).toBe(404);
      expect((res.body as { code: string }).code).toBe('WORKSPACE_NOT_FOUND');
    });
  }
});

describe('attack: own tenant header + victim record ids (IDOR/BOLA)', () => {
  for (const [route, attack] of Object.entries(CASES).filter(([, c]) => c.usesId)) {
    it(`${route} → 404 NOT_FOUND`, async () => {
      const [method] = route.split(' ');
      const res = await send(
        method ?? 'GET',
        attack.path(victim),
        tenantHeaders(attacker, tenantA),
        bodyOf(attack, victim),
      );
      expect(res.status).toBe(404);
      expect((res.body as { code: string }).code).toBe('NOT_FOUND');
    });
  }

  it("own partner + victim's contact id → 404", async () => {
    const path = `/api/v1/partners/${attackerPartnerId}/contacts/${victim.contactId}`;
    const headers = tenantHeaders(attacker, tenantA);
    await send('PATCH', path, headers, { fullName: 'Hacked Contact' }).expect(404);
    await send('DELETE', path, headers).expect(404);
  });
});

describe("attack: bodies in tenant A that reference tenant B's ids", () => {
  const headers = () => tenantHeaders(attacker, tenantA);

  it('partner with a foreign type id → 400', async () => {
    const res = await send('POST', '/api/v1/partners', headers(), {
      name: 'Cross Partner',
      typeId: victim.partnerTypeId,
    });
    expect(res.status).toBe(400);
    expect((res.body as { code: string }).code).toBe('INVALID_REFERENCE');
  });

  it('professional with a foreign profession type or partner → 400', async () => {
    const types = await request(t.server)
      .get('/api/v1/reference-options?category=PROFESSION_TYPE')
      .set(headers());
    const ownTypeId = (types.body as { id: string }[])[0]?.id;
    const foreignType = await send('POST', '/api/v1/professionals', headers(), {
      fullName: 'Cross Pro',
      professionTypeId: victim.optionId,
    });
    expect(foreignType.status).toBe(400);
    const foreignPartner = await send('POST', '/api/v1/professionals', headers(), {
      fullName: 'Cross Pro',
      professionTypeId: ownTypeId,
      partnerOrgId: victim.partnerId,
    });
    expect(foreignPartner.status).toBe(400);
    expect((foreignPartner.body as { code: string }).code).toBe('INVALID_REFERENCE');
  });

  it('member or invitation with a foreign branch id → 400', async () => {
    const members = await request(t.server).get('/api/v1/members').set(headers());
    const selfId = (members.body as { id: string }[])[0]?.id;
    const member = await send('PATCH', `/api/v1/members/${selfId}`, headers(), {
      branchIds: [victim.branchId],
    });
    expect(member.status).toBe(400);
    expect((member.body as { code: string }).code).toBe('UNKNOWN_BRANCH');
    const invite = await send('POST', '/api/v1/invitations', headers(), {
      kind: 'STAFF',
      roleKey: 'receptionist',
      email: uniqueEmail('xt-cross'),
      branchIds: [victim.branchId],
    });
    expect(invite.status).toBe(400);
  });
});

describe("attack: Stage 4 bodies in tenant A that reference tenant B's ids", () => {
  const headers = () => tenantHeaders(attacker, tenantA);
  const code = (res: request.Response) => (res.body as { code: string }).code;

  it('lead with a foreign source, partner, contact, branch or owner → 400', async () => {
    for (const [field, value] of [
      ['sourceId', () => victim.leadSourceId],
      ['referredByPartnerId', () => victim.partnerId],
      ['referredByContactId', () => victim.contactId],
      ['branchId', () => victim.branchId],
      ['ownerMembershipId', () => victim.memberId],
    ] as const) {
      const res = await send('POST', '/api/v1/leads', headers(), {
        fullName: 'Cross Lead',
        [field]: value(),
      });
      expect(res.status, field).toBe(400);
      expect(code(res), field).toBe('INVALID_REFERENCE');
    }
  });

  it("converting own lead into the victim's client → 404; own client related to victim's → 400", async () => {
    const own = await send('POST', '/api/v1/leads', headers(), { fullName: 'Own Lead' }).expect(
      201,
    );
    const link = await send('POST', `/api/v1/leads/${idOf(own)}/convert`, headers(), {
      mode: 'link',
      clientId: victim.clientId,
    });
    expect(link.status).toBe(404);
    const ownClient = await send('POST', '/api/v1/clients', headers(), {
      kind: 'INDIVIDUAL',
      displayName: 'Own Client',
    }).expect(201);
    const types = await request(t.server)
      .get('/api/v1/reference-options?category=RELATIONSHIP_TYPE')
      .set(headers());
    const rel = await send('POST', `/api/v1/clients/${idOf(ownClient)}/relationships`, headers(), {
      toClientId: victim.clientId,
      typeId: (types.body as { id: string }[])[0]?.id,
    });
    expect(rel.status).toBe(400);
    expect(code(rel)).toBe('INVALID_REFERENCE');
    const foreignType = await send(
      'POST',
      `/api/v1/clients/${idOf(ownClient)}/relationships`,
      headers(),
      {
        toClientId: idOf(ownClient),
        typeId: victim.relationshipTypeId,
      },
    );
    expect(foreignType.status).toBe(400);
  });

  it('appointment linked to a foreign lead/client or hosted by a foreign member → 400', async () => {
    for (const extra of [
      { leadId: victim.leadId },
      { clientId: victim.clientId },
      { hostMembershipId: victim.memberId },
    ]) {
      const res = await send('POST', '/api/v1/appointments', headers(), {
        title: 'Cross Meeting',
        ...inOneHour(),
        ...extra,
      });
      expect(res.status, JSON.stringify(extra)).toBe(400);
      expect(code(res)).toBe('INVALID_REFERENCE');
    }
  });

  it("duplicate check never reveals the victim's clients (not even as a hidden count)", async () => {
    const res = await request(t.server)
      .get('/api/v1/clients/duplicates?email=victim@example.test')
      .set(headers())
      .expect(200);
    expect(res.body).toEqual({ candidates: [], hiddenMatches: 0 });
  });
});

describe("attack: Stage 5 bodies in tenant A that reference tenant B's ids", () => {
  const headers = () => tenantHeaders(attacker, tenantA);
  const code = (res: request.Response) => (res.body as { code: string }).code;
  let ownMatterId = '';
  let ownTypeId = '';

  beforeAll(async () => {
    const types = await request(t.server).get('/api/v1/matter-types').set(headers()).expect(200);
    ownTypeId = (types.body as { id: string }[])[0]?.id ?? '';
    const ownClient = await send('POST', '/api/v1/clients', headers(), {
      kind: 'INDIVIDUAL',
      displayName: 'Own Matter Client',
    }).expect(201);
    const own = await send('POST', '/api/v1/matters', headers(), {
      clientId: idOf(ownClient),
      matterTypeId: ownTypeId,
      title: 'Own Matter',
    }).expect(201);
    ownMatterId = idOf(own);
  });

  it('matter with a foreign client, type, branch or assignee → 400', async () => {
    const ownClient = await send('POST', '/api/v1/clients', headers(), {
      kind: 'INDIVIDUAL',
      displayName: 'Own Client 2',
    }).expect(201);
    for (const [label, body] of [
      ['client', { clientId: victim.clientId, matterTypeId: ownTypeId }],
      ['type', { clientId: idOf(ownClient), matterTypeId: victim.matterTypeId }],
      ['branch', { clientId: idOf(ownClient), matterTypeId: ownTypeId, branchId: victim.branchId }],
      [
        'assignee',
        {
          clientId: idOf(ownClient),
          matterTypeId: ownTypeId,
          assigneeMembershipIds: [victim.memberId],
        },
      ],
    ] as const) {
      const res = await send('POST', '/api/v1/matters', headers(), {
        title: 'Cross Matter',
        ...body,
      });
      expect(res.status, label).toBe(400);
      expect(code(res), label).toBe('INVALID_REFERENCE');
    }
  });

  it('own matter: foreign stage, assignee, participant role/client/professional/partner → 400', async () => {
    const stage = await send('POST', `/api/v1/matters/${ownMatterId}/transition`, headers(), {
      stageId: victim.stageId,
    });
    expect(stage.status).toBe(400);
    const assignee = await send('POST', `/api/v1/matters/${ownMatterId}/assignments`, headers(), {
      membershipId: victim.memberId,
    });
    expect(assignee.status).toBe(400);
    const roles = await request(t.server)
      .get('/api/v1/reference-options?category=PARTICIPANT_ROLE')
      .set(headers());
    const ownRole = (roles.body as { id: string }[])[0]?.id;
    for (const body of [
      {
        roleId: victim.participantRoleId,
        professionalId: undefined,
        clientId: undefined,
        partnerOrgId: attackerPartnerId,
      },
      { roleId: ownRole, clientId: victim.clientId },
      { roleId: ownRole, professionalId: victim.professionalId },
      { roleId: ownRole, partnerOrgId: victim.partnerId },
    ]) {
      const res = await send(
        'POST',
        `/api/v1/matters/${ownMatterId}/participants`,
        headers(),
        body,
      );
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(code(res)).toBe('INVALID_REFERENCE');
    }
  });

  it('own matter + victim child ids (deadline, checklist, assignment, participant) → 404', async () => {
    const base = `/api/v1/matters/${ownMatterId}`;
    await send('PATCH', `${base}/deadlines/${victim.deadlineId}`, headers(), {
      completed: true,
    }).expect(404);
    await send('DELETE', `${base}/deadlines/${victim.deadlineId}`, headers()).expect(404);
    await send('PATCH', `${base}/checklist/${victim.checklistItemId}`, headers(), {
      done: true,
    }).expect(404);
    await send('DELETE', `${base}/checklist/${victim.checklistItemId}`, headers()).expect(404);
    await send('DELETE', `${base}/assignments/${victim.assignmentId}`, headers()).expect(404);
    await send('DELETE', `${base}/participants/${victim.participantId}`, headers()).expect(404);
    const typeBase = `/api/v1/matter-types/${ownTypeId}`;
    await send('PATCH', `${typeBase}/stages/${victim.stageId}`, headers(), { name: 'X' }).expect(
      404,
    );
    await send('PATCH', `${typeBase}/checklist/${victim.templateItemId}`, headers(), {
      title: 'X',
    }).expect(404);
  });

  it('task, activity or appointment linked to a foreign matter/client/lead/assignee → 400', async () => {
    for (const extra of [
      { matterId: victim.matterId },
      { clientId: victim.clientId },
      { leadId: victim.leadId },
      { assigneeMembershipId: victim.memberId },
    ]) {
      const res = await send('POST', '/api/v1/tasks', headers(), { title: 'Cross Task', ...extra });
      expect(res.status, JSON.stringify(extra)).toBe(400);
      expect(code(res)).toBe('INVALID_REFERENCE');
    }
    const activity = await send('POST', '/api/v1/activities', headers(), {
      matterId: victim.matterId,
      type: 'NOTE',
      summary: 'Injected',
    });
    expect(activity.status).toBe(404);
    const appt = await send('POST', '/api/v1/appointments', headers(), {
      title: 'Cross Meeting',
      matterId: victim.matterId,
      ...inOneHour(),
    });
    expect(appt.status).toBe(400);
    expect(code(appt)).toBe('INVALID_REFERENCE');
  });
});

describe("attack: Stage 6 bodies and files in tenant A that reference tenant B's ids", () => {
  const headers = () => tenantHeaders(attacker, tenantA);
  const code = (res: request.Response) => (res.body as { code: string }).code;
  const upload = (fields: Record<string, string>) => {
    let req = request(t.server).post('/api/v1/documents').set(headers());
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req.attach('file', PDF, 'cross.pdf');
  };

  it('uploading onto a foreign client, matter, category or checklist item → 400, nothing stored', async () => {
    const ownClient = await send('POST', '/api/v1/clients', headers(), {
      kind: 'INDIVIDUAL',
      displayName: 'Own Doc Client',
    }).expect(201);
    for (const fields of [
      { clientId: victim.clientId },
      { matterId: victim.matterId },
      { clientId: idOf(ownClient), categoryId: victim.optionId },
      { clientId: idOf(ownClient), checklistItemId: victim.checklistItemId },
    ] as Record<string, string>[]) {
      const res = await upload(fields);
      expect(res.status, JSON.stringify(fields)).toBe(400);
      expect(code(res)).toBe('INVALID_REFERENCE');
    }
  });

  it("sharing own matter with the victim's external member or the victim's documents/consent → 400", async () => {
    const types = await request(t.server).get('/api/v1/matter-types').set(headers()).expect(200);
    const ownClient = await send('POST', '/api/v1/clients', headers(), {
      kind: 'INDIVIDUAL',
      displayName: 'Own Share Client',
    }).expect(201);
    const own = await send('POST', '/api/v1/matters', headers(), {
      clientId: idOf(ownClient),
      matterTypeId: (types.body as { id: string }[])[0]?.id,
      title: 'Own Share Matter',
    }).expect(201);
    const ownExternal = await inviteNewUser(
      t,
      attacker,
      tenantA,
      { kind: 'EXTERNAL' },
      'xt-own-ext',
    );
    const members = await request(t.server).get('/api/v1/members').set(headers());
    const ownExternalId = (members.body as { id: string; userId: string }[]).find(
      (m) => m.userId === ownExternal.userId,
    )?.id;
    for (const extra of [
      { granteeMembershipId: victim.externalMemberId },
      { granteeMembershipId: ownExternalId, documentIds: [victim.documentId] },
      { granteeMembershipId: ownExternalId, consentId: victim.consentId },
    ]) {
      const res = await send('POST', '/api/v1/shares', headers(), {
        matterId: idOf(own),
        ...extra,
      });
      expect(res.status, JSON.stringify(extra)).toBe(400);
      expect(code(res)).toBe('INVALID_REFERENCE');
    }
    // The attacker's own external member cannot see anything of tenant B.
    const ext = request(t.server);
    const shared = await ext
      .get('/api/v1/shared')
      .set(tenantHeaders(ownExternal, tenantA))
      .expect(200);
    expect(shared.body).toEqual([]);
    await ext
      .get(`/api/v1/shared/${victim.shareId}/documents/${victim.documentId}/download`)
      .set(tenantHeaders(ownExternal, tenantA))
      .expect(404);
  });
});

describe('after all attacks', () => {
  it('victim data is unchanged', async () => {
    const B = api(victimOwner, tenantB);
    const members = await B.get('/api/v1/members').expect(200);
    const agent = (members.body as { id: string; status: string }[]).find(
      (m) => m.id === victim.memberId,
    );
    expect(agent?.status).toBe('ACTIVE');
    const invites = await B.get('/api/v1/invitations').expect(200);
    const invite = (invites.body as { id: string; status: string }[]).find(
      (i) => i.id === victim.invitationId,
    );
    expect(invite?.status).toBe('PENDING');
    const tenant = await B.get('/api/v1/tenant').expect(200);
    expect((tenant.body as { name: string }).name).not.toBe('Hacked Name');

    const branches = await B.get('/api/v1/branches').expect(200);
    expect((branches.body as { name: string }[]).map((b) => b.name)).toEqual(['Victim Branch']);
    const partner = await B.get(`/api/v1/partners/${victim.partnerId}`).expect(200);
    expect(partner.body).toMatchObject({
      name: 'Victim Partner',
      contacts: [{ id: victim.contactId, fullName: 'Victim Contact' }],
    });
    const professional = await B.get(`/api/v1/professionals/${victim.professionalId}`).expect(200);
    expect(professional.body).toMatchObject({
      fullName: 'Victim Professional',
      credentials: [{ id: victim.credentialId, status: 'UNVERIFIED', issuer: 'OMARA' }],
    });
    const options = await B.get('/api/v1/reference-options?category=PROFESSION_TYPE').expect(200);
    const names = (options.body as { name: string }[]).map((o) => o.name);
    expect(names).not.toContain('Hacked Option');
    expect(names).not.toContain('Attacker Type');
  });

  it('Stage 4 victim records are unchanged', async () => {
    const B = api(victimOwner, tenantB);
    const lead = await B.get(`/api/v1/leads/${victim.leadId}`).expect(200);
    expect(lead.body).toMatchObject({
      fullName: 'Victim Lead',
      status: 'OPEN',
      convertedClient: null,
    });
    const client = await B.get(`/api/v1/clients/${victim.clientId}`).expect(200);
    expect(client.body).toMatchObject({ displayName: 'Victim Client' });
    expect(
      (client.body as { relationships: { id: string }[] }).relationships.map((r) => r.id),
    ).toEqual([victim.relationshipId]);
    const activities = await B.get(`/api/v1/activities?leadId=${victim.leadId}`).expect(200);
    expect((activities.body as { data: { summary: string }[] }).data.map((a) => a.summary)).toEqual(
      ['Victim call'],
    );
    const appointments = await B.get('/api/v1/appointments').expect(200);
    expect(appointments.body).toMatchObject([
      { id: victim.appointmentId, title: 'Victim Consultation', cancelledAt: null },
    ]);
  });

  it('Stage 5 victim records are unchanged', async () => {
    const B = api(victimOwner, tenantB);
    const matter = await B.get(`/api/v1/matters/${victim.matterId}`).expect(200);
    const m = matter.body as {
      title: string;
      status: string;
      assignments: { id: string }[];
      participants: { id: string }[];
      deadlines: { id: string; completedAt: string | null }[];
      checklist: { id: string; completedAt: string | null }[];
      history: unknown[];
    };
    expect(m.title).toBe('Victim Matter');
    expect(m.status).toBe('OPEN');
    expect(m.assignments.map((a) => a.id)).toContain(victim.assignmentId);
    expect(m.participants.map((p) => p.id)).toEqual([victim.participantId]);
    expect(m.deadlines).toMatchObject([{ id: victim.deadlineId, completedAt: null }]);
    expect(m.checklist).toMatchObject([{ id: victim.checklistItemId, completedAt: null }]);
    expect(m.history).toHaveLength(1);
    const type = await B.get(`/api/v1/matter-types/${victim.matterTypeId}`).expect(200);
    const tb = type.body as {
      name: string;
      stages: { name: string }[];
      checklist: { title: string }[];
    };
    expect(tb.name).not.toBe('Hacked Type');
    expect(tb.stages.map((st) => st.name)).not.toContain('Planted Stage');
    expect(tb.stages.map((st) => st.name)).not.toContain('Hacked Stage');
    expect(tb.checklist.map((c) => c.title)).toEqual(['Victim template item']);
    const types = await B.get('/api/v1/matter-types').expect(200);
    expect((types.body as { name: string }[]).map((x) => x.name)).not.toContain('Attacker Type');
    const tasks = await B.get('/api/v1/tasks').expect(200);
    expect(
      (tasks.body as { data: { id: string; title: string; status: string }[] }).data,
    ).toMatchObject([{ id: victim.taskId, title: 'Victim Task', status: 'OPEN' }]);
  });

  it('Stage 6 victim records are unchanged', async () => {
    const B = api(victimOwner, tenantB);
    const doc = await B.get(`/api/v1/documents/${victim.documentId}`).expect(200);
    expect(doc.body).toMatchObject({
      title: 'Victim Passport',
      versions: [{ id: victim.versionId }],
    });
    const file = await request(t.server)
      .get(`/api/v1/documents/${victim.documentId}/download`)
      .set(tenantHeaders(victimOwner, tenantB))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(Buffer.compare(file.body as Buffer, PDF)).toBe(0);
    const consents = await B.get(`/api/v1/consents?clientId=${victim.clientId}`).expect(200);
    expect(consents.body).toMatchObject([{ id: victim.consentId, withdrawnAt: null }]);
    const shares = await B.get(`/api/v1/shares?matterId=${victim.matterId}`).expect(200);
    expect(shares.body).toMatchObject([
      { id: victim.shareId, active: true, documents: [{ id: victim.documentId }] },
    ]);
  });

  it("reports in tenant A never include tenant B's data (even filtered by B's branch)", async () => {
    const A = api(attacker, tenantA);
    const text = async (path: string) => JSON.stringify((await A.get(path).expect(200)).body);
    for (const path of [
      '/api/v1/reports/leads',
      `/api/v1/reports/leads?branchId=${victim.branchId}`,
      '/api/v1/reports/matters',
      `/api/v1/reports/matters?branchId=${victim.branchId}`,
      '/api/v1/reports/workload',
      '/api/v1/reports/documents',
    ]) {
      const body = await text(path);
      for (const secret of [
        victim.partnerId,
        victim.matterId,
        victim.documentId,
        victim.memberId,
        'Victim',
      ]) {
        expect(body, `${path} leaks ${secret}`).not.toContain(secret);
      }
    }
    const filtered = (await A.get(`/api/v1/reports/leads?branchId=${victim.branchId}`).expect(200))
      .body as {
      totals: { created: number };
    };
    expect(filtered.totals.created).toBe(0);
  });

  it('Stage 8 victim automation is unchanged', async () => {
    const B = api(victimOwner, tenantB);
    const type = await B.get(`/api/v1/matter-types/${victim.matterTypeId}`).expect(200);
    const stage = (
      type.body as { stages: { id: string; taskTemplates: { id: string; title: string }[] }[] }
    ).stages.find((st) => st.id === victim.secondStageId);
    expect(stage?.taskTemplates).toMatchObject([
      { id: victim.stageTaskTemplateId, title: 'Victim auto task' },
    ]);
    const settings = await B.get('/api/v1/automation-settings').expect(200);
    expect(settings.body).toEqual({ deadlineReminderDays: [7], leadFollowUpDays: null });
  });

  it("lists in tenant A never contain tenant B's rows", async () => {
    const A = api(attacker, tenantA);
    const ids = async (path: string, paged = false) => {
      const res = await A.get(path).expect(200);
      const rows = (paged ? (res.body as { data: unknown }).data : res.body) as { id: string }[];
      return rows.map((r) => r.id);
    };
    expect(await ids('/api/v1/members')).not.toContain(victim.memberId);
    expect(await ids('/api/v1/invitations')).not.toContain(victim.invitationId);
    expect(await ids('/api/v1/branches')).not.toContain(victim.branchId);
    expect(await ids('/api/v1/reference-options?category=PROFESSION_TYPE')).not.toContain(
      victim.optionId,
    );
    expect(await ids('/api/v1/partners', true)).not.toContain(victim.partnerId);
    expect(await ids('/api/v1/professionals', true)).not.toContain(victim.professionalId);
    expect(await ids('/api/v1/leads', true)).not.toContain(victim.leadId);
    expect(await ids('/api/v1/clients', true)).not.toContain(victim.clientId);
    expect(await ids('/api/v1/appointments')).not.toContain(victim.appointmentId);
    expect(await ids('/api/v1/matter-types')).not.toContain(victim.matterTypeId);
    expect(await ids('/api/v1/matters', true)).not.toContain(victim.matterId);
    expect(await ids('/api/v1/tasks', true)).not.toContain(victim.taskId);
    const audit = await A.get('/api/v1/audit-logs').expect(200);
    expect(JSON.stringify(audit.body)).not.toContain(tenantB);
  });
});
