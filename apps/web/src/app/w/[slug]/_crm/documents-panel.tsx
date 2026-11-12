'use client';

import {
  ALLOWED_UPLOADS,
  type DocumentResponse,
  MAX_UPLOAD_BYTES,
  type Paginated,
  UPLOAD_ACCEPT,
} from '@crm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useRef, useState } from 'react';
import { selectClass } from '@/components/forms/select-field';
import { EmptyState, ErrorState, LoadingState } from '@/components/states/state-view';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { ApiError, apiFetch, downloadFile } from '@/lib/api/client';
import { formatDateTime } from '@/lib/form-values';
import { queryKeys } from '@/lib/queries';
import { useReferenceOptions } from '@/lib/use-options';
import { useWorkspace } from '../workspace-context';

const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong.');
const allowedLabel = ALLOWED_UPLOADS.map((a) => a.label).join(', ');

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Quick client-side check (the server checks the actual content again). */
function precheck(file: File | null | undefined): string | null {
  if (!file) return 'Choose a file.';
  if (file.size > MAX_UPLOAD_BYTES) return 'The file is larger than 20 MB.';
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!ALLOWED_UPLOADS.some((a) => (a.extensions as readonly string[]).includes(ext))) {
    return `Only ${allowedLabel} files can be uploaded.`;
  }
  return null;
}

type Target = { clientId: string } | { matterId: string };

export function DocumentsPanel({
  target,
  checklist = [],
  editable = true,
}: {
  target: Target;
  checklist?: { id: string; title: string }[];
  editable?: boolean;
}) {
  const { tenantId, can } = useWorkspace();
  const queryClient = useQueryClient();
  const query =
    'matterId' in target ? `matterId=${target.matterId}` : `clientId=${target.clientId}`;
  const key = [...queryKeys.documents(tenantId), query];
  const canRead = can('document:read');
  const canUpload = can('document:upload') && editable;
  const canDownload = can('document:download');
  const list = useQuery({
    queryKey: key,
    queryFn: () =>
      apiFetch<Paginated<DocumentResponse>>(`/api/v1/documents?${query}&limit=100`, { tenantId }),
    enabled: canRead,
  });
  const categories = useReferenceOptions(tenantId, 'DOCUMENT_CATEGORY', canUpload);
  const fileRef = useRef<HTMLInputElement>(null);
  const versionRef = useRef<HTMLInputElement>(null);
  const [versionFor, setVersionFor] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [checklistItemId, setChecklistItemId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!canRead && !canUpload) return null;

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: queryKeys.documents(tenantId) });
      return true;
    } catch (e) {
      setError(errText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const upload = async (e: FormEvent) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    const problem = precheck(file);
    if (problem || !file) {
      setError(problem);
      return;
    }
    const form = new FormData();
    form.set(
      'matterId' in target ? 'matterId' : 'clientId',
      'matterId' in target ? target.matterId : target.clientId,
    );
    if (title.trim()) form.set('title', title.trim());
    if (categoryId) form.set('categoryId', categoryId);
    if (checklistItemId) form.set('checklistItemId', checklistItemId);
    form.set('file', file);
    const ok = await run(() =>
      apiFetch('/api/v1/documents', { method: 'POST', tenantId, body: form }),
    );
    if (ok) {
      setTitle('');
      setChecklistItemId('');
      if (fileRef.current) fileRef.current.value = '';
      setNotice(canRead ? null : 'Uploaded. You can upload files here but not view them.');
    }
  };

  const uploadVersion = async (docId: string, file: File | undefined) => {
    const problem = precheck(file);
    if (problem || !file) {
      setError(problem);
      return;
    }
    const form = new FormData();
    form.set('file', file);
    await run(() =>
      apiFetch(`/api/v1/documents/${docId}/versions`, { method: 'POST', tenantId, body: form }),
    );
    setVersionFor(null);
  };

  const rows = list.data?.data ?? [];
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Documents</h2>
        <p className="text-xs text-muted-foreground">
          {allowedLabel} up to 20 MB. Files are stored privately and every download is logged. Virus
          scanning is not active yet.
        </p>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {canRead && list.isPending ? <LoadingState /> : null}
      {list.isError ? <ErrorState onRetry={() => void list.refetch()} /> : null}
      {list.isSuccess && rows.length === 0 ? <EmptyState title="No documents yet" /> : null}
      {rows.length ? (
        <ul className="divide-y rounded-md border text-sm">
          {rows.map((d) => (
            <li key={d.id} className="flex flex-col gap-2 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium">
                    {d.title} {d.category ? <Badge>{d.category.name}</Badge> : null}{' '}
                    {d.versions.length > 1 ? <Badge>v{d.latest.versionNumber}</Badge> : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {d.latest.fileName} · {formatBytes(d.latest.sizeBytes)} ·{' '}
                    {d.latest.uploadedBy.name} · {formatDateTime(d.latest.createdAt)}
                    {'matterId' in target ? null : d.matter ? ` · ${d.matter.reference}` : ''}
                    {d.checklistItem ? ` · for “${d.checklistItem.title}”` : ''}
                  </span>
                </div>
                <span className="flex flex-wrap gap-1">
                  {canDownload ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void run(() => downloadFile(`/api/v1/documents/${d.id}/download`, tenantId))
                      }
                    >
                      Download
                    </Button>
                  ) : null}
                  {canUpload ? (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setVersionFor(versionFor === d.id ? null : d.id)}
                      >
                        New version
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void run(() =>
                            apiFetch(`/api/v1/documents/${d.id}`, { method: 'DELETE', tenantId }),
                          )
                        }
                      >
                        Delete
                      </Button>
                    </>
                  ) : null}
                </span>
              </div>
              {versionFor === d.id ? (
                <div className="flex items-center gap-2">
                  <input
                    ref={versionRef}
                    type="file"
                    accept={UPLOAD_ACCEPT}
                    aria-label={`New version of ${d.title}`}
                    className="text-sm"
                    onChange={(e) => void uploadVersion(d.id, e.target.files?.[0])}
                  />
                </div>
              ) : null}
              {d.versions.length > 1 && canDownload ? (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Earlier versions</summary>
                  <ul className="mt-1 flex flex-col gap-1">
                    {d.versions.slice(1).map((v) => (
                      <li key={v.id}>
                        <button
                          type="button"
                          className="text-primary underline-offset-4 hover:underline"
                          onClick={() =>
                            void run(() =>
                              downloadFile(
                                `/api/v1/documents/${d.id}/versions/${v.id}/download`,
                                tenantId,
                              ),
                            )
                          }
                        >
                          v{v.versionNumber} · {v.fileName}
                        </button>{' '}
                        · {formatDateTime(v.createdAt)}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {canUpload ? (
        <form
          onSubmit={(e) => void upload(e)}
          className="flex flex-col gap-3 border-t pt-3"
          noValidate
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="doc-file">File</Label>
            <input
              id="doc-file"
              ref={fileRef}
              type="file"
              accept={UPLOAD_ACCEPT}
              className="text-sm"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="doc-title">Title (optional)</Label>
              <Input
                id="doc-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="doc-category">Category</Label>
              <select
                id="doc-category"
                className={selectClass}
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">None</option>
                {categories.data
                  ?.filter((c) => c.isActive)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          {checklist.length ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="doc-checklist">For checklist item (optional)</Label>
              <select
                id="doc-checklist"
                className={selectClass}
                value={checklistItemId}
                onChange={(e) => setChecklistItemId(e.target.value)}
              >
                <option value="">None</option>
                {checklist.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div>
            <Button type="submit" size="sm" disabled={busy}>
              Upload
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
