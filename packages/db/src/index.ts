import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export { PrismaClient, Prisma } from './generated/prisma/client.js';
export type * from './generated/prisma/client.js';

export interface CreatePrismaClientOptions {
  connectionString: string;
  /** Max connections in this process's pool. */
  maxConnections?: number;
  /** Fail fast instead of hanging when the database is unreachable. */
  connectionTimeoutMs?: number;
}

/**
 * The ONLY place a Prisma client is constructed.
 * Application modules must not call this directly — the API wraps it in PrismaService
 * (and in Stage 2 a tenant-scoped client). An ESLint rule in apps/api enforces this.
 */
export function createPrismaClient(options: CreatePrismaClientOptions): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 3_000,
  });
  return new PrismaClient({ adapter });
}
