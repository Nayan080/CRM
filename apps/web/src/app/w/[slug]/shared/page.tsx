'use client';

import type { SharedMatter } from '@crm/contracts';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { EmptyState, ErrorState, LoadingState } from '@/components/states/state-view';
import { Card } from '@/components/ui/card';
import { apiFetch } from '@/lib/api/client';
import { formatDate } from '@/lib/form-values';
import { queryKeys } from '@/lib/queries';
import { useWorkspace } from '../workspace-context';

/** External collaborators: the matters this agency shared with them, and nothing else. */
export default function SharedPage() {
  const { tenantId, slug } = useWorkspace();
  const shared = useQuery({
    queryKey: queryKeys.shared(tenantId),
    queryFn: () => apiFetch<SharedMatter[]>('/api/v1/shared', { tenantId }),
  });
  if (shared.isPending) return <LoadingState />;
  if (shared.isError) return <ErrorState onRetry={() => void shared.refetch()} />;
  if (!shared.data.length) {
    return (
      <EmptyState
        title="Nothing shared with you"
        description="You only see matters and documents this agency explicitly shares with you."
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Shared with you</h2>
      {shared.data.map((s) => (
        <Card key={s.shareId} className="flex flex-col gap-1">
          <Link
            href={`/w/${slug}/shared/${s.shareId}`}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {s.matter.reference} · {s.matter.title}
          </Link>
          <span className="text-sm text-muted-foreground">
            {[
              s.matter.clientName,
              s.matter.type,
              `${s.documents.length} document${s.documents.length === 1 ? '' : 's'}`,
              `shared by ${s.sharedBy}`,
              s.expiresAt ? `until ${formatDate(s.expiresAt)}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </Card>
      ))}
    </div>
  );
}
