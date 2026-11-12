import { Injectable } from '@nestjs/common';
import type {
  CreateReferenceOptionInput,
  ReferenceCategory,
  ReferenceOptionResponse,
  UpdateReferenceOptionInput,
} from '@crm/contracts';
import { DEFAULT_REFERENCE_OPTIONS, REFERENCE_CATEGORIES } from '@crm/contracts';
import { requireTenantContext } from '../../common/context/request-context.js';
import { AppException } from '../../common/errors/app-exception.js';
import { PrismaService, type Tx, isUniqueViolation } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';

const optionSelect = { id: true, category: true, key: true, name: true, isActive: true } as const;

export function slugKey(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'option'
  );
}

/** Tenant-configurable lists (profession types, partner types). */
@Injectable()
export class ReferenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Copies the default lists into a newly created tenant (same transaction as tenant creation). */
  async seedDefaults(tx: Tx, tenantId: string): Promise<void> {
    await tx.referenceOption.createMany({
      data: REFERENCE_CATEGORIES.flatMap((category) =>
        DEFAULT_REFERENCE_OPTIONS[category].map((option) => ({ tenantId, category, ...option })),
      ),
    });
  }

  async list(category: ReferenceCategory): Promise<ReferenceOptionResponse[]> {
    return this.prisma.tenantTx((tx) =>
      tx.referenceOption.findMany({
        where: { category },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: optionSelect,
      }),
    );
  }

  async create(input: CreateReferenceOptionInput): Promise<ReferenceOptionResponse> {
    const { tenantId } = requireTenantContext();
    try {
      return await this.prisma.tenantTx(async (tx) => {
        const option = await tx.referenceOption.create({
          data: {
            tenantId,
            category: input.category,
            key: slugKey(input.name),
            name: input.name,
            sortOrder: 50,
          },
          select: optionSelect,
        });
        await this.audit.record(tx, {
          action: 'reference_option.created',
          targetType: 'reference_option',
          targetId: option.id,
          metadata: { category: input.category },
        });
        return option;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppException(409, 'OPTION_EXISTS', 'This list already has that value.', [
          { path: 'name', message: 'Already in the list' },
        ]);
      }
      throw error;
    }
  }

  async update(id: string, input: UpdateReferenceOptionInput): Promise<ReferenceOptionResponse> {
    return this.prisma.tenantTx(async (tx) => {
      const existing = await tx.referenceOption.findUnique({ where: { id }, select: { id: true } });
      if (!existing) throw new AppException(404, 'NOT_FOUND', 'List value not found.');
      const option = await tx.referenceOption.update({
        where: { id },
        data: input,
        select: optionSelect,
      });
      await this.audit.record(tx, {
        action: 'reference_option.updated',
        targetType: 'reference_option',
        targetId: id,
      });
      return option;
    });
  }
}

/**
 * Checks that an id refers to an ACTIVE option of the expected list in the active tenant.
 * The foreign key alone cannot check the category.
 */
export async function requireReferenceOption(
  tx: Tx,
  id: string,
  category: ReferenceCategory,
  field: string,
): Promise<void> {
  const option = await tx.referenceOption.findUnique({
    where: { id },
    select: { category: true, isActive: true },
  });
  if (!option || option.category !== category || !option.isActive) {
    throw new AppException(400, 'INVALID_REFERENCE', 'Choose a value from the list.', [
      { path: field, message: 'Choose a value from the list' },
    ]);
  }
}
