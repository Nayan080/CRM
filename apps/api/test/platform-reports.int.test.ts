import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type SignedInUser,
  inviteNewUser,
  ownerWithWorkspace,
  signUp,
  tenantHeaders,
  bearer,
} from './helpers/flows.js';
import { type TestApp, createTestApp, testDatabaseUrl, uniqueEmail } from './helpers/test-app.js';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../dist/cli/platform-role.js', import.meta.url));

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

/** Runs the real server command (as an operator would). NODE_ENV=production skips the local .env. */
async function platformRole(
  action: 'grant' | 'revoke',
  email: string,
  role: 'SUPER_ADMIN' | 'SUPPORT',
) {
  const { stdout } = await run('node', [CLI, action, email, role], {
    env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: testDatabaseUrl },
  });
  return stdout;
}

function platform(user: SignedInUser) {
  const h = bearer(user.accessToken);
  return {
    get: (p: string) => request(t.server).get(`/api/v1/platform${p}`).set(h),
    patch: (p: string, b: Body) => request(t.server).patch(`/api/v1/platform${p}`).set(h).send(b),
    post: (p: string, b: Body) => request(t.server).post(`/api/v1/platform${p}`).set(h).send(b),
  };
}

function as(user: SignedInUser, tenantId: string) {
  const h = tenantHeaders(user, tenantId);
  return {
    get: (p: string) => request(t.server).get(p).set(h),
    post: (p: string, b: Body = {}) => request(t.server).post(p).set(h).send(b),
    patch: (p: string, b: Body) => request(t.server).patch(p).set(h).send(b),
  };
}

describe('platform administration', () => {
  let admin: SignedInUser;
  beforeAll(async () => {
    const a = await ownerWithWorkspace(t, 'plat-admin');
    admin = a.owner;
    const out = await platformRole('grant', admin.email, 'SUPER_ADMIN');
    expect(out).toContain('Granted SUPER_ADMIN');
  });

  it('platform routes are invisible to normal users; registration never grants a platform role', async () => {
    const { owner } = await ownerWithWorkspace(t, 'plat-normal');
    const res = await platform(owner).get('/tenants');
    expect(res.status).toBe(404);
    const me = await request(t.server).get('/api/v1/me').set(bearer(owner.accessToken)).expect(200);
    expect((me.body as { platformRoles: string[] }).platformRoles).toEqual([]);
    const adminMe = await request(t.server)
      .get('/api/v1/me')
      .set(bearer(admin.accessToken))
      .expect(200);
    expect((adminMe.body as { platformRoles: string[] }).platformRoles).toEqual(['SUPER_ADMIN']);
  });

  it('a platform role without two-factor cannot be used', async () => {
    const user = await signUp(t, 'plat-nomfa');
    await platformRole('grant', user.email, 'SUPPORT');
    expect(code(await platform(user).get('/tenants'))).toBe('MFA_SETUP_REQUIRED');
  });

  it('lists agencies with metadata and usage only — never client data', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'plat-meta');
    await as(owner, tenantId)
      .post('/api/v1/clients', { kind: 'INDIVIDUAL', displayName: 'Secret Client Person' })
      .expect(201);
    await inviteNewUser(t, owner, tenantId, { kind: 'EXTERNAL' }, 'plat-ext');
    const res = await platform(admin).get(`/tenants/${tenantId}`).expect(200);
    expect(res.body).toMatchObject({
      id: tenantId,
      status: 'ACTIVE',
      plan: null,
      usage: { staffUsers: 1, externalUsers: 1 },
    });
    const list = await platform(admin).get('/tenants?limit=100').expect(200);
    expect(JSON.stringify(list.body)).not.toContain('Secret Client Person');
    // Platform admins are not members: agency data stays closed to them.
    const asTenant = await request(t.server)
      .get('/api/v1/clients')
      .set(tenantHeaders(admin, tenantId));
    expect(asTenant.status).toBe(404);
  });

  it('suspending blocks the agency at once with a clear reason; re-activating restores it; both are audited', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'plat-susp');
    const api = as(owner, tenantId);
    await api.get('/api/v1/clients').expect(200);
    expect(
      (await platform(admin).patch(`/tenants/${tenantId}`, { status: 'SUSPENDED' })).status,
    ).toBe(400);
    await platform(admin)
      .patch(`/tenants/${tenantId}`, { status: 'SUSPENDED', reason: 'Unpaid invoice' })
      .expect(200);
    const blocked = await api.get('/api/v1/clients');
    expect(blocked.status).toBe(403);
    expect(code(blocked)).toBe('WORKSPACE_SUSPENDED');
    const ws = await request(t.server)
      .get('/api/v1/me/workspaces')
      .set(bearer(owner.accessToken))
      .expect(200);
    expect(ws.body).toMatchObject([{ tenantId, status: 'SUSPENDED' }]);
    // Strangers still get a plain 404 (no hint that the workspace exists).
    const { owner: stranger } = await ownerWithWorkspace(t, 'plat-stranger');
    expect(
      code(await request(t.server).get('/api/v1/clients').set(tenantHeaders(stranger, tenantId))),
    ).toBe('WORKSPACE_NOT_FOUND');
    await platform(admin)
      .patch(`/tenants/${tenantId}`, { status: 'ACTIVE', reason: 'Paid' })
      .expect(200);
    await api.get('/api/v1/clients').expect(200);
    const audit = await api.get('/api/v1/audit-logs?limit=50').expect(200);
    expect(JSON.stringify(audit.body).match(/platform\.tenant_status_changed/g)).toHaveLength(2);
  });

  it('support staff can look but not change', async () => {
    const { owner: support } = await ownerWithWorkspace(t, 'plat-support');
    await platformRole('grant', support.email, 'SUPPORT');
    const { tenantId } = await ownerWithWorkspace(t, 'plat-sup-target');
    await platform(support).get(`/tenants/${tenantId}`).expect(200);
    const res = await platform(support).patch(`/tenants/${tenantId}`, {
      status: 'SUSPENDED',
      reason: 'x',
    });
    expect(res.status).toBe(403);
    await platformRole('revoke', support.email, 'SUPPORT');
    expect((await platform(support).get('/tenants')).status).toBe(404);
  });

  it('plan staff limit: pending invitations count, externals do not, reactivation is checked', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'plat-plan');
    const api = as(owner, tenantId);
    const plan = await platform(admin)
      .post('/plans', { key: `two-${Date.now()}`, name: 'Two seats', maxStaffUsers: 2 })
      .expect(201);
    await platform(admin)
      .patch(`/tenants/${tenantId}`, { planId: idOf(plan) })
      .expect(200);
    const staff = await inviteNewUser(
      t,
      owner,
      tenantId,
      { kind: 'STAFF', roleKey: 'case_manager' },
      'pp-staff',
    );
    const third = await api.post('/api/v1/invitations', {
      kind: 'STAFF',
      roleKey: 'receptionist',
      email: uniqueEmail('pp-3'),
    });
    expect(third.status).toBe(409);
    expect(code(third)).toBe('PLAN_LIMIT_REACHED');
    await api
      .post('/api/v1/invitations', { kind: 'EXTERNAL', email: uniqueEmail('pp-ext') })
      .expect(201);

    const members = await api.get('/api/v1/members').expect(200);
    const staffId = (members.body as { id: string; userId: string }[]).find(
      (m) => m.userId === staff.userId,
    )!.id;
    await api.patch(`/api/v1/members/${staffId}`, { status: 'SUSPENDED' }).expect(200);
    const pending = await api.post('/api/v1/invitations', {
      kind: 'STAFF',
      roleKey: 'receptionist',
      email: uniqueEmail('pp-4'),
    });
    expect(pending.status).toBe(201); // seat freed by the suspension, now reserved by this invitation
    expect(code(await api.patch(`/api/v1/members/${staffId}`, { status: 'ACTIVE' }))).toBe(
      'PLAN_LIMIT_REACHED',
    );

    const detail = await platform(admin).get(`/tenants/${tenantId}`).expect(200);
    expect(detail.body).toMatchObject({
      plan: { maxStaffUsers: 2 },
      usage: { staffUsers: 1, pendingStaffInvites: 1, externalUsers: 0 },
    });
    const plans = await platform(admin).get('/plans').expect(200);
    expect(
      (plans.body as { id: string; tenantCount: number }[]).find((p) => p.id === idOf(plan))
        ?.tenantCount,
    ).toBe(1);
  });
});

describe('reports', () => {
  it('leads & referrals: totals, conversion, sources, partners, months', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'rep-leads');
    const api = as(owner, tenantId);
    const sources = await api.get('/api/v1/reference-options?category=LEAD_SOURCE').expect(200);
    const referral = (sources.body as { id: string; key: string }[]).find(
      (s) => s.key === 'referral',
    )!.id;
    const types = await api.get('/api/v1/reference-options?category=PARTNER_TYPE').expect(200);
    const partner = idOf(
      await api
        .post('/api/v1/partners', {
          name: 'Harbour Accounting',
          typeId: (types.body as { id: string }[])[0]!.id,
        })
        .expect(201),
    );
    const l1 = idOf(
      await api
        .post('/api/v1/leads', { fullName: 'A', sourceId: referral, referredByPartnerId: partner })
        .expect(201),
    );
    await api.post('/api/v1/leads', { fullName: 'B', sourceId: referral }).expect(201);
    await api.post('/api/v1/leads', { fullName: 'C' }).expect(201);
    await api
      .post(`/api/v1/leads/${l1}/convert`, {
        mode: 'new',
        client: { kind: 'INDIVIDUAL', displayName: 'A' },
      })
      .expect(200);
    const r = await api.get('/api/v1/reports/leads').expect(200);
    expect(r.body).toMatchObject({
      totals: { created: 3, converted: 1, open: 2, lost: 0, conversionRate: 33.3 },
      byPartner: [
        { partner: { id: partner, name: 'Harbour Accounting' }, created: 1, converted: 1 },
      ],
    });
    const body = r.body as {
      bySource: { source: { name: string } | null; created: number; converted: number }[];
      byMonth: { month: string; created: number }[];
      medianDaysToConvert: number;
    };
    expect(body.bySource).toEqual([
      {
        source: expect.objectContaining({ name: 'Referral' }) as unknown,
        created: 2,
        converted: 1,
      },
      { source: null, created: 1, converted: 0 },
    ]);
    expect(body.byMonth.at(-1)).toMatchObject({
      month: new Date().toISOString().slice(0, 7),
      created: 3,
    });
    expect(body.medianDaysToConvert).toBe(0);
    expect((await api.get('/api/v1/reports/leads?from=2026-02-01&to=2025-01-01')).status).toBe(400);
  });

  it('matters, workload and documents; scope and permissions apply', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 'rep-matters');
    const api = as(owner, tenantId);
    const north = idOf(await api.post('/api/v1/branches', { name: 'North' }).expect(201));
    const south = idOf(await api.post('/api/v1/branches', { name: 'South' }).expect(201));
    const types = (await api.get('/api/v1/matter-types').expect(200)).body as {
      id: string;
      name: string;
    }[];
    const mk = async (branchId: string, title: string) => {
      const client = idOf(
        await api
          .post('/api/v1/clients', { kind: 'INDIVIDUAL', displayName: title, branchId })
          .expect(201),
      );
      return idOf(
        await api
          .post('/api/v1/matters', { clientId: client, matterTypeId: types[0]!.id, title })
          .expect(201),
      );
    };
    const m1 = await mk(north, 'North matter');
    await mk(south, 'South matter');
    const closed = await mk(north, 'Closed matter');
    await api.post(`/api/v1/matters/${closed}/transition`, { status: 'CLOSED' }).expect(200);
    await api
      .post(`/api/v1/matters/${m1}/deadlines`, {
        title: 'Late',
        dueAt: new Date(Date.now() - 86_400_000).toISOString(),
      })
      .expect(201);
    await api
      .post(`/api/v1/matters/${m1}/deadlines`, {
        title: 'Soon',
        dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      })
      .expect(201);
    await api
      .post('/api/v1/tasks', {
        title: 'Overdue task',
        dueAt: new Date(Date.now() - 3_600_000).toISOString(),
      })
      .expect(201);

    const r = await api.get('/api/v1/reports/matters').expect(200);
    expect(r.body).toMatchObject({
      byStatus: { OPEN: 2, CLOSED: 1, ON_HOLD: 0, ARCHIVED: 0 },
      openByType: [{ type: { name: types[0]!.name }, count: 2 }],
      ageing: [{ label: '0–30 days', count: 2 }, { count: 0 }, { count: 0 }, { count: 0 }],
      openedInPeriod: 3,
      closedInPeriod: 1,
      overdueDeadlines: { count: 1, items: [{ matterId: m1, deadline: 'Late' }] },
    });
    const northOnly = await api.get(`/api/v1/reports/matters?branchId=${north}`).expect(200);
    expect((northOnly.body as { byStatus: { OPEN: number } }).byStatus.OPEN).toBe(1);

    const w = await api.get('/api/v1/reports/workload').expect(200);
    expect(w.body).toMatchObject({
      rows: [{ openMatters: 3 - 1, openTasks: 1, overdueTasks: 1, deadlinesNext14Days: 1 }],
    });

    // Branch manager: own branch only; no audit access → no documents report.
    const bm = await inviteNewUser(
      t,
      owner,
      tenantId,
      { kind: 'STAFF', roleKey: 'branch_manager' },
      'rep-bm',
    );
    const members = (await api.get('/api/v1/members').expect(200)).body as {
      id: string;
      userId: string;
    }[];
    await api
      .patch(`/api/v1/members/${members.find((m) => m.userId === bm.userId)!.id}`, {
        branchIds: [north],
      })
      .expect(200);
    const bApi = as(bm, tenantId);
    const bmReport = await bApi.get('/api/v1/reports/matters').expect(200);
    expect(
      (bmReport.body as { byStatus: { OPEN: number; CLOSED: number } }).byStatus,
    ).toMatchObject({ OPEN: 1, CLOSED: 1 });
    expect(JSON.stringify(bmReport.body)).not.toContain('South');
    expect((await bApi.get('/api/v1/reports/documents')).status).toBe(403);
    // Agents have no report access at all.
    const agent = await inviteNewUser(
      t,
      owner,
      tenantId,
      { kind: 'STAFF', roleKey: 'migration_agent' },
      'rep-agent',
    );
    expect((await as(agent, tenantId).get('/api/v1/reports/matters')).status).toBe(403);

    const pdf = Buffer.from('%PDF-1.7\n%%EOF\n');
    const up = await request(t.server)
      .post('/api/v1/documents')
      .set(tenantHeaders(owner, tenantId))
      .field('matterId', m1)
      .attach('file', pdf, 'a.pdf')
      .expect(201);
    await request(t.server)
      .get(`/api/v1/documents/${idOf(up)}/download`)
      .set(tenantHeaders(owner, tenantId))
      .expect(200);
    const d = await api.get('/api/v1/reports/documents').expect(200);
    expect(d.body).toMatchObject({
      uploads: 1,
      downloads: 1,
      downloadsViaShare: 0,
      activeShares: 0,
      topDownloaded: [{ document: { id: idOf(up) }, downloads: 1 }],
    });
  });
});
