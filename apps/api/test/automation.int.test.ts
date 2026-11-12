import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RemindersService } from '../src/modules/matters/reminders.service.js';
import {
  type SignedInUser,
  inviteNewUser,
  ownerWithWorkspace,
  tenantHeaders,
} from './helpers/flows.js';
import { type TestApp, createTestApp } from './helpers/test-app.js';

let t: TestApp;
let reminders: RemindersService;
beforeAll(async () => {
  t = await createTestApp();
  reminders = t.app.get(RemindersService);
});
afterAll(async () => {
  await t.close();
});

const DAY = 86_400_000;
type Body = Record<string, unknown>;
const idOf = (res: request.Response) => (res.body as { id: string }).id;
const code = (res: request.Response) => (res.body as { code?: string }).code;

function as(user: SignedInUser, tenantId: string) {
  const h = tenantHeaders(user, tenantId);
  return {
    get: (p: string) => request(t.server).get(p).set(h),
    post: (p: string, b: Body = {}) => request(t.server).post(p).set(h).send(b),
    put: (p: string, b: Body) => request(t.server).put(p).set(h).send(b),
    patch: (p: string, b: Body) => request(t.server).patch(p).set(h).send(b),
    del: (p: string) => request(t.server).delete(p).set(h),
  };
}
type Api = ReturnType<typeof as>;
type TypeBody = {
  id: string;
  stages: { id: string; name: string; taskTemplates: { id: string; title: string }[] }[];
};

async function memberId(api: Api, userId: string) {
  const res = await api.get('/api/v1/members').expect(200);
  return (res.body as { id: string; userId: string }[]).find((m) => m.userId === userId)!.id;
}

/** Sends to one address since `before` (index into the outbox). */
const mailsTo = (email: string, before: number) =>
  t.mailer.outbox.slice(before).filter((m) => m.to === email);

describe('stage task templates', () => {
  it('entering a stage creates its preset tasks once, assigned to the matter lead, with a due date', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'auto-tasks');
    const api = as(owner, tenantId);
    const agent = await inviteNewUser(
      t,
      owner,
      tenantId,
      { kind: 'STAFF', roleKey: 'migration_agent' },
      'at-agent',
    );
    const agentId = await memberId(api, agent.userId);
    const type = ((await api.get('/api/v1/matter-types').expect(200)).body as TypeBody[])[0]!;
    const [intake, collecting] = type.stages;
    await api
      .post(`/api/v1/matter-types/${type.id}/stages/${intake!.id}/tasks`, {
        title: 'Send service agreement',
      })
      .expect(201);
    const withTpl = await api
      .post(`/api/v1/matter-types/${type.id}/stages/${collecting!.id}/tasks`, {
        title: 'Request passport copy',
        priority: 'HIGH',
        dueInDays: 3,
      })
      .expect(201);
    expect((withTpl.body as TypeBody).stages[1]!.taskTemplates.map((x) => x.title)).toEqual([
      'Request passport copy',
    ]);
    expect(
      (
        await as(agent, tenantId).post(
          `/api/v1/matter-types/${type.id}/stages/${intake!.id}/tasks`,
          { title: 'x' },
        )
      ).status,
    ).toBe(403);

    const client = idOf(
      await api.post('/api/v1/clients', { kind: 'INDIVIDUAL', displayName: 'C' }).expect(201),
    );
    const matterId = idOf(
      await api
        .post('/api/v1/matters', {
          clientId: client,
          matterTypeId: type.id,
          title: 'M',
          assigneeMembershipIds: [agentId],
        })
        .expect(201),
    );
    const tasks = async () =>
      (
        (await api.get(`/api/v1/tasks?matterId=${matterId}`).expect(200)).body as {
          data: {
            id: string;
            title: string;
            priority: string;
            dueAt: string | null;
            assignee: { id: string } | null;
          }[];
        }
      ).data;
    expect((await tasks()).map((x) => x.title)).toEqual(['Send service agreement']);

    await api
      .post(`/api/v1/matters/${matterId}/transition`, { stageId: collecting!.id })
      .expect(200);
    const created = (await tasks()).find((x) => x.title === 'Request passport copy')!;
    expect(created).toMatchObject({ priority: 'HIGH', assignee: { id: agentId } });
    const dueIn = (Date.parse(created.dueAt!) - Date.now()) / DAY;
    expect(dueIn).toBeGreaterThan(2.9);
    expect(dueIn).toBeLessThan(3.1);
    // The agent sees the task (assigned to them).
    const agentTasks = await as(agent, tenantId).get('/api/v1/tasks').expect(200);
    expect(JSON.stringify(agentTasks.body)).toContain('Request passport copy');

    // Re-entering the stage does not duplicate; a cancelled one is re-created.
    await api.post(`/api/v1/matters/${matterId}/transition`, { stageId: intake!.id }).expect(200);
    await api
      .post(`/api/v1/matters/${matterId}/transition`, { stageId: collecting!.id })
      .expect(200);
    expect((await tasks()).filter((x) => x.title === 'Request passport copy')).toHaveLength(1);
    await api.patch(`/api/v1/tasks/${created.id}`, { status: 'CANCELLED' }).expect(200);
    await api.post(`/api/v1/matters/${matterId}/transition`, { stageId: intake!.id }).expect(200);
    await api
      .post(`/api/v1/matters/${matterId}/transition`, { stageId: collecting!.id })
      .expect(200);
    expect((await tasks()).filter((x) => x.title === 'Request passport copy')).toHaveLength(2);

    // Deleting the template keeps the tasks already created.
    const tplId = (withTpl.body as TypeBody).stages[1]!.taskTemplates[0]!.id;
    await api
      .del(`/api/v1/matter-types/${type.id}/stages/${collecting!.id}/tasks/${tplId}`)
      .expect(200);
    expect((await tasks()).filter((x) => x.title === 'Request passport copy')).toHaveLength(2);
  });
});

describe('automation settings', () => {
  it('are off by default, validated, and audited', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'auto-set');
    const api = as(owner, tenantId);
    expect((await api.get('/api/v1/automation-settings').expect(200)).body).toEqual({
      deadlineReminderDays: [],
      leadFollowUpDays: null,
    });
    expect(
      (
        await api.put('/api/v1/automation-settings', {
          deadlineReminderDays: [1, 2, 3, 4],
          leadFollowUpDays: null,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api.put('/api/v1/automation-settings', {
          deadlineReminderDays: [1, 1],
          leadFollowUpDays: null,
        })
      ).status,
    ).toBe(400);
    const ok = await api
      .put('/api/v1/automation-settings', { deadlineReminderDays: [1, 7], leadFollowUpDays: 5 })
      .expect(200);
    expect(ok.body).toEqual({ deadlineReminderDays: [7, 1], leadFollowUpDays: 5 });
    const audit = await api.get('/api/v1/audit-logs?limit=20').expect(200);
    expect(JSON.stringify(audit.body)).toContain('automation.updated');
    const agent = await inviteNewUser(
      t,
      owner,
      tenantId,
      { kind: 'STAFF', roleKey: 'migration_agent' },
      'as-agent',
    );
    expect((await as(agent, tenantId).get('/api/v1/automation-settings')).status).toBe(403);
  });
});

describe('automatic deadline reminders', () => {
  it('sends each "N days before" reminder once, to the assigned team, only for open work', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'auto-dl');
    const api = as(owner, tenantId);
    const type = ((await api.get('/api/v1/matter-types').expect(200)).body as TypeBody[])[0]!;
    const client = idOf(
      await api.post('/api/v1/clients', { kind: 'INDIVIDUAL', displayName: 'C' }).expect(201),
    );
    const matterId = idOf(
      await api
        .post('/api/v1/matters', { clientId: client, matterTypeId: type.id, title: 'DL' })
        .expect(201),
    );
    const now = Date.now();
    await api
      .post(`/api/v1/matters/${matterId}/deadlines`, {
        title: 'Medicals',
        dueAt: new Date(now + 5 * DAY).toISOString(),
      })
      .expect(201);
    const soon = await api
      .post(`/api/v1/matters/${matterId}/deadlines`, {
        title: 'Biometrics',
        dueAt: new Date(now + 0.5 * DAY).toISOString(),
      })
      .expect(201);
    void soon;
    const doneRes = await api
      .post(`/api/v1/matters/${matterId}/deadlines`, {
        title: 'Already done',
        dueAt: new Date(now + 2 * DAY).toISOString(),
      })
      .expect(201);
    const doneId = (doneRes.body as { deadlines: { id: string; title: string }[] }).deadlines.find(
      (d) => d.title === 'Already done',
    )!.id;
    await api
      .patch(`/api/v1/matters/${matterId}/deadlines/${doneId}`, { completed: true })
      .expect(200);

    // Off by default: nothing is sent.
    let before = t.mailer.outbox.length;
    await reminders.runOnce(new Date(now), tenantId);
    expect(mailsTo(owner.email, before)).toEqual([]);

    await api
      .put('/api/v1/automation-settings', { deadlineReminderDays: [7, 1], leadFollowUpDays: null })
      .expect(200);
    before = t.mailer.outbox.length;
    await reminders.runOnce(new Date(now), tenantId);
    const first = mailsTo(owner.email, before).map((m) => m.subject);
    // Medicals: the 7-day reminder. Biometrics: both offsets reached at once → only ONE email.
    expect(first).toHaveLength(2);
    expect(first.filter((x) => x.includes('Biometrics'))).toHaveLength(1);
    expect(first.find((x) => x.includes('Medicals'))).toContain('in 5 days');

    before = t.mailer.outbox.length;
    await reminders.runOnce(new Date(now + 60_000), tenantId);
    expect(mailsTo(owner.email, before)).toEqual([]);

    before = t.mailer.outbox.length;
    await reminders.runOnce(new Date(now + 4.5 * DAY), tenantId);
    expect(mailsTo(owner.email, before).map((m) => m.subject)).toEqual([
      expect.stringContaining('Medicals'),
    ]);
    before = t.mailer.outbox.length;
    await reminders.runOnce(new Date(now + 4.6 * DAY), tenantId);
    expect(mailsTo(owner.email, before)).toEqual([]);
  });
});

describe('lead follow-up nudge', () => {
  it('reminds the owner once per quiet period; new activity starts a new period', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'auto-lead');
    const api = as(owner, tenantId);
    const leadId = idOf(await api.post('/api/v1/leads', { fullName: 'Quiet Lead' }).expect(201));
    const converted = idOf(
      await api.post('/api/v1/leads', { fullName: 'Converted Lead' }).expect(201),
    );
    await api
      .post(`/api/v1/leads/${converted}/convert`, {
        mode: 'new',
        client: { kind: 'INDIVIDUAL', displayName: 'X' },
      })
      .expect(200);
    await api
      .put('/api/v1/automation-settings', { deadlineReminderDays: [], leadFollowUpDays: 3 })
      .expect(200);
    const now = Date.now();

    let before = t.mailer.outbox.length;
    await reminders.runOnce(new Date(now + 2 * DAY), tenantId);
    expect(mailsTo(owner.email, before)).toEqual([]);

    before = t.mailer.outbox.length;
    await reminders.runOnce(new Date(now + 4 * DAY), tenantId);
    const nudges = mailsTo(owner.email, before);
    expect(nudges.map((m) => m.subject)).toEqual(['Follow up: Quiet Lead']);
    expect(nudges[0]!.text).toContain(`/leads/${leadId}`);

    before = t.mailer.outbox.length;
    await reminders.runOnce(new Date(now + 6 * DAY), tenantId);
    expect(mailsTo(owner.email, before)).toEqual([]);

    await api
      .post('/api/v1/activities', {
        leadId,
        type: 'CALL',
        summary: 'Called',
        occurredAt: new Date(now + 5 * DAY).toISOString(),
      })
      .expect(201);
    before = t.mailer.outbox.length;
    await reminders.runOnce(new Date(now + 7 * DAY), tenantId);
    expect(mailsTo(owner.email, before)).toEqual([]); // only 2 quiet days since the call
    await reminders.runOnce(new Date(now + 9 * DAY), tenantId);
    expect(mailsTo(owner.email, before).map((m) => m.subject)).toEqual(['Follow up: Quiet Lead']);
    expect(
      code(
        await api.put('/api/v1/automation-settings', {
          deadlineReminderDays: [],
          leadFollowUpDays: 0,
        }),
      ),
    ).toBe('VALIDATION_FAILED');
  });
});
