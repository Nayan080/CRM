'use client';

import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { LoadingState } from '@/components/states/state-view';
import { useAuth } from './auth-context';

/**
 * Client-side gate for signed-in pages (UX only). The API enforces access on every request
 * regardless of what the browser shows.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (state.status === 'anonymous') {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [state.status, router, pathname]);

  if (state.status !== 'authenticated') return <LoadingState />;
  return <>{children}</>;
}
