# ADR-0007: Documents, storage and external sharing

- **Status:** Accepted (2026-11-10, Stage 6)
- **Related decisions:** DEC-09 (external access only via shares), DEC-14 (consent optional),
  DEC-15 (S3 API only; provider chosen before go-live), upload rules (PDF, JPG, PNG, DOCX; 20 MB;
  malware scanning before production).

## Decisions

1. **Files go through the API, both ways.** The browser uploads to the API (multipart, max 20 MB,
   one file); the API checks the file and writes it to private storage. Downloads stream through the
   API, which checks access and writes an audit entry first.
   - Why: every byte is authorized and audited in one place; no presigned URLs or storage CORS to
     get wrong; works the same with any S3-compatible store.
   - Trade-off: the API carries file traffic. Fine at 20 MB per file. Presigned uploads can be added
     later if volume needs it.
2. **Type is decided by content, not by name.** Magic bytes must be PDF, JPEG, PNG, or a DOCX (a
   ZIP containing `word/document.xml`; macro documents and other ZIPs are rejected), and the file
   name's extension must match. The stored MIME type is the detected one.
3. **Downloads cannot run in our web origin.** `Content-Disposition: attachment`,
   `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`,
   `Cache-Control: private, no-store`.
4. **Storage keys hold no personal data:** `tenants/<tenant>/documents/<document>/<random>`.
   Versions are never overwritten; the database user cannot update or delete version rows.
5. **Every file is marked `NOT_SCANNED`.** A malware scanner must be added before production
   (open item). The status field is in place so the scanner only has to update it.
6. **Shares** give one EXTERNAL member read access to one matter's basics (reference, title, type,
   stage, status, client name) and only the documents ticked. Checked on every request, so revoke,
   expiry, removing a document, or suspending the member takes effect immediately. Consent can be
   attached but is not required (DEC-14).
7. **Local storage = S3Proxy** (`andrewgaul/s3proxy:s3proxy-4.1.1`, filesystem backend) in
   docker-compose. MinIO was not chosen: it stopped publishing free community Docker images in
   October 2025.
   Sources: [gigazine.net (2025-10-23)](https://www.gigazine.net/gsc_news/en/20251023-minio-stops-distributing-free-docker-images),
   [rmoff.net comparison (2026-01-14)](https://rmoff.net/2026/01/14/alternatives-to-minio-for-single-node-local-s3/),
   [S3Proxy Dockerfile](https://raw.githubusercontent.com/gaul/s3proxy/master/Dockerfile).
8. **Production:** `STORAGE_DRIVER=s3`, `S3_BUCKET` and `S3_REGION` required; no local fallbacks;
   credentials from the AWS SDK chain (e.g. an IAM role) unless keys are given; optional
   `S3_SSE`. Bucket must block public access.

## Verification

- In-memory store for most integration tests; the S3 code path is tested against a real S3 API
  (`moto` server in the build environment; `S3_TEST_ENDPOINT=http://localhost:9000` runs the same
  test against S3Proxy on the PC).
- S3Proxy itself was not run in the build environment (no Docker there). First run is on the PC.
