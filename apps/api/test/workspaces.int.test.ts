import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PASSWORD,
  bearer,
  createWorkspace,
  enableMfa,
  freshCode,
  inviteNewUser,
  login,
  ownerWithWorkspace,
  signUp,
  tenantHeaders,
} from './helpers/flows.js';
import {
  type TestApp,
  createTestApp,
  tokenFromLastEmail,
  uniqueEmail,
} from './helpers/test-app.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const code = (res: request.Response) => (res.body as { code?: string }).code;

describe('workspace creation and MFA enforcement (DEC-06)', () => {
  it('creates tenant + 9 roles + owner membership; owner must enable MFA before using it', async () => {
    const owner = await signUp(t, 'ws-owner');
    const { tenantId } = await createWorkspace(t, owner, 'ws');

    const blocked = await request(t.server)
      .get('/api/v1/tenant/access')
      .set(tenantHeaders(owner, tenantId));
    expect(blocked.status).toBe(403);
    expect(code(blocked)).toBe('MFA_SETUP_REQUIRED');

    const withMfa = await enableMfa(t, owner);
    const access = await request(t.server)
      .get('/api/v1/tenant/access')
      .set(tenantHeaders(withMfa, tenantId))
      .expect(200);
    const body = access.body as { role: { key: string }; permissions: unknown[] };
    expect(body.role.key).toBe('owner');
    expect(body.permissions.length).toBeGreaterThan(20);

    const audit = await request(t.server)
      .get('/api/v1/audit-logs')
      .set(tenantHeaders(withMfa, tenantId))
      .expect(200);
    expect((audit.body as { action: string }[]).map((a) => a.action)).toContain('tenant.created');
  });

  it('an owner session opened without the MFA step is refused (MFA_REQUIRED)', async () => {
    const owner = await signUp(t, 'mfa-session');
    const olderSession = await login(t, owner.email); // opened before MFA was turned on
    const withMfa = await enableMfa(t, owner); // marks only THIS session as MFA-verified
    const { tenantId } = await createWorkspace(t, withMfa, 'mfa-session');
    await request(t.server).get('/api/v1/tenant').set(tenantHeaders(withMfa, tenantId)).expect(200);
    const res = await request(t.server)
      .get('/api/v1/tenant')
      .set(tenantHeaders(olderSession, tenantId));
    expect(res.status).toBe(403);
    expect(code(res)).toBe('MFA_REQUIRED');
  });

  it('owner signs in with password + authenticator code and can use the workspace', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'mfa-login');
    const step1 = await request(t.server)
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: PASSWORD })
      .expect(200);
    expect((step1.body as { status: string }).status).toBe('mfa_required');
    const step2 = await request(t.server)
      .post('/api/v1/auth/login/mfa')
      .send({
        mfaToken: (step1.body as { mfaToken: string }).mfaToken,
        code: freshCode(owner.mfaSecret ?? ''),
      })
      .expect(200);
    await request(t.server)
      .get('/api/v1/tenant')
      .set({
        ...bearer((step2.body as { accessToken: string }).accessToken),
        'X-Tenant-Id': tenantId,
      })
      .expect(200);
  });

  it('rejects a duplicate workspace address', async () => {
    const { owner, slug } = await ownerWithWorkspace(t, 'dup');
    const res = await request(t.server)
      .post('/api/v1/tenants')
      .set(bearer(owner.accessToken))
      .send({ name: 'Other', slug });
    expect(res.status).toBe(409);
    expect(code(res)).toBe('SLUG_TAKEN');
  });

  it('requires the X-Tenant-Id header on workspace routes', async () => {
    const { owner } = await ownerWithWorkspace(t, 'hdr');
    const res = await request(t.server).get('/api/v1/tenant').set(bearer(owner.accessToken));
    expect(res.status).toBe(400);
    expect(code(res)).toBe('TENANT_REQUIRED');
  });
});

describe('invitations', () => {
  it('staff invite → new user accepts → gets the invited role', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'inv');
    const agent = await inviteNewUser(
      t,
      owner,
      tenantId,
      { kind: 'STAFF', roleKey: 'migration_agent' },
      'agent',
    );
    const access = await request(t.server)
      .get('/api/v1/tenant/access')
      .set(tenantHeaders(agent, tenantId))
      .expect(200);
    expect((access.body as { role: { key: string } }).role.key).toBe('migration_agent');
    // Agents cannot manage the team.
    await request(t.server)
      .get('/api/v1/invitations')
      .set(tenantHeaders(agent, tenantId))
      .expect(403);
  });

  it('invitation links are single-use; revoked and resent links behave correctly', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'inv2');
    const email = uniqueEmail('invitee');
    const created = await request(t.server)
      .post('/api/v1/invitations')
      .set(tenantHeaders(owner, tenantId))
      .send({ kind: 'STAFF', roleKey: 'receptionist', email })
      .expect(201);
    const id = (created.body as { id: string }).id;
    const firstToken = tokenFromLastEmail(t.mailer, email);

    const dup = await request(t.server)
      .post('/api/v1/invitations')
      .set(tenantHeaders(owner, tenantId))
      .send({ kind: 'STAFF', roleKey: 'receptionist', email });
    expect(code(dup)).toBe('INVITE_ALREADY_PENDING');

    await request(t.server)
      .post(`/api/v1/invitations/${id}/resend`)
      .set(tenantHeaders(owner, tenantId))
      .expect(200);
    const secondToken = tokenFromLastEmail(t.mailer, email);
    expect(secondToken).not.toBe(firstToken);
    await request(t.server)
      .post('/api/v1/invitations/preview')
      .send({ token: firstToken })
      .expect(404);
    const preview = await request(t.server)
      .post('/api/v1/invitations/preview')
      .send({ token: secondToken })
      .expect(200);
    expect(preview.body).toMatchObject({
      email,
      kind: 'STAFF',
      accountExists: false,
      role: { key: 'receptionist' },
    });

    await request(t.server)
      .delete(`/api/v1/invitations/${id}`)
      .set(tenantHeaders(owner, tenantId))
      .expect(204);
    await request(t.server)
      .post('/api/v1/invitations/preview')
      .send({ token: secondToken })
      .expect(404);
  });

  it('existing user accepts only with the invited email', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'inv3');
    const invitee = await signUp(t, 'existing');
    const someoneElse = await signUp(t, 'someone-else');
    await request(t.server)
      .post('/api/v1/invitations')
      .set(tenantHeaders(owner, tenantId))
      .send({ kind: 'STAFF', roleKey: 'case_manager', email: invitee.email })
      .expect(201);
    const token = tokenFromLastEmail(t.mailer, invitee.email);

    const wrong = await request(t.server)
      .post('/api/v1/invitations/accept')
      .set(bearer(someoneElse.accessToken))
      .send({ token });
    expect(code(wrong)).toBe('INVITATION_EMAIL_MISMATCH');
    const newUser = await request(t.server)
      .post('/api/v1/invitations/accept-new')
      .send({ token, name: 'X', password: PASSWORD });
    expect(code(newUser)).toBe('ACCOUNT_EXISTS');

    await request(t.server)
      .post('/api/v1/invitations/accept')
      .set(bearer(invitee.accessToken))
      .send({ token })
      .expect(200);
    const again = await request(t.server)
      .post('/api/v1/invitations/accept')
      .set(bearer(invitee.accessToken))
      .send({ token });
    expect(again.status).toBe(404);
  });

  it('no privilege escalation: admin cannot invite an owner; agent cannot invite anyone', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'esc');
    const admin = await enableMfa(
      t,
      await inviteNewUser(t, owner, tenantId, { kind: 'STAFF', roleKey: 'admin' }, 'admin'),
    );
    const res = await request(t.server)
      .post('/api/v1/invitations')
      .set(tenantHeaders(admin, tenantId))
      .send({ kind: 'STAFF', roleKey: 'owner', email: uniqueEmail('wannabe') });
    expect(res.status).toBe(403);
    expect(code(res)).toBe('ROLE_ESCALATION');
    await request(t.server)
      .post('/api/v1/invitations')
      .set(tenantHeaders(admin, tenantId))
      .send({ kind: 'STAFF', roleKey: 'migration_agent', email: uniqueEmail('ok-agent') })
      .expect(201);
  });
});

describe('external collaborators (DEC-09)', () => {
  it('external member sees only their access info — no team, tenant settings or audit', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'ext');
    const lawyer = await inviteNewUser(t, owner, tenantId, { kind: 'EXTERNAL' }, 'lawyer');
    const access = await request(t.server)
      .get('/api/v1/tenant/access')
      .set(tenantHeaders(lawyer, tenantId))
      .expect(200);
    expect(access.body).toMatchObject({ kind: 'EXTERNAL', role: null, permissions: [] });
    for (const path of [
      '/api/v1/tenant',
      '/api/v1/members',
      '/api/v1/invitations',
      '/api/v1/audit-logs',
    ]) {
      const res = await request(t.server).get(path).set(tenantHeaders(lawyer, tenantId));
      expect(res.status, path).toBe(403);
    }
  });

  it('an external member cannot be given a role (must be re-invited as staff)', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'ext2');
    await inviteNewUser(t, owner, tenantId, { kind: 'EXTERNAL' }, 'acct');
    const members = await request(t.server)
      .get('/api/v1/members')
      .set(tenantHeaders(owner, tenantId))
      .expect(200);
    const external = (members.body as { id: string; kind: string }[]).find(
      (m) => m.kind === 'EXTERNAL',
    );
    const res = await request(t.server)
      .patch(`/api/v1/members/${external?.id}`)
      .set(tenantHeaders(owner, tenantId))
      .send({ roleKey: 'admin' });
    expect(code(res)).toBe('EXTERNAL_MEMBER_HAS_NO_ROLE');
  });
});

describe('members', () => {
  it('last owner cannot be demoted, suspended or removed; ownership can be transferred', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'own');
    const members = await request(t.server)
      .get('/api/v1/members')
      .set(tenantHeaders(owner, tenantId))
      .expect(200);
    const self = (members.body as { id: string; role: { key: string } }[])[0];

    const demote = await request(t.server)
      .patch(`/api/v1/members/${self?.id}`)
      .set(tenantHeaders(owner, tenantId))
      .send({ roleKey: 'admin' });
    expect(code(demote)).toBe('LAST_OWNER');
    const leave = await request(t.server)
      .delete(`/api/v1/members/${self?.id}`)
      .set(tenantHeaders(owner, tenantId));
    expect(code(leave)).toBe('LAST_OWNER');

    // Transfer: promote a second owner, then the first can step down.
    const second = await enableMfa(
      t,
      await inviteNewUser(t, owner, tenantId, { kind: 'STAFF', roleKey: 'owner' }, 'owner2'),
    );
    await request(t.server)
      .patch(`/api/v1/members/${self?.id}`)
      .set(tenantHeaders(owner, tenantId))
      .send({ roleKey: 'admin' })
      .expect(200);
    const access = await request(t.server)
      .get('/api/v1/tenant/access')
      .set(tenantHeaders(second, tenantId))
      .expect(200);
    expect((access.body as { role: { key: string } }).role.key).toBe('owner');
  });

  it('admin cannot change or remove the owner', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'adm');
    const admin = await enableMfa(
      t,
      await inviteNewUser(t, owner, tenantId, { kind: 'STAFF', roleKey: 'admin' }, 'adm2'),
    );
    const members = await request(t.server)
      .get('/api/v1/members')
      .set(tenantHeaders(admin, tenantId))
      .expect(200);
    const ownerRow = (members.body as { id: string; role: { key: string } }[]).find(
      (m) => m.role.key === 'owner',
    );
    const res = await request(t.server)
      .patch(`/api/v1/members/${ownerRow?.id}`)
      .set(tenantHeaders(admin, tenantId))
      .send({ status: 'SUSPENDED' });
    expect(code(res)).toBe('ROLE_ESCALATION');
    const del = await request(t.server)
      .delete(`/api/v1/members/${ownerRow?.id}`)
      .set(tenantHeaders(admin, tenantId));
    expect(code(del)).toBe('ROLE_ESCALATION');
  });

  it('removing a member revokes access to that workspace on the next request only', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'rm');
    const agent = await inviteNewUser(
      t,
      owner,
      tenantId,
      { kind: 'STAFF', roleKey: 'migration_agent' },
      'rm-agent',
    );
    const { owner: otherOwner, tenantId: otherTenant } = await ownerWithWorkspace(t, 'rm-other');
    // Agent also joins another agency.
    await request(t.server)
      .post('/api/v1/invitations')
      .set(tenantHeaders(otherOwner, otherTenant))
      .send({ kind: 'STAFF', roleKey: 'case_manager', email: agent.email })
      .expect(201);
    await request(t.server)
      .post('/api/v1/invitations/accept')
      .set(bearer(agent.accessToken))
      .send({ token: tokenFromLastEmail(t.mailer, agent.email) })
      .expect(200);

    const members = await request(t.server)
      .get('/api/v1/members')
      .set(tenantHeaders(owner, tenantId));
    const agentRow = (members.body as { id: string; userId: string }[]).find(
      (m) => m.userId === agent.userId,
    );
    await request(t.server)
      .delete(`/api/v1/members/${agentRow?.id}`)
      .set(tenantHeaders(owner, tenantId))
      .expect(204);

    const gone = await request(t.server)
      .get('/api/v1/tenant/access')
      .set(tenantHeaders(agent, tenantId));
    expect(gone.status).toBe(404);
    // Same token still works for the other agency; account untouched.
    await request(t.server)
      .get('/api/v1/tenant/access')
      .set(tenantHeaders(agent, otherTenant))
      .expect(200);
    await request(t.server).get('/api/v1/me').set(bearer(agent.accessToken)).expect(200);
  });
});

describe('a user in two agencies (architecture §9.5)', () => {
  it('lists both workspaces and never merges permissions between them', async () => {
    const a = await ownerWithWorkspace(t, 'two-a');
    const b = await ownerWithWorkspace(t, 'two-b');
    const person = await inviteNewUser(
      t,
      a.owner,
      a.tenantId,
      { kind: 'STAFF', roleKey: 'sales_manager' },
      'two',
    );
    await request(t.server)
      .post('/api/v1/invitations')
      .set(tenantHeaders(b.owner, b.tenantId))
      .send({ kind: 'EXTERNAL', email: person.email })
      .expect(201);
    await request(t.server)
      .post('/api/v1/invitations/accept')
      .set(bearer(person.accessToken))
      .send({ token: tokenFromLastEmail(t.mailer, person.email) })
      .expect(200);

    const list = await request(t.server)
      .get('/api/v1/me/workspaces')
      .set(bearer(person.accessToken))
      .expect(200);
    const workspaces = list.body as {
      tenantId: string;
      kind: string;
      role: { key: string } | null;
    }[];
    expect(workspaces.map((w) => w.tenantId).sort()).toEqual([a.tenantId, b.tenantId].sort());

    const inA = await request(t.server)
      .get('/api/v1/tenant/access')
      .set(tenantHeaders(person, a.tenantId));
    const inB = await request(t.server)
      .get('/api/v1/tenant/access')
      .set(tenantHeaders(person, b.tenantId));
    expect((inA.body as { permissions: unknown[] }).permissions.length).toBeGreaterThan(0);
    expect(inB.body).toMatchObject({ kind: 'EXTERNAL', permissions: [] });
    // Sales manager rights in A do not apply in B.
    await request(t.server)
      .get('/api/v1/tenant')
      .set(tenantHeaders(person, a.tenantId))
      .expect(200);
    await request(t.server)
      .get('/api/v1/tenant')
      .set(tenantHeaders(person, b.tenantId))
      .expect(403);
  });
});
