import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  type TenantResponse,
  type UpdateTenantInput,
  type WorkspaceAccessResponse,
  type WorkspaceSummary,
  createTenantSchema,
  updateTenantSchema,
} from '@crm/contracts';
import { PERMISSIONS } from '@crm/permissions';
import { RequirePermission, TenantScoped } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { TenantsService } from './tenants.service.js';

@ApiTags('tenants')
@ApiBearerAuth()
@Controller()
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  /** Create a new workspace; the caller becomes its Owner. */
  @Post('tenants')
  create(
    @Body(new ZodValidationPipe(createTenantSchema))
    body: ReturnType<typeof createTenantSchema.parse>,
  ): Promise<WorkspaceSummary> {
    return this.tenants.create(body);
  }

  @Get('tenant/access')
  @TenantScoped()
  access(): Promise<WorkspaceAccessResponse> {
    return this.tenants.access();
  }

  @Get('tenant')
  @TenantScoped()
  @RequirePermission(PERMISSIONS.TENANT_READ)
  current(): Promise<TenantResponse> {
    return this.tenants.current();
  }

  @Patch('tenant')
  @TenantScoped()
  @RequirePermission(PERMISSIONS.TENANT_UPDATE, 'TENANT')
  update(
    @Body(new ZodValidationPipe(updateTenantSchema)) body: UpdateTenantInput,
  ): Promise<TenantResponse> {
    return this.tenants.update(body);
  }
}
