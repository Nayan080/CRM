# ADR-0004: Zod validation, RFC 9457 errors, API conventions

- **Status:** Accepted (2026-11-10, DEC-03). Implemented in Stage 1.
- **Decision:**
  - **Zod** schemas in `packages/contracts` are the single source of validation rules, used by
    web forms and by the API (`ZodValidationPipe`). class-validator is not used.
  - Every error is **RFC 9457** `application/problem+json` with extensions `code` (stable),
    `requestId` and optional field `errors`. 5xx responses never expose internal details.
  - REST under `/api/v1`. Health probes at `/health/live` and `/health/ready` (outside the prefix,
    not rate-limited). Swagger UI at `/api/docs` in non-production only.
  - Cursor pagination, `Idempotency-Key` on create endpoints (from Stage 3).
  - Every request gets an `X-Request-Id` (a safe incoming value is reused). Logs are JSON with
    that id; secrets and auth headers are redacted; query strings are not logged.
- **Consequences:** One error shape for the UI to handle; requests are traceable end to end.
