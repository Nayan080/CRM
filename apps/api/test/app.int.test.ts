import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { problemDetailsSchema, readyResponseSchema } from '@crm/contracts';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap/configure-app.js';
import { parseConfig } from '../src/config/app-config.js';
import { bearer, signUp } from './helpers/flows.js';
import { baseTestEnv, createTestApp } from './helpers/test-app.js';

const baseEnv = baseTestEnv;

let app: NestExpressApplication | undefined;

async function createApp(overrides: Record<string, string> = {}): Promise<NestExpressApplication> {
  const config = parseConfig({ ...baseEnv, ...overrides });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(config)],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app, config);
  await app.init();
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('health', () => {
  it('GET /health/live → 200 and a generated X-Request-Id', async () => {
    const server = (await createApp()).getHttpServer();
    const res = await request(server).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('echoes a safe incoming X-Request-Id', async () => {
    const server = (await createApp()).getHttpServer();
    const res = await request(server).get('/health/live').set('X-Request-Id', 'trace-abc-1');
    expect(res.headers['x-request-id']).toBe('trace-abc-1');
  });

  it('GET /health/ready → 200 when the database is up', async () => {
    const server = (await createApp()).getHttpServer();
    const res = await request(server).get('/health/ready');
    expect(res.status).toBe(200);
    expect(readyResponseSchema.parse(res.body)).toEqual({
      status: 'ok',
      checks: { database: 'up' },
    });
  });

  it('GET /health/ready → 503 when the database is down', async () => {
    const server = (
      await createApp({ DATABASE_URL: 'postgresql://crm:wrong@127.0.0.1:1/unreachable' })
    ).getHttpServer();
    const res = await request(server).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error', checks: { database: 'down' } });
  });
});

describe('errors', () => {
  it('unknown route → 404 RFC 9457 problem+json with requestId', async () => {
    const server = (await createApp()).getHttpServer();
    const res = await request(server).get('/api/v1/does-not-exist?token=secret');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    const problem = problemDetailsSchema.parse(res.body);
    expect(problem.code).toBe('NOT_FOUND');
    expect(problem.requestId).toBe(res.headers['x-request-id']);
    expect(problem.instance).toBe('/api/v1/does-not-exist');
    expect(JSON.stringify(res.body)).not.toMatch(/secret/);
  });
});

describe('security', () => {
  it('sets security headers and hides X-Powered-By', async () => {
    const server = (await createApp()).getHttpServer();
    const res = await request(server).get('/api/v1');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('CORS allows configured origin only', async () => {
    const server = (await createApp()).getHttpServer();
    const allowed = await request(server).get('/api/v1').set('Origin', 'http://localhost:3000');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    const blocked = await request(server).get('/api/v1').set('Origin', 'https://evil.example');
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('CORS preflight allows the headers the web app sends (incl. the CSRF header)', async () => {
    const server = (await createApp()).getHttpServer();
    const res = await request(server)
      .options('/api/v1/auth/refresh')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'x-crm-csrf,authorization,x-tenant-id,content-type');
    expect(res.status).toBeLessThan(300);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    const allowed = String(res.headers['access-control-allow-headers']).toLowerCase();
    for (const header of ['x-crm-csrf', 'authorization', 'x-tenant-id', 'content-type']) {
      expect(allowed).toContain(header);
    }
  });

  it('rate limits normal routes → 429 problem+json', async () => {
    const server = (await createApp({ RATE_LIMIT_MAX: '2' })).getHttpServer();
    await request(server).get('/api/v1').expect(200);
    await request(server).get('/api/v1').expect(200);
    const res = await request(server).get('/api/v1');
    expect(res.status).toBe(429);
    expect(problemDetailsSchema.parse(res.body).code).toBe('RATE_LIMITED');
  });

  it('session refresh is not limited like login (page reloads must not sign people out)', async () => {
    const server = (await createApp({ AUTH_RATE_LIMIT_MAX: '2' })).getHttpServer();
    for (let i = 0; i < 5; i += 1) {
      // No cookie → 401, but never 429 at this volume.
      const res = await request(server).post('/api/v1/auth/refresh').set('X-CRM-CSRF', '1');
      expect(res.status).toBe(401);
    }
    for (let i = 0; i < 2; i += 1) {
      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'x@example.test', password: 'wrong password here' });
    }
    const limited = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'x@example.test', password: 'wrong password here' });
    expect(limited.status).toBe(429);
  });

  it('signed-in users each get their own budget (one office IP must not be shared)', async () => {
    const t2 = await createTestApp({ RATE_LIMIT_MAX: '3' });
    try {
      const a = await signUp(t2, 'rl-a');
      const b = await signUp(t2, 'rl-b');
      for (let i = 0; i < 3; i += 1)
        await request(t2.server).get('/api/v1/me').set(bearer(a.accessToken)).expect(200);
      expect((await request(t2.server).get('/api/v1/me').set(bearer(a.accessToken))).status).toBe(
        429,
      );
      await request(t2.server).get('/api/v1/me').set(bearer(b.accessToken)).expect(200);
      // A forged token does not get its own budget: it counts against the IP.
      for (let i = 0; i < 3; i += 1)
        await request(t2.server)
          .get('/api/v1')
          .set(bearer(`forged-${i}`));
      expect((await request(t2.server).get('/api/v1').set(bearer('forged-x'))).status).toBe(429);
    } finally {
      await t2.close();
    }
  });

  it('does not rate limit health probes', async () => {
    const server = (await createApp({ RATE_LIMIT_MAX: '1' })).getHttpServer();
    for (let i = 0; i < 3; i += 1) {
      await request(server).get('/health/live').expect(200);
    }
  });
});

describe('API docs', () => {
  it('serves OpenAPI JSON when enabled (non-production)', async () => {
    const server = (await createApp()).getHttpServer();
    const res = await request(server).get('/api/docs-json');
    expect(res.status).toBe(200);
    const doc = res.body as { info: { title: string }; paths: Record<string, unknown> };
    expect(doc.info.title).toBe('Migration CRM API');
    expect(Object.keys(doc.paths)).toContain('/health/ready');
  });

  it('never serves docs in production', async () => {
    const server = (
      await createApp({
        NODE_ENV: 'production',
        SWAGGER_ENABLED: 'true',
        MAIL_TRANSPORT: 'smtp',
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'crm-documents',
        S3_REGION: 'ap-southeast-2',
      })
    ).getHttpServer();
    const res = await request(server).get('/api/docs-json');
    expect(res.status).toBe(404);
  });
});
