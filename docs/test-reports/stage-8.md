# Stage 8 — Test Report (Automation & Hardening)

- **Date:** 2026-11-11
- **Where tested:** Cloud build environment (Linux, Node 22, PostgreSQL 16). PC run pending (§4).
- **Migration:** `20261111120000_stage8_automation`
- **Decisions (2026-11-11):** automation = stage task templates, automatic deadline reminders, lead
  follow-up nudge. No integrations. No AI for now.
- **Before go-live:** `docs/PRODUCTION_CHECKLIST.md`

## 1. Scope delivered

| Area                 | Delivered                                                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stage task templates | Per stage (Settings): title, priority, due in N days, assign to the matter lead or leave unassigned. Created when a matter opens in or moves into the stage; once per matter (a cancelled one is re-created on re-entry). |
| Deadline reminders   | Agency rule "N days before" (up to 3, e.g. 7 and 1), off by default. Emails the assigned staff; each reminder once; if several are reached at once, one email. Open/on-hold matters only.                                 |
| Lead follow-up nudge | Agency rule "after N days without activity", off by default. Emails the lead owner once per quiet period; new activity starts a new one.                                                                                  |
| Scheduler            | Runs in the API every minute; claims work in the database, so several API instances never send twice. Visits only agencies that switched each rule on.                                                                    |
| Per-user rate limits | Signed-in requests count per user (valid token), anonymous per IP; strict login limits unchanged.                                                                                                                         |
| Web security         | Strict per-request nonce Content-Security-Policy (scripts only with this request's nonce; connections only to the site and API); HSTS in production.                                                                      |
| Dependency audit     | 1 moderate finding, in ESLint's `minimatch` (development tool, not shipped).                                                                                                                                              |
| Web                  | Settings: Automation card; auto tasks per stage in Matter types & stages.                                                                                                                                                 |

## 2. Results

| Check                                                           | Result                    |
| --------------------------------------------------------------- | ------------------------- |
| ESLint, TypeScript, Prettier (all packages)                     | ✅                        |
| Unit tests — contracts 19, permissions 11, api 43, web 12       | ✅ 85/85                  |
| API integration tests (real PostgreSQL, runtime user `crm_app`) | ✅ 326/326                |
| — automation suite (simulated time)                             | ✅ 4/4                    |
| — cross-tenant attack suite (every tenant route incl. Stage 8)  | ✅ 200/200                |
| Production builds (API, web)                                    | ✅                        |
| Browser journeys, Stages 3–8, all with the strict CSP           | ✅ 6/6, no console errors |

Mutation check: switching the rate limiter back to per-IP made the new per-user test fail (restored).

## 3. Found and fixed in this pass

1. **The attack-test helper sent `DELETE` for any method it didn't know**, so a `PUT` route could
   have passed without being attacked. It now handles `PUT` and fails on unknown methods.
2. Automation switches first lived in an agency-protected table, which made the scheduler visit
   every agency. Moved onto the agency record so only agencies using a rule are visited.
3. After moving a matter to a new stage, auto-created tasks didn't show until reload — the matter
   page now refreshes tasks.
4. The Automation "Saved." message vanished at once — fixed.
5. Stage 6 report said the API limit was "100 per minute per IP across the API"; it is per route.
   Corrected there.

## 4. Not verified here — please run on the PC

- `pnpm db:migrate` with the real Prisma CLI (Stages 7–8 add 2 migrations).
- Automation emails in Mailpit (verified here with the in-memory mailer and simulated time).

## 5. Assumptions to confirm

- Auto tasks are created by the system even if the person moving the matter has no task
  permission (they are part of the agency's workflow).
- "Matter lead" = the first active person on the matter's team.
- Reminder emails use the agency's time zone for the due time.

## 6. Known limitations

- Manual per-deadline reminders (Stage 5) still visit every active agency each minute; move the
  scheduler to a job queue before thousands of agencies (production checklist item 12).
