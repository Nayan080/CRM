import { AlertTriangle, Inbox, Loader2, Lock, SearchX } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Standard UI states required on every screen (docs/PRODUCT_BRIEF.md §9):
 * loading, empty, error, unauthorized/forbidden and no-results.
 */

interface StateShellProps {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  role?: 'status' | 'alert';
}

function StateShell({ icon, title, description, action, role = 'status' }: StateShellProps) {
  return (
    <div
      role={role}
      className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed p-10 text-center"
    >
      <div className="text-muted-foreground" aria-hidden="true">
        {icon}
      </div>
      <h2 className="text-base font-semibold">{title}</h2>
      {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action}
    </div>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground"
    >
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <StateShell
      icon={<Inbox className="size-8" />}
      title={title}
      description={description}
      action={action}
    />
  );
}

export function NoResultsState({ query }: { query?: string }) {
  return (
    <StateShell
      icon={<SearchX className="size-8" />}
      title="No results"
      description={
        query ? `Nothing matches “${query}”. Try a different search.` : 'Try changing your filters.'
      }
    />
  );
}

export function ErrorState({
  title = 'Something went wrong',
  description = 'Please try again. If it keeps happening, contact support.',
  requestId,
  onRetry,
}: {
  title?: string;
  description?: string;
  requestId?: string;
  onRetry?: () => void;
}) {
  return (
    <StateShell
      role="alert"
      icon={<AlertTriangle className="size-8 text-destructive" />}
      title={title}
      description={requestId ? `${description} (Reference: ${requestId})` : description}
      action={
        onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        ) : undefined
      }
    />
  );
}

export function ForbiddenState() {
  return (
    <StateShell
      role="alert"
      icon={<Lock className="size-8" />}
      title="You don’t have access"
      description="Ask your workspace owner or admin if you need access to this page."
    />
  );
}
