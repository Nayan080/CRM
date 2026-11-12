# Stage 4 — Test Report (Leads, Clients, Timeline, Appointments)

- **Date:** 2026-11-10
- **Where tested:** Cloud build environment (Linux, Node 22, PostgreSQL 16). PC run pending (§4).
- **Migrations:** `20261110150000_stage4_reference_categories`, `20261110150100_stage4_crm_core`

## 1. Scope delivered

| Area            | Delivered                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Leads           | Create, edit, owner, branch, source (agency list), referring partner + contact; status Open / Lost / Converted; delete         |
| Duplicate check | Before converting: match by email, normalised phone, or name + date of birth; matches the user may not see are counted only    |
| Conversion      | Create a new client from the lead, or link the lead to an existing client (no duplicate); source and referrer stay on the lead |
| Clients         | Individual or business; number per agency (`C-000001`); details; branch; related clients (agency list of relationship types)   |
| Timeline        | Notes, calls, emails, meetings on a lead or client                                                                             |
| Appointments    | Consultations / appointments for a lead, a client, or general; host; cancel; calendar page                                     |
| Roles           | New appointment and task permissions; existing agencies get them automatically (role templates version 2)                      |
| Web             | Leads, Clients, Calendar pages and menu links; Settings adds Lead sources and Relationship types                               |

## 2. Results

| Check                                                                   | Result         |
| ----------------------------------------------------------------------- | -------------- |
| ESLint, TypeScript (all packages), Prettier (report)                    | ✅             |
| Unit tests — contracts 15, permissions 11, api 33, web 11               | ✅ 70/70       |
| API integration tests (real PostgreSQL, runtime user `crm_app`)         | ✅ 174/174     |
| — CRM suite (scope, duplicates, conversion, appointments)               | ✅ 12/12       |
| — cross-tenant attack suite (every tenant route + body-reference cases) | ✅ 96/96       |
| — RLS proof suite (now incl. 6 new tables)                              | ✅ 7/7         |
| Production builds (API, web)                                            | ✅             |
| Browser journey (Playwright, real API + web + DB)                       | ✅ 16/16 steps |

Browser journey: owner set-up with MFA → menu shows Leads, Clients, Calendar → empty state → lead
with source "Referral" and referring partner → call on timeline → consultation booked → duplicate
check finds none → convert → client `C-000001` shows "Referral, via Harbour Accounting" → second
lead with the same phone in another format → duplicate found → linked to existing client (no new
client) → client `C-000002` added → relationship "Family member" → lists correct → calendar shows
the appointment → cancel shows "Cancelled" → no console errors.

## 3. Found and fixed in this pass

1. After linking a lead, the client page showed old (cached) data — the client is now refreshed.
2. Cancelled appointments disappeared instead of showing "Cancelled" — panels now include them.
3. Boot-time role update could stop the API from starting when the database was down — it now
   logs and retries on the next request to that agency.

## 4. Not verified here — please run on the PC

- `pnpm db:migrate` with the real Prisma CLI (migration SQL made with Prisma's WebAssembly engine).
- PostgreSQL 17 in Docker.

## 5. Assumptions to confirm

- Appointment/task access per role: branch manager = own branches; agent, lawyer, case manager =
  own; sales manager and receptionist = whole agency (appointments); finance = none.
- Agents, lawyers and case managers can read/update their own leads and clients but cannot
  create leads or clients, so they cannot convert leads (per role matrix §10.2).
- Receptionists see full client details.

## 6. Known limitations

- No email/SMS reminders for appointments yet.
- Calendar is a list of upcoming appointments, not a month grid.
