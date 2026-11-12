'use client';

import type { SharedMatter } from '@crm/contracts';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { EmptyState, ErrorState, LoadingState } from '@/components/states/state-view';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { ApiError, apiFetch, downloadFile } from '@/lib/api/client';
import { formatDate, formatDateTime } from '@/lib/form-values';
import { queryKeys } from '@/lib/queries';
import { formatBytes } from '../../_crm/documents-panel';
import { matterStatusLabel } from '../../matters/matter-status';
import { useWorkspace } from '../../workspace-context';

export default function SharedMatterPage() {
  const { shareId } = useParams<{ shareId: string }>();
  const { tenantId, slug } = useWorkspace();
  const [error, setError] = useState<string | null>(null);
  const share = useQuery({
    queryKey: [...queryKeys.shared(tenantId), shareId],
    queryFn: () => apiFetch<SharedMatter>(`/api/v1/shared/${shareId}`, { tenantId }),
  });
  if (share.isPending) return <LoadingState />;
  if (share.isError) {
    return share.error instanceof ApiError && share.error.status === 404 ? (
      <EmptyState title="No longer shared" description="This share has ended or was revoked." />
    ) : (
      <ErrorState onRetry={() => void share.refetch()} />
    );
  }
  const s = share.data;
  const download = async (documentId: string) => {
    setError(null);
    try {
      await downloadFile(`/api/v1/shared/${shareId}/documents/${documentId}/download`, tenantId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Download failed.');
      void share.refetch();
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/w/${slug}/shared`}
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        ← Shared with you
      </Link>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold">
            {s.matter.reference} · {s.matter.title}
          </h2>
          <Badge>{matterStatusLabel[s.matter.status]}</Badge>
          {s.matter.stage ? <Badge>{s.matter.stage}</Badge> : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {s.matter.type} · Client {s.matter.clientName} · shared by {s.sharedBy}
          {s.expiresAt ? ` · until ${formatDate(s.expiresAt)}` : ''}
        </p>
        {s.purpose ? <p className="text-sm">Purpose: {s.purpose}</p> : null}
      </div>
      {error ? <Alert>{error}</Alert> : null}
      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Documents</h2>
        {s.documents.length ? (
          <ul className="divide-y rounded-md border text-sm">
            {s.documents.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              >
                <span className="flex flex-col">
                  <span className="font-medium">
                    {d.title} {d.category ? <Badge>{d.category}</Badge> : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {d.fileName} · {formatBytes(d.sizeBytes)} · updated{' '}
                    {formatDateTime(d.updatedAt)}
                  </span>
                </span>
                <Button size="sm" variant="outline" onClick={() => void download(d.id)}>
                  Download
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No documents shared.</p>
        )}
        <p className="text-xs text-muted-foreground">Downloads are logged by the agency.</p>
      </Card>
    </div>
  );
}
