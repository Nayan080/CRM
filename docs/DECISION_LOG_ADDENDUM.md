# Decision log — addendum

Continues the decision log in `docs/ARCHITECTURE.md` (DEC-01 … DEC-16). That file is read-only in
the working copy, so later decisions are recorded here. Earlier ones, for reference:
DEC-13 generic editable matter types · DEC-14 consent optional for sharing · DEC-15 storage
provider later (S3 API only) · DEC-16 no card payments.

| Date       | #      | Decision                                                                       | Notes                                                                                                          |
| ---------- | ------ | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| 2026-11-10 | DEC-17 | **Uploads: PDF, JPG, PNG, DOCX · max 20 MB**                                   | Checked by content. Malware scanning required before production (not built yet). ADR-0007.                     |
| 2026-11-10 | DEC-18 | **Local S3 = S3Proxy** (`andrewgaul/s3proxy:s3proxy-4.1.1`)                    | MinIO stopped free community images (Oct 2025). Production provider still per DEC-15. ADR-0007.                |
| 2026-11-11 | DEC-19 | **Reports:** leads & referrals, matters, team workload, documents & sharing    | Per agency; each report applies the viewer's access scope.                                                     |
| 2026-11-11 | DEC-20 | **Plan limit: staff users only**                                               | Set by a platform admin; pending staff invitations count; external collaborators do not.                       |
| 2026-11-11 | DEC-21 | **First super admin via server command**                                       | `pnpm --filter @crm/api platform:role grant <email> SUPER_ADMIN`. Platform roles need 2FA; metadata only.      |
| 2026-11-11 | DEC-22 | **No AI for now**                                                              | AI-assist deferred; provider and client-data handling to be decided first.                                     |
| 2026-11-11 | DEC-23 | **Automation:** stage task templates, deadline reminders, lead follow-up nudge | All off by default per agency. No integrations for now (no daily digest, CSV export, webhooks, calendar feed). |
