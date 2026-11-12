/**
 * Proof that PostgreSQL Row-Level Security (isolation layer 4) works on its own, independent of
 * the application code: these tests talk to the database directly as the API's runtime user.
 */
import {
  DEFAULT_MATTER_STAGES,
  DEFAULT_MATTER_TYPES,
  DEFAULT_REFERENCE_OPTIONS,
} from '@crm/contracts';
import { createPrismaClient } from '@crm/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inviteNewUser, ownerWithWorkspace } from './helpers/flows.js';
import { type TestApp, createTestApp, testDatabaseUrl } from './helpers/test-app.js';

const DEFAULT_OPTION_COUNT = Object.values(DEFAULT_REFERENCE_OPTIONS).flat().length;
const db = createPrismaClient({ connectionString: testDatabaseUrl });
let t: TestApp;
let tenantA: string;
let tenantB: string;
let userInBoth: string;

/** Run raw SQL inside a transaction with the given RLS settings. */
function withRls<T>(
  settings: { tenantId?: string; userId?: string },
  fn: (tx: typeof db) => Promise<T>,
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.tenant_id', ${settings.tenantId ?? ''}, true),
                              set_config('app.user_id', ${settings.userId ?? ''}, true)`;
    return fn(tx as unknown as typeof db);
  });
}

async function count(tx: typeof db, table: string, tenantId: string): Promise<number> {
  const rows = await tx.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM "${table}" WHERE tenant_id = $1::uuid`,
    tenantId,
  );
  return rows[0]?.n ?? -1;
}

beforeAll(async () => {
  t = await createTestApp();
  const a = await ownerWithWorkspace(t, 'rls-a');
  const b = await ownerWithWorkspace(t, 'rls-b');
  tenantA = a.tenantId;
  tenantB = b.tenantId;
  const person = await inviteNewUser(
    t,
    a.owner,
    tenantA,
    { kind: 'STAFF', roleKey: 'case_manager' },
    'rls-p',
  );
  userInBoth = person.userId;
});

afterAll(async () => {
  await t.close();
  await db.$disconnect();
});

describe('database role', () => {
  it('the API connects as a non-superuser without BYPASSRLS', async () => {
    const rows = await db.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });
});

describe('Row-Level Security', () => {
  const tables = [
    'roles',
    'role_permissions',
    'memberships',
    'invitations',
    'audit_logs',
    // Stage 3
    'branches',
    'membership_branches',
    'reference_options',
    'partner_organizations',
    'partner_contacts',
    'professional_profiles',
    'credentials',
    // Stage 4
    'tenant_counters',
    'leads',
    'clients',
    'client_relationships',
    'activities',
    'appointments',
    // Stage 5
    'matter_types',
    'matter_stages',
    'checklist_template_items',
    'matters',
    'matter_assignments',
    'matter_participants',
    'matter_deadlines',
    'checklist_items',
    'matter_status_history',
    'tasks',
    // Stage 6
    'documents',
    'document_versions',
    'consents',
    'resource_shares',
    'share_documents',
  ];

  it('with no tenant context, tenant tables return nothing (fail closed)', async () => {
    await withRls({}, async (tx) => {
      for (const table of tables) expect(await count(tx, table, tenantA), table).toBe(0);
    });
  });

  it("with tenant A context, tenant B's rows are invisible even when queried by id", async () => {
    await withRls({ tenantId: tenantA }, async (tx) => {
      expect(await count(tx, 'roles', tenantA)).toBe(9);
      // Tenant B really has rows (the seeded list values) that stay invisible here.
      expect(await count(tx, 'reference_options', tenantA)).toBe(DEFAULT_OPTION_COUNT);
      for (const table of tables) expect(await count(tx, table, tenantB), table).toBe(0);
    });
  });

  it("tenant B's default matter types exist but only inside tenant B's context", async () => {
    await withRls({ tenantId: tenantB }, async (tx) => {
      expect(await count(tx, 'matter_types', tenantB)).toBe(DEFAULT_MATTER_TYPES.length);
      expect(await count(tx, 'matter_stages', tenantB)).toBe(
        DEFAULT_MATTER_TYPES.length * DEFAULT_MATTER_STAGES.length,
      );
    });
    await withRls({ tenantId: tenantA }, async (tx) => {
      expect(await count(tx, 'matter_types', tenantB)).toBe(0);
    });
  });

  it('document versions cannot be changed or deleted by the API user', async () => {
    await expect(
      withRls(
        { tenantId: tenantA },
        (tx) => tx.$executeRaw`UPDATE document_versions SET file_name = 'x'`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withRls({ tenantId: tenantA }, (tx) => tx.$executeRaw`DELETE FROM document_versions`),
    ).rejects.toThrow(/permission denied/);
  });

  it('matter status history cannot be changed or deleted by the API user', async () => {
    await expect(
      withRls(
        { tenantId: tenantA },
        (tx) => tx.$executeRaw`UPDATE matter_status_history SET reason = 'x'`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withRls({ tenantId: tenantA }, (tx) => tx.$executeRaw`DELETE FROM matter_status_history`),
    ).rejects.toThrow(/permission denied/);
  });

  it("cannot write into tenant B while in tenant A's context", async () => {
    await expect(
      withRls(
        { tenantId: tenantA },
        (tx) =>
          tx.$executeRaw`INSERT INTO roles (id, tenant_id, key, name, updated_at)
                       VALUES (gen_random_uuid(), ${tenantB}::uuid, 'evil', 'Evil', now())`,
      ),
    ).rejects.toThrow(/row-level security/);

    const changed = await withRls(
      { tenantId: tenantA },
      (tx) =>
        tx.$executeRaw`UPDATE memberships SET status = 'REMOVED' WHERE tenant_id = ${tenantB}::uuid`,
    );
    expect(changed).toBe(0);
  });

  it("user context shows only that user's own memberships across tenants", async () => {
    await withRls({ userId: userInBoth }, async (tx) => {
      const rows = await tx.$queryRaw<{ user_id: string }[]>`SELECT user_id FROM memberships`;
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.user_id === userInBoth)).toBe(true);
    });
  });

  it('audit log is append-only, even inside its own tenant', async () => {
    const before = await withRls({ tenantId: tenantA }, (tx) => count(tx, 'audit_logs', tenantA));
    expect(before).toBeGreaterThan(0);
    // App role: no UPDATE/DELETE policy exists, so RLS matches zero rows.
    const updated = await withRls(
      { tenantId: tenantA },
      (tx) =>
        tx.$executeRaw`UPDATE audit_logs SET action = 'tampered' WHERE tenant_id = ${tenantA}::uuid`,
    );
    const deleted = await withRls(
      { tenantId: tenantA },
      (tx) => tx.$executeRaw`DELETE FROM audit_logs WHERE tenant_id = ${tenantA}::uuid`,
    );
    expect(updated).toBe(0);
    expect(deleted).toBe(0);
    await withRls({ tenantId: tenantA }, async (tx) => {
      expect(await count(tx, 'audit_logs', tenantA)).toBe(before);
      const tampered = await tx.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM audit_logs WHERE action = 'tampered'`;
      expect(tampered[0]?.n).toBe(0);
    });
  });

  it('audit trigger also blocks users that bypass RLS (e.g. the owner/superuser)', async () => {
    const ownerUrl = process.env.TEST_MIGRATION_DATABASE_URL;
    if (!ownerUrl) return; // set locally (.env) and in CI
    const owner = createPrismaClient({ connectionString: ownerUrl });
    try {
      const bypass = await owner.$queryRaw<{ bypass: boolean }[]>`
        SELECT (rolsuper OR rolbypassrls) AS bypass FROM pg_roles WHERE rolname = current_user`;
      const attempt = owner.$executeRaw`UPDATE audit_logs SET action = 'tampered' WHERE tenant_id = ${tenantA}::uuid`;
      if (bypass[0]?.bypass) {
        await expect(attempt).rejects.toThrow(/append-only/);
      } else {
        // Non-superuser owner: FORCE ROW LEVEL SECURITY still applies → nothing matched.
        expect(await attempt).toBe(0);
      }
    } finally {
      await owner.$disconnect();
    }
  });
});
