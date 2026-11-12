# ADR-0001: Monorepo with pnpm workspaces and Turborepo

- **Status:** Accepted (2026-11-10, DEC-03)
- **Context:** One team builds a NestJS API and a Next.js web app that share types, validation
  rules and permission codes. Separate repositories would let the API contract drift from the UI.
- **Decision:** One repository. `apps/api`, `apps/web`, shared code in `packages/*`.
  pnpm workspaces for dependencies, Turborepo to run tasks in dependency order with caching.
  Internal packages are compiled to `dist/` (Turborepo builds them before apps run).
- **Consequences:**
  - One PR can change API + UI together; one CI pipeline.
  - Strict, exact dependency versions; one lockfile.
  - pnpm 10 blocks dependency install scripts by default; allowed ones are listed in
    `pnpm-workspace.yaml` (`onlyBuiltDependencies`).
- **Revisit when:** separate teams own web and API with different release cycles.
