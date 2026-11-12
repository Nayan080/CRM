# ADR-0006: Row-Level Security implementation (Stage 2 spike result)

- **Status:** Accepted (2026-11-10). Closes the RLS spike planned in ADR-0002.
- **Decision:** RLS is ON for all tenant-owned tables from Stage 2.

## How it works

1. The API connects as `crm_app` (NOSUPERUSER, NOBYPASSRLS). Migrations use the owner `crm`.
2. Every request's database work runs in a transaction that first calls
   `set_config('app.tenant_id' | 'app.user_id' | 'app.invite_token_hash', value, true)`
   (`true` = local to that transaction, safe with connection pooling).
3. Policies (`packages/db/prisma/migrations/*_stage2_identity_tenancy/migration.sql`) read these
   settings through `app_setting_uuid()`. Unset → NULL → no rows (**fail closed**).
4. `FORCE ROW LEVEL SECURITY` makes policies apply to the table owner too.

| Table                   | Visible when                                                            |
| ----------------------- | ----------------------------------------------------------------------- |
| roles, role_permissions | tenant = active tenant, or the role is one the current user holds       |
| memberships             | tenant = active tenant, or the row is the current user's own membership |
| invitations             | tenant = active tenant, or the caller holds that invitation's token     |
| audit_logs              | read: active tenant only · insert: active tenant or tenant-less events  |

Writes always require `tenant_id = active tenant` (WITH CHECK).

## Findings from the spike

- **INSERT … RETURNING needs the SELECT policy too.** Tenant-less audit events (login, reset) can't
  be read back, so the audit service uses `createMany` (no RETURNING). Recorded in code comments.
- Invitation acceptance happens before a tenant is selected: the token holder sees only that row;
  the transaction then switches the active RLS tenant to the invitation's tenant.
- Audit log is append-only: no UPDATE/DELETE policies (RLS matches 0 rows for the app) **and** a
  trigger that raises for anyone who bypasses RLS (verified as superuser).
- Cost: one extra `SELECT set_config(...)` round trip per transaction — negligible at current scale.
- Prisma's drift check ignores policies/functions/triggers (they live in hand-written SQL in the
  same migration). Any future change to them must be a new migration.

## Consequences

- Forgetting a tenant filter in code returns nothing instead of leaking (defence in depth).
- Background jobs (Stage 5) must set the same settings before touching data.
- Platform-level reads across tenants (Stage 7) will need a separate, audited mechanism.
