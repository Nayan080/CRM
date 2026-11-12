import { Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
  getOptionsToken,
  getStorageToken,
} from '@nestjs/throttler';
import { JwtService } from '../../modules/auth/jwt.service.js';

/**
 * Rate limits count per signed-in user when the request carries a VALID access token, otherwise
 * per IP. So several staff behind one office IP do not share one budget, while anonymous traffic
 * (login, registration…) stays limited per IP. Limits apply per route.
 */
@Injectable()
export class UserAwareThrottlerGuard extends ThrottlerGuard {
  constructor(
    @Inject(getOptionsToken()) options: ThrottlerModuleOptions,
    @Inject(getStorageToken()) storage: ThrottlerStorage,
    reflector: Reflector,
    private readonly jwt: JwtService,
  ) {
    super(options, storage, reflector);
  }

  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const header = (req.headers as Record<string, string | undefined> | undefined)?.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (token) {
      const claims = await this.jwt.verifyAccess(token).catch(() => null);
      if (claims?.userId) return `user:${claims.userId}`;
    }
    const ip = typeof req.ip === 'string' ? req.ip : 'unknown';
    return `ip:${ip}`;
  }
}
