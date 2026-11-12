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
  type CreatePartnerContactInput,
  type CreatePartnerInput,
  type ListQuery,
  type Paginated,
  type PartnerContactResponse,
  type PartnerDetail,
  type PartnerSummary,
  type UpdatePartnerContactInput,
  type UpdatePartnerInput,
  createPartnerContactSchema,
  createPartnerSchema,
  listQuerySchema,
  updatePartnerContactSchema,
  updatePartnerSchema,
} from '@crm/contracts';
import { PERMISSIONS } from '@crm/permissions';
import { RequirePermission, TenantScoped } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { PartnersService } from './partners.service.js';

const uuid = () => new ParseUUIDPipe();

@ApiTags('partners')
@TenantScoped()
@Controller('partners')
export class PartnersController {
  constructor(private readonly partners: PartnersService) {}

  @Get()
  @RequirePermission(PERMISSIONS.DIRECTORY_READ)
  list(
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery,
  ): Promise<Paginated<PartnerSummary>> {
    return this.partners.list(query);
  }

  @Post()
  @RequirePermission(PERMISSIONS.PARTNER_MANAGE, 'TENANT')
  create(
    @Body(new ZodValidationPipe(createPartnerSchema)) body: CreatePartnerInput,
  ): Promise<PartnerSummary> {
    return this.partners.create(body);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.DIRECTORY_READ)
  get(@Param('id', uuid()) id: string): Promise<PartnerDetail> {
    return this.partners.get(id);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.PARTNER_MANAGE, 'TENANT')
  update(
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(updatePartnerSchema)) body: UpdatePartnerInput,
  ): Promise<PartnerSummary> {
    return this.partners.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(PERMISSIONS.PARTNER_MANAGE, 'TENANT')
  archive(@Param('id', uuid()) id: string): Promise<void> {
    return this.partners.archive(id);
  }

  @Post(':id/contacts')
  @RequirePermission(PERMISSIONS.PARTNER_MANAGE, 'TENANT')
  addContact(
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(createPartnerContactSchema)) body: CreatePartnerContactInput,
  ): Promise<PartnerContactResponse> {
    return this.partners.addContact(id, body);
  }

  @Patch(':id/contacts/:contactId')
  @RequirePermission(PERMISSIONS.PARTNER_MANAGE, 'TENANT')
  updateContact(
    @Param('id', uuid()) id: string,
    @Param('contactId', uuid()) contactId: string,
    @Body(new ZodValidationPipe(updatePartnerContactSchema)) body: UpdatePartnerContactInput,
  ): Promise<PartnerContactResponse> {
    return this.partners.updateContact(id, contactId, body);
  }

  @Delete(':id/contacts/:contactId')
  @HttpCode(204)
  @RequirePermission(PERMISSIONS.PARTNER_MANAGE, 'TENANT')
  archiveContact(
    @Param('id', uuid()) id: string,
    @Param('contactId', uuid()) contactId: string,
  ): Promise<void> {
    return this.partners.archiveContact(id, contactId);
  }
}
