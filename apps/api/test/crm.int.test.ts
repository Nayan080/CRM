import { ROLE_TEMPLATES_VERSION } from '@crm/permissions';
import { createPrismaClient } from '@crm/db';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type SignedInUser,
  enableMfa,
  inviteNewUser,
  ownerWithWorkspace,
  tenantHeaders,
} from './helpers/flows.js';
import { type TestApp, createTestApp, testDatabaseUrl } from './helpers/test-app.js';

let t: TestApp;
const db = createPrismaClient({ connectionString: testDatabaseUrl });

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
  await db.$disconnect();
});

type Body = Record<string, unknown>;
const code = (res: request.Response) => (res.body as { code?: string }).code;
const idOf = (res: request.Response) => (res.body as { id: string }).id;

function as(user: SignedInUser, tenantId: string) {
  const h = tenantHeaders(user, tenantId);
  return {
    get: (p: string) => request(t.server).get(p).set(h),
    post: (p: string, b: Body = {}) => request(t.server).post(p).set(h).send(b),
    patch: (p: string, b: Body) => request(t.server).patch(p).set(h).send(b),
    del: (p: string) => request(t.server).delete(p).set(h),
  };
}

async function optionId(api: ReturnType<typeof as>, category: string, key: string) {
  const res = await api.get(`/api/v1/reference-options?category=${category}`).expect(200);
  return (res.body as { id: string; key: string }[]).find((o) => o.key === key)?.id ?? '';
}

async function memberId(api: ReturnType<typeof as>, userId: string) {
  const res = await api.get('/api/v1/members').expect(200);
  return (res.body as { id: string; userId: string }[]).find((m) => m.userId === userId)?.id ?? '';
}

const slot = (hoursFromNow: number, minutes = 30) => {
  const start = new Date(Date.now() + hoursFromNow * 3_600_000);
  return {
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + minutes * 60_000).toISOString(),
  };
};

describe('leads', () => {
  it('records source and referral; the contact must belong to the referring partner', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'lead-src');
    const api = as(owner, tenantId);
    const referral = await optionId(api, 'LEAD_SOURCE', 'referral');
    const typeId = await optionId(api, 'PARTNER_TYPE', 'referral_agency');
    const partner = await api.post('/api/v1/partners', { name: 'Broker Co', typeId }).expect(201);
    const contact = await api
      .post(`/api/v1/partners/${idOf(partner)}/contacts`, { fullName: 'Bob Broker' })
      .expect(201);
    const other = await api.post('/api/v1/partners', { name: 'Other Co', typeId }).expect(201);

    const wrong = await api.post('/api/v1/leads', {
      fullName: 'Jane Doe',
      referredByPartnerId: idOf(other),
      referredByContactId: idOf(contact),
    });
    expect(wrong.status).toBe(400);

    const lead = await api
      .post('/api/v1/leads', {
        fullName: 'Jane Doe',
        email: 'Jane@Example.test',
        phone: '0412 345 678',
        sourceId: referral,
        referredByPartnerId: idOf(partner),
        referredByContactId: idOf(contact),
        interest: 'Skilled visa enquiry',
      })
      .expect(201);
    expect(lead.body).toMatchObject({
      status: 'OPEN',
      email: 'jane@example.test',
      source: { name: 'Referral' },
      referredBy: { name: 'Broker Co' },
      referredContact: { name: 'Bob Broker' },
      owner: { name: 'User lead-src-owner' },
    });

    await api
      .patch(`/api/v1/leads/${idOf(lead)}`, { status: 'LOST', lostReason: 'Not eligible' })
      .expect(200);
    const lost = await api.get('/api/v1/leads?status=LOST').expect(200);
    expect((lost.body as { data: { id: string }[] }).data.map((l) => l.id)).toEqual([idOf(lead)]);
    const search = await api.get('/api/v1/leads?q=jane').expect(200);
    expect((search.body as { data: unknown[] }).data).toHaveLength(1);
    const reopened = await api.patch(`/api/v1/leads/${idOf(lead)}`, { status: 'OPEN' }).expect(200);
    expect(reopened.body).toMatchObject({ status: 'OPEN', lostReason: null });
  });

  it('agents see only leads they own and cannot reassign or create them', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'lead-own');
    const api = as(owner, tenantId);
    const agent = await inviteNewUser(
      t,
      owner,
      tenantId,
      { kind: 'STAFF', roleKey: 'migration_agent' },
      'lead-agent',
    );
    const agentApi = as(agent, tenantId);
    const agentMember = await memberId(api, agent.userId);

    const mine = await api
      .post('/api/v1/leads', { fullName: 'For Agent', ownerMembershipId: agentMember })
      .expect(201);
    const notMine = await api.post('/api/v1/leads', { fullName: 'For Owner' }).expect(201);

    const list = await agentApi.get('/api/v1/leads').expect(200);
    expect((list.body as { data: { id: string }[] }).data.map((l) => l.id)).toEqual([idOf(mine)]);
    await agentApi.get(`/api/v1/leads/${idOf(notMine)}`).expect(404);
    await agentApi.patch(`/api/v1/leads/${idOf(mine)}`, { interest: 'Partner visa' }).expect(200);
    const reassign = await agentApi.patch(`/api/v1/leads/${idOf(mine)}`, {
      ownerMembershipId: await memberId(api, owner.userId),
    });
    expect(code(reassign)).toBe('OUT_OF_SCOPE');
    await agentApi.post('/api/v1/leads', { fullName: 'Agent Lead' }).expect(403);
  });

  it('branch managers see their branches and create only inside them', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'lead-br');
    const api = as(owner, tenantId);
    const north = await api.post('/api/v1/branches', { name: 'North' }).expect(201);
    const south = await api.post('/api/v1/branches', { name: 'South' }).expect(201);
    const manager = await inviteNewUser(
      t,
      owner,
      tenantId,
      { kind: 'STAFF', roleKey: 'branch_manager' },
      'lead-bm',
    );
    await api
      .patch(`/api/v1/members/${await memberId(api, manager.userId)}`, { branchIds: [idOf(north)] })
      .expect(200);
    const mApi = as(manager, tenantId);

    const inNorth = await api
      .post('/api/v1/leads', { fullName: 'North Lead', branchId: idOf(north) })
      .expect(201);
    await api.post('/api/v1/leads', { fullName: 'South Lead', branchId: idOf(south) }).expect(201);
    const list = await mApi.get('/api/v1/leads').expect(200);
    expect((list.body as { data: { id: string }[] }).data.map((l) => l.id)).toEqual([
      idOf(inNorth),
    ]);

    await mApi.post('/api/v1/leads', { fullName: 'X', branchId: idOf(north) }).expect(201);
    const outside = await mApi.post('/api/v1/leads', { fullName: 'X', branchId: idOf(south) });
    expect(code(outside)).toBe('OUT_OF_SCOPE');
  });
});

describe('lead conversion', () => {
  it('creates a numbered client, keeps attribution and is safe to retry', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'conv');
    const api = as(owner, tenantId);
    const referral = await optionId(api, 'LEAD_SOURCE', 'referral');
    const lead = await api
      .post('/api/v1/leads', { fullName: 'Ravi Kumar', sourceId: referral })
      .expect(201);

    const res = await api
      .post(`/api/v1/leads/${idOf(lead)}/convert`, {
        mode: 'new',
        client: { kind: 'INDIVIDUAL', displayName: 'Ravi Kumar', dateOfBirth: '1990-05-01' },
      })
      .expect(200);
    const body = res.body as {
      created: boolean;
      client: { id: string; clientNumber: string };
      lead: { status: string };
    };
    expect(body.created).toBe(true);
    expect(body.client.clientNumber).toBe('C-000001');
    expect(body.lead.status).toBe('CONVERTED');

    const client = await api.get(`/api/v1/clients/${body.client.id}`).expect(200);
    expect(client.body).toMatchObject({
      dateOfBirth: '1990-05-01',
      sourceLeads: [{ id: idOf(lead), source: { name: 'Referral' } }],
    });

    // Retry-safe and duplicate-proof.
    const again = await api
      .post(`/api/v1/leads/${idOf(lead)}/convert`, { mode: 'link', clientId: body.client.id })
      .expect(200);
    expect((again.body as { created: boolean }).created).toBe(false);
    const second = await api.post(`/api/v1/leads/${idOf(lead)}/convert`, {
      mode: 'new',
      client: { kind: 'INDIVIDUAL', displayName: 'Ravi Kumar' },
    });
    expect(code(second)).toBe('LEAD_ALREADY_CONVERTED');
    const clients = await api.get('/api/v1/clients').expect(200);
    expect((clients.body as { data: unknown[] }).data).toHaveLength(1);

    // Converted leads are kept read-only for attribution.
    expect(code(await api.patch(`/api/v1/leads/${idOf(lead)}`, { fullName: 'X' }))).toBe(
      'LEAD_CONVERTED',
    );
    expect(code(await api.del(`/api/v1/leads/${idOf(lead)}`))).toBe('LEAD_CONVERTED');
  });

  it('finds duplicates by email, phone (any format) or name + birth date, then links instead', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'dup');
    const api = as(owner, tenantId);
    const existing = await api
      .post('/api/v1/clients', {
        kind: 'INDIVIDUAL',
        displayName: 'Mei Chen',
        email: 'mei@example.test',
        phone: '+61 412 000 111',
        dateOfBirth: '1988-02-03',
      })
      .expect(201);

    const byPhone = await api
      .get(`/api/v1/clients/duplicates?phone=${encodeURIComponent('0412 000 111')}`)
      .expect(200);
    expect(byPhone.body).toMatchObject({
      candidates: [{ id: idOf(existing), reasons: ['phone'] }],
      hiddenMatches: 0,
    });
    const byEmail = await api.get('/api/v1/clients/duplicates?email=MEI@example.test').expect(200);
    expect(
      (byEmail.body as { candidates: { reasons: string[] }[] }).candidates[0]?.reasons,
    ).toEqual(['email']);
    const byName = await api
      .get('/api/v1/clients/duplicates?name=mei%20chen&dateOfBirth=1988-02-03')
      .expect(200);
    expect((byName.body as { candidates: { reasons: string[] }[] }).candidates[0]?.reasons).toEqual(
      ['name_and_birth_date'],
    );
    await api.get('/api/v1/clients/duplicates?name=Mei').expect(400);

    const lead = await api
      .post('/api/v1/leads', { fullName: 'Mei Chen', phone: '0412000111' })
      .expect(201);
    const linked = await api
      .post(`/api/v1/leads/${idOf(lead)}/convert`, { mode: 'link', clientId: idOf(existing) })
      .expect(200);
    expect((linked.body as { created: boolean }).created).toBe(false);
    const clients = await api.get('/api/v1/clients').expect(200);
    expect((clients.body as { data: unknown[] }).data).toHaveLength(1);
  });

  it('matches the caller may not see are only counted', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'dup-hidden');
    const api = as(owner, tenantId);
    await api
      .post('/api/v1/clients', {
        kind: 'INDIVIDUAL',
        displayName: 'Hidden',
        email: 'hidden@example.test',
      })
      .expect(201);
    const agent = await inviteNewUser(
      t,
      owner,
      tenantId,
      { kind: 'STAFF', roleKey: 'migration_agent' },
      'dup-agent',
    );
    const res = await as(agent, tenantId)
      .get('/api/v1/clients/duplicates?email=hidden@example.test')
      .expect(200);
    expect(res.body).toEqual({ candidates: [], hiddenMatches: 1 });
  });
});

describe('clients', () => {
  it('validates kind-specific fields and manages relationships', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'cli');
    const api = as(owner, tenantId);
    const biz = await api.post('/api/v1/clients', {
      kind: 'BUSINESS',
      displayName: 'Acme Pty Ltd',
      dateOfBirth: '2000-01-01',
    });
    expect(biz.status).toBe(400);
    const parent = await api
      .post('/api/v1/clients', { kind: 'INDIVIDUAL', displayName: 'Ana Silva' })
      .expect(201);
    const child = await api
      .post('/api/v1/clients', { kind: 'INDIVIDUAL', displayName: 'Leo Silva' })
      .expect(201);
    const dependant = await optionId(api, 'RELATIONSHIP_TYPE', 'dependant');

    expect(
      (
        await api.post(`/api/v1/clients/${idOf(parent)}/relationships`, {
          toClientId: idOf(parent),
          typeId: dependant,
        })
      ).status,
    ).toBe(400);
    const added = await api
      .post(`/api/v1/clients/${idOf(parent)}/relationships`, {
        toClientId: idOf(child),
        typeId: dependant,
      })
      .expect(201);
    const relId = (added.body as { relationships: { id: string }[] }).relationships[0]?.id;
    expect(
      code(
        await api.post(`/api/v1/clients/${idOf(parent)}/relationships`, {
          toClientId: idOf(child),
          typeId: dependant,
        }),
      ),
    ).toBe('RELATIONSHIP_EXISTS');
    const fromChild = await api.get(`/api/v1/clients/${idOf(child)}`).expect(200);
    expect(fromChild.body).toMatchObject({
      relationships: [
        { direction: 'to', other: { displayName: 'Ana Silva' }, type: { name: 'Dependant' } },
      ],
    });
    await api.del(`/api/v1/clients/${idOf(child)}/relationships/${relId}`).expect(204);
    const after = await api.get(`/api/v1/clients/${idOf(parent)}`).expect(200);
    expect((after.body as { relationships: unknown[] }).relationships).toHaveLength(0);
  });

  it('client numbers are sequential per workspace and never reused across workspaces', async () => {
    const a = await ownerWithWorkspace(t, 'num-a');
    const b = await ownerWithWorkspace(t, 'num-b');
    const n = async (api: ReturnType<typeof as>) =>
      (
        (await api.post('/api/v1/clients', { kind: 'INDIVIDUAL', displayName: 'X' }).expect(201))
          .body as { clientNumber: string }
      ).clientNumber;
    const A = as(a.owner, a.tenantId);
    const B = as(b.owner, b.tenantId);
    expect(await Promise.all([n(A), n(A), n(A)]).then((v) => v.sort())).toEqual([
      'C-000001',
      'C-000002',
      'C-000003',
    ]);
    expect(await n(B)).toBe('C-000001');
  });

  it('audit records changes without personal values', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'cli-audit');
    const api = as(owner, tenantId);
    const c = await api
      .post('/api/v1/clients', { kind: 'INDIVIDUAL', displayName: 'Secret Person' })
      .expect(201);
    await api
      .patch(`/api/v1/clients/${idOf(c)}`, { nationality: 'Narnian', email: 'secret@example.test' })
      .expect(200);
    const audit = await api.get('/api/v1/audit-logs').expect(200);
    const raw = JSON.stringify(audit.body);
    expect(raw).toContain('client.updated');
    expect(raw).toContain('email,nationality');
    expect(raw).not.toMatch(/Narnian|secret@example|Secret Person/);
  });
});

describe('activities timeline', () => {
  it('logs and lists entries; read-only roles cannot add; others cannot see', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'act');
    const api = as(owner, tenantId);
    const lead = await api.post('/api/v1/leads', { fullName: 'Timeline Lead' }).expect(201);
    await api
      .post('/api/v1/activities', { leadId: idOf(lead), type: 'CALL', summary: 'First call' })
      .expect(201);
    await api
      .post('/api/v1/activities', { leadId: idOf(lead), type: 'EMAIL', summary: 'Sent checklist' })
      .expect(201);
    const list = await api.get(`/api/v1/activities?leadId=${idOf(lead)}`).expect(200);
    expect(
      (list.body as { data: { summary: string; actor: { name: string } }[] }).data,
    ).toMatchObject([
      { summary: 'Sent checklist', actor: { name: 'User act-owner' } },
      { summary: 'First call' },
    ]);
    await api.get('/api/v1/activities').expect(400);

    const reception = await inviteNewUser(
      t,
      owner,
      tenantId,
      { kind: 'STAFF', roleKey: 'receptionist' },
      'act-rec',
    );
    const recApi = as(reception, tenantId);
    await recApi.get(`/api/v1/activities?leadId=${idOf(lead)}`).expect(200);
    await recApi
      .post('/api/v1/activities', { leadId: idOf(lead), type: 'NOTE', summary: 'x' })
      .expect(403);

    const agent = await inviteNewUser(
      t,
      owner,
      tenantId,
      { kind: 'STAFF', roleKey: 'migration_agent' },
      'act-agent',
    );
    await as(agent, tenantId)
      .get(`/api/v1/activities?leadId=${idOf(lead)}`)
      .expect(404);
  });
});

describe('appointments and consultations', () => {
  it('reception books a consultation for an agent; scopes and rules apply', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'appt');
    const api = as(owner, tenantId);
    const agent = await inviteNewUser(
      t,
      owner,
      tenantId,
      { kind: 'STAFF', roleKey: 'migration_agent' },
      'appt-agent',
    );
    const reception = await inviteNewUser(
      t,
      owner,
      tenantId,
      { kind: 'STAFF', roleKey: 'receptionist' },
      'appt-rec',
    );
    const finance = await inviteNewUser(
      t,
      owner,
      tenantId,
      { kind: 'STAFF', roleKey: 'finance_manager' },
      'appt-fin',
    );
    const agentMember = await memberId(api, agent.userId);
    const lead = await api
      .post('/api/v1/leads', { fullName: 'Consult Me', ownerMembershipId: agentMember })
      .expect(201);
    const recApi = as(reception, tenantId);

    const bad = await recApi.post('/api/v1/appointments', {
      title: 'Backwards',
      startsAt: slot(2).endsAt,
      endsAt: slot(2).startsAt,
    });
    expect(bad.status).toBe(400);
    const appt = await recApi
      .post('/api/v1/appointments', {
        title: 'Initial consultation',
        isConsultation: true,
        hostMembershipId: agentMember,
        leadId: idOf(lead),
        location: 'Sydney office',
        ...slot(24),
      })
      .expect(201);
    expect(appt.body).toMatchObject({
      isConsultation: true,
      host: { name: 'User appt-agent' },
      lead: { fullName: 'Consult Me' },
    });
    await recApi.post('/api/v1/appointments', { title: 'Own one', ...slot(26) }).expect(201);

    const agentView = await as(agent, tenantId).get('/api/v1/appointments').expect(200);
    expect((agentView.body as { title: string }[]).map((a) => a.title)).toEqual([
      'Initial consultation',
    ]);
    const forLead = await api.get(`/api/v1/appointments?leadId=${idOf(lead)}`).expect(200);
    expect(forLead.body).toHaveLength(1);
    await as(finance, tenantId).get('/api/v1/appointments').expect(403);
    const agentBooksForOthers = await as(agent, tenantId).post('/api/v1/appointments', {
      title: 'x',
      hostMembershipId: await memberId(api, owner.userId),
      ...slot(30),
    });
    expect(code(agentBooksForOthers)).toBe('OUT_OF_SCOPE');

    await recApi.post(`/api/v1/appointments/${idOf(appt)}/cancel`).expect(200);
    expect(code(await recApi.patch(`/api/v1/appointments/${idOf(appt)}`, { title: 'Moved' }))).toBe(
      'APPOINTMENT_CANCELLED',
    );
    const upcoming = await api.get('/api/v1/appointments').expect(200);
    expect((upcoming.body as { title: string }[]).map((a) => a.title)).toEqual(['Own one']);
  });
});

describe('system role updates for existing workspaces', () => {
  it('a workspace on old role templates gets the new permissions on its next request', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'roles-v1');
    const reception = await inviteNewUser(
      t,
      owner,
      tenantId,
      { kind: 'STAFF', roleKey: 'receptionist' },
      'roles-rec',
    );
    // Simulate a workspace created before Stage 4: version 1, no appointment permissions.
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await tx.rolePermission.deleteMany({
        where: { tenantId, permission: { startsWith: 'appointment:' } },
      });
      await tx.tenant.update({ where: { id: tenantId }, data: { rolesVersion: 1 } });
    });
    const res = await as(reception, tenantId).get('/api/v1/appointments');
    expect(res.status).toBe(200);
    const tenant = await db.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { rolesVersion: true },
    });
    expect(tenant.rolesVersion).toBe(ROLE_TEMPLATES_VERSION);
    const admin = await enableMfa(
      t,
      await inviteNewUser(t, owner, tenantId, { kind: 'STAFF', roleKey: 'admin' }, 'roles-adm'),
    );
    await as(admin, tenantId).get('/api/v1/appointments').expect(200);
  });
});
