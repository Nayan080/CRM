# Stage 1 — Test Report

## Update — developer PC verification (2026-11-10, Windows)

Environment: Node 24.21.0, pnpm 10.28.0, Docker 29.9.2, Docker Compose v5.6.1, Postgres 17 (Docker).

| Step                                                                | Result                                                                           |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `pnpm install` (frozen lockfile, all 7 workspace projects)          | ✅                                                                               |
| `docker compose up -d`                                              | ✅ after stopping local Windows service `postgresql-x64-13` (port 5432 conflict) |
| `pnpm db:validate` (real Prisma)                                    | ✅ schema valid                                                                  |
| `pnpm db:migrate` → `20261110061545_init` created and applied       | ✅                                                                               |
| `pnpm test`                                                         | ✅ 27/27                                                                         |
| `pnpm test:integration` (real generated Prisma client, Postgres 17) | ✅ 11/11                                                                         |
| `pnpm dev` (API watch + Next.js dev)                                | ✅ both started, 0 compile errors                                                |

The migration SQL was reviewed (2 tables, 1 enum, 2 unique indexes) and also applied cleanly to
PostgreSQL 16 in the cloud environment.

**Result: acceptance criterion 1 now passes.** Remaining open items: CI run and Gitleaks scan
(need a GitHub repository, DEC-04).

---

- **Date:** 2026-11-10
- **Scope:** Engineering foundation (monorepo, API skeleton, web skeleton, DB package, CI file, docs).
- **Where tested:** Cloud build environment (Linux, Node 22.23, pnpm 10.28, PostgreSQL 16.15).
- **Not tested here:** anything needing the Prisma engine download (`binaries.prisma.sh` is blocked in
  the build environment) and Docker Compose. These must be verified on the developer PC (see §4).

## 1. Results summary

| Check                                                           | Result                                  |
| --------------------------------------------------------------- | --------------------------------------- |
| `pnpm install` (exact versions, lockfile)                       | ✅ Pass                                 |
| Prettier `format:check` (whole repo)                            | ✅ Pass                                 |
| ESLint — contracts, permissions, db, api, web                   | ✅ Pass (0 errors, 0 warnings)          |
| TypeScript — all packages and apps                              | ✅ Pass                                 |
| Unit tests — contracts (3), permissions (2), api (17), web (5)  | ✅ 27/27 pass                           |
| API integration tests against real PostgreSQL (11)              | ✅ 11/11 pass ¹                         |
| `nest build` + run `node dist/main.js`                          | ✅ Pass ¹                               |
| `nest start --watch` (dev mode)                                 | ✅ Pass ¹                               |
| `next build` (production)                                       | ✅ Pass                                 |
| `prisma validate` / `generate` / `migrate dev` / `migrate diff` | ⚠️ Not run — engine download blocked    |
| `docker compose up`                                             | ⚠️ Not run here                         |
| GitHub Actions CI                                               | ⚠️ Not run — no repository yet (DEC-04) |

¹ The Prisma-generated client could not be created here, so API runs used a **temporary stand-in**
for the generated file that sends `SELECT 1` through the **real `@prisma/adapter-pg`** to the real
database. The stand-in was not delivered. With the real generated client the API code is unchanged,
but this path must be re-checked on the PC (§4).

## 2. Stage 1 acceptance criteria

| #   | Criterion                                                                 | Status     | Evidence                                                                                                              |
| --- | ------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | Fresh clone → `install`, `compose up`, `db:migrate`, `dev` runs API + web | ⚠️ Partial | install, API and web verified; compose + migrate need the PC                                                          |
| 2   | `/health/ready` → 200 with DB up, 503 with DB down                        | ✅         | Integration tests + real process: `{"status":"ok",...}` 200; DB on closed port → 503                                  |
| 3   | Missing required env var → API refuses to start, clear message            | ✅         | `DATABASE_URL: is required … The API will not start`, exit code 1                                                     |
| 4   | JSON logs with `requestId`; test proves `password`/`token` redacted       | ✅         | `logger-options.test.ts`; request logs carry `req.id`. Startup logs (outside a request) have no request id, by design |
| 5   | Unknown route → RFC 9457 problem+json                                     | ✅         | 404 `application/problem+json`, `code: NOT_FOUND`, `requestId` matches header                                         |
| 6   | CI green on a PR; fails on lint/type error                                | ⚠️ Not run | Workflow written; runs once a GitHub repo exists                                                                      |
| 7   | No secrets in repo; secret scan in CI                                     | ✅ / ⚠️    | Pattern scan of all delivered files: none. Gitleaks CI step written, not run. `.env` excluded                         |
| 8   | Swagger page loads locally                                                | ✅         | `/api/docs` 200; `/api/docs-json` lists health routes; 404 when `NODE_ENV=production`                                 |
| 9   | Test report + list of what was not done                                   | ✅         | This file                                                                                                             |

## 3. Issues found and fixed during testing

1. **Query-string leak in 404 body** — the router's default message echoed the full URL
   (`?token=…`). Fixed: generic detail for unknown routes; unit + integration tests added.
2. **ESLint 9 is end-of-life** — moved to ESLint 10. React/import plugins print peer warnings;
   verified their rules (`react/jsx-key`, `react-hooks/rules-of-hooks`, `jsx-a11y`, Next rules) still run.
3. **Telemetry install script** (`@scarf/scarf`, via Swagger UI) — explicitly blocked in
   `pnpm-workspace.yaml`.

## 4. To verify on the developer PC (Windows)

Run from `C:\Users\NAYAN MISHRA\Downloads\CRM` in PowerShell:

```powershell
Copy-Item .env.example .env
pnpm install
docker compose up -d
pnpm db:validate
pnpm db:migrate          # first run asks for a migration name: type  init
pnpm test
pnpm test:integration
pnpm dev                 # open http://localhost:3000/status → API + Database "Operational"
```

Expected: the first `db:migrate` creates `packages/db/prisma/migrations/<timestamp>_init/`.
Keep that folder — it is the first migration and must be committed when the repo is created.

## 5. Not done in Stage 1 (by design)

- Business features, auth, tenants (Stage 2).
- Git hooks (Husky) — after `git init` (DEC-04).
- Local S3 emulator — Stage 6. Job queue — Stage 5.
- Nonce-based CSP for the web app — once auth pages exist.
