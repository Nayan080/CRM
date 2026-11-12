/**
 * Real S3 API round trip. Runs only when S3_TEST_ENDPOINT is set, e.g. the local S3Proxy:
 *   S3_TEST_ENDPOINT=http://localhost:9000 pnpm test:integration
 * Otherwise it is skipped (unit/integration runs use the in-memory store).
 */
import { randomUUID } from 'node:crypto';
import { text } from 'node:stream/consumers';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { S3ObjectStorage } from '../src/infra/storage/storage.js';
import { ownerWithWorkspace, tenantHeaders } from './helpers/flows.js';
import { type TestApp, createTestApp } from './helpers/test-app.js';

const endpoint = process.env.S3_TEST_ENDPOINT;
const bucket = `crm-test-${randomUUID().slice(0, 8)}`;
const s3Env = {
  STORAGE_DRIVER: 's3',
  S3_ENDPOINT: endpoint ?? '',
  S3_BUCKET: bucket,
  S3_REGION: 'ap-southeast-2',
  S3_ACCESS_KEY_ID: process.env.S3_TEST_ACCESS_KEY_ID ?? 'local-identity',
  S3_SECRET_ACCESS_KEY: process.env.S3_TEST_SECRET_ACCESS_KEY ?? 'local-credential',
  S3_FORCE_PATH_STYLE: 'true',
  S3_CREATE_BUCKET: 'true',
};

describe.skipIf(!endpoint)('S3 storage driver (real S3 API)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp(s3Env);
  });
  afterAll(async () => {
    await t?.close();
  });

  it('creates the bucket, stores and reads back an object', async () => {
    const storage = new S3ObjectStorage({
      driver: 's3',
      endpoint,
      region: 'ap-southeast-2',
      bucket,
      accessKeyId: s3Env.S3_ACCESS_KEY_ID,
      secretAccessKey: s3Env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: true,
      sse: undefined,
      createBucket: true,
    });
    await storage.ensureReady();
    await storage.put('probe/key', Buffer.from('hello'), 'text/plain');
    expect(await text(await storage.get('probe/key'))).toBe('hello');
    await expect(storage.get('probe/missing')).rejects.toThrow();
  });

  it('upload and download through the API use the S3 store', async () => {
    const { owner, tenantId } = await ownerWithWorkspace(t, 's3-flow');
    const h = tenantHeaders(owner, tenantId);
    const client = await request(t.server)
      .post('/api/v1/clients')
      .set(h)
      .send({ kind: 'INDIVIDUAL', displayName: 'S3 Client' })
      .expect(201);
    const pdf = Buffer.from('%PDF-1.7\ns3 round trip\n%%EOF\n');
    const up = await request(t.server)
      .post('/api/v1/documents')
      .set(h)
      .field('clientId', (client.body as { id: string }).id)
      .attach('file', pdf, 's3.pdf')
      .expect(201);
    const dl = await request(t.server)
      .get(`/api/v1/documents/${(up.body as { id: string }).id}/download`)
      .set(h)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(Buffer.compare(dl.body as Buffer, pdf)).toBe(0);
  });
});
