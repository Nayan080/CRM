import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Local dev: read the single root .env. In CI/production the variables are already set
// in the environment and take precedence (dotenv never overrides existing values).
loadEnv({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Migrations run as the database OWNER (MIGRATION_DATABASE_URL), never as the API's runtime
    // user. `pnpm db:migrate:test` targets the integration-test database instead.
    // Empty fallback lets `prisma generate` / `prisma validate` run without a database.
    url:
      (process.env.npm_lifecycle_event === 'migrate:test'
        ? process.env.TEST_MIGRATION_DATABASE_URL
        : (process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL)) ?? '',
    // Used by `migrate diff --from-migrations` (CI drift check). `migrate dev` creates its own
    // temporary shadow database when this is not set. NEVER point this at a real database: it is wiped.
    ...(process.env.SHADOW_DATABASE_URL
      ? { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL }
      : {}),
  },
});
