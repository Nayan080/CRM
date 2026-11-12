# Stage 2 — Test Report (Identity & Tenancy)

## Update — developer PC verification (2026-11-10, Windows)

Environment: Node 24.21, pnpm 10.28.0, Docker Postgres 17 + Mailpit (fresh volume).

| Step                                                                                                            | Result   |
| --------------------------------------------------------------------------------------------------------------- | -------- |
| `docker compose down -v` / `up -d` (creates `crm_app` role, `crm_test`, Mailpit)                                | ✅       |
| `pnpm db:migrate` with the real Prisma CLI — both migrations applied, **no new migration requested** (no drift) | ✅       |
| `pnpm db:migrate:test`                                                                                          | ✅       |
| `pnpm test` — contracts 9, permissions 10, api 28, web 10                                                       | ✅ 57/57 |
| `pnpm test:integration` — workspaces 15, auth 14, cross-tenant 18, app 12, RLS 7                                | ✅ 66/66 |
| `pnpm dev` — API and web start, 0 compile errors                                                                | ✅       |

**Result: Stage 2 accepted.** Still not run: manual click-through with Mailpit on the PC, CI and Gitleaks
(no GitHub repository yet, DEC-04).

**Correction:** the first version of this report said the cross-tenant suite had 24 tests. It has **18**
(1 route-registry check + 11 wrong-workspace attacks + 4 record-id attacks + 2 data checks). The figure 24
wrongly included 6 of the RLS tests. Total (66) was always correct.

---

- **Date:** 2026-11-10
- **Where tested:** Cloud build environment (Linux, Node 22.23, pnpm 10.28, PostgreSQL 16.15).

## 1. Scope delivered

| Area                         | Delivered                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sign-up & email verification | Generic responses (no account discovery), 24 h single-use links, resend                                                                                                        |
| Login                        | Argon2id, lockout after 10 failures (15 min), timing-safe for unknown emails                                                                                                   |
| Sessions                     | 10-min JWT access token (memory only) + rotating refresh token (HttpOnly, SameSite=Strict cookie), 7-day idle / 30-day absolute, reuse detection, logout, device list & revoke |
| Password reset               | 30-min single-use link, signs out everywhere                                                                                                                                   |
| MFA (DEC-06)                 | TOTP (RFC 6238) with replay protection, AES-256-GCM encrypted secret, 10 recovery codes; required for Owner/Admin, enforced per session                                        |
| Workspaces                   | Create (tenant + 9 system roles + owner), my workspaces, workspace access, settings                                                                                            |
| Team                         | List, change role, suspend/reactivate, remove/leave, last-owner protection, privilege-escalation guard                                                                         |
| Invitations                  | STAFF (role) / EXTERNAL (no role, DEC-09), 7-day single-use, resend, cancel, preview, accept (existing user, email must match), accept as new user                             |
| Audit                        | Append-only log of security/business events; tenant audit list endpoint                                                                                                        |
| Isolation                    | 4 layers: verified membership → request context → automatic tenant filter → PostgreSQL RLS; composite tenant foreign keys                                                      |
| Web                          | Register, verify, login (+MFA), forgot/reset, workspaces, security (MFA, sessions), workspace overview, team & invitations, invite accept                                      |

## 2. Results

| Check                                                                            | Result                              |
| -------------------------------------------------------------------------------- | ----------------------------------- |
| Prettier, ESLint (all packages), TypeScript (all packages)                       | ✅ 0 errors, 0 warnings             |
| Unit tests — contracts 9, permissions 10, api 28, web 10                         | ✅ 57/57                            |
| API integration tests (real PostgreSQL, API connects as non-superuser `crm_app`) | ✅ 66/66                            |
| — of which cross-tenant attack suite (route registry + 11 routes × attacks)      | ✅ 18/18                            |
| — of which direct RLS proof tests                                                | ✅ 7/7                              |
| Production builds (API, web)                                                     | ✅                                  |
| Browser end-to-end journey (Playwright, real API + web + DB)                     | ✅ 12/12 steps                      |
| Secret pattern scan of delivered files                                           | ✅ none found (Gitleaks runs in CI) |

### Browser journey (verified)

register → verify link (token removed from address bar) → login → create workspace → forced MFA
setup → 10 recovery codes → open workspace → invite staff → **page reload keeps session** →
refresh cookie is HttpOnly + SameSite=Strict, no token in web storage → sign out → protected page
redirects to login → invitee opens link in a fresh browser, creates account, joins as Migration
Agent and does not see the Team tab → no browser console errors.

## 3. Isolation evidence

- **Route registry test:** reads every `@TenantScoped` route from controller metadata; CI fails if a
  new tenant route has no attack case.
- **Attacker = Owner of tenant A** against tenant B, every route: header B → 404 `WORKSPACE_NOT_FOUND`;
  header A + B's record ids → 404 `NOT_FOUND`; B's data verified unchanged; A's lists contain no B rows.
- **RLS directly in PostgreSQL:** runtime role is not superuser and cannot bypass RLS; no context →
  0 rows; tenant A context → 0 of B's rows; inserting into B blocked; updating B affects 0 rows;
  user context sees only own memberships; audit log cannot be changed or deleted (trigger verified
  as superuser too).
- **User in two agencies:** both workspaces listed; Sales Manager rights in A do not apply in B
  (external there); removing them from A leaves B and the account untouched.

## 4. Issues found and fixed during testing

1. **CORS blocked silent refresh** (found by the browser test): the CSRF header was missing from the
   allowed CORS headers, so browsers blocked every refresh → users looked signed out after reload.
   Fixed + API test for the preflight added.
2. **INSERT…RETURNING under RLS:** tenant-less audit events failed (RETURNING needs the read policy).
   Fixed by inserting without RETURNING; documented in ADR-0006.
3. **Invitation role hidden by RLS before tenant context** → staff could have joined without a role.
   Fixed: the token first resolves the invitation's tenant, then the role is read inside it.
4. **Pre-registration takeover risk:** re-registering an unverified email now replaces the password
   and invalidates older links (test added).
5. **404 body echoed query strings** (Stage 1 fix retained).
6. React lint rules (setState in effects) — replaced with `useSyncExternalStore`-based reader.

## 5. Not verified here — please run on the PC

| Item                                                                                         | Why not here                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prisma migrate dev` with the real CLI (drift check of the hand-assembled Stage 2 migration) | Prisma engine download blocked in the build environment. The client and migration SQL were produced with Prisma's own published generator/WebAssembly engine; the generated client matched the PC's output byte-for-byte except the version label. |
| PostgreSQL 17 + Docker init scripts (`crm_app` role, Mailpit)                                | No Docker in the build environment (tested on PostgreSQL 16 with the same SQL).                                                                                                                                                                    |
| Real SMTP delivery to Mailpit                                                                | Tests use an in-memory mailer; the browser test used the log mailer.                                                                                                                                                                               |
| CI pipeline and Gitleaks                                                                     | No GitHub repository yet (DEC-04).                                                                                                                                                                                                                 |

## 6. Known limitations (by design, later stages)

- Branch-scoped permissions behave as "self only" until branches exist (Stage 3).
- Real email via Zoho ZeptoMail (DEC-02): adapter not built yet; SMTP/Mailpit locally.
- No QR code image for MFA setup yet (setup key + `otpauth://` link are shown).
- Platform admin (super admin) features: Stage 7.
- Nonce-based Content-Security-Policy for the web app: to add before production.
