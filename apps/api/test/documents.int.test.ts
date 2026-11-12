import { createPrismaClient } from '@crm/db';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OBJECT_STORAGE, type MemoryObjectStorage } from '../src/infra/storage/storage.js';
import {
  type SignedInUser,
  inviteNewUser,
  ownerWithWorkspace,
  tenantHeaders,
} from './helpers/flows.js';
import { type TestApp, createTestApp, testDatabaseUrl } from './helpers/test-app.js';

let t: TestApp;
let storage: MemoryObjectStorage;
const db = createPrismaClient({ connectionString: testDatabaseUrl });

beforeAll(async () => {
  t = await createTestApp();
  storage = t.app.get<MemoryObjectStorage>(OBJECT_STORAGE);
});
afterAll(async () => {
  await t.close();
  await db.$disconnect();
});

type Body = Record<string, unknown>;
const code = (res: request.Response) => (res.body as { code?: string }).code;
const idOf = (res: request.Response) => (res.body as { id: string }).id;

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
const PDF2 = Buffer.from('%PDF-1.7\n% version two\n%%EOF\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function as(user: SignedInUser, tenantId: string) {
  const h = tenantHeaders(user, tenantId);
  const binary = (req: request.Test) =>
    req.buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  return {
    get: (p: string) => request(t.server).get(p).set(h),
    post: (p: string, b: Body = {}) => request(t.server).post(p).set(h).send(b),
    patch: (p: string, b: Body) => request(t.server).patch(p).set(h).send(b),
    del: (p: string) => request(t.server).delete(p).set(h),
    file: (p: string) => binary(request(t.server).get(p).set(h)),
    upload: (
      fields: Record<string, string>,
      file?: { body: Buffer; name: string },
      path = '/api/v1/documents',
    ) => {
      let req = request(t.server).post(path).set(h);
      for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
      return file ? req.attach('file', file.body, file.name) : req;
    },
  };
}
type Api = ReturnType<typeof as>;

async function memberId(api: Api, userId: string) {
  const res = await api.get('/api/v1/members').expect(200);
  return (res.body as { id: string; userId: string }[]).find((x) => x.userId === userId)?.id ?? '';
}

async function setup(label: string) {
  const { owner, tenantId } = await ownerWithWorkspace(t, label);
  const api = as(owner, tenantId);
  const types = await api.get('/api/v1/matter-types').expect(200);
  const client = idOf(
    await api
      .post('/api/v1/clients', {
        kind: 'INDIVIDUAL',
        displayName: 'Mei Chen',
        email: 'mei@example.test',
        phone: '0400 000 000',
      })
      .expect(201),
  );
  const matter = await api
    .post('/api/v1/matters', {
      clientId: client,
      matterTypeId: (types.body as { id: string }[])[0]!.id,
      title: 'Partner visa',
    })
    .expect(201);
  return {
    owner,
    tenantId,
    api,
    client,
    matterId: idOf(matter),
    matter: matter.body as { checklist: { id: string }[] },
  };
}

async function external(owner: SignedInUser, tenantId: string, api: Api, label: string) {
  const user = await inviteNewUser(t, owner, tenantId, { kind: 'EXTERNAL' }, label);
  return { user, memberId: await memberId(api, user.userId), api: as(user, tenantId) };
}

describe('upload and download', () => {
  it('stores the file privately, detects its type, versions it and audits every download', async () => {
    const { api, matterId, client } = await setup('doc-up');
    const before = storage.objects.size;
    const up = await api
      .upload({ matterId, title: 'Passport' }, { body: PDF, name: 'passport.pdf' })
      .expect(201);
    expect(up.body).toMatchObject({
      title: 'Passport',
      client: { id: client },
      matter: { id: matterId },
      latest: {
        versionNumber: 1,
        fileName: 'passport.pdf',
        mimeType: 'application/pdf',
        sizeBytes: PDF.length,
        scanStatus: 'NOT_SCANNED',
      },
    });
    expect(storage.objects.size).toBe(before + 1);
    const [key] = [...storage.objects.keys()].slice(-1);
    expect(key).not.toContain('passport');

    const dl = await api.file(`/api/v1/documents/${idOf(up)}/download`).expect(200);
    expect(Buffer.compare(dl.body as Buffer, PDF)).toBe(0);
    expect(dl.headers['content-type']).toBe('application/pdf');
    expect(dl.headers['content-disposition']).toContain('attachment; filename="passport.pdf"');
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(dl.headers['cache-control']).toBe('private, no-store');
    expect(dl.headers['content-security-policy']).toContain('sandbox');

    const v2 = await api
      .upload(
        {},
        { body: PDF2, name: 'passport-renewed.pdf' },
        `/api/v1/documents/${idOf(up)}/versions`,
      )
      .expect(201);
    const versions = (v2.body as { versions: { id: string; versionNumber: number }[] }).versions;
    expect(versions.map((v) => v.versionNumber)).toEqual([2, 1]);
    const latest = await api.file(`/api/v1/documents/${idOf(up)}/download`).expect(200);
    expect(Buffer.compare(latest.body as Buffer, PDF2)).toBe(0);
    const old = await api
      .file(`/api/v1/documents/${idOf(up)}/versions/${versions[1]!.id}/download`)
      .expect(200);
    expect(Buffer.compare(old.body as Buffer, PDF)).toBe(0);

    const audit = await api.get('/api/v1/audit-logs?limit=100').expect(200);
    const actions = JSON.stringify(audit.body);
    expect(actions.match(/document\.downloaded/g)?.length).toBe(3);
    expect(actions).toContain('document.version_uploaded');

    const list = await api.get(`/api/v1/documents?matterId=${matterId}`).expect(200);
    expect((list.body as { data: { id: string }[] }).data.map((d) => d.id)).toEqual([idOf(up)]);
    const byClient = await api.get(`/api/v1/documents?clientId=${client}`).expect(200);
    expect((byClient.body as { data: unknown[] }).data).toHaveLength(1);
  });

  it('rejects files by content, extension, size and missing file — nothing is stored', async () => {
    const { api, client } = await setup('doc-rej');
    const before = storage.objects.size;
    for (const file of [
      { body: Buffer.from('<html><script>alert(1)</script></html>'), name: 'evil.pdf' },
      { body: PDF, name: 'passport.png' },
      { body: Buffer.from('MZ\x90\x00binary'), name: 'tool.exe' },
    ]) {
      const res = await api.upload({ clientId: client }, file);
      expect(res.status, file.name).toBe(400);
      expect(code(res)).toBe('FILE_REJECTED');
    }
    expect(code(await api.upload({ clientId: client }))).toBe('FILE_REJECTED');
    const big = await api.upload(
      { clientId: client },
      { body: Buffer.concat([PDF, Buffer.alloc(20 * 1024 * 1024)]), name: 'big.pdf' },
    );
    expect(big.status).toBe(413);
    expect(storage.objects.size).toBe(before);
    // A PNG uploads fine at client level.
    await api.upload({ clientId: client }, { body: PNG, name: 'photo.png' }).expect(201);
  });

  it('files can be linked to checklist items and categories; deleting hides them everywhere', async () => {
    const { api, matterId } = await setup('doc-meta');
    const detail = await api
      .post(`/api/v1/matters/${matterId}/checklist`, { title: 'Passport copy' })
      .expect(201);
    const item = (detail.body as { checklist: { id: string }[] }).checklist[0]!.id;
    const cats = await api.get('/api/v1/reference-options?category=DOCUMENT_CATEGORY').expect(200);
    const identity = (cats.body as { id: string; key: string }[]).find(
      (c) => c.key === 'identity',
    )!.id;
    const up = await api
      .upload(
        { matterId, categoryId: identity, checklistItemId: item },
        { body: PDF, name: 'p.pdf' },
      )
      .expect(201);
    expect(up.body).toMatchObject({ category: { name: 'Identity' }, checklistItem: { id: item } });
    await api.del(`/api/v1/matters/${matterId}/checklist/${item}`).expect(200);
    const after = await api.get(`/api/v1/documents/${idOf(up)}`).expect(200);
    expect((after.body as { checklistItem: unknown }).checklistItem).toBeNull();

    await api.del(`/api/v1/documents/${idOf(up)}`).expect(204);
    await api.get(`/api/v1/documents/${idOf(up)}`).expect(404);
    await api.file(`/api/v1/documents/${idOf(up)}/download`).expect(404);
  });

  it('archived matters take no new documents', async () => {
    const { api, matterId } = await setup('doc-arch');
    await api.post(`/api/v1/matters/${matterId}/transition`, { status: 'CLOSED' }).expect(200);
    await api.post(`/api/v1/matters/${matterId}/transition`, { status: 'ARCHIVED' }).expect(200);
    expect(code(await api.upload({ matterId }, { body: PDF, name: 'late.pdf' }))).toBe(
      'MATTER_ARCHIVED',
    );
  });
});

describe('document scope', () => {
  it('agents see documents on their matters only; receptionists can upload but not read or download', async () => {
    const { owner, tenantId, api, matterId, client } = await setup('doc-scope');
    const types = await api.get('/api/v1/matter-types').expect(200);
    const agent = await inviteNewUser(
      t,
      owner,
      tenantId,
      { kind: 'STAFF', roleKey: 'migration_agent' },
      'ds-agent',
    );
    const rec = await inviteNewUser(
      t,
      owner,
      tenantId,
      { kind: 'STAFF', roleKey: 'receptionist' },
      'ds-rec',
    );
    const aApi = as(agent, tenantId);
    const rApi = as(rec, tenantId);
    const other = idOf(
      await api
        .post('/api/v1/matters', {
          clientId: client,
          matterTypeId: (types.body as { id: string }[])[0]!.id,
          title: 'Other',
          assigneeMembershipIds: [await memberId(api, agent.userId)],
        })
        .expect(201),
    );
    const hidden = await api.upload({ matterId }, { body: PDF, name: 'hidden.pdf' }).expect(201);
    const visible = await api
      .upload({ matterId: other }, { body: PDF, name: 'visible.pdf' })
      .expect(201);

    await aApi.get(`/api/v1/documents/${idOf(visible)}`).expect(200);
    await aApi.file(`/api/v1/documents/${idOf(visible)}/download`).expect(200);
    await aApi.get(`/api/v1/documents/${idOf(hidden)}`).expect(404);
    await aApi.file(`/api/v1/documents/${idOf(hidden)}/download`).expect(404);
    await aApi.get(`/api/v1/documents?matterId=${matterId}`).expect(404);
    expect(code(await aApi.upload({ matterId }, { body: PDF, name: 'x.pdf' }))).toBe(
      'INVALID_REFERENCE',
    );

    await rApi.upload({ clientId: client }, { body: PDF, name: 'front-desk.pdf' }).expect(201);
    expect((await rApi.get(`/api/v1/documents?clientId=${client}`)).status).toBe(403);
    expect((await rApi.file(`/api/v1/documents/${idOf(visible)}/download`)).status).toBe(403);
  });
});

describe('consents (DEC-14: optional for sharing)', () => {
  it('records and withdraws consent on a client', async () => {
    const { api, client } = await setup('consent');
    const c = await api
      .post('/api/v1/consents', {
        clientId: client,
        purpose: 'Share documents with external lawyer',
        recipient: 'Harbour Legal',
        method: 'WRITTEN',
        givenAt: new Date().toISOString(),
      })
      .expect(201);
    const withdrawn = await api.post(`/api/v1/consents/${idOf(c)}/withdraw`).expect(200);
    expect((withdrawn.body as { withdrawnAt: string | null }).withdrawnAt).not.toBeNull();
    const list = await api.get(`/api/v1/consents?clientId=${client}`).expect(200);
    expect(list.body).toHaveLength(1);
  });
});

describe('external sharing (DEC-09)', () => {
  it('an external member sees only the shared matter basics and the selected documents', async () => {
    const { owner, tenantId, api, matterId, client } = await setup('share');
    const shared = await api
      .upload({ matterId, title: 'Shared passport' }, { body: PDF, name: 'shared.pdf' })
      .expect(201);
    const notShared = await api
      .upload({ matterId, title: 'Bank statement' }, { body: PNG, name: 'bank.png' })
      .expect(201);
    const ext = await external(owner, tenantId, api, 'sh-ext');

    // Before any share: nothing, and no staff endpoints.
    expect((await ext.api.get('/api/v1/shared').expect(200)).body).toEqual([]);
    expect((await ext.api.get(`/api/v1/matters/${matterId}`)).status).toBe(403);
    expect((await ext.api.get(`/api/v1/documents?matterId=${matterId}`)).status).toBe(403);
    expect((await ext.api.get(`/api/v1/clients/${client}`)).status).toBe(403);

    // Consent is optional (DEC-14).
    const share = await api
      .post('/api/v1/shares', {
        matterId,
        granteeMembershipId: ext.memberId,
        documentIds: [idOf(shared)],
        purpose: 'Second opinion',
      })
      .expect(201);
    expect(share.body).toMatchObject({
      active: true,
      consent: null,
      documents: [{ id: idOf(shared) }],
    });
    const dup = await api.post('/api/v1/shares', { matterId, granteeMembershipId: ext.memberId });
    expect(code(dup)).toBe('ALREADY_SHARED');

    const list = await ext.api.get('/api/v1/shared').expect(200);
    expect(list.body).toMatchObject([
      {
        shareId: idOf(share),
        purpose: 'Second opinion',
        matter: { title: 'Partner visa', clientName: 'Mei Chen' },
        documents: [{ id: idOf(shared), title: 'Shared passport', fileName: 'shared.pdf' }],
      },
    ]);
    const text = JSON.stringify(list.body);
    expect(text).not.toContain('mei@example.test');
    expect(text).not.toContain('0400');
    expect(text).not.toContain('Bank statement');

    const base = `/api/v1/shared/${idOf(share)}/documents`;
    const file = await ext.api.file(`${base}/${idOf(shared)}/download`).expect(200);
    expect(Buffer.compare(file.body as Buffer, PDF)).toBe(0);
    await ext.api.file(`${base}/${idOf(notShared)}/download`).expect(404);

    const audit = await api.get('/api/v1/audit-logs?limit=100').expect(200);
    expect(JSON.stringify(audit.body)).toContain('"via":"share"');

    // Changing the document list applies immediately; revoking removes everything at once.
    await api
      .patch(`/api/v1/shares/${idOf(share)}`, { documentIds: [idOf(notShared)] })
      .expect(200);
    await ext.api.file(`${base}/${idOf(shared)}/download`).expect(404);
    await ext.api.file(`${base}/${idOf(notShared)}/download`).expect(200);
    await api.post(`/api/v1/shares/${idOf(share)}/revoke`).expect(200);
    expect((await ext.api.get('/api/v1/shared').expect(200)).body).toEqual([]);
    await ext.api.get(`/api/v1/shared/${idOf(share)}`).expect(404);
    await ext.api.file(`${base}/${idOf(notShared)}/download`).expect(404);
  });

  it('expired shares stop working; deleted documents leave the share; only external members can receive shares', async () => {
    const { owner, tenantId, api, matterId } = await setup('share-exp');
    const doc = await api.upload({ matterId }, { body: PDF, name: 'a.pdf' }).expect(201);
    const ext = await external(owner, tenantId, api, 'se-ext');
    const staff = await inviteNewUser(
      t,
      owner,
      tenantId,
      { kind: 'STAFF', roleKey: 'case_manager' },
      'se-staff',
    );
    const toStaff = await api.post('/api/v1/shares', {
      matterId,
      granteeMembershipId: await memberId(api, staff.userId),
    });
    expect(code(toStaff)).toBe('INVALID_REFERENCE');
    const past = await api.post('/api/v1/shares', {
      matterId,
      granteeMembershipId: ext.memberId,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(past.status).toBe(400);

    const share = await api
      .post('/api/v1/shares', {
        matterId,
        granteeMembershipId: ext.memberId,
        documentIds: [idOf(doc)],
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      })
      .expect(201);
    await ext.api.get(`/api/v1/shared/${idOf(share)}`).expect(200);

    await api.del(`/api/v1/documents/${idOf(doc)}`).expect(204);
    const after = await ext.api.get(`/api/v1/shared/${idOf(share)}`).expect(200);
    expect((after.body as { documents: unknown[] }).documents).toEqual([]);

    // Simulate time passing: move the expiry into the past directly in the database.
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await tx.$executeRaw`UPDATE resource_shares SET expires_at = now() - interval '1 minute' WHERE id = ${idOf(share)}::uuid`;
    });
    await ext.api.get(`/api/v1/shared/${idOf(share)}`).expect(404);
    expect((await ext.api.get('/api/v1/shared').expect(200)).body).toEqual([]);
    // An expired share no longer blocks a new one.
    await api.post('/api/v1/shares', { matterId, granteeMembershipId: ext.memberId }).expect(201);
  });

  it('a withdrawn consent or one from another client cannot be attached', async () => {
    const { owner, tenantId, api, matterId, client } = await setup('share-consent');
    const ext = await external(owner, tenantId, api, 'sc-ext');
    const otherClient = idOf(
      await api.post('/api/v1/clients', { kind: 'INDIVIDUAL', displayName: 'Other' }).expect(201),
    );
    const body = (clientId: string) => ({
      clientId,
      purpose: 'p',
      method: 'VERBAL',
      givenAt: new Date().toISOString(),
    });
    const withdrawn = idOf(await api.post('/api/v1/consents', body(client)).expect(201));
    await api.post(`/api/v1/consents/${withdrawn}/withdraw`).expect(200);
    const foreign = idOf(await api.post('/api/v1/consents', body(otherClient)).expect(201));
    const good = idOf(await api.post('/api/v1/consents', body(client)).expect(201));
    expect(
      code(
        await api.post('/api/v1/shares', {
          matterId,
          granteeMembershipId: ext.memberId,
          consentId: withdrawn,
        }),
      ),
    ).toBe('CONSENT_WITHDRAWN');
    expect(
      code(
        await api.post('/api/v1/shares', {
          matterId,
          granteeMembershipId: ext.memberId,
          consentId: foreign,
        }),
      ),
    ).toBe('INVALID_REFERENCE');
    const ok = await api
      .post('/api/v1/shares', { matterId, granteeMembershipId: ext.memberId, consentId: good })
      .expect(201);
    expect(ok.body).toMatchObject({ consent: { id: good, withdrawnAt: null } });
  });

  it('only people with share permission manage shares', async () => {
    const { owner, tenantId, api, matterId } = await setup('share-perm');
    const agent = await inviteNewUser(
      t,
      owner,
      tenantId,
      { kind: 'STAFF', roleKey: 'branch_manager' },
      'sp-bm',
    );
    const ext = await external(owner, tenantId, api, 'sp-ext');
    const res = await as(agent, tenantId).post('/api/v1/shares', {
      matterId,
      granteeMembershipId: ext.memberId,
    });
    expect(res.status).toBe(403);
  });
});
