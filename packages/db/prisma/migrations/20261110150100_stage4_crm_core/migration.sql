-- Stage 4 (part 2 of 2): CRM core — leads, clients, relationships, activities, appointments.
-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('OPEN', 'CONVERTED', 'LOST');

-- CreateEnum
CREATE TYPE "ClientKind" AS ENUM ('INDIVIDUAL', 'BUSINESS');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('NOTE', 'CALL', 'EMAIL', 'MEETING');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "roles_version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "tenant_counters" (
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tenant_counters_pkey" PRIMARY KEY ("tenant_id","key")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID,
    "owner_membership_id" UUID,
    "full_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "phone_digits" TEXT,
    "source_id" UUID,
    "referred_by_partner_id" UUID,
    "referred_by_contact_id" UUID,
    "interest" TEXT,
    "notes" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'OPEN',
    "lost_reason" TEXT,
    "converted_client_id" UUID,
    "converted_at" TIMESTAMP(3),
    "created_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID,
    "client_number" TEXT NOT NULL,
    "kind" "ClientKind" NOT NULL,
    "display_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "phone_digits" TEXT,
    "date_of_birth" DATE,
    "nationality" TEXT,
    "address_line" TEXT,
    "notes" TEXT,
    "created_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_relationships" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "from_client_id" UUID NOT NULL,
    "to_client_id" UUID NOT NULL,
    "type_id" UUID NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lead_id" UUID,
    "client_id" UUID,
    "type" "ActivityType" NOT NULL,
    "summary" TEXT NOT NULL,
    "body" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "actor_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "notes" TEXT,
    "is_consultation" BOOLEAN NOT NULL DEFAULT false,
    "host_membership_id" UUID NOT NULL,
    "lead_id" UUID,
    "client_id" UUID,
    "cancelled_at" TIMESTAMP(3),
    "created_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leads_tenant_id_status_idx" ON "leads"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "leads_tenant_id_owner_membership_id_idx" ON "leads"("tenant_id", "owner_membership_id");

-- CreateIndex
CREATE INDEX "leads_tenant_id_email_idx" ON "leads"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "leads_tenant_id_phone_digits_idx" ON "leads"("tenant_id", "phone_digits");

-- CreateIndex
CREATE UNIQUE INDEX "leads_tenant_id_id_key" ON "leads"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "clients_tenant_id_display_name_idx" ON "clients"("tenant_id", "display_name");

-- CreateIndex
CREATE INDEX "clients_tenant_id_email_idx" ON "clients"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "clients_tenant_id_phone_digits_idx" ON "clients"("tenant_id", "phone_digits");

-- CreateIndex
CREATE UNIQUE INDEX "clients_tenant_id_id_key" ON "clients"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "clients_tenant_id_client_number_key" ON "clients"("tenant_id", "client_number");

-- CreateIndex
CREATE UNIQUE INDEX "client_relationships_tenant_id_id_key" ON "client_relationships"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "client_relationships_from_client_id_to_client_id_type_id_key" ON "client_relationships"("from_client_id", "to_client_id", "type_id");

-- CreateIndex
CREATE INDEX "activities_tenant_id_lead_id_occurred_at_idx" ON "activities"("tenant_id", "lead_id", "occurred_at");

-- CreateIndex
CREATE INDEX "activities_tenant_id_client_id_occurred_at_idx" ON "activities"("tenant_id", "client_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "activities_tenant_id_id_key" ON "activities"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "appointments_tenant_id_starts_at_idx" ON "appointments"("tenant_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_tenant_id_host_membership_id_starts_at_idx" ON "appointments"("tenant_id", "host_membership_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_tenant_id_id_key" ON "appointments"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "tenant_counters" ADD CONSTRAINT "tenant_counters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_owner_membership_id_fkey" FOREIGN KEY ("tenant_id", "owner_membership_id") REFERENCES "memberships"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_source_id_fkey" FOREIGN KEY ("tenant_id", "source_id") REFERENCES "reference_options"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_referred_by_partner_id_fkey" FOREIGN KEY ("tenant_id", "referred_by_partner_id") REFERENCES "partner_organizations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_referred_by_contact_id_fkey" FOREIGN KEY ("tenant_id", "referred_by_contact_id") REFERENCES "partner_contacts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_converted_client_id_fkey" FOREIGN KEY ("tenant_id", "converted_client_id") REFERENCES "clients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_relationships" ADD CONSTRAINT "client_relationships_tenant_id_from_client_id_fkey" FOREIGN KEY ("tenant_id", "from_client_id") REFERENCES "clients"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_relationships" ADD CONSTRAINT "client_relationships_tenant_id_to_client_id_fkey" FOREIGN KEY ("tenant_id", "to_client_id") REFERENCES "clients"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_relationships" ADD CONSTRAINT "client_relationships_tenant_id_type_id_fkey" FOREIGN KEY ("tenant_id", "type_id") REFERENCES "reference_options"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_tenant_id_lead_id_fkey" FOREIGN KEY ("tenant_id", "lead_id") REFERENCES "leads"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_tenant_id_client_id_fkey" FOREIGN KEY ("tenant_id", "client_id") REFERENCES "clients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_host_membership_id_fkey" FOREIGN KEY ("tenant_id", "host_membership_id") REFERENCES "memberships"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_lead_id_fkey" FOREIGN KEY ("tenant_id", "lead_id") REFERENCES "leads"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_client_id_fkey" FOREIGN KEY ("tenant_id", "client_id") REFERENCES "clients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_tenant_id_actor_membership_id_fkey" FOREIGN KEY ("tenant_id", "actor_membership_id") REFERENCES "memberships"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════════
-- Hand-written section (not generated by Prisma)
-- ═════════════════════════════════════════════════════════════════════════════

-- An activity belongs to exactly one lead or one client.
ALTER TABLE "activities" ADD CONSTRAINT "activities_one_subject"
  CHECK (num_nonnulls("lead_id", "client_id") = 1);

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_time_order"
  CHECK ("ends_at" > "starts_at");

-- Row-Level Security: every Stage 4 table is visible and writable only inside the active tenant.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenant_counters', 'leads', 'clients', 'client_relationships', 'activities', 'appointments'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = app_setting_uuid(''app.tenant_id'')) WITH CHECK (tenant_id = app_setting_uuid(''app.tenant_id''))',
      t || '_isolation', t);
  END LOOP;
END $$;

-- Default values for the new lists in existing workspaces (from the product brief: referral source
-- §3; family members, dependants and business contacts §2.2 D / §5.3). Keep in sync with
-- packages/contracts/src/reference-defaults.ts. reference_options already has RLS, so the tenant
-- context is set per workspace (works whether or not the migration user bypasses RLS).
DO $$
DECLARE t RECORD;
BEGIN
  FOR t IN SELECT id FROM "tenants" LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    INSERT INTO "reference_options" ("id", "tenant_id", "category", "key", "name", "sort_order", "updated_at")
    SELECT gen_random_uuid(), t.id, d.category::"ReferenceCategory", d.key, d.name, d.sort_order, now()
    FROM (VALUES
      ('LEAD_SOURCE', 'referral', 'Referral', 1),
      ('LEAD_SOURCE', 'other', 'Other', 99),
      ('RELATIONSHIP_TYPE', 'family_member', 'Family member', 1),
      ('RELATIONSHIP_TYPE', 'dependant', 'Dependant', 2),
      ('RELATIONSHIP_TYPE', 'business_contact', 'Business contact', 3),
      ('RELATIONSHIP_TYPE', 'other', 'Other', 99)
    ) AS d(category, key, name, sort_order)
    ON CONFLICT ("tenant_id", "category", "key") DO NOTHING;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;
