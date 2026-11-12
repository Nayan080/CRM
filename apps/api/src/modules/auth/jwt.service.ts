import { Inject, Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';

export const ACCESS_TOKEN_TTL_SECONDS = 10 * 60; // DEC-05
const MFA_TOKEN_TTL_SECONDS = 5 * 60;
const ISSUER = 'migration-crm-api';
const AUDIENCE = 'migration-crm';

export interface AccessTokenClaims {
  userId: string;
  sessionId: string;
}

/**
 * Short-lived JWTs (HS256). Access tokens carry only user + session ids — no tenant or role —
 * so membership/role changes apply on the very next request (ADR-0003).
 */
@Injectable()
export class JwtService {
  private readonly key: Uint8Array;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.key = new TextEncoder().encode(config.auth.jwtAccessSecret);
  }

  signAccess(claims: AccessTokenClaims): Promise<string> {
    return new SignJWT({ sid: claims.sessionId, typ: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(this.key);
  }

  async verifyAccess(token: string): Promise<AccessTokenClaims | null> {
    const payload = await this.verify(token, 'access');
    return payload && typeof payload.sid === 'string' && payload.sub
      ? { userId: payload.sub, sessionId: payload.sid }
      : null;
  }

  /** Proves the password step passed; exchanged with a TOTP/recovery code for a session. */
  signMfaChallenge(userId: string): Promise<string> {
    return new SignJWT({ typ: 'mfa' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${MFA_TOKEN_TTL_SECONDS}s`)
      .sign(this.key);
  }

  async verifyMfaChallenge(token: string): Promise<string | null> {
    const payload = await this.verify(token, 'mfa');
    return payload?.sub ?? null;
  }

  private async verify(token: string, typ: 'access' | 'mfa') {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      return payload.typ === typ ? payload : null;
    } catch {
      return null;
    }
  }
}
