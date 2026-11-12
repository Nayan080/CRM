# Production readiness checklist

Status after Stage 8 (2026-11-11). **Open items must be done before real client data is stored.**

## Must do before go-live (open)

| #   | Item                                               | Why / notes                                                                                                                                                                                       |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Malware scanning of uploads**                    | Decided 2026-11-10: required before production. Every file is `NOT_SCANNED` today; add a scanner that sets `CLEAN`/`INFECTED` and block downloads of anything not `CLEAN`.                        |
| 2   | **Data retention & deletion rules**                | Architecture question 12 is still open. Offboarding deletion is manual (runbook). Needs business/legal decision.                                                                                  |
| 3   | **Australian privacy / professional-rules review** | DEC-01: Privacy Act 1988 / APPs and any migration-agent rules must be confirmed by qualified advisers.                                                                                            |
| 4   | **Cloud provider and region**                      | AWS proposed (Sydney `ap-southeast-2` or Melbourne `ap-southeast-4`); not confirmed.                                                                                                              |
| 5   | **Storage bucket**                                 | Private bucket, Block Public Access ON, encryption (`S3_SSE`), versioning; IAM role with access to that bucket only; `S3_CREATE_BUCKET` off.                                                      |
| 6   | **Email (ZeptoMail, DEC-02)**                      | Real SMTP credentials; SPF/DKIM for the sender domain. `MAIL_TRANSPORT=smtp` is enforced in production.                                                                                           |
| 7   | **Secrets**                                        | New `JWT_ACCESS_SECRET` and `MFA_ENCRYPTION_KEY` from a secrets manager; never the local values.                                                                                                  |
| 8   | **Database**                                       | Managed PostgreSQL 17, two users (migrations owner + `crm_app` runtime, no superuser/BYPASSRLS), automated backups + a tested restore, TLS. Run `pnpm db:migrate:deploy`.                         |
| 9   | **HTTPS everywhere**                               | Web and API on HTTPS (HSTS and `upgrade-insecure-requests` switch on automatically). `COOKIE_SECURE` defaults to true in production. Set `CORS_ORIGINS` and `WEB_APP_URL` to the real web origin. |
| 10  | **Error monitoring**                               | Tool not chosen yet (e.g. Sentry or CloudWatch).                                                                                                                                                  |
| 11  | **First super admin**                              | `pnpm --filter @crm/api platform:role grant <email> SUPER_ADMIN` after that person turns on 2FA.                                                                                                  |
| 12  | **Scheduler at scale**                             | Reminders run inside the API every minute and visit every active agency for manual deadline reminders. Fine for hundreds of agencies; move to a job queue (e.g. pg-boss) before thousands.        |
| 13  | **Proxy hops**                                     | The API trusts exactly 1 proxy in production (`trust proxy = 1`) to read the client IP. Confirm this matches your load balancer set-up.                                                           |

## Done (built and tested)

- Tenant isolation in 4 layers incl. PostgreSQL RLS; cross-agency attack suite covering every route.
- MFA required for Owner/Admin and platform roles; Argon2id passwords; rotating refresh tokens.
- Strict, per-request nonce Content-Security-Policy on the web app; security headers on the API.
- Uploads checked by content, stored privately, downloads forced and audited.
- Rate limits: strict per-IP limits on login/registration; per-user limits for signed-in requests.
- Audit log (append-only) for security-relevant actions, including platform admin changes.
- Dependency audit (2026-11-11): 1 moderate finding, in ESLint (development tool only, not shipped).
