'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';

/** Minimal shell. Workspace navigation (leads, clients, matters…) is added from Stage 3. */
export function AppShell({ children }: { children: ReactNode }) {
  const { state, signOut } = useAuth();
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded-md focus:bg-card focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="border-b bg-card">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
          <Link
            href={state.status === 'authenticated' ? '/workspaces' : '/'}
            className="font-semibold"
          >
            Migration CRM
          </Link>
          <nav aria-label="Main" className="flex items-center gap-4 text-sm text-muted-foreground">
            {state.status === 'authenticated' ? (
              <>
                <Link href="/workspaces" className="hover:text-foreground">
                  Workspaces
                </Link>
                {state.user.platformRoles.length ? (
                  <Link href="/platform" className="hover:text-foreground">
                    Platform
                  </Link>
                ) : null}
                <Link href="/account/security" className="hover:text-foreground">
                  Security
                </Link>
                <span className="hidden text-foreground sm:inline" title={state.user.email}>
                  {state.user.name}
                </span>
                <Button variant="outline" size="sm" onClick={() => void signOut()}>
                  Sign out
                </Button>
              </>
            ) : state.status === 'anonymous' ? (
              <>
                <Link href="/login" className="hover:text-foreground">
                  Sign in
                </Link>
                <Link href="/register" className="hover:text-foreground">
                  Create account
                </Link>
              </>
            ) : null}
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        {children}
      </main>
    </div>
  );
}
