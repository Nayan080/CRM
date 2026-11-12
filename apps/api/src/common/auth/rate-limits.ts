import { Throttle } from '@nestjs/throttler';

/**
 * Stricter per-IP limit for credential and token endpoints (brute force / enumeration defence).
 * The value comes from config (AUTH_RATE_LIMIT_MAX) and is set once at startup.
 */
const authLimit = { max: 10 };

export function configureAuthRateLimit(max: number): void {
  authLimit.max = max;
}

export const AuthRateLimit = () =>
  Throttle({ default: { limit: () => authLimit.max, ttl: 60_000 } });

/**
 * Session refresh happens on every page load, so it must not share the strict login limit
 * (a few reloads, or several staff behind one office IP, would sign people out). Refresh needs a
 * valid, single-use, rotating 256-bit cookie, so a higher per-IP limit does not help guessing.
 */
export const SESSION_REFRESH_LIMIT = 120;
export const SessionRefreshRateLimit = () =>
  Throttle({ default: { limit: SESSION_REFRESH_LIMIT, ttl: 60_000 } });
