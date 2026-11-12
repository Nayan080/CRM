/**
 * Grant or revoke a platform role from the server (the only way to create the first super admin).
 *   node dist/cli/platform-role.js grant  someone@example.com SUPER_ADMIN
 *   node dist/cli/platform-role.js revoke someone@example.com SUPER_ADMIN
 *   node dist/cli/platform-role.js list
 * The user must already have an account. Every change is written to the audit log.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// The CLI runs outside the Nest app, so it uses the client directly (same runtime DB user).
// eslint-disable-next-line no-restricted-imports
import { createPrismaClient } from '@crm/db';
import { PLATFORM_ROLES, type PlatformRole } from '@crm/contracts';

function loadLocalEnvFile(): void {
  if (process.env.NODE_ENV === 'production') return;
  const rootEnv = fileURLToPath(new URL('../../../../.env', import.meta.url)); // dist/cli -> repo root
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
}

async function main(): Promise<number> {
  loadLocalEnvFile();
  const [action, email, role] = process.argv.slice(2);
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('DATABASE_URL is not set.\n');
    return 1;
  }
  const db = createPrismaClient({ connectionString: url });
  try {
    if (action === 'list') {
      const rows = await db.platformRoleAssignment.findMany({
        select: { role: true, createdAt: true, user: { select: { email: true } } },
        orderBy: { createdAt: 'asc' },
      });
      for (const r of rows)
        process.stdout.write(`${r.user.email}\t${r.role}\t${r.createdAt.toISOString()}\n`);
      if (!rows.length) process.stdout.write('No platform roles.\n');
      return 0;
    }
    if (
      (action !== 'grant' && action !== 'revoke') ||
      !email ||
      !PLATFORM_ROLES.includes(role as PlatformRole)
    ) {
      process.stderr.write(
        'Usage: platform-role.js grant|revoke <email> SUPER_ADMIN|SUPPORT  |  platform-role.js list\n',
      );
      return 2;
    }
    const user = await db.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { id: true, mfaEnabledAt: true },
    });
    if (!user) {
      process.stderr.write('No account with that email. The person must register first.\n');
      return 1;
    }
    const r = role as PlatformRole;
    await db.$transaction(async (tx) => {
      if (action === 'grant') {
        await tx.platformRoleAssignment.upsert({
          where: { userId_role: { userId: user.id, role: r } },
          create: { userId: user.id, role: r },
          update: {},
        });
      } else {
        await tx.platformRoleAssignment.deleteMany({ where: { userId: user.id, role: r } });
      }
      await tx.auditLog.createMany({
        data: {
          tenantId: null,
          actorUserId: null,
          action: action === 'grant' ? 'platform.role_granted' : 'platform.role_revoked',
          targetType: 'user',
          targetId: user.id,
          metadata: { role: r, via: 'server-command' },
        },
      });
    });
    process.stdout.write(`${action === 'grant' ? 'Granted' : 'Revoked'} ${r} for ${email}.\n`);
    if (action === 'grant' && !user.mfaEnabledAt) {
      process.stdout.write(
        'Note: they must turn on two-factor authentication before using platform pages.\n',
      );
    }
    return 0;
  } finally {
    await db.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exit(1);
  },
);
