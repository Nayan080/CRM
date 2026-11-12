import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type CreateCredentialInput,
  type CreateProfessionalInput,
  type CredentialResponse,
  type ListQuery,
  type Paginated,
  type ProfessionalDetail,
  type ProfessionalSummary,
  type UpdateCredentialInput,
  type UpdateProfessionalInput,
  type VerifyCredentialInput,
  createCredentialSchema,
  createProfessionalSchema,
  listQuerySchema,
  updateCredentialSchema,
  updateProfessionalSchema,
  verifyCredentialSchema,
} from '@crm/contracts';
import { PERMISSIONS } from '@crm/permissions';
import { RequirePermission, TenantScoped } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { ProfessionalsService } from './professionals.service.js';

const uuid = () => new ParseUUIDPipe();

@ApiTags('professionals')
@TenantScoped()
@Controller('professionals')
export class ProfessionalsController {
  constructor(private readonly professionals: ProfessionalsService) {}

  @Get()
  @RequirePermission(PERMISSIONS.DIRECTORY_READ)
  list(
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery,
  ): Promise<Paginated<ProfessionalSummary>> {
    return this.professionals.list(query);
  }

  @Post()
  @RequirePermission(PERMISSIONS.DIRECTORY_MANAGE, 'TENANT')
  create(
    @Body(new ZodValidationPipe(createProfessionalSchema)) body: CreateProfessionalInput,
  ): Promise<ProfessionalSummary> {
    return this.professionals.create(body);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.DIRECTORY_READ)
  get(@Param('id', uuid()) id: string): Promise<ProfessionalDetail> {
    return this.professionals.get(id);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.DIRECTORY_MANAGE, 'TENANT')
  update(
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(updateProfessionalSchema)) body: UpdateProfessionalInput,
  ): Promise<ProfessionalSummary> {
    return this.professionals.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(PERMISSIONS.DIRECTORY_MANAGE, 'TENANT')
  archive(@Param('id', uuid()) id: string): Promise<void> {
    return this.professionals.archive(id);
  }

  @Post(':id/credentials')
  @RequirePermission(PERMISSIONS.DIRECTORY_MANAGE, 'TENANT')
  addCredential(
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(createCredentialSchema)) body: CreateCredentialInput,
  ): Promise<CredentialResponse> {
    return this.professionals.addCredential(id, body);
  }

  @Patch(':id/credentials/:credentialId')
  @RequirePermission(PERMISSIONS.DIRECTORY_MANAGE, 'TENANT')
  updateCredential(
    @Param('id', uuid()) id: string,
    @Param('credentialId', uuid()) credentialId: string,
    @Body(new ZodValidationPipe(updateCredentialSchema)) body: UpdateCredentialInput,
  ): Promise<CredentialResponse> {
    return this.professionals.updateCredential(id, credentialId, body);
  }

  @Post(':id/credentials/:credentialId/verification')
  @HttpCode(200)
  @RequirePermission(PERMISSIONS.DIRECTORY_MANAGE, 'TENANT')
  verifyCredential(
    @Param('id', uuid()) id: string,
    @Param('credentialId', uuid()) credentialId: string,
    @Body(new ZodValidationPipe(verifyCredentialSchema)) body: VerifyCredentialInput,
  ): Promise<CredentialResponse> {
    return this.professionals.verifyCredential(id, credentialId, body);
  }

  @Delete(':id/credentials/:credentialId')
  @HttpCode(204)
  @RequirePermission(PERMISSIONS.DIRECTORY_MANAGE, 'TENANT')
  removeCredential(
    @Param('id', uuid()) id: string,
    @Param('credentialId', uuid()) credentialId: string,
  ): Promise<void> {
    return this.professionals.removeCredential(id, credentialId);
  }
}
