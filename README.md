# Migration Business Management CRM

Multi-tenant SaaS for migration agencies. **Current stage: 2 — identity & tenancy**
(sign-up, login, MFA, workspaces, team, invitations, roles, tenant isolation).

- Product brief: [`docs/PRODUCT_BRIEF.md`](docs/PRODUCT_BRIEF.md)
- Architecture (approved): [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Decisions: [`docs/adr/`](docs/adr) · Test reports: [`docs/test-reports/`](docs/test-reports)

## Prerequisites

| Tool           | Version            | Check                                              |
| -------------- | ------------------ | -------------------------------------------------- |
| Node.js        | 22.12+ (or 24 LTS) | `node -v`                                          |
| pnpm           | 10.x               | `pnpm -v` (install: `npm install -g pnpm@10.28.0`) |
| Docker Desktop | with Compose v2    | `docker compose version`                           |

## Run locally

PowerShell, from the project folder:

```powershell
Copy-Item .env.example .env
pnpm install
docker compose up -d
pnpm db:migrate
pnpm dev
```

| What                                     | URL                                                 |
| ---------------------------------------- | --------------------------------------------------- |
| Web app                                  | http://localhost:3000                               |
| Local email inbox (Mailpit)              | http://localhost:8025                               |
| Local document storage (S3Proxy, S3 API) | http://localhost:9000 (used by the API only)        |
| API                                      | http://localhost:4000/api/v1                        |
| API docs (Swagger, non-production only)  | http://localhost:4000/api/docs                      |
| Liveness / readiness                     | http://localhost:4000/health/live · `/health/ready` |

**Try it:** Create account → open the verification email in Mailpit → sign in → create a workspace →
set up two-factor (any authenticator app) → Team → invite someone → open their email in Mailpit.

## Database users (least privilege)

| User      | Used by           | Why                                                                   |
| --------- | ----------------- | --------------------------------------------------------------------- |
| `crm`     | migrations only   | Owner of the tables (DDL).                                            |
| `crm_app` | the API (runtime) | Not a superuser, so PostgreSQL Row-Level Security applies to the API. |

Both are created by `infra/postgres/init/*.sql` when the Docker volume is **first** created.

## Scripts (run from the root)

| Command                                                          | What it does                                                                                                                  |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                                       | Builds shared packages, then runs API + web in watch mode                                                                     |
| `pnpm build`                                                     | Production build of everything                                                                                                |
| `pnpm lint` / `pnpm typecheck`                                   | ESLint / TypeScript checks                                                                                                    |
| `pnpm test`                                                      | Unit tests (no database needed)                                                                                               |
| `pnpm db:migrate:test`                                           | Apply migrations to the `crm_test` database (before integration)                                                              |
| `pnpm test:integration`                                          | API integration tests incl. cross-tenant + RLS suites (`crm_test`)                                                            |
| `pnpm format` / `pnpm format:check`                              | Prettier                                                                                                                      |
| `pnpm db:migrate`                                                | Create/apply migrations in development (`prisma migrate dev`)                                                                 |
| `pnpm db:migrate:deploy`                                         | Apply existing migrations (CI / production)                                                                                   |
| `pnpm db:validate`                                               | Validate the Prisma schema                                                                                                    |
| `pnpm --filter @crm/api platform:role grant <email> SUPER_ADMIN` | Make an existing user a platform admin (needs a built API; also `revoke`, `list`). See `docs/runbooks/agency-offboarding.md`. |

## Project structure

```
apps/
  api/          NestJS 12 REST API (ESM)
    src/common/   auth guards, request context, security helpers, errors, logging
    src/infra/    database (tenant-scoped Prisma + RLS), mail
    src/modules/  auth, me, tenants, members, invitations, audit, health
  web/          Next.js 16 (App Router) + Tailwind 4 + TanStack Query + React Hook Form
packages/
  config/       shared tsconfig + ESLint presets
  contracts/    Zod schemas shared by API and web (single source of validation rules)
  db/           Prisma 7 schema, migrations (incl. RLS policies), client factory
  permissions/  permission codes, 9 system role templates, escalation check
docs/           brief, architecture, ADRs, test reports
infra/          local Postgres init scripts (test DB, crm_app role)
.github/        CI workflow (runs once a GitHub repo exists)
```

## Security notes

- Never commit `.env`. All values in `.env.example` are local-only placeholders.
- The API refuses to start if any environment variable is missing or invalid.
- Tenant isolation has 4 layers: verified membership → request context → auto tenant filter →
  PostgreSQL RLS. `pnpm test:integration` includes a suite that attacks every tenant route.
- Access tokens live in memory only; the refresh token is an HttpOnly, SameSite=Strict cookie.
- Logs are JSON, carry a request id, and redact passwords, tokens and auth headers.
- Only `apps/api/src/infra/prisma` may use the raw database client (enforced by ESLint).

## Troubleshooting

| Problem                                                 | Fix                                                                                                                        |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `pnpm db:migrate` → "Can't reach database server"       | Is Docker Desktop running? `docker compose ps` should show postgres `healthy`.                                             |
| Port 5432 already in use                                | Another Postgres is running (e.g. Windows service `postgresql-x64-13`). Stop it, or change the port in compose and `.env`. |
| `role "crm_app" does not exist` / `crm_test` missing    | Init scripts only run on a fresh volume: `docker compose down -v` then `docker compose up -d` (deletes local data).        |
| Document upload says "Files cannot be stored right now" | Is the `s3` service running? `docker compose ps`; start it with `docker compose up -d`.                                    |
| No emails arrive                                        | Open http://localhost:8025. Check `docker compose ps` shows `mailpit` running and `.env` has `MAIL_TRANSPORT=smtp`.        |
| Workspace says "Two-factor authentication required"     | Owner/Admin roles need MFA (DEC-06). Account → Security → set up two-factor.                                               |
| `pnpm install` shows ESLint peer warnings               | Expected (see ADR-0005). Lint rules were verified to work.                                                                 |
| API exits with "Invalid environment configuration"      | The message lists which variable is wrong. Compare `.env` with `.env.example`.                                             |
