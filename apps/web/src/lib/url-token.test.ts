import { describe, expect, it } from 'vitest';
import { safeNextPath, takeTokenFromHash } from './url-token';

describe('takeTokenFromHash', () => {
  it('reads the token and removes it from the address bar', () => {
    const token = 'A'.repeat(43);
    window.history.replaceState(null, '', `/verify-email?x=1#token=${token}`);
    expect(takeTokenFromHash()).toBe(token);
    expect(window.location.hash).toBe('');
    expect(window.location.search).toBe('?x=1');
  });

  it('rejects malformed tokens', () => {
    window.history.replaceState(null, '', '/verify-email#token=<script>');
    expect(takeTokenFromHash()).toBeNull();
  });
});

describe('safeNextPath', () => {
  it('allows only local paths', () => {
    expect(safeNextPath('/w/acme/team')).toBe('/w/acme/team');
    expect(safeNextPath('https://evil.example')).toBe('/workspaces');
    expect(safeNextPath('//evil.example')).toBe('/workspaces');
    expect(safeNextPath('/\\evil.example')).toBe('/workspaces');
    expect(safeNextPath(null)).toBe('/workspaces');
  });
});
