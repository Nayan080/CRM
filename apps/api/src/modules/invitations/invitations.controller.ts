import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  type AcceptInvitationNewUserInput,
  type AuthTokensResponse,
  type CreateInvitationInput,
  type InvitationPreviewResponse,
  type InvitationSummary,
  type WorkspaceSummary,
  acceptInvitationNewUserSchema,
  createInvitationSchema,
  tokenOnlySchema,
} from '@crm/contracts';
import { PERMISSIONS } from '@crm/permissions';
import { Public, RequirePermission, TenantScoped } from '../../common/auth/decorators.js';
import { AuthRateLimit } from '../../common/auth/rate-limits.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { setRefreshCookie } from '../auth/refresh-cookie.js';
import { InvitationsService } from './invitations.service.js';

@ApiTags('invitations')
@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ── Workspace admins see all invitations; branch managers only those for their own branches.
  @Post()
  @TenantScoped()
  @RequirePermission(PERMISSIONS.MEMBER_INVITE)
  create(
    @Body(new ZodValidationPipe(createInvitationSchema)) body: CreateInvitationInput,
  ): Promise<InvitationSummary> {
    return this.invitations.create(body);
  }

  @Get()
  @TenantScoped()
  @RequirePermission(PERMISSIONS.MEMBER_INVITE)
  list(): Promise<InvitationSummary[]> {
    return this.invitations.list();
  }

  @Post(':id/resend')
  @HttpCode(200)
  @TenantScoped()
  @RequirePermission(PERMISSIONS.MEMBER_INVITE)
  resend(@Param('id', new ParseUUIDPipe()) id: string): Promise<InvitationSummary> {
    return this.invitations.resend(id);
  }

  @Delete(':id')
  @HttpCode(204)
  @TenantScoped()
  @RequirePermission(PERMISSIONS.MEMBER_INVITE)
  revoke(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    return this.invitations.revoke(id);
  }

  // ── Invitee side. The token is the proof; it is sent in the body (never in a URL).
  @Post('preview')
  @HttpCode(200)
  @Public()
  @AuthRateLimit()
  preview(
    @Body(new ZodValidationPipe(tokenOnlySchema)) body: { token: string },
  ): Promise<InvitationPreviewResponse> {
    return this.invitations.preview(body.token);
  }

  @Post('accept')
  @HttpCode(200)
  @ApiBearerAuth()
  @AuthRateLimit()
  accept(
    @Body(new ZodValidationPipe(tokenOnlySchema)) body: { token: string },
  ): Promise<WorkspaceSummary> {
    return this.invitations.accept(body.token);
  }

  @Post('accept-new')
  @HttpCode(200)
  @Public()
  @AuthRateLimit()
  async acceptAsNewUser(
    @Body(new ZodValidationPipe(acceptInvitationNewUserSchema)) body: AcceptInvitationNewUserInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokensResponse> {
    const result = await this.invitations.acceptAsNewUser(body);
    setRefreshCookie(res, result.refreshToken, this.config.auth.cookieSecure);
    return result.body;
  }
}
