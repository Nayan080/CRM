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

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

type Body = Record<string, unknown>;
const code = (res: request.Response) => (res.body as { code?: string }).code;
const idOf = (res: request.Response) => (res.body as { id: string }).id;

interface MatterBody {
  id: string;
  reference: string;
  status: string;
  closedAt: string | null;
  stage: { id: string; name: string } | null;
  stages: { id: string; name: string; isTerminal: boolean }[];
  assignees: { id: string; name: string }[];
  assignments: { id: string; member: { id: string } }[];
  participants: { id: string; kind: string; party: { name: string }; role: { name: string } }[];
  deadlines: { id: string; completedAt: string | null; reminderSentAt: string | null }[];
  checklist: {
    id: string;
    title: string;
    completedAt: string | null;
    completedBy: { id: string } | null;
  }[];
  history: {
    fromStatus: string | null;
    toStatus: string | null;
    fromStage: { name: string } | null;
    toStage: { name: string } | null;
    reason: string | null;
  }[];
}
const m = (res: request.Response) => res.body as MatterBody;

function as(user: SignedInUser, tenantId: string) {
  const h = tenantHeaders(user, tenantId);
  return {
    get: (p: string) => request(t.server).get(p).set(h),
    post: (p: string, b: Body = {}) => request(t.server).post(p).set(h).send(b),
    patch: (p: string, b: Body) => request(t.server).patch(p).set(h).send(b),
    del: (p: string) => request(t.server).delete(p).set(h),
  };
}
type Api = ReturnType<typeof as>;

async function memberId(api: Api, userId: string) {
  const res = await api.get('/api/v1/members').expect(200);
  return (res.body as { id: string; userId: string }[]).find((x) => x.userId === userId)?.id ?? '';
}

async function firstType(api: Api) {
  const res = await api.get('/api/v1/matter-types').expect(200);
  return (res.body as { id: string; name: string; stages: { id: string; name: string }[] }[])[0]!;
}

async function newClient(api: Api, displayName = 'Client', extra: Body = {}) {
  return idOf(
    await api.post('/api/v1/clients', { kind: 'INDIVIDUAL', displayName, ...extra }).expect(201),
  );
}

describe('matter types (DEC-13)', () => {
  it('a new workspace has generic editable examples with plain stages and no checklist rules', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'mt-defaults');
    const api = as(owner, tenantId);
    const res = await api.get('/api/v1/matter-types').expect(200);
    const types = res.body as {
      name: string;
      stages: { name: string; isTerminal: boolean }[];
      checklist: unknown[];
    }[];
    expect(types.map((x) => x.name)).toEqual([
      'Student',
      'Skilled',
      'Partner',
      'Employer-sponsored',
    ]);
    for (const type of types) {
      expect(type.stages.map((s) => s.name)).toEqual([
        'Intake',
        'Collecting documents',
        'Preparing application',
        'Lodged',
        'Decision received',
      ]);
      expect(type.stages.filter((s) => s.isTerminal).map((s) => s.name)).toEqual([
        'Decision received',
      ]);
      expect(type.checklist).toEqual([]);
    }
    const roles = await api.get('/api/v1/reference-options?category=PARTICIPANT_ROLE').expect(200);
    expect((roles.body as { key: string }[]).map((r) => r.key)).toContain('dependant');
  });

  it('agency can rename, add, deactivate and delete; names are unique ignoring case; used items are protected', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'mt-crud');
    const api = as(owner, tenantId);
    const created = await api.post('/api/v1/matter-types', { name: 'Visitor' }).expect(201);
    const typeId = idOf(created);
    const dup = await api.post('/api/v1/matter-types', { name: 'visitor' });
    expect(dup.status).toBe(409);
    expect(code(dup)).toBe('NAME_EXISTS');
    await api.patch(`/api/v1/matter-types/${typeId}`, { name: 'Visitor (tourist)' }).expect(200);
    const withStage = await api
      .post(`/api/v1/matter-types/${typeId}/stages`, { name: 'Intake' })
      .expect(201);
    const stageId = (withStage.body as { stages: { id: string }[] }).stages[0]!.id;
    await api
      .post(`/api/v1/matter-types/${typeId}/checklist`, { title: 'Signed service agreement' })
      .expect(201);

    const clientId = await newClient(api);
    const matter = await api
      .post('/api/v1/matters', { clientId, matterTypeId: typeId, title: 'Tourist visit' })
      .expect(201);
    expect(m(matter).checklist.map((c) => c.title)).toEqual(['Signed service agreement']);
    expect(m(matter).stage?.id).toBe(stageId);

    const delType = await api.del(`/api/v1/matter-types/${typeId}`);
    expect(delType.status).toBe(409);
    expect(code(delType)).toBe('IN_USE');
    expect(code(await api.del(`/api/v1/matter-types/${typeId}/stages/${stageId}`))).toBe('IN_USE');
    await api.patch(`/api/v1/matter-types/${typeId}`, { isActive: false }).expect(200);
    const inactive = await api.post('/api/v1/matters', {
      clientId,
      matterTypeId: typeId,
      title: 'X',
    });
    expect(code(inactive)).toBe('INVALID_REFERENCE');

    const unused = idOf(await api.post('/api/v1/matter-types', { name: 'Unused' }).expect(201));
    await api.del(`/api/v1/matter-types/${unused}`).expect(204);
  });

  it('only settings managers change types; staff without tenant:update get 403', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'mt-perm');
    const agent = await inviteNewUser(
      t,
      owner,
      tenantId,
      { kind: 'STAFF', roleKey: 'migration_agent' },
      'mt-agent',
    );
    const res = await as(agent, tenantId).post('/api/v1/matter-types', { name: 'Sneaky' });
    expect(res.status).toBe(403);
    await as(agent, tenantId).get('/api/v1/matter-types').expect(200);
  });
});

describe('matters', () => {
  it('opens with a reference, the creator assigned, first stage and one history row', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'mat-open');
    const api = as(owner, tenantId);
    const type = await firstType(api);
    const clientId = await newClient(api, 'Priya Sharma');
    const first = await api
      .post('/api/v1/matters', { clientId, matterTypeId: type.id, title: 'Study' })
      .expect(201);
    const second = await api
      .post('/api/v1/matters', { clientId, matterTypeId: type.id, title: 'Study 2' })
      .expect(201);
    expect(m(first).reference).toBe('M-000001');
    expect(m(second).reference).toBe('M-000002');
    expect(m(first).assignees.map((a) => a.id)).toEqual([await memberId(api, owner.userId)]);
    expect(m(first).stage?.name).toBe('Intake');
    expect(m(first).history).toMatchObject([{ toStatus: 'OPEN', toStage: { name: 'Intake' } }]);

    const list = await api.get(`/api/v1/matters?clientId=${clientId}`).expect(200);
    expect((list.body as { data: unknown[] }).data).toHaveLength(2);
    const search = await api.get('/api/v1/matters?q=priya').expect(200);
    expect((search.body as { data: unknown[] }).data).toHaveLength(2);
  });

  it('stage and status changes write history; closing sets closedAt; archived is read-only until re-opened', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'mat-flow');
    const api = as(owner, tenantId);
    const type = await firstType(api);
    const matter = await api
      .post('/api/v1/matters', {
        clientId: await newClient(api),
        matterTypeId: type.id,
        title: 'Flow',
      })
      .expect(201);
    const id = idOf(matter);
    const lodged = m(matter).stages.find((s) => s.name === 'Lodged')!;
    const moved = await api
      .post(`/api/v1/matters/${id}/transition`, {
        stageId: lodged.id,
        reason: 'Application lodged',
      })
      .expect(200);
    expect(m(moved).stage?.name).toBe('Lodged');
    expect(m(moved).history[0]).toMatchObject({
      fromStage: { name: 'Intake' },
      toStage: { name: 'Lodged' },
      fromStatus: null,
      reason: 'Application lodged',
    });
    const same = await api.post(`/api/v1/matters/${id}/transition`, { stageId: lodged.id });
    expect(code(same)).toBe('NO_CHANGE');

    const closed = await api
      .post(`/api/v1/matters/${id}/transition`, { status: 'CLOSED' })
      .expect(200);
    expect(m(closed).closedAt).not.toBeNull();
    const archived = await api
      .post(`/api/v1/matters/${id}/transition`, { status: 'ARCHIVED' })
      .expect(200);
    expect(m(archived).history).toHaveLength(4);
    expect(code(await api.patch(`/api/v1/matters/${id}`, { title: 'Edit' }))).toBe(
      'MATTER_ARCHIVED',
    );
    expect(code(await api.post(`/api/v1/matters/${id}/checklist`, { title: 'x' }))).toBe(
      'MATTER_ARCHIVED',
    );
    const list = await api.get('/api/v1/matters').expect(200);
    expect((list.body as { data: { id: string }[] }).data.map((x) => x.id)).not.toContain(id);
    const reopened = await api
      .post(`/api/v1/matters/${id}/transition`, { status: 'OPEN' })
      .expect(200);
    expect(m(reopened).closedAt).toBeNull();
    await api.patch(`/api/v1/matters/${id}`, { title: 'Edit' }).expect(200);

    const otherType = (await api.get('/api/v1/matter-types').expect(200)).body as {
      stages: { id: string }[];
    }[];
    const foreignStage = otherType[1]!.stages[0]!.id;
    expect(
      code(await api.post(`/api/v1/matters/${id}/transition`, { stageId: foreignStage })),
    ).toBe('INVALID_REFERENCE');
  });

  it('participants, deadlines and checklist items', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'mat-parts');
    const api = as(owner, tenantId);
    const type = await firstType(api);
    const id = idOf(
      await api
        .post('/api/v1/matters', {
          clientId: await newClient(api),
          matterTypeId: type.id,
          title: 'Parts',
        })
        .expect(201),
    );
    const roles = (await api.get('/api/v1/reference-options?category=PARTICIPANT_ROLE')).body as {
      id: string;
      key: string;
    }[];
    const dependant = roles.find((r) => r.key === 'dependant')!.id;
    const child = await newClient(api, 'Child');
    const withP = await api
      .post(`/api/v1/matters/${id}/participants`, { roleId: dependant, clientId: child })
      .expect(201);
    expect(m(withP).participants).toMatchObject([
      { kind: 'client', party: { name: 'Child' }, role: { name: 'Dependant' } },
    ]);
    const both = await api.post(`/api/v1/matters/${id}/participants`, {
      roleId: dependant,
      clientId: child,
      partnerOrgId: child,
    });
    expect(both.status).toBe(400);
    const wrongCategory = (await api.get('/api/v1/reference-options?category=LEAD_SOURCE'))
      .body as { id: string }[];
    expect(
      code(
        await api.post(`/api/v1/matters/${id}/participants`, {
          roleId: wrongCategory[0]!.id,
          clientId: child,
        }),
      ),
    ).toBe('INVALID_REFERENCE');
    await api.del(`/api/v1/matters/${id}/participants/${m(withP).participants[0]!.id}`).expect(200);

    const due = new Date(Date.now() + 86_400_000).toISOString();
    const late = await api.post(`/api/v1/matters/${id}/deadlines`, {
      title: 'Bad',
      dueAt: due,
      remindAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    });
    expect(late.status).toBe(400);
    const withD = await api
      .post(`/api/v1/matters/${id}/deadlines`, { title: 'Medical', dueAt: due })
      .expect(201);
    const dId = m(withD).deadlines[0]!.id;
    const done = await api
      .patch(`/api/v1/matters/${id}/deadlines/${dId}`, { completed: true })
      .expect(200);
    expect(m(done).deadlines[0]!.completedAt).not.toBeNull();

    const withC = await api
      .post(`/api/v1/matters/${id}/checklist`, { title: 'Passport copy' })
      .expect(201);
    const cId = m(withC).checklist[0]!.id;
    const ticked = await api
      .patch(`/api/v1/matters/${id}/checklist/${cId}`, { done: true })
      .expect(200);
    expect(m(ticked).checklist[0]!.completedBy?.id).toBe(await memberId(api, owner.userId));
    const unticked = await api
      .patch(`/api/v1/matters/${id}/checklist/${cId}`, { done: false })
      .expect(200);
    expect(m(unticked).checklist[0]!.completedAt).toBeNull();
  });
});

describe('matter scope', () => {
  it('agents (OWN) see only matters they are assigned to, and cannot staff them', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'mat-own');
    const api = as(owner, tenantId);
    const agent = await inviteNewUser(
      t,
      owner,
      tenantId,
      { kind: 'STAFF', roleKey: 'migration_agent' },
      'mo-agent',
    );
    const colleague = await inviteNewUser(
      t,
      owner,
      tenantId,
      { kind: 'STAFF', roleKey: 'case_manager' },
      'mo-cm',
    );
    const agentId = await memberId(api, agent.userId);
    const colleagueId = await memberId(api, colleague.userId);
    const aApi = as(agent, tenantId);
    const type = await firstType(api);
    const clientId = await newClient(api, 'Assigned Client');
    const mine = await api
      .post('/api/v1/matters', {
        clientId,
        matterTypeId: type.id,
        title: 'Mine',
        assigneeMembershipIds: [agentId],
      })
      .expect(201);
    const notMine = await api
      .post('/api/v1/matters', {
        clientId: await newClient(api, 'Other'),
        matterTypeId: type.id,
        title: 'Not mine',
      })
      .expect(201);

    const list = await aApi.get('/api/v1/matters').expect(200);
    expect((list.body as { data: { id: string }[] }).data.map((x) => x.id)).toEqual([idOf(mine)]);
    await aApi.get(`/api/v1/matters/${idOf(notMine)}`).expect(404);
    // The client becomes visible through the assignment (and only that client).
    await aApi.get(`/api/v1/clients/${clientId}`).expect(200);
    const clients = await aApi.get('/api/v1/clients').expect(200);
    expect((clients.body as { data: { id: string }[] }).data.map((c) => c.id)).toEqual([clientId]);

    await aApi.patch(`/api/v1/matters/${idOf(mine)}`, { title: 'Mine (updated)' }).expect(200);
    const staffing = await aApi.post(`/api/v1/matters/${idOf(mine)}/assignments`, {
      membershipId: colleagueId,
    });
    expect(staffing.status).toBe(403);
    expect(code(staffing)).toBe('OUT_OF_SCOPE');
    expect(
      (await aApi.post('/api/v1/matters', { clientId, matterTypeId: type.id, title: 'X' })).status,
    ).toBe(403);

    // Unassigning removes access.
    const assignmentId = m(mine).assignments.find((a) => a.member.id === agentId)!.id;
    await api.del(`/api/v1/matters/${idOf(mine)}/assignments/${assignmentId}`).expect(200);
    await aApi.get(`/api/v1/matters/${idOf(mine)}`).expect(404);
    const again = await api
      .post(`/api/v1/matters/${idOf(mine)}/assignments`, { membershipId: agentId })
      .expect(201);
    expect(m(again).assignees.map((a) => a.id)).toContain(agentId);
    const dup = await api.post(`/api/v1/matters/${idOf(mine)}/assignments`, {
      membershipId: agentId,
    });
    expect(code(dup)).toBe('ALREADY_ASSIGNED');
  });

  it('branch managers work inside their branches only', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'mat-branch');
    const api = as(owner, tenantId);
    const north = idOf(await api.post('/api/v1/branches', { name: 'North' }).expect(201));
    const south = idOf(await api.post('/api/v1/branches', { name: 'South' }).expect(201));
    const manager = await inviteNewUser(
      t,
      owner,
      tenantId,
      { kind: 'STAFF', roleKey: 'branch_manager' },
      'mb-bm',
    );
    const southAgent = await inviteNewUser(
      t,
      owner,
      tenantId,
      { kind: 'STAFF', roleKey: 'migration_agent' },
      'mb-sa',
    );
    await api
      .patch(`/api/v1/members/${await memberId(api, manager.userId)}`, { branchIds: [north] })
      .expect(200);
    await api
      .patch(`/api/v1/members/${await memberId(api, southAgent.userId)}`, { branchIds: [south] })
      .expect(200);
    const mApi = as(manager, tenantId);
    const type = await firstType(api);

    const northClient = await newClient(api, 'North Client', { branchId: north });
    const southClient = await newClient(api, 'South Client', { branchId: south });
    const inNorth = await api
      .post('/api/v1/matters', { clientId: northClient, matterTypeId: type.id, title: 'N' })
      .expect(201);
    expect((m(inNorth) as unknown as { branch: { id: string } }).branch.id).toBe(north);
    await api
      .post('/api/v1/matters', { clientId: southClient, matterTypeId: type.id, title: 'S' })
      .expect(201);

    const list = await mApi.get('/api/v1/matters').expect(200);
    expect((list.body as { data: { id: string }[] }).data.map((x) => x.id)).toEqual([
      idOf(inNorth),
    ]);
    await mApi
      .post('/api/v1/matters', { clientId: northClient, matterTypeId: type.id, title: 'N2' })
      .expect(201);
    const outside = await mApi.post('/api/v1/matters', {
      clientId: northClient,
      matterTypeId: type.id,
      title: 'X',
      branchId: south,
    });
    expect(code(outside)).toBe('OUT_OF_SCOPE');
    const foreignAssignee = await mApi.post(`/api/v1/matters/${idOf(inNorth)}/assignments`, {
      membershipId: await memberId(api, southAgent.userId),
    });
    expect(code(foreignAssignee)).toBe('OUT_OF_SCOPE');
  });

  it('matters appear on the timeline and appointments of the matter', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'mat-tl');
    const api = as(owner, tenantId);
    const type = await firstType(api);
    const id = idOf(
      await api
        .post('/api/v1/matters', {
          clientId: await newClient(api),
          matterTypeId: type.id,
          title: 'TL',
        })
        .expect(201),
    );
    await api
      .post('/api/v1/activities', { matterId: id, type: 'NOTE', summary: 'Spoke to client' })
      .expect(201);
    const tl = await api.get(`/api/v1/activities?matterId=${id}`).expect(200);
    expect((tl.body as { data: { summary: string }[] }).data.map((a) => a.summary)).toEqual([
      'Spoke to client',
    ]);
    const start = new Date(Date.now() + 3_600_000);
    await api
      .post('/api/v1/appointments', {
        title: 'Review',
        matterId: id,
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + 1_800_000).toISOString(),
      })
      .expect(201);
    const appts = await api.get(`/api/v1/appointments?matterId=${id}`).expect(200);
    expect(appts.body).toMatchObject([{ title: 'Review', matter: { id } }]);
  });
});

describe('tasks', () => {
  it('OWN scope: my tasks only, assign to myself only; links to hidden records are masked', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'task-own');
    const api = as(owner, tenantId);
    const agent = await inviteNewUser(
      t,
      owner,
      tenantId,
      { kind: 'STAFF', roleKey: 'migration_agent' },
      'to-agent',
    );
    const agentId = await memberId(api, agent.userId);
    const aApi = as(agent, tenantId);
    const type = await firstType(api);
    const hiddenMatter = idOf(
      await api
        .post('/api/v1/matters', {
          clientId: await newClient(api),
          matterTypeId: type.id,
          title: 'Secret',
        })
        .expect(201),
    );

    const mine = await aApi
      .post('/api/v1/tasks', { title: 'Call client', priority: 'HIGH' })
      .expect(201);
    expect((mine.body as { assignee: { id: string } }).assignee.id).toBe(agentId);
    const toOwner = await aApi.post('/api/v1/tasks', {
      title: 'For boss',
      assigneeMembershipId: await memberId(api, owner.userId),
    });
    expect(code(toOwner)).toBe('OUT_OF_SCOPE');
    expect(code(await aApi.post('/api/v1/tasks', { title: 'Link', matterId: hiddenMatter }))).toBe(
      'INVALID_REFERENCE',
    );

    // Owner assigns the agent a task on a matter the agent cannot see.
    await api
      .post('/api/v1/tasks', {
        title: 'Check file',
        matterId: hiddenMatter,
        assigneeMembershipId: agentId,
      })
      .expect(201);
    await api.post('/api/v1/tasks', { title: 'Owner only' }).expect(201);
    const list = await aApi.get('/api/v1/tasks').expect(200);
    const rows = (list.body as { data: { title: string; link: unknown }[] }).data;
    expect(rows.map((r) => r.title).sort()).toEqual(['Call client', 'Check file']);
    expect(rows.find((r) => r.title === 'Check file')?.link).toEqual({
      kind: 'matter',
      hidden: true,
    });
    expect(JSON.stringify(list.body)).not.toContain('Secret');

    const done = await aApi.patch(`/api/v1/tasks/${idOf(mine)}`, { status: 'DONE' }).expect(200);
    expect((done.body as { completedAt: string | null }).completedAt).not.toBeNull();
    const active = await aApi.get('/api/v1/tasks?active=true').expect(200);
    expect((active.body as { data: { title: string }[] }).data.map((r) => r.title)).toEqual([
      'Check file',
    ]);
    await aApi.del(`/api/v1/tasks/${idOf(mine)}`).expect(204);
  });

  it('receptionists have no task access', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'task-rec');
    const rec = await inviteNewUser(
      t,
      owner,
      tenantId,
      { kind: 'STAFF', roleKey: 'receptionist' },
      'tr-rec',
    );
    expect((await as(rec, tenantId).get('/api/v1/tasks')).status).toBe(403);
    expect((await as(rec, tenantId).get('/api/v1/matters')).status).toBe(403);
  });
});

describe('deadline reminders', () => {
  it('emails assigned staff once when due; skips completed deadlines and closed matters', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'remind');
    const api = as(owner, tenantId);
    const agent = await inviteNewUser(
      t,
      owner,
      tenantId,
      { kind: 'STAFF', roleKey: 'migration_agent' },
      'rm-agent',
    );
    const agentId = await memberId(api, agent.userId);
    const type = await firstType(api);
    const clientId = await newClient(api);
    const id = idOf(
      await api
        .post('/api/v1/matters', {
          clientId,
          matterTypeId: type.id,
          title: 'Remind me',
          assigneeMembershipIds: [agentId],
        })
        .expect(201),
    );
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();
    const withD = await api
      .post(`/api/v1/matters/${id}/deadlines`, { title: 'Biometrics', dueAt: soon, remindAt: past })
      .expect(201);
    const done = await api
      .post(`/api/v1/matters/${id}/deadlines`, {
        title: 'Already done',
        dueAt: soon,
        remindAt: past,
      })
      .expect(201);
    const doneId = m(done).deadlines.find((d) => d.id !== m(withD).deadlines[0]!.id)!.id;
    await api.patch(`/api/v1/matters/${id}/deadlines/${doneId}`, { completed: true }).expect(200);
    const closedMatter = idOf(
      await api
        .post('/api/v1/matters', {
          clientId,
          matterTypeId: type.id,
          title: 'Closed',
          assigneeMembershipIds: [agentId],
        })
        .expect(201),
    );
    await api
      .post(`/api/v1/matters/${closedMatter}/deadlines`, {
        title: 'Closed deadline',
        dueAt: soon,
        remindAt: past,
      })
      .expect(201);
    await api.post(`/api/v1/matters/${closedMatter}/transition`, { status: 'CLOSED' }).expect(200);

    const reminders = t.app.get(RemindersService);
    const before = t.mailer.outbox.length;
    await reminders.runOnce();
    const sent = t.mailer.outbox.slice(before).filter((msg) => msg.to === agent.email);
    expect(sent.map((msg) => msg.subject)).toEqual([expect.stringContaining('Biometrics')]);
    expect(sent[0]!.text).toContain(`/matters/${id}`);

    const after = t.mailer.outbox.length;
    await reminders.runOnce();
    expect(t.mailer.outbox.slice(after).filter((msg) => msg.to === agent.email)).toEqual([]);
    const detail = await api.get(`/api/v1/matters/${id}`).expect(200);
    const biometrics = m(detail).deadlines.find((d) => d.id === m(withD).deadlines[0]!.id)!;
    expect(biometrics.reminderSentAt).not.toBeNull();
  });
});
