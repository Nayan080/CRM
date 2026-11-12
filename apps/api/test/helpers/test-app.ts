import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/bootstrap/configure-app.js';
import { parseConfig } from '../../src/config/app-config.js';
import { MAILER, type MemoryMailer } from '../../src/infra/mail/mailer.js';

export const testDatabaseUrl = (() => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Start Postgres (docker compose up -d), run `pnpm db:migrate:test`, and check .env.',
    );
  }
  return url;
})();

export const baseTestEnv: Record<string, string> = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: testDatabaseUrl,
  CORS_ORIGINS: 'http://localhost:3000',
  WEB_APP_URL: 'http://localhost:3000',
  SWAGGER_ENABLED: 'true',
  RATE_LIMIT_MAX: '100000',
  AUTH_RATE_LIMIT_MAX: '100000',
  JWT_ACCESS_SECRET: 'integration-test-secret-integration-test-secret',
  MFA_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  MAIL_TRANSPORT: 'memory',
  STORAGE_DRIVER: 'memory',
};

export interface TestApp {
  app: NestExpressApplication;
  server: Server;
  mailer: MemoryMailer;
  close(): Promise<void>;
}

export async function createTestApp(overrides: Record<string, string> = {}): Promise<TestApp> {
  const config = parseConfig({ ...baseTestEnv, ...overrides });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(config)],
  }).compile();
  // TEST_DEBUG=1 prints server-side errors while debugging a failing test.
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    logger: process.env.TEST_DEBUG ? ['error'] : false,
  });
  configureApp(app, config);
  await app.init();
  return {
    app,
    server: app.getHttpServer(),
    mailer: app.get<MemoryMailer>(MAILER),
    close: () => app.close(),
  };
}

/** Unique per run so tests never collide with data from earlier runs. */
export function uniqueEmail(label: string): string {
  return `${label}-${randomUUID().slice(0, 8)}@example.test`;
}

export function uniqueSlug(label: string): string {
  return `${label}-${randomUUID().slice(0, 8)}`;
}

/** Extract the #token=... value from the last email sent to an address. */
export function tokenFromLastEmail(mailer: MemoryMailer, to: string): string {
  const message = mailer.lastTo(to);
  const match = message?.text.match(/#token=([A-Za-z0-9_-]+)/);
  if (!match?.[1]) throw new Error(`No token email found for ${to}`);
  return match[1];
}
