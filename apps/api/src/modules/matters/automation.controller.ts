import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type AutomationSettingsInput,
  type AutomationSettingsResponse,
  automationSettingsSchema,
} from '@crm/contracts';
import { PERMISSIONS } from '@crm/permissions';
import { RequirePermission, TenantScoped } from '../../common/auth/decorators.js';
import { requireTenantContext } from '../../common/context/request-context.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';

const OFF: AutomationSettingsResponse = { deadlineReminderDays: [], leadFollowUpDays: null };

/** Agency automation switches (Settings). Everything is off until turned on. */
@ApiTags('automation')
@TenantScoped()
@Controller('automation-settings')
export class AutomationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission(PERMISSIONS.TENANT_UPDATE, 'TENANT')
  async get(): Promise<AutomationSettingsResponse> {
    const { tenantId } = requireTenantContext();
    const row = await this.prisma.tenantTx((tx) =>
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: { deadlineReminderDays: true, leadFollowUpDays: true },
      }),
    );
    return row ?? OFF;
  }

  @Put()
  @RequirePermission(PERMISSIONS.TENANT_UPDATE, 'TENANT')
  async put(
    @Body(new ZodValidationPipe(automationSettingsSchema)) body: AutomationSettingsInput,
  ): Promise<AutomationSettingsResponse> {
    const { tenantId } = requireTenantContext();
    return this.prisma.tenantTx(async (tx) => {
      const row = await tx.tenant.update({
        where: { id: tenantId },
        data: body,
        select: { deadlineReminderDays: true, leadFollowUpDays: true },
      });
      await this.audit.record(tx, {
        action: 'automation.updated',
        targetType: 'tenant',
        targetId: tenantId,
        metadata: {
          deadlineReminderDays: body.deadlineReminderDays.join(',') || 'off',
          leadFollowUpDays: body.leadFollowUpDays ?? 'off',
        },
      });
      return row;
    });
  }
}
