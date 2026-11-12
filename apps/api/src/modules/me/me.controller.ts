import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  type MfaSetupResponse,
  type RecoveryCodesResponse,
  type SessionSummary,
  type UserSummary,
  type WorkspaceSummary,
  mfaDisableSchema,
  mfaEnableSchema,
} from '@crm/contracts';
import { AuthRateLimit } from '../../common/auth/rate-limits.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { MeService } from './me.service.js';

/** The signed-in user's own account. Not tenant-scoped. */
@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  get(): Promise<UserSummary> {
    return this.me.me();
  }

  @Get('workspaces')
  workspaces(): Promise<WorkspaceSummary[]> {
    return this.me.workspaces();
  }

  @Get('sessions')
  sessions(): Promise<SessionSummary[]> {
    return this.me.sessions();
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  revokeSession(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    return this.me.revokeSession(id);
  }

  @Post('mfa/setup')
  @HttpCode(200)
  startMfaSetup(): Promise<MfaSetupResponse> {
    return this.me.startMfaSetup();
  }

  @Post('mfa/enable')
  @HttpCode(200)
  @AuthRateLimit()
  enableMfa(
    @Body(new ZodValidationPipe(mfaEnableSchema)) body: { code: string },
  ): Promise<RecoveryCodesResponse> {
    return this.me.enableMfa(body.code);
  }

  @Post('mfa/disable')
  @HttpCode(204)
  @AuthRateLimit()
  disableMfa(
    @Body(new ZodValidationPipe(mfaDisableSchema)) body: { password: string; code: string },
  ): Promise<void> {
    return this.me.disableMfa(body.password, body.code);
  }
}
