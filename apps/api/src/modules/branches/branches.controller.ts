import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type BranchResponse,
  type CreateBranchInput,
  type UpdateBranchInput,
  createBranchSchema,
  updateBranchSchema,
} from '@crm/contracts';
import { PERMISSIONS } from '@crm/permissions';
import { RequirePermission, TenantScoped } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { BranchesService } from './branches.service.js';

@ApiTags('branches')
@TenantScoped()
@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @RequirePermission(PERMISSIONS.BRANCH_READ)
  list(): Promise<BranchResponse[]> {
    return this.branches.list();
  }

  @Post()
  @RequirePermission(PERMISSIONS.BRANCH_MANAGE, 'TENANT')
  create(
    @Body(new ZodValidationPipe(createBranchSchema)) body: CreateBranchInput,
  ): Promise<BranchResponse> {
    return this.branches.create(body);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.BRANCH_MANAGE, 'TENANT')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateBranchSchema)) body: UpdateBranchInput,
  ): Promise<BranchResponse> {
    return this.branches.update(id, body);
  }
}
