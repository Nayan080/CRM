'use client';

import type { AuthTokensResponse, UserSummary } from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { apiFetch } from '../api/client';
import { API_URL } from '../env';
import { CSRF_HEADERS, refreshAccessToken, setAccessToken } from './token-store';

type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'anonymous'; user: null }
  | { status: 'authenticated'; user: UserSummary };

interface AuthContextValue {
  state: AuthState;
  /** Store tokens from a successful login / invitation acceptance. */
  signedIn: (result: AuthTokensResponse) => void;
  signOut: () => Promise<void>;
  reloadUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null });
  const queryClient = useQueryClient();
  const router = useRouter();

  const reloadUser = useCallback(async () => {
    try {
      const user = await apiFetch<UserSummary>('/api/v1/me');
      setState({ status: 'authenticated', user });
    } catch {
      setState({ status: 'anonymous', user: null });
    }
  }, []);

  // On first load, try to restore the session from the HttpOnly refresh cookie.
  useEffect(() => {
    void (async () => {
      const token = await refreshAccessToken();
      if (token) await reloadUser();
      else setState({ status: 'anonymous', user: null });
    })();
  }, [reloadUser]);

  const signedIn = useCallback(
    (result: AuthTokensResponse) => {
      setAccessToken(result.accessToken);
      queryClient.clear(); // never show data cached for a previous user
      setState({ status: 'authenticated', user: result.user });
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    try {
      await fetch(`${API_URL}/api/v1/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: CSRF_HEADERS,
      });
    } finally {
      setAccessToken(null);
      queryClient.clear();
      setState({ status: 'anonymous', user: null });
      router.push('/login');
    }
  }, [queryClient, router]);

  const value = useMemo(
    () => ({ state, signedIn, signOut, reloadUser }),
    [state, signedIn, signOut, reloadUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
