'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { RequireAuth } from '@/lib/auth/require-auth';
import { cn } from '@/lib/utils';
import { WorkspaceProvider, useWorkspace } from './workspace-context';

function WorkspaceNav() {
  const { slug, access, can } = useWorkspace();
  const pathname = usePathname();
  const home = `/w/${slug}`;
  const isActive = (href: string) =>
    href === home ? pathname === home : pathname === href || pathname.startsWith(`${href}/`);
  const links = [
    { href: `/w/${slug}`, label: 'Overview', show: true },
    { href: `/w/${slug}/shared`, label: 'Shared with me', show: access.kind === 'EXTERNAL' },
    { href: `/w/${slug}/leads`, label: 'Leads', show: can('lead:read') },
    { href: `/w/${slug}/clients`, label: 'Clients', show: can('client:read') },
    { href: `/w/${slug}/matters`, label: 'Matters', show: can('matter:read') },
    { href: `/w/${slug}/tasks`, label: 'Tasks', show: can('task:read') },
    { href: `/w/${slug}/calendar`, label: 'Calendar', show: can('appointment:read') },
    { href: `/w/${slug}/reports`, label: 'Reports', show: can('report:read') },
    { href: `/w/${slug}/professionals`, label: 'Professionals', show: can('directory:read') },
    { href: `/w/${slug}/partners`, label: 'Partners', show: can('directory:read') },
    { href: `/w/${slug}/team`, label: 'Team', show: can('member:read') },
    { href: `/w/${slug}/branches`, label: 'Branches', show: can('branch:read') },
    { href: `/w/${slug}/settings`, label: 'Settings', show: can('tenant:update') },
  ];
  return (
    <div className="mb-6 flex flex-col gap-3 border-b pb-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{access.tenant.name}</h1>
        <span className="text-sm text-muted-foreground">
          {access.kind === 'EXTERNAL' ? 'External collaborator' : access.role?.name}
        </span>
      </div>
      <nav aria-label="Workspace" className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {links
          .filter((l) => l.show)
          .map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isActive(l.href) ? 'page' : undefined}
              className={cn(
                'underline-offset-4 hover:underline',
                isActive(l.href) ? 'font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {l.label}
            </Link>
          ))}
      </nav>
    </div>
  );
}

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  return (
    <RequireAuth>
      <WorkspaceProvider slug={slug}>
        <WorkspaceNav />
        {children}
      </WorkspaceProvider>
    </RequireAuth>
  );
}
