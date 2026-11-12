import { PROBLEM_CONTENT_TYPE, type ProblemDetails, problemDetailsSchema } from '@crm/contracts';
import { getAccessToken, refreshAccessToken } from '../auth/token-store';
import { API_URL } from '../env';

/** Error thrown for any non-2xx API response. Carries the RFC 9457 problem when available. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly problem: ProblemDetails | null,
  ) {
    super(problem?.detail ?? problem?.title ?? `Request failed with status ${status}`);
    this.name = 'ApiError';
  }

  get code(): string | undefined {
    return this.problem?.code;
  }
}

export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Active workspace. Sent as X-Tenant-Id; the API verifies membership on every request. */
  tenantId?: string;
  /** Skip the automatic "refresh and retry once" on 401 (used by auth endpoints themselves). */
  noRetry?: boolean;
}

async function doFetch(path: string, options: ApiRequestOptions, token: string | null) {
  const { body, tenantId, headers, ...rest } = options;
  const init: RequestInit & { noRetry?: boolean } = { ...rest };
  delete init.noRetry;
  // Files are sent as multipart; the browser sets the boundary header itself.
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  return fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(tenantId ? { 'X-Tenant-Id': tenantId } : {}),
      ...headers,
    },
    body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/**
 * Typed fetch wrapper for the API. Adds the access token; if it has expired (401), silently
 * refreshes once and retries.
 */
export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const response = await apiResponse(path, options);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Like apiFetch but returns the raw successful Response (for file downloads). */
export async function apiResponse(
  path: string,
  options: ApiRequestOptions = {},
): Promise<Response> {
  let response = await doFetch(path, options, getAccessToken());

  if (response.status === 401 && !options.noRetry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) response = await doFetch(path, options, refreshed);
  }

  if (!response.ok) {
    let problem: ProblemDetails | null = null;
    if (response.headers.get('content-type')?.startsWith(PROBLEM_CONTENT_TYPE)) {
      const parsed = problemDetailsSchema.safeParse(await response.json());
      problem = parsed.success ? parsed.data : null;
    }
    throw new ApiError(response.status, problem);
  }
  return response;
}

/** File name from a Content-Disposition header (prefers the UTF-8 form). */
export function fileNameFrom(header: string | null, fallback = 'download'): string {
  if (!header) return fallback;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      /* fall through */
    }
  }
  return /filename="([^"]+)"/i.exec(header)?.[1] ?? fallback;
}

/**
 * Downloads an authorized file. The token travels in a header (never in a URL), so the file is
 * fetched first and then handed to the browser as a local blob.
 */
export async function downloadFile(path: string, tenantId: string): Promise<void> {
  const response = await apiResponse(path, { tenantId, headers: { Accept: '*/*' } });
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileNameFrom(response.headers.get('content-disposition'));
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
