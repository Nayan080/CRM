import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type SignedInUser,
  bearer,
  inviteNewUser,
  ownerWithWorkspace,
  tenantHeaders,
} from './helpers/flows.js';
import {
  type TestApp,
  createTestApp,
  tokenFromLastEmail,
  uniqueEmail,
} from './helpers/test-app.js';

let t: TestApp;
let owner: SignedInUser;
let tenantId: string;
let agent: SignedInUser;
let sales: SignedInUser;
let external: SignedInUser;

const code = (res: request.Response) => (res.body as { code?: string }).code;
const idOf = (res: request.Response) => (res.body as { id: string }).id;

function as(user: SignedInUser, tenant = tenantId) {
  const headers = tenantHeaders(user, tenant);
  return {
    get: (path: string) => request(t.server).get(path).set(headers),
    post: (path: string, body: object = {}) => request(t.server).post(path).set(headers).send(body),
    patch: (path: string, body: object) => request(t.server).patch(path).set(headers).send(body),
    del: (path: string) => request(t.server).delete(path).set(headers),
  };
}

async function optionId(category: string, name: string): Promise<string> {
  const res = await as(owner).get(`/api/v1/reference-options?category=${category}`).expect(200);
  const option = (res.body as { id: string; name: string }[]).find((o) => o.name === name);
  if (!option) throw new Error(`No ${category} option named ${name}`);
  return option.id;
}

beforeAll(async () => {
  t = await createTestApp();
  const ws = await ownerWithWorkspace(t, 'dir');
  owner = ws.owner;
  tenantId = ws.tenantId;
  agent = await inviteNewUser(
    t,
    owner,
    tenantId,
    { kind: 'STAFF', roleKey: 'migration_agent' },
    'dir-agent',
  );
  sales = await inviteNewUser(
    t,
    owner,
    tenantId,
    { kind: 'STAFF', roleKey: 'sales_manager' },
    'dir-sales',
  );
  external = await inviteNewUser(t, owner, tenantId, { kind: 'EXTERNAL' }, 'dir-ext');
});

afterAll(async () => {
  await t.close();
});

describe('agency profile', () => {
  it('owner updates profile fields; empty text clears a value', async () => {
    const res = await as(owner)
      .patch('/api/v1/tenant', {
        legalName: 'Dir Agency Pty Ltd',
        phone: '+61 2 5550 0000',
        contactEmail: 'Hello@Dir-Agency.example',
        website: 'https://dir-agency.example',
        city: 'Sydney',
        timezone: 'Australia/Melbourne',
      })
      .expect(200);
    expect(res.body).toMatchObject({
      legalName: 'Dir Agency Pty Ltd',
      contactEmail: 'hello@dir-agency.example',
      city: 'Sydney',
      timezone: 'Australia/Melbourne',
    });
    const cleared = await as(owner).patch('/api/v1/tenant', { phone: '' }).expect(200);
    expect((cleared.body as { phone: string | null; city: string }).phone).toBeNull();
    expect((cleared.body as { city: string }).city).toBe('Sydney');
  });

  it('rejects an unknown time zone and non-admins', async () => {
    const bad = await as(owner).patch('/api/v1/tenant', { timezone: 'Mars/Phobos' });
    expect(bad.status).toBe(400);
    expect((bad.body as { errors: { path: string }[] }).errors[0]?.path).toBe('timezone');
    await as(agent).patch('/api/v1/tenant', { name: 'Nope Agency' }).expect(403);
  });
});

describe('configurable lists', () => {
  it('a new workspace starts with the default profession and partner types', async () => {
    const professions = await as(agent)
      .get('/api/v1/reference-options?category=PROFESSION_TYPE')
      .expect(200);
    const partners = await as(agent)
      .get('/api/v1/reference-options?category=PARTNER_TYPE')
      .expect(200);
    expect((professions.body as { name: string }[]).map((o) => o.name)).toEqual([
      'Migration Agent',
      'Migration Lawyer',
      'Legal Consultant',
      'CA / Accountant',
      'Broker',
      'Education Consultant',
      'Other',
    ]);
    expect(partners.body).toHaveLength(7);
    await as(owner).get('/api/v1/reference-options?category=NOPE').expect(400);
  });

  it('admin adds, renames and deactivates values; duplicates are refused', async () => {
    const created = await as(owner)
      .post('/api/v1/reference-options', { category: 'PROFESSION_TYPE', name: 'Tax Agent' })
      .expect(201);
    expect(created.body).toMatchObject({ key: 'tax_agent', isActive: true });
    const dup = await as(owner).post('/api/v1/reference-options', {
      category: 'PROFESSION_TYPE',
      name: 'Tax agent',
    });
    expect(code(dup)).toBe('OPTION_EXISTS');
    await as(agent)
      .post('/api/v1/reference-options', { category: 'PROFESSION_TYPE', name: 'X' })
      .expect(403);

    await as(owner)
      .patch(`/api/v1/reference-options/${idOf(created)}`, { isActive: false })
      .expect(200);
    const refused = await as(owner).post('/api/v1/professionals', {
      fullName: 'Uses Inactive Type',
      professionTypeId: idOf(created),
    });
    expect(code(refused)).toBe('INVALID_REFERENCE');
  });
});

describe('branches and branch scope', () => {
  let sydney: string;
  let perth: string;
  let manager: SignedInUser;

  it('admin creates, renames and deactivates branches; names are unique per workspace', async () => {
    const a = await as(owner)
      .post('/api/v1/branches', { name: 'Sydney', city: 'Sydney', timezone: 'Australia/Sydney' })
      .expect(201);
    const b = await as(owner)
      .post('/api/v1/branches', { name: 'Perth', timezone: 'Australia/Perth' })
      .expect(201);
    sydney = idOf(a);
    perth = idOf(b);
    const dup = await as(owner).post('/api/v1/branches', { name: 'Sydney' });
    expect(code(dup)).toBe('BRANCH_NAME_TAKEN');
    const renamed = await as(owner)
      .patch(`/api/v1/branches/${perth}`, { name: 'Perth CBD' })
      .expect(200);
    expect(renamed.body).toMatchObject({ name: 'Perth CBD', isActive: true, memberCount: 0 });
    await as(agent).post('/api/v1/branches', { name: 'Rogue' }).expect(403);
    await as(agent).get('/api/v1/branches').expect(403);
  });

  it('invited staff join their branches; members can be re-assigned', async () => {
    manager = await inviteNewUser(
      t,
      owner,
      tenantId,
      { kind: 'STAFF', roleKey: 'branch_manager', branchIds: [sydney] },
      'dir-manager',
    );
    const members = await as(owner).get('/api/v1/members').expect(200);
    const rows = members.body as { id: string; userId: string; branches: { name: string }[] }[];
    expect(rows.find((m) => m.userId === manager.userId)?.branches).toEqual([
      { id: sydney, name: 'Sydney' },
    ]);

    const agentRow = rows.find((m) => m.userId === agent.userId);
    const updated = await as(owner)
      .patch(`/api/v1/members/${agentRow?.id}`, { branchIds: [sydney, perth] })
      .expect(200);
    expect((updated.body as { branches: { name: string }[] }).branches.map((b) => b.name)).toEqual([
      'Perth CBD',
      'Sydney',
    ]);
    const branches = await as(owner).get('/api/v1/branches').expect(200);
    expect(
      (branches.body as { name: string; memberCount: number }[]).find((b) => b.name === 'Sydney')
        ?.memberCount,
    ).toBe(2);

    const externalRow = rows.find((m) => m.userId === external.userId);
    const refused = await as(owner).patch(`/api/v1/members/${externalRow?.id}`, {
      branchIds: [sydney],
    });
    expect(code(refused)).toBe('EXTERNAL_MEMBER_HAS_NO_BRANCHES');
  });

  it('a branch manager sees only people who share a branch (and themselves)', async () => {
    const res = await as(manager).get('/api/v1/members').expect(200);
    const userIds = (res.body as { userId: string }[]).map((m) => m.userId).sort();
    expect(userIds).toEqual([manager.userId, agent.userId].sort());
  });

  it('a branch manager invites only into own branches and only into roles below their own', async () => {
    const other = await as(manager).post('/api/v1/invitations', {
      kind: 'STAFF',
      roleKey: 'migration_agent',
      email: uniqueEmail('bm-perth'),
      branchIds: [perth],
    });
    expect(other.status).toBe(403);
    const noBranch = await as(manager).post('/api/v1/invitations', {
      kind: 'STAFF',
      roleKey: 'migration_agent',
      email: uniqueEmail('bm-none'),
    });
    expect(noBranch.status).toBe(403);
    const ext = await as(manager).post('/api/v1/invitations', {
      kind: 'EXTERNAL',
      email: uniqueEmail('bm-ext'),
    });
    expect(ext.status).toBe(403);
    const admin = await as(manager).post('/api/v1/invitations', {
      kind: 'STAFF',
      roleKey: 'admin',
      email: uniqueEmail('bm-admin'),
      branchIds: [sydney],
    });
    expect(code(admin)).toBe('ROLE_ESCALATION');

    const email = uniqueEmail('bm-ok');
    const ok = await as(manager)
      .post('/api/v1/invitations', {
        kind: 'STAFF',
        roleKey: 'migration_agent',
        email,
        branchIds: [sydney],
      })
      .expect(201);
    // Owner's tenant-wide invitation is not visible to the branch manager; their own is.
    const ownerInvite = await as(owner)
      .post('/api/v1/invitations', {
        kind: 'STAFF',
        roleKey: 'receptionist',
        email: uniqueEmail('own-inv'),
      })
      .expect(201);
    const visible = await as(manager).get('/api/v1/invitations').expect(200);
    const ids = (visible.body as { id: string }[]).map((i) => i.id);
    expect(ids).toContain(idOf(ok));
    expect(ids).not.toContain(idOf(ownerInvite));
    await as(manager)
      .del(`/api/v1/invitations/${idOf(ownerInvite)}`)
      .expect(404);

    // The invitee lands in the Sydney branch.
    const token = tokenFromLastEmail(t.mailer, email);
    const joined = await request(t.server)
      .post('/api/v1/invitations/accept-new')
      .send({ token, name: 'New Agent', password: 'correct horse battery staple' })
      .expect(200);
    const all = await as(owner).get('/api/v1/members').expect(200);
    const newUserId = (joined.body as { user: { id: string } }).user.id;
    const row = (all.body as { userId: string; branches: { id: string }[] }[]).find(
      (m) => m.userId === newUserId,
    );
    expect(row?.branches.map((b) => b.id)).toEqual([sydney]);
  });

  it('deactivated branches cannot receive new invitations', async () => {
    await as(owner).patch(`/api/v1/branches/${perth}`, { isActive: false }).expect(200);
    const res = await as(owner).post('/api/v1/invitations', {
      kind: 'STAFF',
      roleKey: 'receptionist',
      email: uniqueEmail('inactive-branch'),
      branchIds: [perth],
    });
    expect(code(res)).toBe('UNKNOWN_BRANCH');
  });
});

describe('partner organizations and contacts', () => {
  let partnerId: string;

  it('sales manager creates partners with contacts; list supports search and paging', async () => {
    const typeId = await optionId('PARTNER_TYPE', 'Law Firm');
    for (const name of ['Harbour Legal', 'Harbourside Education', 'Outback Recruitment']) {
      const res = await as(sales)
        .post('/api/v1/partners', { name, typeId, website: '' })
        .expect(201);
      if (name === 'Harbour Legal') partnerId = idOf(res);
    }
    const contact = await as(sales)
      .post(`/api/v1/partners/${partnerId}/contacts`, {
        fullName: 'Maya Chen',
        email: 'Maya@Harbour.example',
        position: 'Partner',
      })
      .expect(201);
    expect(contact.body).toMatchObject({ fullName: 'Maya Chen', email: 'maya@harbour.example' });

    const search = await as(agent).get('/api/v1/partners?q=harbour').expect(200);
    expect((search.body as { data: { name: string }[] }).data.map((p) => p.name).sort()).toEqual([
      'Harbour Legal',
      'Harbourside Education',
    ]);
    const page1 = await as(agent).get('/api/v1/partners?limit=2').expect(200);
    const first = page1.body as { data: { id: string }[]; nextCursor: string | null };
    expect(first.data).toHaveLength(2);
    expect(first.nextCursor).toBe(first.data[1]?.id);
    const page2 = await as(agent)
      .get(`/api/v1/partners?limit=2&cursor=${first.nextCursor}`)
      .expect(200);
    const second = page2.body as { data: { id: string }[]; nextCursor: string | null };
    expect(second.data).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(first.data.map((p) => p.id)).not.toContain(second.data[0]?.id);

    const detail = await as(agent).get(`/api/v1/partners/${partnerId}`).expect(200);
    expect(detail.body).toMatchObject({
      name: 'Harbour Legal',
      type: { name: 'Law Firm' },
      contactCount: 1,
    });
  });

  it('validates input and enforces who may change partners', async () => {
    const typeId = await optionId('PARTNER_TYPE', 'Law Firm');
    const professionTypeId = await optionId('PROFESSION_TYPE', 'Broker');
    const bad = await as(sales).post('/api/v1/partners', {
      name: '',
      typeId,
      website: 'not-a-url',
    });
    expect(bad.status).toBe(400);
    expect((bad.body as { errors: { path: string }[] }).errors.map((e) => e.path).sort()).toEqual([
      'name',
      'website',
    ]);
    // A profession type is not a partner type.
    const wrongList = await as(sales).post('/api/v1/partners', {
      name: 'Wrong List',
      typeId: professionTypeId,
    });
    expect(code(wrongList)).toBe('INVALID_REFERENCE');
    await as(agent).post('/api/v1/partners', { name: 'Agent Partner', typeId }).expect(403);
    await as(agent).del(`/api/v1/partners/${partnerId}`).expect(403);
    for (const path of ['/api/v1/partners', '/api/v1/professionals', '/api/v1/branches']) {
      await as(external).get(path).expect(403);
    }
    await as(external).get('/api/v1/reference-options?category=PARTNER_TYPE').expect(403);
  });

  it('archiving a partner hides it and its contacts', async () => {
    const typeId = await optionId('PARTNER_TYPE', 'Other');
    const partner = await as(owner)
      .post('/api/v1/partners', { name: 'To Archive', typeId })
      .expect(201);
    const contact = await as(owner)
      .post(`/api/v1/partners/${idOf(partner)}/contacts`, { fullName: 'Gone Soon' })
      .expect(201);
    await as(owner)
      .del(`/api/v1/partners/${idOf(partner)}/contacts/${idOf(contact)}`)
      .expect(204);
    const afterContact = await as(owner)
      .get(`/api/v1/partners/${idOf(partner)}`)
      .expect(200);
    expect((afterContact.body as { contacts: unknown[] }).contacts).toEqual([]);
    await as(owner)
      .del(`/api/v1/partners/${idOf(partner)}`)
      .expect(204);
    await as(owner)
      .get(`/api/v1/partners/${idOf(partner)}`)
      .expect(404);
    await as(owner)
      .patch(`/api/v1/partners/${idOf(partner)}`, { name: 'Back' })
      .expect(404);
    const list = await as(owner).get('/api/v1/partners?q=To Archive').expect(200);
    expect((list.body as { data: unknown[] }).data).toEqual([]);
  });
});

describe('professional directory and credentials', () => {
  let professionalId: string;
  let credentialId: string;

  it('admin adds a professional linked to a partner; sales and agents cannot', async () => {
    const professionTypeId = await optionId('PROFESSION_TYPE', 'Migration Lawyer');
    const partners = await as(owner).get('/api/v1/partners?q=Harbour Legal').expect(200);
    const partnerOrgId = (partners.body as { data: { id: string }[] }).data[0]?.id;
    const res = await as(owner)
      .post('/api/v1/professionals', {
        fullName: 'Asha Rao',
        professionTypeId,
        partnerOrgId,
        email: 'asha@harbour.example',
      })
      .expect(201);
    professionalId = idOf(res);
    expect(res.body).toMatchObject({
      fullName: 'Asha Rao',
      professionType: { name: 'Migration Lawyer' },
      partnerOrg: { name: 'Harbour Legal' },
      credentialCount: 0,
    });
    await as(sales)
      .post('/api/v1/professionals', { fullName: 'Nope', professionTypeId })
      .expect(403);
    await as(agent)
      .post('/api/v1/professionals', { fullName: 'Nope', professionTypeId })
      .expect(403);
    const found = await as(agent).get('/api/v1/professionals?q=asha').expect(200);
    expect((found.body as { data: { id: string }[] }).data.map((p) => p.id)).toEqual([
      professionalId,
    ]);
  });

  it('a profile is not a login and grants no access', async () => {
    const res = await request(t.server)
      .post('/api/v1/auth/login')
      .send({ email: 'asha@harbour.example', password: 'correct horse battery staple' });
    expect(res.status).toBe(401);
    const members = await as(owner).get('/api/v1/members').expect(200);
    expect(JSON.stringify(members.body)).not.toContain('asha@harbour.example');
  });

  it('credentials start unverified; a person records the verification decision', async () => {
    const created = await as(owner)
      .post(`/api/v1/professionals/${professionalId}/credentials`, {
        credentialType: 'Legal practising certificate',
        issuer: 'Law Society',
        identifier: 'LP-12345',
        issuedOn: '2026-01-01',
        expiresOn: '2099-12-31',
      })
      .expect(201);
    credentialId = idOf(created);
    expect(created.body).toMatchObject({
      status: 'UNVERIFIED',
      isExpired: false,
      verifiedAt: null,
      expiresOn: '2099-12-31',
    });

    const path = `/api/v1/professionals/${professionalId}/credentials/${credentialId}`;
    await as(agent).post(`${path}/verification`, { status: 'VERIFIED' }).expect(403);
    const verified = await as(owner)
      .post(`${path}/verification`, { status: 'VERIFIED', note: 'Checked on the public register' })
      .expect(200);
    expect(verified.body).toMatchObject({
      status: 'VERIFIED',
      verificationNote: 'Checked on the public register',
    });
    expect((verified.body as { verifiedAt: string | null }).verifiedAt).not.toBeNull();
  });

  it('changing credential details resets verification; expiry is shown regardless of status', async () => {
    const path = `/api/v1/professionals/${professionalId}/credentials/${credentialId}`;
    const edited = await as(owner).patch(path, { identifier: 'LP-99999' }).expect(200);
    expect(edited.body).toMatchObject({
      identifier: 'LP-99999',
      status: 'UNVERIFIED',
      verifiedAt: null,
      verificationNote: null,
    });

    const badDates = await as(owner).patch(path, { expiresOn: '2025-01-01' });
    expect(badDates.status).toBe(400);

    const expired = await as(owner)
      .post(`/api/v1/professionals/${professionalId}/credentials`, {
        credentialType: 'Old registration',
        issuer: 'Registry',
        identifier: 'OLD-1',
        expiresOn: '2020-01-01',
      })
      .expect(201);
    await as(owner)
      .post(`/api/v1/professionals/${professionalId}/credentials/${idOf(expired)}/verification`, {
        status: 'VERIFIED',
      })
      .expect(200);
    const detail = await as(agent).get(`/api/v1/professionals/${professionalId}`).expect(200);
    const credentials = (
      detail.body as { credentials: { identifier: string; status: string; isExpired: boolean }[] }
    ).credentials;
    expect(credentials.find((c) => c.identifier === 'OLD-1')).toMatchObject({
      status: 'VERIFIED',
      isExpired: true,
    });
    expect((detail.body as { credentialCount: number }).credentialCount).toBe(2);

    await as(owner)
      .del(`/api/v1/professionals/${professionalId}/credentials/${idOf(expired)}`)
      .expect(204);
  });

  it('archived professionals disappear from the directory', async () => {
    const professionTypeId = await optionId('PROFESSION_TYPE', 'Broker');
    const res = await as(owner)
      .post('/api/v1/professionals', { fullName: 'Temp Broker', professionTypeId })
      .expect(201);
    await as(owner)
      .del(`/api/v1/professionals/${idOf(res)}`)
      .expect(204);
    await as(owner)
      .get(`/api/v1/professionals/${idOf(res)}`)
      .expect(404);
    await as(owner)
      .post(`/api/v1/professionals/${idOf(res)}/credentials`, {
        credentialType: 'x',
        issuer: 'y',
        identifier: 'z',
      })
      .expect(404);
  });
});

describe('audit trail', () => {
  it('records directory changes without leaking personal details', async () => {
    const res = await as(owner).get('/api/v1/audit-logs').expect(200);
    const actions = (res.body as { action: string }[]).map((a) => a.action);
    for (const action of [
      'branch.created',
      'member.branches_changed',
      'partner.created',
      'partner.archived',
      'professional.created',
      'credential.verification_changed',
      'credential.updated',
    ]) {
      expect(actions, action).toContain(action);
    }
    expect(JSON.stringify(res.body)).not.toMatch(/LP-12345|asha@harbour|Maya Chen/);
    await request(t.server).get('/api/v1/audit-logs').set(bearer(agent.accessToken)).expect(400);
  });
});
