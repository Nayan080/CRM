# Migration Business Management CRM
## Full Product Brief, Architecture Plan & Claude Code Starting Instructions

**Project type:** Greenfield, multi-tenant SaaS  
**Primary market assumption:** Migration agencies and associated professionals  
**Status:** Product concept and architecture proposal — validate legal, operational and commercial requirements before production use.

---

# 1. Executive Summary

Build a secure, scalable, multi-tenant SaaS platform for migration agencies and the professionals and businesses who collaborate with them.

Multiple independent agencies will register and use the same application. Each agency receives its own workspace. Its users, branches, leads, clients, matters, documents, tasks, settings and reports must be isolated from every other agency by default.

The product is broader than a generic sales CRM. It combines:

- CRM and lead management
- Client onboarding and relationship management
- Migration matter/case management
- Professional directory
- Partner and referral management
- Secure document management
- Tasks, appointments and communications
- Reporting and operational analytics
- Optional client and partner collaboration portals
- SaaS tenant, subscription and platform administration

The product should be designed as a modular platform. Do not attempt to generate the entire application in one pass.

# 2. Product Vision and Users

## 2.1 Product positioning

Working product description: **Migration Business Management CRM**.

The platform should connect migration agencies, migration agents, migration lawyers, case managers, CAs/accountants, brokers, education consultants, referral partners and clients while keeping agency data private and access controlled.

This is a product-planning assumption, not a claim that every profession has the same legal authority. The system must support configurable professional types and credentials. It must not imply that a person is legally authorized to provide migration or legal advice merely because they have a profile.

## 2.2 User categories

### A. Platform-level users

- Super Admin / Platform Operator
- Platform Support (restricted and audited access)
- Billing or Subscription Administrator

Platform roles manage SaaS operations. They are distinct from agency roles. Platform administration must not automatically grant unrestricted access to private client or case documents.

### B. Agency users and professional directory

Agency roles may include:

- Agency Owner
- Agency Admin
- Branch Manager
- Migration Agent
- Migration Lawyer / Legal Professional
- Case Manager
- Sales / Lead Manager
- Receptionist
- Accounts / Finance Manager
- CA / Accountant
- Broker / Referral Partner
- Education Consultant
- External Legal Consultant
- Employer / Sponsor Contact

Important distinction:
- An **account identity** is a login identity.
- A **membership** grants a user access to a particular agency and defines their role there.
- A **professional profile** describes a person's professional details and may exist without login access.
- A person may belong to more than one agency through separate memberships, if explicitly invited and authorized.

Do not make every professional profile a login account. Do not make every professional associated with an agency an employee.

### C. External partner organizations

Examples:
- Referral agencies
- Accounting firms
- Education agencies
- Law firms
- Recruitment agencies
- Employers and sponsors

A partner organization may have multiple partner contacts. A partner relationship does not automatically grant access to the agency's tenant data.

### D. Clients

- Individual clients
- Business clients
- Family members / dependants linked to an individual client's matter where appropriate

Client access to a portal is optional and must be separately authorized.

# 3. Example Client and Matter Journey

An illustrative journey:

1. A potential client is referred by a broker or partner.
2. The agency records the lead and referral source.
3. The agency contacts the lead and schedules a consultation.
4. After onboarding, the lead is converted or linked to a client record.
5. A migration matter is opened and assigned to an authorized professional or case team.
6. The team tracks matter stages, tasks, deadlines and required documents.
7. The agency may explicitly share selected matter information with an external lawyer, accountant or other professional.
8. The client receives updates through approved communication channels or a client portal.
9. The matter is completed, closed or archived according to retention rules.

Not every matter requires a broker, CA, lawyer or every other professional. The workflow must be configurable.

# 4. SaaS and Multi-Tenant Architecture

## 4.1 Confirmed product decision

This is a **multi-tenant SaaS CRM**. Multiple independent migration agencies will register and use one shared platform.

Recommended initial approach:
- One application deployment.
- Shared PostgreSQL database.
- Tenant-owned records carry a tenant/organization scope.
- Enforce tenant isolation in backend authorization and data access.
- Consider PostgreSQL Row-Level Security (RLS) as an additional defence-in-depth control after careful design and testing.

A shared database is a starting architecture, not a reason to weaken isolation. Reassess separate schemas or databases if regulatory, contractual, scale or customer requirements later demand it.

## 4.2 Tenant registration and onboarding

Owner-led, invitation-based onboarding is the selected default:

1. An agency owner registers using name, work email and password.
2. The system verifies the email and creates the tenant/workspace.
3. The registering account receives the first OWNER membership.
4. The owner completes agency profile and optional branch setup.
5. The owner or authorized admin invites employees and associated professionals.
6. Invitees accept a tenant-scoped, expiring, single-use invitation.
7. A user may belong to multiple tenants through separate memberships.
8. After login, the user selects or switches between workspaces for which they have active membership.

Requirements:
- Public registration must never create a Super Admin.
- Invitation tokens must be securely generated, stored safely (preferably hashed), expire, be single-use and be revocable.
- Support accept, expiry, cancellation and resend flows.
- Verify email and invitation recipient identity.
- Membership role and status are tenant-specific.
- Removing a membership must revoke that user's access to that tenant without necessarily deleting their global account or other memberships.
- Define owner transfer and last-owner protection rules.
- Tenant suspension and deletion must follow explicit retention and legal review policies.

## 4.3 Tenant isolation rules

- Never trust a tenant ID supplied by the browser as proof of access.
- Derive active tenant context from an authenticated user and verified membership.
- Every tenant-owned read, write, update, delete, search, export and file operation must enforce tenant scope.
- Prevent IDOR/BOLA vulnerabilities: guessing another tenant's record ID must not reveal or modify it.
- Apply authorization in backend services/queries, not only frontend route guards.
- Use tenant-scoped unique constraints where business data is unique per tenant.
- Add automated tests for cross-tenant access attempts.
- Background jobs, exports, notifications and scheduled tasks must carry and validate tenant context.
- Audit sensitive access and administrative changes.
- Use secure object storage paths and short-lived authorized download URLs; never rely on obscure file paths as access control.

# 5. Conceptual Domain Model

This is a conceptual starting point. Review and refine relationships, constraints, cardinalities, indexes, deletion rules and normalization before final schema implementation.

## 5.1 SaaS and identity

- **Tenant / Organization:** One agency workspace.
- **Branch:** A location or operating unit belonging to a tenant.
- **User:** Global login identity, such as email and authentication details.
- **Membership:** Relationship between a User and a Tenant, including role, status and branch scope.
- **Role / Permission:** Tenant-level access policy. Consider permissions as granular capabilities rather than relying only on role names.
- **Invitation:** Tenant-scoped invitation to join a workspace.
- **Subscription / Plan:** SaaS commercial entitlement and billing status; build after core CRM unless needed for initial registration.

A user may have multiple memberships. A tenant-owned record must have a clear tenant scope.

## 5.2 Professional and partner directory

- **ProfessionalProfile:** Person's professional details, profession type, credentials, registration information, verification status and contact details. May be directory-only.
- **PartnerOrganization:** Independent external business or organization.
- **PartnerContact:** Person associated with a PartnerOrganization.
- **ProfessionalOrganizationRelationship:** Optional relationship connecting a professional to an agency or partner organization, with relationship type and dates.
- **Credential / Verification:** Optional structured records for licenses, registrations, qualification and verification evidence.

Do not assume credential validity. Store issuer, identifier, dates, status and verification evidence where appropriate; verification status should be explicit.

## 5.3 CRM and client domain

- **Lead:** Potential client or business opportunity, including source, status, owner, interest and activity history.
- **Client:** Individual or business receiving services.
- **ClientContact / Relationship:** Optional supporting records for business contacts and family/dependant relationships.
- **Consultation / Appointment:** Scheduled meeting or consultation.
- **Activity:** Calls, emails, notes, meetings and other timeline events, with appropriate privacy and audit controls.

Define lead conversion carefully to avoid duplicate clients and preserve source attribution.

## 5.4 Migration matter domain

- **Matter / MigrationCase:** A service engagement or migration case owned by one tenant.
- **MatterType / ServiceType:** Configurable service or case category.
- **MatterStage:** Configurable workflow stage.
- **MatterParticipant:** Internal or external person/organization with a defined role and scope.
- **MatterAssignment:** Assigned staff and responsibility.
- **MatterDeadline:** Due dates and reminder rules.
- **MatterChecklist / ChecklistItem:** Configurable requirements by service or case type.
- **MatterStatusHistory:** Track stage and status changes.

Do not hardcode every visa subclass or workflow as a permanent enum. Use configurable reference data and versioned workflow templates where suitable. Validate country-specific terminology and legal process requirements with subject-matter experts.

## 5.5 Documents and collaboration

- **Document:** Metadata, tenant, storage key, classification, related client/matter, uploader, timestamps and status.
- **DocumentVersion:** Version history and replacement tracking.
- **DocumentRequirement:** Required document checklist item.
- **ResourceShare / ExternalOrganizationAccess:** Explicitly grants access to selected resources to an external party.
- **Consent:** Records the relevant person's consent, purpose, scope, timestamp, expiry/withdrawal and evidence where required.
- **AuditLog:** Security and business audit trail for sensitive actions.

External collaboration must be explicit, scoped, revocable, time-bound where appropriate and auditable. A partner must not gain broad tenant access merely by being listed in a directory.

## 5.6 Operations and growth

- **Task:** Work item with assignee, due date, priority, status and optional related record.
- **Notification:** In-app/email notification preferences and delivery status.
- **Referral:** Referrer, referred lead/client, tenant, attribution, status and agreement reference.
- **Communication:** Email/message metadata and links to related records; avoid storing unnecessary sensitive message content.
- **Invoice / Payment:** Optional billing domain, subject to accounting and payment-provider requirements.
- **Report / Dashboard:** Tenant-scoped operational metrics.
- **Integration:** Credentials/configuration stored securely, with per-tenant scopes and audit trails.

# 6. Suggested Technology Stack

Recommended stack, subject to team and infrastructure approval:

### Frontend
- Next.js with TypeScript
- Tailwind CSS
- shadcn/ui
- TanStack Query
- React Hook Form
- Zod
- A suitable state-management approach only where server state/context does not suffice

### Backend
- NestJS with TypeScript
- REST API initially, documented with Swagger/OpenAPI
- PostgreSQL
- Prisma ORM
- DTO validation using class-validator/class-transformer or a consistently selected validation strategy
- JWT access tokens and secure refresh/session strategy
- RBAC plus resource-level authorization

### Supporting services
- Object storage such as AWS S3 or equivalent for sensitive documents
- Email provider such as Zoho ZeptoMail or another approved transactional provider
- Background job/queue infrastructure when asynchronous workloads are introduced
- Centralized structured logging and error monitoring
- Automated tests: Jest and API/integration tests; Playwright for key browser workflows
- CI pipeline for lint, typecheck, tests, build and migration validation

Do not add all optional infrastructure on day one. Recommend a minimum viable setup and explain when additional services become necessary.

# 7. Product Modules and Priorities

## P0 — Core foundation

1. Authentication, sessions and password reset
2. Tenant registration and workspace onboarding
3. Memberships, invitations, roles and permissions
4. Tenant and branch management
5. Professional directory
6. Partner organization and partner contact management
7. Lead and enquiry management
8. Client management
9. Migration matter/case management
10. Document metadata and secure upload/download
11. Tasks, appointments and activity timeline
12. Audit logging and tenant-isolation tests

## P1 — Operational completeness

1. Referral management
2. Configurable case workflows and checklists
3. Email/in-app notifications
4. Client portal with scoped access
5. External professional collaboration and resource sharing
6. Reports and analytics
7. Billing/invoices, if confirmed in scope

## P2 — Advanced capabilities

1. Workflow automation
2. Document OCR and AI-assisted extraction/classification
3. AI-supported discrepancy flags with human review
4. Advanced analytics
5. External integrations
6. SaaS subscription self-service and advanced usage metering

AI must not make legal eligibility decisions, provide unsupervised legal advice, submit applications automatically or replace authorized professional review. Human review is required for extracted data and important decisions.

# 8. Security, Privacy and Compliance by Design

The platform may process highly sensitive identity, immigration, family, employment and financial information.

Design for:
- Least privilege and role/resource-level access
- Strong tenant isolation
- Encryption in transit and at rest
- Secure password hashing
- Secure token/session lifecycle and revocation
- MFA as a planned security enhancement
- Audit logging for access to sensitive documents and records
- Secure file type/size validation and malware scanning where available
- Short-lived, authorized file access URLs
- Backup, recovery and incident response
- Data retention, deletion, export and legal hold policies
- Consent and disclosure records where applicable
- Data residency and privacy obligations for target markets
- Secrets management and environment separation
- Rate limiting, secure headers, CORS and input validation

Do not claim regulatory compliance merely because security controls exist. Confirm the applicable jurisdictions, privacy laws, professional obligations, retention requirements and contractual obligations with qualified advisers.

Never assume government immigration portals expose public APIs or permit automated access. Verify official documentation, authorization and terms before designing integrations.

# 9. UX and Application Areas

Suggested application navigation:

### Platform administration
- Platform overview
- Tenants/agencies
- Plans and subscriptions
- Platform configuration
- Support operations
- Audit and platform health

### Agency workspace
- Dashboard
- Leads and enquiries
- Clients
- Matters / Cases
- Calendar and appointments
- Tasks
- Documents
- Professionals
- Partners and referrals
- Reports
- Team and branches
- Settings

The UI must respect role permissions. Empty, loading, error, success, unauthorized and no-results states are required. Use responsive, accessible layouts and consistent design tokens. Avoid exposing sensitive data in dashboard previews or notifications unnecessarily.

# 10. Development Roadmap

Build incrementally, with review gates.

### Stage 0 — Discovery and architecture
- Confirm target jurisdictions, customer types and workflows.
- Confirm SaaS vs agency feature boundaries.
- Produce architecture diagram and threat model.
- Produce ERD and schema proposal.
- Define API conventions and authorization model.
- Identify legal/compliance questions and unresolved assumptions.
- Do not implement business modules yet.

### Stage 1 — Repository and engineering foundation
- Decide monorepo vs separate repositories with rationale.
- Create frontend and backend apps.
- Configure environment variables and secrets policy.
- Configure database and Prisma migrations.
- Set up linting, formatting, typechecking and CI.
- Add health checks, structured logs and API docs.

### Stage 2 — Tenant and identity foundation
- User registration and email verification.
- Tenant creation and owner membership.
- Login/logout, session/refresh strategy and password reset.
- Invitations and membership lifecycle.
- Workspace selection/switching.
- RBAC and tenant context.
- Cross-tenant security tests.

### Stage 3 — Organization and directory
- Tenant profile and branches.
- Agency team management.
- Professional profiles.
- Partner organizations and contacts.
- Credential metadata and verification states.

### Stage 4 — CRM core
- Lead capture and pipeline.
- Lead assignment and activities.
- Consultations.
- Client creation and lead conversion.
- Duplicate detection and source attribution.

### Stage 5 — Matter operations
- Matter creation and assignment.
- Configurable matter types and stages.
- Participants and deadlines.
- Tasks, appointments and checklists.
- Matter timeline and status history.

### Stage 6 — Documents and collaboration
- Secure storage.
- Document metadata, versions and requirements.
- Scoped sharing and consent.
- Audit trails for sensitive access.
- Client/partner portal only after security review.

### Stage 7 — Reporting and SaaS operations
- Tenant-scoped reports.
- Referral analytics.
- Subscription plans and billing.
- Usage limits and platform administration.
- Tenant suspension and offboarding procedures.

### Stage 8 — Advanced capabilities
- Automation.
- AI document assistance with human review.
- Verified integrations.
- Performance, resilience and security hardening.

# 11. Non-Functional Requirements and Quality Gates

- Modular, maintainable code and clear domain boundaries.
- Consistent API response and error format.
- Server-side validation and authorization.
- Database indexes and pagination for list endpoints.
- Idempotency for operations where retries could create duplicates.
- No secrets in source control.
- Migrations must be reviewed and tested.
- Unit, integration and end-to-end coverage for critical workflows.
- Cross-tenant tests are mandatory.
- Accessibility and responsive behavior.
- Backup and restore testing before production.
- Monitoring and operational runbooks.
- Document architectural decisions (ADRs).

A phase is not complete just because screens exist. It must meet acceptance criteria, pass applicable checks and have a clear test report.

# 12. Open Questions to Resolve Before Production

Do not silently invent answers. Record assumptions and ask the project owner/TL for decisions where needed.

1. Which countries and migration jurisdictions are in scope at launch?
2. Is the product for Australian migration businesses first, or multiple countries?
3. Which exact user roles and permissions are required for MVP?
4. Can clients log in at launch, or is the client portal later?
5. Can external professionals be invited to selected matters in MVP?
6. What are the first supported matter/service types?
7. Which currencies, time zones and languages are needed?
8. Which email, SMS and storage providers are approved?
9. What privacy, data residency, retention and deletion requirements apply?
10. Is subscription billing required in the first release?
11. What is the expected number of tenants, users and documents?
12. Which integrations are required and officially supported?

# 13. Competitor and Market Research Notes

Research previously considered migration-specific platforms including Officio, ImmiDesk, LodgeHQ and Agentcis, alongside general CRM/platform references such as Zoho CRM, HubSpot and Microsoft Dataverse.

Use this as an initial research shortlist, not verified current product documentation. Recheck current vendor websites, product demos, pricing, feature availability and target-market fit before making product decisions.

General positioning hypothesis:
- Generic CRMs provide general lead, contact, pipeline, task and automation capabilities.
- Migration-specific products may include specialized matter workflows, document requirements and practice operations.
- The proposed product's strategic hypothesis is a strong combination of migration case management, professional directory, partner/referral management and secure cross-organization collaboration.

Do not claim that any feature is unique or missing from competitors without current evidence and customer validation. Interview migration agencies and professionals to identify actual workflow pain points.

# 14. Claude Code — First Task Prompt

Paste the following prompt into Claude Code after placing this brief in the project workspace (for example, as `docs/PRODUCT_BRIEF.md`).

---

You are acting as the **Senior Software Architect and Technical Lead** for a completely new Migration Business Management CRM.

Read the entire `docs/PRODUCT_BRIEF.md` before doing anything. This is a greenfield project: no existing frontend, backend, database, authentication system or CRM modules are assumed.

## Your first task: architecture and implementation plan only

Do not start implementing the application yet.

1. Inspect the current working directory and identify whether it is empty or contains any existing files. Do not overwrite or delete anything.
2. Read and follow the product brief. Treat confirmed decisions as requirements and clearly label assumptions and unresolved questions.
3. Propose a practical architecture for a multi-tenant SaaS CRM using the recommended stack, but explain alternatives where a decision is consequential.
4. Decide whether a monorepo or separate repositories is more appropriate for this project and explain why.
5. Produce:
   - System context and container/component architecture.
   - Frontend and backend module boundaries.
   - Tenant registration, invitation, login and workspace-switching flows.
   - Tenant context and authorization strategy.
   - RBAC and resource-level access model.
   - Database ERD and proposed Prisma model design.
   - API module breakdown and representative endpoint contracts.
   - Secure document storage and scoped external-sharing design.
   - Testing strategy, especially cross-tenant isolation tests.
   - Deployment, environment, secrets, logging and backup strategy.
   - Phased implementation plan with dependencies and acceptance criteria.
6. Identify risks, trade-offs, security threats and missing business decisions.
7. Distinguish MVP requirements from later-stage features. Do not overengineer the first release.
8. Do not invent government API availability, legal rules, compliance certifications or unverified competitor capabilities.

## Repository and change-control rules

- Do not create or modify application source files during this first task.
- Do not install packages.
- Do not run database migrations.
- Do not create cloud resources.
- Do not commit, push or deploy.
- Do not perform destructive operations.
- You may propose documentation files and their contents, but wait for approval before creating them if the directory already contains project work.

## Expected response

Present the proposed architecture in a structured, reviewable format. Include diagrams using Mermaid where useful. Include an initial ERD with entities, key relationships and tenant ownership. Explain how a user who belongs to two agencies is safely handled. Explain how a partner professional can receive access to one shared matter without seeing the rest of either agency's data.

Finish with:
- Recommended architecture decisions.
- Assumptions.
- Questions requiring the product owner's/TL's decision.
- Proposed implementation phases.
- Exact first implementation milestone and its acceptance criteria.

**Stop after the architecture proposal and wait for explicit approval. Do not begin coding.**

---

# 15. How to Use This Brief

1. Create a new project folder or open the intended empty repository.
2. Save this file as `docs/PRODUCT_BRIEF.md` (or place it at the repository root if the `docs` folder does not exist).
3. Open Claude Code in that project directory.
4. Paste the complete “Claude Code — First Task Prompt” section.
5. Review Claude's architecture, tenant isolation strategy and ERD with your TL before approving implementation.
6. After approval, ask Claude to implement only Stage 1, then review and test it before proceeding.

**Important:** This brief is a starting product and technical specification. It is not a substitute for confirming requirements with the TL, migration professionals, security specialists and legal/compliance advisers.
