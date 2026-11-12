import { Body, Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  type AuthTokensResponse,
  type LoginResponse,
  type MessageResponse,
  emailOnlySchema,
  loginMfaSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  tokenOnlySchema,
} from '@crm/contracts';
import { Public } from '../../common/auth/decorators.js';
import { AuthRateLimit, SessionRefreshRateLimit } from '../../common/auth/rate-limits.js';
import { AppException } from '../../common/errors/app-exception.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { AuthService, GENERIC_EMAIL_SENT } from './auth.service.js';
import {
  clearRefreshCookie,
  readRefreshCookie,
  requireCsrfHeader,
  setRefreshCookie,
} from './refresh-cookie.js';
import { SessionService } from './session.service.js';

@ApiTags('auth')
@Public()
@AuthRateLimit()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('register')
  @HttpCode(202)
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: ReturnType<typeof registerSchema.parse>,
  ): Promise<MessageResponse> {
    await this.auth.register(body);
    return { message: GENERIC_EMAIL_SENT };
  }

  @Post('verify-email')
  @HttpCode(200)
  async verifyEmail(
    @Body(new ZodValidationPipe(tokenOnlySchema)) body: { token: string },
  ): Promise<MessageResponse> {
    await this.auth.verifyEmail(body.token);
    return { message: 'Email verified. You can sign in now.' };
  }

  @Post('resend-verification')
  @HttpCode(202)
  async resendVerification(
    @Body(new ZodValidationPipe(emailOnlySchema)) body: { email: string },
  ): Promise<MessageResponse> {
    await this.auth.resendVerification(body.email);
    return { message: GENERIC_EMAIL_SENT };
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: ReturnType<typeof loginSchema.parse>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const result = await this.auth.login(body);
    if ('refreshToken' in result) {
      setRefreshCookie(res, result.refreshToken, this.config.auth.cookieSecure);
      return result.body;
    }
    return result;
  }

  @Post('login/mfa')
  @HttpCode(200)
  async loginMfa(
    @Body(new ZodValidationPipe(loginMfaSchema)) body: ReturnType<typeof loginMfaSchema.parse>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokensResponse> {
    const result = await this.auth.loginWithMfa(body.mfaToken, body.code);
    setRefreshCookie(res, result.refreshToken, this.config.auth.cookieSecure);
    return result.body;
  }

  /** Silent re-login: rotates the refresh cookie and returns a new access token. */
  @Post('refresh')
  @HttpCode(200)
  @SessionRefreshRateLimit()
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    requireCsrfHeader(req);
    const token = readRefreshCookie(req);
    if (!token) throw new AppException(401, 'UNAUTHENTICATED', 'Sign in again to continue.');
    try {
      const result = await this.sessions.refresh(token);
      setRefreshCookie(res, result.refreshToken, this.config.auth.cookieSecure);
      return { accessToken: result.accessToken, expiresIn: result.expiresIn };
    } catch (error) {
      if (error instanceof AppException && error.getStatus() === 401) {
        clearRefreshCookie(res, this.config.auth.cookieSecure);
      }
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    requireCsrfHeader(req);
    const token = readRefreshCookie(req);
    if (token) await this.sessions.revokeByRefreshToken(token);
    clearRefreshCookie(res, this.config.auth.cookieSecure);
  }

  @Post('password/forgot')
  @HttpCode(202)
  async forgotPassword(
    @Body(new ZodValidationPipe(emailOnlySchema)) body: { email: string },
  ): Promise<MessageResponse> {
    await this.auth.forgotPassword(body.email);
    return { message: GENERIC_EMAIL_SENT };
  }

  @Post('password/reset')
  @HttpCode(200)
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema))
    body: ReturnType<typeof resetPasswordSchema.parse>,
  ): Promise<MessageResponse> {
    await this.auth.resetPassword(body);
    return { message: 'Password changed. Sign in with your new password.' };
  }
}
