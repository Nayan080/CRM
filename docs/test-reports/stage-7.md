# Stage 7 — Test Report (Reports, Plans, Platform Administration)

- **Date:** 2026-11-11
- **Where tested:** Cloud build environment (Linux, Node 22, PostgreSQL 16). PC run pending (§4).
- **Migration:** `20261111090000_stage7_platform`
- **Runbook:** `docs/runbooks/agency-offboarding.md`

## 1. Scope delivered (decisions of 2026-11-11)

| Area              | Delivered                                                                                                                                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reports           | Leads & referrals, Matters, Team workload, Documents & sharing. Period (default last 90 days) and branch filter.                                                                                                                 |
| Report access     | New `report:read` (Owner, Admin, Branch Manager [branch], Sales Manager, Finance). Each report also needs read access to its data and only counts records the person can see. Documents report needs audit access (Owner/Admin). |
| Plans             | Staff-user limit only, set by a platform admin; no payments (DEC-16). Seats = active staff + pending staff invitations; external collaborators never count. Checked on invite, resend, accept and re-activation.                 |
| Platform admin    | `SUPER_ADMIN` (view + change) and `SUPPORT` (view). Agency metadata and member counts only — never clients, matters or documents. Two-factor required. Platform routes return 404 to everyone else.                              |
| First super admin | Server command: `pnpm --filter @crm/api platform:role grant <email> SUPER_ADMIN` (also `revoke`, `list`). Audited.                                                                                                               |
| Suspension        | Suspend / re-activate / pending deletion with a required reason; immediate; members see "suspended", strangers still get 404; recorded in the agency's audit log.                                                                |
| Offboarding       | "Pending deletion" status + written runbook. Data deletion itself is not automated (retention rules still open).                                                                                                                 |
| Web               | Reports page; Platform page (agencies, plans, status); suspended workspaces shown in the workspace list.                                                                                                                         |

## 2. Results

| Check                                                                | Result       |
| -------------------------------------------------------------------- | ------------ |
| ESLint, TypeScript, Prettier (all packages)                          | ✅           |
| Unit tests — contracts 19, permissions 11, api 43, web 12            | ✅ 85/85     |
| API integration tests (real PostgreSQL, runtime user `crm_app`)      | ✅ 312/312   |
| — platform & reports suite (runs the real server command)            | ✅ 8/8       |
| — cross-tenant attack suite (+ reports never include another agency) | ✅ 198/198   |
| Production builds (API, web)                                         | ✅           |
| Browser journey (Playwright, real API + web + DB)                    | ✅ 9/9 steps |

Browser journey: owner adds a lead → Reports page shows it by source and all four sections →
a second person is granted super admin by the server command → Platform page lists agencies with
no client data → plan with 3 staff created and assigned (usage "1 / 3") → agency suspended with a
reason → owner's workspace list shows "Suspended — contact support" → re-activated → owner uses
the workspace again → no console errors.

## 3. Found and fixed in this pass

1. Seat rule was inconsistent: pending invitations reserved a seat for new invitations but not for
   re-activation or acceptance. Now one rule everywhere (active staff + pending staff invitations).
2. Members of a suspended agency got "workspace not found" and the workspace disappeared from
   their list. They now see a clear "suspended" message; non-members still get a plain 404.

## 4. Not verified here — please run on the PC

- `pnpm db:migrate` with the real Prisma CLI.
- The grant command on Windows: `pnpm --filter @crm/api build` then
  `pnpm --filter @crm/api platform:role grant <your-email> SUPER_ADMIN`.

## 5. Assumptions to confirm

- Who gets `report:read` (see §1). Agents, lawyers, case managers and receptionists do not.
- Report periods use UTC dates (not the agency's time zone) in this first version.
- Plans have only the staff-user limit (as decided); other limits can be added later.

## 6. Known limitations

- Agency data export and deletion for offboarding are manual (runbook).
- Report charts are simple bars/tables; no export to CSV yet.
