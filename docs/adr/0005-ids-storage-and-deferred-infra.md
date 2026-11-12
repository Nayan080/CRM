# ADR-0005: IDs, tooling versions and deferred infrastructure

- **Status:** Accepted (2026-11-10)
- **IDs:** UUID v7 primary keys (`@default(uuid(7))`), time-sortable and not guessable.
  Authorization — not ID secrecy — is what protects records.
- **Tooling versions (Stage 1):** latest stable releases that work together on 2026-11-10:
  Node 22.12+ (24 LTS also fine), NestJS 12 (ESM), Next.js 16, React 19, Prisma 7.10,
  TypeScript 6.0, ESLint 10, Vitest 5, Tailwind 4, Zod 4.
  - Prisma 8 skipped: still a release candidate.
  - TypeScript 7 skipped: typescript-eslint and ts tooling do not support it yet.
  - ESLint 10: `eslint-plugin-react` / `eslint-plugin-import` (used by eslint-config-next) do not yet
    list ESLint 10 as a peer, so pnpm prints peer warnings. Their rules were verified to run
    correctly. ESLint 9 is end-of-life, so 10 is the supported choice.
- **Deferred (added only when needed):**
  - Object storage emulator for local dev → Stage 6: decided in ADR-0007 (S3Proxy).
    _Correction 2026-11-10:_ the earlier note about MinIO was written without a source. It has
    since been checked: MinIO stopped publishing free community Docker images in October 2025
    (see ADR-0007 for sources).
  - Job queue (pg-boss) → Stage 5 (reminders).
  - Git hooks (Husky) → after `git init` (DEC-04: no repo yet).
  - Nonce-based Content-Security-Policy for the web app → once auth pages exist.
