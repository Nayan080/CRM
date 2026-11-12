# ADR-0002: Shared database, tenant column, four isolation layers

- **Status:** Accepted (2026-11-10, DEC-03). Implemented from Stage 2.
- **Context:** Many independent agencies share one platform. Agency data must be private by
  default (docs/PRODUCT_BRIEF.md §4).
- **Decision:**
  1. One PostgreSQL database and schema; every tenant-owned table has `tenant_id`.
  2. Isolation layers: verified membership (TenantGuard) → request context → auto-scoped data
     access → PostgreSQL Row-Level Security as defence in depth.
  3. Composite foreign keys `(tenant_id, id)` so the database rejects cross-tenant links.
  4. The browser sends `X-Tenant-Id` only as a **selector**; the server verifies an ACTIVE
     membership on every request. Not-found and not-allowed both return 404.
  5. A mandatory cross-tenant test suite runs in CI.
- **Consequences:** Low cost and simple operations. Every query path must carry tenant context
  (HTTP, jobs, exports). RLS adds a small per-request transaction cost — validated in a Stage 2 spike.
- **Revisit when:** a customer, regulator or scale requires schema- or database-per-tenant.
