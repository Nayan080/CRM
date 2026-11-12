import { Injectable } from '@nestjs/common';
import type {
  CreateChecklistTemplateItemInput,
  CreateMatterTypeInput,
  CreateStageInput,
  CreateStageTaskTemplateInput,
  MatterTypeResponse,
  UpdateChecklistTemplateItemInput,
  UpdateMatterTypeInput,
  UpdateStageInput,
  UpdateStageTaskTemplateInput,
} from '@crm/contracts';
import { requireTenantContext } from '../../common/context/request-context.js';
import { AppException } from '../../common/errors/app-exception.js';
import { PrismaService, type Tx, isUniqueViolation } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { notFound } from '../crm/access.js';

const taskTemplateSelect = {
  id: true,
  title: true,
  description: true,
  priority: true,
  dueInDays: true,
  assignToMatterLead: true,
  isActive: true,
} as const;
const stageSelect = {
  id: true,
  name: true,
  sortOrder: true,
  isTerminal: true,
  isActive: true,
  taskTemplates: { select: taskTemplateSelect, orderBy: { sortOrder: 'asc' as const } },
} as const;
const templateSelect = {
  id: true,
  title: true,
  isRequired: true,
  sortOrder: true,
  isActive: true,
} as const;
const typeSelect = {
  id: true,
  name: true,
  description: true,
  isActive: true,
  sortOrder: true,
  stages: {
    select: stageSelect,
    orderBy: { sortOrder: 'asc' as const },
  },
  checklist: {
    select: templateSelect,
    orderBy: { sortOrder: 'asc' as const },
  },
} as const;

const inUse = (what: string) =>
  new AppException(409, 'IN_USE', `This ${what} is used by matters. Deactivate it instead.`);

/** Agency-configured matter types, their stages and checklist templates (Settings). */
@Injectable()
export class MatterTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(): Promise<MatterTypeResponse[]> {
    return this.prisma.tenantTx((tx) =>
      tx.matterType.findMany({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: typeSelect,
      }),
    );
  }

  async get(id: string): Promise<MatterTypeResponse> {
    const row = await this.prisma.tenantTx((tx) => this.load(tx, id));
    return row;
  }

  async create(input: CreateMatterTypeInput): Promise<MatterTypeResponse> {
    const { tenantId } = requireTenantContext();
    return this.unique(() =>
      this.prisma.tenantTx(async (tx) => {
        const max = await tx.matterType.aggregate({ _max: { sortOrder: true } });
        const row = await tx.matterType.create({
          data: {
            tenantId,
            name: input.name,
            description: input.description ?? null,
            sortOrder: (max._max.sortOrder ?? 0) + 1,
          },
          select: { id: true },
        });
        await this.audit.record(tx, {
          action: 'matter_type.created',
          targetType: 'matter_type',
          targetId: row.id,
        });
        return this.load(tx, row.id);
      }),
    );
  }

  async update(id: string, input: UpdateMatterTypeInput): Promise<MatterTypeResponse> {
    return this.unique(() =>
      this.prisma.tenantTx(async (tx) => {
        await this.requireType(tx, id);
        await tx.matterType.update({ where: { id }, data: input });
        await this.audit.record(tx, {
          action: 'matter_type.updated',
          targetType: 'matter_type',
          targetId: id,
          metadata: { fields: Object.keys(input).sort().join(',') },
        });
        return this.load(tx, id);
      }),
    );
  }

  async remove(id: string): Promise<void> {
    await this.prisma.tenantTx(async (tx) => {
      await this.requireType(tx, id);
      if (await tx.matter.count({ where: { matterTypeId: id } })) throw inUse('matter type');
      await tx.matterType.delete({ where: { id } });
      await this.audit.record(tx, {
        action: 'matter_type.deleted',
        targetType: 'matter_type',
        targetId: id,
      });
    });
  }

  // ───────── Stages ─────────

  async addStage(typeId: string, input: CreateStageInput): Promise<MatterTypeResponse> {
    const { tenantId } = requireTenantContext();
    return this.unique(
      () =>
        this.prisma.tenantTx(async (tx) => {
          await this.requireType(tx, typeId);
          const max = await tx.matterStage.aggregate({
            where: { matterTypeId: typeId },
            _max: { sortOrder: true },
          });
          await tx.matterStage.create({
            data: {
              tenantId,
              matterTypeId: typeId,
              name: input.name,
              isTerminal: input.isTerminal,
              sortOrder: (max._max.sortOrder ?? 0) + 1,
            },
          });
          await this.audit.record(tx, {
            action: 'matter_stage.created',
            targetType: 'matter_type',
            targetId: typeId,
          });
          return this.load(tx, typeId);
        }),
      'This type already has a stage with that name.',
    );
  }

  async updateStage(
    typeId: string,
    stageId: string,
    input: UpdateStageInput,
  ): Promise<MatterTypeResponse> {
    return this.unique(
      () =>
        this.prisma.tenantTx(async (tx) => {
          await this.requireStage(tx, typeId, stageId);
          await tx.matterStage.update({ where: { id: stageId }, data: input });
          await this.audit.record(tx, {
            action: 'matter_stage.updated',
            targetType: 'matter_stage',
            targetId: stageId,
          });
          return this.load(tx, typeId);
        }),
      'This type already has a stage with that name.',
    );
  }

  async removeStage(typeId: string, stageId: string): Promise<MatterTypeResponse> {
    return this.prisma.tenantTx(async (tx) => {
      await this.requireStage(tx, typeId, stageId);
      const used =
        (await tx.matter.count({ where: { stageId } })) +
        (await tx.matterStatusHistory.count({
          where: { OR: [{ fromStageId: stageId }, { toStageId: stageId }] },
        }));
      if (used) throw inUse('stage');
      await tx.matterStage.delete({ where: { id: stageId } });
      await this.audit.record(tx, {
        action: 'matter_stage.deleted',
        targetType: 'matter_stage',
        targetId: stageId,
      });
      return this.load(tx, typeId);
    });
  }

  // ───────── Checklist template ─────────

  async addTemplateItem(
    typeId: string,
    input: CreateChecklistTemplateItemInput,
  ): Promise<MatterTypeResponse> {
    const { tenantId } = requireTenantContext();
    return this.prisma.tenantTx(async (tx) => {
      await this.requireType(tx, typeId);
      const max = await tx.checklistTemplateItem.aggregate({
        where: { matterTypeId: typeId },
        _max: { sortOrder: true },
      });
      await tx.checklistTemplateItem.create({
        data: {
          tenantId,
          matterTypeId: typeId,
          title: input.title,
          isRequired: input.isRequired,
          sortOrder: (max._max.sortOrder ?? 0) + 1,
        },
      });
      await this.audit.record(tx, {
        action: 'checklist_template.created',
        targetType: 'matter_type',
        targetId: typeId,
      });
      return this.load(tx, typeId);
    });
  }

  async updateTemplateItem(
    typeId: string,
    itemId: string,
    input: UpdateChecklistTemplateItemInput,
  ): Promise<MatterTypeResponse> {
    return this.prisma.tenantTx(async (tx) => {
      await this.requireTemplateItem(tx, typeId, itemId);
      await tx.checklistTemplateItem.update({ where: { id: itemId }, data: input });
      return this.load(tx, typeId);
    });
  }

  /** Removing a template item never changes checklists already copied into matters. */
  async removeTemplateItem(typeId: string, itemId: string): Promise<MatterTypeResponse> {
    return this.prisma.tenantTx(async (tx) => {
      await this.requireTemplateItem(tx, typeId, itemId);
      await tx.checklistTemplateItem.delete({ where: { id: itemId } });
      return this.load(tx, typeId);
    });
  }

  // ───────── Stage task templates (Stage 8 automation) ─────────

  async addStageTask(
    typeId: string,
    stageId: string,
    input: CreateStageTaskTemplateInput,
  ): Promise<MatterTypeResponse> {
    const { tenantId } = requireTenantContext();
    return this.prisma.tenantTx(async (tx) => {
      await this.requireStage(tx, typeId, stageId);
      const max = await tx.stageTaskTemplate.aggregate({
        where: { stageId },
        _max: { sortOrder: true },
      });
      await tx.stageTaskTemplate.create({
        data: {
          tenantId,
          stageId,
          title: input.title,
          description: input.description ?? null,
          priority: input.priority,
          dueInDays: input.dueInDays ?? null,
          assignToMatterLead: input.assignToMatterLead,
          sortOrder: (max._max.sortOrder ?? 0) + 1,
        },
      });
      await this.audit.record(tx, {
        action: 'stage_task.created',
        targetType: 'matter_stage',
        targetId: stageId,
      });
      return this.load(tx, typeId);
    });
  }

  async updateStageTask(
    typeId: string,
    stageId: string,
    templateId: string,
    input: UpdateStageTaskTemplateInput,
  ): Promise<MatterTypeResponse> {
    return this.prisma.tenantTx(async (tx) => {
      await this.requireStageTask(tx, typeId, stageId, templateId);
      await tx.stageTaskTemplate.update({ where: { id: templateId }, data: input });
      return this.load(tx, typeId);
    });
  }

  /** Tasks already created from it stay (their link to the template is cleared). */
  async removeStageTask(
    typeId: string,
    stageId: string,
    templateId: string,
  ): Promise<MatterTypeResponse> {
    return this.prisma.tenantTx(async (tx) => {
      await this.requireStageTask(tx, typeId, stageId, templateId);
      await tx.task.updateMany({ where: { templateId }, data: { templateId: null } });
      await tx.stageTaskTemplate.deleteMany({ where: { id: templateId } });
      await this.audit.record(tx, {
        action: 'stage_task.deleted',
        targetType: 'matter_stage',
        targetId: stageId,
      });
      return this.load(tx, typeId);
    });
  }

  private async requireStageTask(tx: Tx, typeId: string, stageId: string, templateId: string) {
    const ok = await tx.stageTaskTemplate.count({
      where: { id: templateId, stageId, stage: { matterTypeId: typeId } },
    });
    if (!ok) throw notFound('Stage task');
  }

  // ───────── helpers ─────────

  private async load(tx: Tx, id: string): Promise<MatterTypeResponse> {
    const row = await tx.matterType.findUnique({ where: { id }, select: typeSelect });
    if (!row) throw notFound('Matter type');
    return row;
  }

  private async requireType(tx: Tx, id: string) {
    if (!(await tx.matterType.count({ where: { id } }))) throw notFound('Matter type');
  }

  private async requireStage(tx: Tx, typeId: string, stageId: string) {
    if (!(await tx.matterStage.count({ where: { id: stageId, matterTypeId: typeId } })))
      throw notFound('Stage');
  }

  private async requireTemplateItem(tx: Tx, typeId: string, itemId: string) {
    if (!(await tx.checklistTemplateItem.count({ where: { id: itemId, matterTypeId: typeId } })))
      throw notFound('Checklist item');
  }

  private async unique<T>(
    fn: () => Promise<T>,
    message = 'A matter type with that name already exists.',
  ) {
    try {
      return await fn();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppException(409, 'NAME_EXISTS', message, [
          { path: 'name', message: 'Already used' },
        ]);
      }
      throw error;
    }
  }
}
