import { API_URL } from '../env';

/**
 * Access token lives ONLY in memory (never localStorage), so a malicious script can't read it from
 * storage. After a page reload we get a new one via the HttpOnly refresh cookie.
 */
let accessToken: string | null = null;
let refreshInFlight: Promise<string | null> | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/** Header the API requires on cookie-authenticated endpoints (CSRF defence). */
export const CSRF_HEADERS = { 'X-CRM-CSRF': '1' } as const;

/**
 * Exchange the refresh cookie for a new access token. Concurrent callers share one request
 * (single-flight), so parallel API calls don't race and trip refresh-token reuse detection.
 */
export function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: CSRF_HEADERS,
      });
      if (!res.ok) {
        if (res.status === 401) accessToken = null;
        return null;
      }
      const body = (await res.json()) as { accessToken: string };
      accessToken = body.accessToken;
      return accessToken;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}
