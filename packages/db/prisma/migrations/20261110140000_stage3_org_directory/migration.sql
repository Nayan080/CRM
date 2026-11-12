-- CreateEnum
CREATE TYPE "ReferenceCategory" AS ENUM ('PROFESSION_TYPE', 'PARTNER_TYPE');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "address_line" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "contact_email" TEXT,
ADD COLUMN     "legal_name" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "postcode" TEXT,
ADD COLUMN     "region" TEXT,
ADD COLUMN     "website" TEXT;

-- AlterTable
ALTER TABLE "invitations" ADD COLUMN     "branch_ids" UUID[] DEFAULT ARRAY[]::UUID[];

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address_line" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postcode" TEXT,
    "phone" TEXT,
    "timezone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_branches" (
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,

    CONSTRAINT "membership_branches_pkey" PRIMARY KEY ("membership_id","branch_id")
);

-- CreateTable
CREATE TABLE "reference_options" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "category" "ReferenceCategory" NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reference_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_organizations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type_id" UUID NOT NULL,
    "website" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "created_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "partner_organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_contacts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "partner_org_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "position" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "partner_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "professional_profiles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "profession_type_id" UUID NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "organization_name" TEXT,
    "partner_org_id" UUID,
    "notes" TEXT,
    "created_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "professional_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credentials" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "credential_type" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "issued_on" DATE,
    "expires_on" DATE,
    "status" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verified_at" TIMESTAMP(3),
    "verified_by_membership_id" UUID,
    "verification_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "branches_tenant_id_id_key" ON "branches"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "branches_tenant_id_name_key" ON "branches"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "membership_branches_tenant_id_branch_id_idx" ON "membership_branches"("tenant_id", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "reference_options_tenant_id_id_key" ON "reference_options"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "reference_options_tenant_id_category_key_key" ON "reference_options"("tenant_id", "category", "key");

-- CreateIndex
CREATE INDEX "partner_organizations_tenant_id_name_idx" ON "partner_organizations"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "partner_organizations_tenant_id_id_key" ON "partner_organizations"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "partner_contacts_tenant_id_partner_org_id_idx" ON "partner_contacts"("tenant_id", "partner_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "partner_contacts_tenant_id_id_key" ON "partner_contacts"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "professional_profiles_tenant_id_full_name_idx" ON "professional_profiles"("tenant_id", "full_name");

-- CreateIndex
CREATE UNIQUE INDEX "professional_profiles_tenant_id_id_key" ON "professional_profiles"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "credentials_tenant_id_profile_id_idx" ON "credentials"("tenant_id", "profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "credentials_tenant_id_id_key" ON "credentials"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_branches" ADD CONSTRAINT "membership_branches_tenant_id_membership_id_fkey" FOREIGN KEY ("tenant_id", "membership_id") REFERENCES "memberships"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_branches" ADD CONSTRAINT "membership_branches_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_options" ADD CONSTRAINT "reference_options_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_organizations" ADD CONSTRAINT "partner_organizations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_organizations" ADD CONSTRAINT "partner_organizations_tenant_id_type_id_fkey" FOREIGN KEY ("tenant_id", "type_id") REFERENCES "reference_options"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_contacts" ADD CONSTRAINT "partner_contacts_tenant_id_partner_org_id_fkey" FOREIGN KEY ("tenant_id", "partner_org_id") REFERENCES "partner_organizations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_profiles" ADD CONSTRAINT "professional_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_profiles" ADD CONSTRAINT "professional_profiles_tenant_id_profession_type_id_fkey" FOREIGN KEY ("tenant_id", "profession_type_id") REFERENCES "reference_options"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_profiles" ADD CONSTRAINT "professional_profiles_tenant_id_partner_org_id_fkey" FOREIGN KEY ("tenant_id", "partner_org_id") REFERENCES "partner_organizations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_tenant_id_profile_id_fkey" FOREIGN KEY ("tenant_id", "profile_id") REFERENCES "professional_profiles"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════════
-- Hand-written section (not generated by Prisma). See docs/adr/0006-row-level-security-implementation.md
-- ═════════════════════════════════════════════════════════════════════════════

-- Default list values for tenants that already exist (new tenants get them from the API on creation).
-- Keep in sync with packages/contracts/src/reference-defaults.ts.
INSERT INTO "reference_options" ("id", "tenant_id", "category", "key", "name", "sort_order", "updated_at")
SELECT gen_random_uuid(), t.id, d.category::"ReferenceCategory", d.key, d.name, d.sort_order, CURRENT_TIMESTAMP
FROM "tenants" t
CROSS JOIN (VALUES
  ('PROFESSION_TYPE', 'migration_agent', 'Migration Agent', 1),
  ('PROFESSION_TYPE', 'migration_lawyer', 'Migration Lawyer', 2),
  ('PROFESSION_TYPE', 'legal_consultant', 'Legal Consultant', 3),
  ('PROFESSION_TYPE', 'accountant', 'CA / Accountant', 4),
  ('PROFESSION_TYPE', 'broker', 'Broker', 5),
  ('PROFESSION_TYPE', 'education_consultant', 'Education Consultant', 6),
  ('PROFESSION_TYPE', 'other', 'Other', 99),
  ('PARTNER_TYPE', 'referral_agency', 'Referral Agency', 1),
  ('PARTNER_TYPE', 'accounting_firm', 'Accounting Firm', 2),
  ('PARTNER_TYPE', 'education_agency', 'Education Agency', 3),
  ('PARTNER_TYPE', 'law_firm', 'Law Firm', 4),
  ('PARTNER_TYPE', 'recruitment_agency', 'Recruitment Agency', 5),
  ('PARTNER_TYPE', 'employer_sponsor', 'Employer / Sponsor', 6),
  ('PARTNER_TYPE', 'other', 'Other', 99)
) AS d(category, key, name, sort_order)
ON CONFLICT ("tenant_id", "category", "key") DO NOTHING;

-- Row-Level Security: every Stage 3 table is visible and writable only inside the active tenant.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'branches', 'membership_branches', 'reference_options',
    'partner_organizations', 'partner_contacts', 'professional_profiles', 'credentials'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = app_setting_uuid(''app.tenant_id'')) WITH CHECK (tenant_id = app_setting_uuid(''app.tenant_id''))',
      t || '_isolation', t);
  END LOOP;
END $$;
