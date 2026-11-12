import { Injectable } from '@nestjs/common';
import type { BranchResponse, CreateBranchInput, UpdateBranchInput } from '@crm/contracts';
import { requireTenantContext } from '../../common/context/request-context.js';
import { AppException } from '../../common/errors/app-exception.js';
import { PrismaService, isUniqueViolation } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';

const branchSelect = {
  id: true,
  name: true,
  addressLine: true,
  city: true,
  region: true,
  postcode: true,
  phone: true,
  timezone: true,
  isActive: true,
  _count: { select: { members: true } },
} as const;

type BranchRow = Omit<BranchResponse, 'memberCount'> & { _count: { members: number } };

function toResponse({ _count, ...branch }: BranchRow): BranchResponse {
  return { ...branch, memberCount: _count.members };
}

const nameTaken = () =>
  new AppException(409, 'BRANCH_NAME_TAKEN', 'A branch with this name already exists.', [
    { path: 'name', message: 'Already used by another branch' },
  ]);

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<BranchResponse[]> {
    const rows = await this.prisma.tenantTx((tx) =>
      tx.branch.findMany({ orderBy: { name: 'asc' }, select: branchSelect }),
    );
    return rows.map(toResponse);
  }

  async create(input: CreateBranchInput): Promise<BranchResponse> {
    const { tenantId } = requireTenantContext();
    try {
      return await this.prisma.tenantTx(async (tx) => {
        const branch = await tx.branch.create({
          data: { ...input, tenantId },
          select: branchSelect,
        });
        await this.audit.record(tx, {
          action: 'branch.created',
          targetType: 'branch',
          targetId: branch.id,
        });
        return toResponse(branch);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken();
      throw error;
    }
  }

  async update(id: string, input: UpdateBranchInput): Promise<BranchResponse> {
    try {
      return await this.prisma.tenantTx(async (tx) => {
        const existing = await tx.branch.findUnique({ where: { id }, select: { id: true } });
        if (!existing) throw new AppException(404, 'NOT_FOUND', 'Branch not found.');
        const branch = await tx.branch.update({ where: { id }, data: input, select: branchSelect });
        await this.audit.record(tx, {
          action: input.isActive === false ? 'branch.deactivated' : 'branch.updated',
          targetType: 'branch',
          targetId: id,
        });
        return toResponse(branch);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken();
      throw error;
    }
  }
}
