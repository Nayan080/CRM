# Stage 3 — Test Report (Organization & Directory)

- **Date:** 2026-11-10
- **Where tested:** Cloud build environment (Linux, Node 22, PostgreSQL 16). PC run pending (§4).
- **Migration:** `20261110140000_stage3_org_directory`

## 1. Scope delivered

| Area                | Delivered                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Agency profile      | Legal name, contact email, phone, website, address, time zone (validated IANA name)                                                              |
| Branches            | Create, rename, deactivate; names unique per agency; member branch assignment (API + Team page)                                                  |
| Branch scope        | BRANCH-scope roles see only people who share a branch; branch managers invite only into their own branches and only into roles below their own   |
| Configurable lists  | Profession types and partner types per agency; defaults are only the values named in the product brief (§2.2); add, rename, deactivate           |
| Professionals       | Directory profiles that are **not** logins and grant no access; optional link to a partner organization; archive                                 |
| Credentials         | Type, issuer, identifier, dates; status starts `UNVERIFIED`; a person records Verified / Rejected (audited); editing details resets verification |
| Partners & contacts | Organizations with contacts; search + cursor paging; archive hides contacts                                                                      |
| Web                 | Professionals, Partners, Branches, Settings pages; workspace menu links; Team page branch assignment                                             |

## 2. Results

| Check                                                                  | Result       |
| ---------------------------------------------------------------------- | ------------ |
| Prettier, ESLint, TypeScript (all packages)                            | ✅           |
| Unit tests — contracts 15, permissions 10, api 30, web 10              | ✅ 65/65     |
| API integration tests (real PostgreSQL, runtime user `crm_app`)        | ✅ 126/126   |
| — directory suite                                                      | ✅ 18/18     |
| — cross-tenant attack suite (route registry covers every tenant route) | ✅ 60/60     |
| — RLS proof suite                                                      | ✅ 7/7       |
| Production builds (API, web)                                           | ✅           |
| Browser journey (Playwright, real API + web + DB)                      | ✅ 9/9 steps |

Browser journey: owner set-up with MFA → workspace menu shows Stage 3 sections → create branch →
assign owner to branch on Team page → create partner (brief-provided type) → create professional →
add credential (unverified) → mark verified → settings shows configurable lists → no console errors.

## 3. Found and fixed in this pass

1. Stage 3 pages existed but were not reachable from the workspace menu — links added (shown only
   when the role has the permission).
2. Branch assignment had an API but no screen — added to the Team page.

## 4. Not verified here — please run on the PC

- `pnpm db:migrate` with the real Prisma CLI (the migration was produced with Prisma's published
  WebAssembly engine because the CLI's engine download is blocked in the build environment).
- PostgreSQL 17 in Docker.

## 5. Known limitations

- Credential evidence files are not stored yet (documents arrive in Stage 6).
- A professional profile cannot yet be linked to a login account; profiles are directory-only.
