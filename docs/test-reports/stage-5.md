# Stage 5 — Test Report (Matters & Tasks)

- **Date:** 2026-11-10
- **Where tested:** Cloud build environment (Linux, Node 22, PostgreSQL 16). PC run pending (§4).
- **Migrations:** `20261110160000_stage5_reference_categories`, `20261110160100_stage5_matters`

## 1. Scope delivered

| Area         | Delivered                                                                                                                                                                                                                                             |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Matter types | Agency-configured types, ordered stages (one can be marked final), checklist templates. New agencies get 4 generic, editable examples (DEC-13). No legal rules or visa subclasses built in. Used types/stages cannot be deleted (deactivate instead). |
| Matters      | Number per agency (`M-000001`), client, type, branch (defaults to client's), title, description; status Open / On hold / Closed / Archived; archived = read-only until re-opened                                                                      |
| Workflow     | Stage and status changes write an append-only history row (database blocks edits/deletes for the API user)                                                                                                                                            |
| Team         | Staff assignments with optional responsibility; un-assigning keeps history and removes access                                                                                                                                                         |
| Participants | Exactly one of: client record, directory professional, partner organization — with an agency-configured role (new list)                                                                                                                               |
| Deadlines    | Due time + optional email reminder to assigned staff; overdue badge; mark done                                                                                                                                                                        |
| Checklist    | Copied from the type template when the matter opens; tick shows who and when; add/remove per matter                                                                                                                                                   |
| Tasks        | Title, priority, due, assignee, optional link to one matter/client/lead; links to records you cannot see are masked                                                                                                                                   |
| Timeline     | Notes/calls and appointments can now belong to a matter                                                                                                                                                                                               |
| Scope        | Matter OWN = assigned or created · BRANCH = own + my branches · TENANT = all. A client becomes visible to an OWN user through an assigned matter. OWN users cannot change who is assigned.                                                            |
| Web          | Matters list + detail, Tasks page, "Open a matter" from a client, Settings: matter types/stages/checklists and participant roles                                                                                                                      |

## 2. Results

| Check                                                                   | Result         |
| ----------------------------------------------------------------------- | -------------- |
| ESLint, TypeScript, Prettier (all packages)                             | ✅             |
| Unit tests — contracts 19, permissions 11, api 33, web 11               | ✅ 74/74       |
| API integration tests (real PostgreSQL, runtime user `crm_app`)         | ✅ 248/248     |
| — matters suite (types, workflow, scope, tasks, reminders)              | ✅ 12/12       |
| — cross-tenant attack suite (every tenant route + body-reference cases) | ✅ 156/156     |
| — RLS proof suite (10 new tables + history append-only)                 | ✅ 9/9         |
| Production builds (API, web)                                            | ✅             |
| Browser journey (Playwright, real API + web + DB)                       | ✅ 15/15 steps |

Mutation check: deliberately breaking the OWN matter scope made 2 tests fail (then restored), so the
scope tests do detect leaks.

Browser journey: owner set-up → menu shows Matters, Tasks → Settings shows the 4 example types →
agency adds its own checklist item → client page → "Open a matter" → `M-000001` at "Intake" with the
checklist copied → move stage with note (history) → tick checklist → deadline with reminder →
dependant added from another client record → task → call on timeline → Tasks page links to the
matter, tick done → close matter (history) → list filters by status → no console errors.

## 3. Found and fixed in this pass

1. The default matter filter was labelled "Active" but also showed closed matters — renamed
   "Not archived".

## 4. Not verified here — please run on the PC

- `pnpm db:migrate` with the real Prisma CLI (migration SQL made with Prisma's WebAssembly engine).
- Reminder emails through Mailpit (verified here with the in-memory mailer).

## 5. Assumptions to confirm

- Matter types are managed by people with Settings access (Owner/Admin).
- Reminders go to staff assigned to the matter; none for closed/archived matters.
- Reminder timer runs inside the API (every minute, safe with several API instances). A job queue
  can replace it later.

## 6. Known limitations

- Reminder time is chosen per deadline (no automatic rules such as "7 days before").
- Checklist items are not yet linked to documents (Stage 6).
