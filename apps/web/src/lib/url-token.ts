/**
 * Email links carry tokens in the URL fragment (#token=...). Fragments are never sent to servers,
 * so tokens stay out of server logs and Referer headers. Read once, then remove from the address bar.
 */
export function takeTokenFromHash(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const token = params.get('token');
  if (token) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  return token && /^[A-Za-z0-9_-]{20,200}$/.test(token) ? token : null;
}

/** Only allow same-site relative redirects after login (prevents open-redirect phishing). */
export function safeNextPath(next: string | null | undefined, fallback = '/workspaces'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return fallback;
  }
  return next;
}
