# Stage 6 — Test Report (Documents, Consents, External Sharing)

- **Date:** 2026-11-10
- **Where tested:** Cloud build environment (Linux, Node 22, PostgreSQL 16, `moto` S3 server). PC run
  pending (§4).
- **Migrations:** `20261110170000_stage6_reference_categories`, `20261110170100_stage6_documents`
- **Design:** ADR-0007

## 1. Scope delivered

| Area        | Delivered                                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Upload      | PDF, JPG, PNG, DOCX up to 20 MB; type checked by file content and must match the extension; stored in private S3-API storage   |
| Documents   | On a client, optionally on a matter and a checklist item; agency-configured categories (new list); title; soft delete          |
| Versions    | New upload = new version; earlier versions kept and downloadable; version rows cannot be changed by the API's database user    |
| Download    | Streams through the API after an access check; audited; forced download with safe headers                                      |
| Scope       | Matter documents follow matter access; client-level documents follow client access; receptionists can upload but not view      |
| Consents    | Record (purpose, recipient, method, date), withdraw; optional on shares (DEC-14); withdrawn consent cannot be attached         |
| Sharing     | One matter → one EXTERNAL member, ticked documents only, optional expiry and purpose; revoke/expiry/document removal immediate |
| External UI | "Shared with me": matter reference, title, type, stage, status, client name, shared documents. Nothing else.                   |
| Storage     | S3 driver (any S3-compatible store); local S3Proxy in docker-compose; production requires bucket + region                      |

## 2. Results

| Check                                                                | Result         |
| -------------------------------------------------------------------- | -------------- |
| ESLint, TypeScript, Prettier (all packages)                          | ✅             |
| Unit tests — contracts 19, permissions 11, api 40, web 12            | ✅ 82/82       |
| API integration tests (real PostgreSQL, runtime user `crm_app`)      | ✅ 299/299     |
| — documents & sharing suite                                          | ✅ 10/10       |
| — S3 driver against a real S3 API (`moto`)                           | ✅ 2/2         |
| — cross-tenant attack suite (every tenant route + file/body attacks) | ✅ 193/193     |
| — RLS proof suite (5 new tables + versions append-only)              | ✅ 10/10       |
| Production builds (API, web)                                         | ✅             |
| Browser journey (Playwright; API on S3 storage)                      | ✅ 11/11 steps |
| Stage 4 and 5 browser journeys re-run back to back                   | ✅             |

Mutation check: removing the "not revoked" condition from external access made the sharing test
fail (then restored).

Browser journey: consent on client → matter → HTML renamed `.pdf` rejected → PDF uploaded with a
category → download is byte-identical with the right name → external collaborator invited and joins
→ sees only "Shared with me" → matter shared with one document, no consent → external sees basics
(no client email) and downloads the file → owner revokes → external sees "No longer shared" → client
page lists the matter document → no console errors.

## 3. Found and fixed in this pass

1. **Sign-outs after a few page reloads.** Session refresh shared the 10-per-minute login limit, so
   reloading pages (or several staff behind one office IP) signed people out. Refresh now has its
   own limit (120/min per IP); login limits are unchanged. Test added.
2. Cross-origin downloads could not read the file name — `Content-Disposition` is now exposed by CORS.
3. The ADR note about MinIO had no source; checked and corrected (ADR-0005, ADR-0007).

## 4. Not verified here — please run on the PC

- `docker compose up -d` starts the new `s3` service (S3Proxy). Docker is not available here.
- `pnpm db:migrate` with the real Prisma CLI.
- Optional: `S3_TEST_ENDPOINT=http://localhost:9000 pnpm test:integration` runs the S3 test
  against S3Proxy.

## 5. Assumptions to confirm

- Default document categories: Identity, Financial, Education, Employment, Relationship,
  Correspondence, Other (agency can change them).
- External collaborators see the client's name (not contact details).
- Only Owner/Admin (`share:manage`) can share; they must also be able to see the matter.

## 6. Known limitations / before production

- **Malware scanning is not active** (all files `NOT_SCANNED`). Required before production.
- Uploads are held in API memory (max 20 MB each); fine for now, presigned uploads later if needed.
- If saving the record fails after the file is stored, the file stays unreferenced in storage
  (logged). A clean-up job can be added with the job queue.
- ~~The general API limit (100 requests/min per IP) may be tight for a busy office behind one IP.~~
  _Corrected 2026-11-11:_ the limit is per route (not across the whole API). Signed-in users now
  get their own budget instead of sharing their office IP's (Stage 8).
