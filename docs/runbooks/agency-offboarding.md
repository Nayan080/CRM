# Runbook: suspending and offboarding an agency

Platform roles only (Stage 7). Platform admins see agency metadata, never client data.

## Grant the first super admin (server command, once)

The person registers normally and turns on two-factor authentication. Then, on the server:

```bash
pnpm --filter @crm/api build            # if not built
pnpm --filter @crm/api platform:role grant someone@example.com SUPER_ADMIN
pnpm --filter @crm/api platform:role list
pnpm --filter @crm/api platform:role revoke someone@example.com SUPER_ADMIN
```

Roles: `SUPER_ADMIN` (view + change), `SUPPORT` (view only). Every change is audited.

## Suspend (temporary)

Platform → Agencies → choose **Suspended**, give a reason → **Change status**.

- Takes effect on the agency's next request: members see "This workspace is suspended".
- Nothing is deleted. Invitations cannot be accepted while suspended.
- The change and reason are written to the agency's own audit log.
- Re-activate the same way (status **Active**, with a reason).

## Offboard (agency leaving)

1. Agree the end date and what the agency gets back. **Data retention and deletion rules are
   still an open decision** (architecture question 12): confirm them with the business and legal
   advisers before deleting anything.
2. Set status **Pending deletion** with the reason. Access stops at once, as with suspension.
3. Export for the agency (manual for now): database rows for that `tenant_id` and the storage
   prefix `tenants/<tenant-id>/` in the documents bucket.
4. After the agreed retention period, delete the tenant's rows and storage prefix. This step is
   **not automated yet**; it must be scripted and reviewed before the first real offboarding.
5. Record the deletion date and who approved it (outside the database, since the audit log is
   deleted with the tenant).
