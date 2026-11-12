import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAccessToken, refreshAccessToken, setAccessToken } from '../auth/token-store';
import { ApiError, apiFetch } from './client';

function json(body: unknown, status = 200, type = 'application/json') {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

describe('apiFetch', () => {
  it('sends the access token and tenant header', async () => {
    setAccessToken('tok-1');
    const fetchMock = vi.fn().mockResolvedValue(json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch('/api/v1/tenant', { tenantId: 't-1' })).resolves.toEqual({ ok: true });
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-1');
    expect(headers['X-Tenant-Id']).toBe('t-1');
  });

  it('throws ApiError with the parsed problem details', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          json(
            { type: 'about:blank', title: 'Not Found', status: 404, code: 'NOT_FOUND' },
            404,
            'application/problem+json',
          ),
        ),
    );
    const error = await apiFetch('/api/v1/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('NOT_FOUND');
  });

  it('on 401, refreshes once and retries with the new token', async () => {
    setAccessToken('expired');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({}, 401, 'application/problem+json'))
      .mockResolvedValueOnce(json({ accessToken: 'fresh', expiresIn: 600 }))
      .mockResolvedValueOnce(json({ id: 'me' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch('/api/v1/me')).resolves.toEqual({ id: 'me' });
    expect(fetchMock.mock.calls[1]?.[0]).toMatch(/\/auth\/refresh$/);
    const retryHeaders = (fetchMock.mock.calls[2]?.[1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(retryHeaders.Authorization).toBe('Bearer fresh');
  });
});

describe('refreshAccessToken', () => {
  it('runs only one refresh for concurrent callers (single-flight)', async () => {
    let resolve: (r: Response) => void = () => undefined;
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((r) => (resolve = r)));
    vi.stubGlobal('fetch', fetchMock);

    const a = refreshAccessToken();
    const b = refreshAccessToken();
    resolve(json({ accessToken: 'shared' }));
    expect(await a).toBe('shared');
    expect(await b).toBe('shared');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>)['X-CRM-CSRF']).toBe('1');
    expect(getAccessToken()).toBe('shared');
  });
});

describe('fileNameFrom', () => {
  it('prefers the UTF-8 name and falls back to the ASCII one', async () => {
    const { fileNameFrom } = await import('./client');
    expect(
      fileNameFrom(`attachment; filename="P_ssport.pdf"; filename*=UTF-8''P%C3%A4ssport.pdf`),
    ).toBe('Pässport.pdf');
    expect(fileNameFrom('attachment; filename="a.pdf"')).toBe('a.pdf');
    expect(fileNameFrom(null)).toBe('download');
  });
});
