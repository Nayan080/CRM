import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type MemberSummary, type UpdateMemberInput, updateMemberSchema } from '@crm/contracts';
import { PERMISSIONS } from '@crm/permissions';
import { RequirePermission, TenantScoped } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { MembersService } from './members.service.js';

@ApiTags('members')
@TenantScoped()
@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @RequirePermission(PERMISSIONS.MEMBER_READ)
  list(): Promise<MemberSummary[]> {
    return this.members.list();
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.MEMBER_MANAGE, 'TENANT')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateMemberSchema)) body: UpdateMemberInput,
  ): Promise<MemberSummary> {
    return this.members.update(id, body);
  }

  /** Leave (own membership) or remove someone (needs member:manage — checked in the service). */
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    return this.members.remove(id);
  }
}
