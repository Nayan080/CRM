import type { Request, Response } from 'express';
import { AppException } from '../../common/errors/app-exception.js';
import { SESSION_ABSOLUTE_MS } from './session.service.js';

export const REFRESH_COOKIE = 'crm_rt';
/** Cookie is only sent to the auth endpoints that need it. */
const COOKIE_PATH = '/api/v1/auth';
/** Custom header required on cookie-authenticated endpoints (CSRF defence with SameSite=Strict). */
export const CSRF_HEADER = 'x-crm-csrf';

export function setRefreshCookie(res: Response, token: string, secure: boolean): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: COOKIE_PATH,
    maxAge: SESSION_ABSOLUTE_MS,
  });
}

export function clearRefreshCookie(res: Response, secure: boolean): void {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: COOKIE_PATH,
  });
}

export function readRefreshCookie(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  const value = cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 && value.length < 200 ? value : undefined;
}

export function requireCsrfHeader(req: Request): void {
  if (req.get(CSRF_HEADER) !== '1') {
    throw new AppException(403, 'CSRF_CHECK_FAILED', 'Missing security header.');
  }
}
