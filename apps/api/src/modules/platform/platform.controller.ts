import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type CreatePlanInput,
  type Paginated,
  type PlanResponse,
  type PlatformTenantListQuery,
  type PlatformTenantSummary,
  type UpdatePlanInput,
  type UpdatePlatformTenantInput,
  createPlanSchema,
  platformTenantListQuerySchema,
  updatePlanSchema,
  updatePlatformTenantSchema,
} from '@crm/contracts';
import { PlatformGuard, PlatformRoles } from '../../common/auth/platform.guard.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { PlatformService } from './platform.service.js';

const uuid = () => new ParseUUIDPipe();

/** Platform administration (not tenant-scoped). SUPPORT can look; only SUPER_ADMIN can change. */
@ApiTags('platform')
@Controller('platform')
@UseGuards(PlatformGuard)
@PlatformRoles('SUPER_ADMIN', 'SUPPORT')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('tenants')
  listTenants(
    @Query(new ZodValidationPipe(platformTenantListQuerySchema)) q: PlatformTenantListQuery,
  ): Promise<Paginated<PlatformTenantSummary>> {
    return this.platform.listTenants(q);
  }

  @Get('tenants/:id')
  getTenant(@Param('id', uuid()) id: string): Promise<PlatformTenantSummary> {
    return this.platform.getTenant(id);
  }

  @Patch('tenants/:id')
  @PlatformRoles('SUPER_ADMIN')
  updateTenant(
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(updatePlatformTenantSchema)) body: UpdatePlatformTenantInput,
  ): Promise<PlatformTenantSummary> {
    return this.platform.updateTenant(id, body);
  }

  @Get('plans')
  listPlans(): Promise<PlanResponse[]> {
    return this.platform.listPlans();
  }

  @Post('plans')
  @PlatformRoles('SUPER_ADMIN')
  createPlan(
    @Body(new ZodValidationPipe(createPlanSchema)) body: CreatePlanInput,
  ): Promise<PlanResponse> {
    return this.platform.createPlan(body);
  }

  @Patch('plans/:id')
  @PlatformRoles('SUPER_ADMIN')
  updatePlan(
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(updatePlanSchema)) body: UpdatePlanInput,
  ): Promise<PlanResponse> {
    return this.platform.updatePlan(id, body);
  }
}
