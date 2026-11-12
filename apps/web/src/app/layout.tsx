import type { Metadata } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Migration CRM', template: '%s · Migration CRM' },
  description: 'Migration Business Management CRM',
  robots: { index: false, follow: false },
};

/** Rendered per request so Next.js can stamp its scripts with the CSP nonce (see src/proxy.ts). */
export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  return (
    <html lang="en-AU">
      <body className="antialiased">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
