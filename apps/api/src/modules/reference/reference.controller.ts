import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type CreateReferenceOptionInput,
  type ReferenceCategory,
  type ReferenceOptionResponse,
  type UpdateReferenceOptionInput,
  createReferenceOptionSchema,
  referenceListQuerySchema,
  updateReferenceOptionSchema,
} from '@crm/contracts';
import { PERMISSIONS } from '@crm/permissions';
import { RequirePermission, TenantScoped } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { ReferenceService } from './reference.service.js';

@ApiTags('reference-options')
@TenantScoped()
@Controller('reference-options')
export class ReferenceController {
  constructor(private readonly reference: ReferenceService) {}

  @Get()
  @RequirePermission(PERMISSIONS.TENANT_READ)
  list(
    @Query(new ZodValidationPipe(referenceListQuerySchema)) query: { category: ReferenceCategory },
  ): Promise<ReferenceOptionResponse[]> {
    return this.reference.list(query.category);
  }

  @Post()
  @RequirePermission(PERMISSIONS.TENANT_UPDATE, 'TENANT')
  create(
    @Body(new ZodValidationPipe(createReferenceOptionSchema)) body: CreateReferenceOptionInput,
  ): Promise<ReferenceOptionResponse> {
    return this.reference.create(body);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.TENANT_UPDATE, 'TENANT')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateReferenceOptionSchema)) body: UpdateReferenceOptionInput,
  ): Promise<ReferenceOptionResponse> {
    return this.reference.update(id, body);
  }
}
