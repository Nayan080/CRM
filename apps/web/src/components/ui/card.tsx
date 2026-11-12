import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-md border bg-card p-6 shadow-xs', className)} {...props} />;
}

export function CardHeader({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-1">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
    </div>
  );
}

/** Narrow centered column for sign-in style pages. */
export function AuthPage({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-md py-6">{children}</div>;
}

export function Alert({
  tone = 'error',
  children,
}: {
  tone?: 'error' | 'success' | 'info';
  children: ReactNode;
}) {
  const styles = {
    error: 'border-destructive/40 bg-destructive/10 text-destructive',
    success: 'border-success/40 bg-success/10 text-success',
    info: 'border-border bg-muted text-foreground',
  }[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('rounded-md border px-3 py-2 text-sm', styles)}
    >
      {children}
    </div>
  );
}
