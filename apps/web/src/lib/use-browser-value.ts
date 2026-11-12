import { useSyncExternalStore } from 'react';

const cache = new Map<string, string | null>();
const noopSubscribe = () => () => undefined;

/**
 * Reads a browser-only value (URL fragment, sessionStorage…) once per page, without an effect.
 * During server rendering and hydration it returns `undefined`; then React re-renders with the
 * real value. The reader runs once per key and its result is cached, so side effects inside it
 * (like removing the token from the address bar) happen only once.
 */
export function useBrowserValue(key: string, read: () => string | null): string | null | undefined {
  return useSyncExternalStore(
    noopSubscribe,
    () => {
      const cacheKey = `${key}:${window.location.pathname}`;
      if (!cache.has(cacheKey)) cache.set(cacheKey, read());
      return cache.get(cacheKey) ?? null;
    },
    () => undefined,
  );
}
