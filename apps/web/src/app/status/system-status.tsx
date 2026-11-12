'use client';

import { type ReadyResponse, readyResponseSchema } from '@crm/contracts';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { ErrorState, LoadingState } from '@/components/states/state-view';
import { API_URL } from '@/lib/env';

/** Readiness returns 200 or 503 with the same JSON body, so read the body either way. */
async function fetchReadiness(): Promise<ReadyResponse> {
  const response = await fetch(`${API_URL}/health/ready`, { cache: 'no-store' });
  return readyResponseSchema.parse(await response.json());
}

export function SystemStatus() {
  const query = useQuery({ queryKey: ['system', 'readiness'], queryFn: fetchReadiness });

  if (query.isPending) return <LoadingState label="Checking API…" />;
  if (query.isError) {
    return (
      <ErrorState
        title="API unreachable"
        description={`Could not reach the API at ${API_URL}. Is it running?`}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const rows = [
    { name: 'API', up: true },
    { name: 'Database', up: query.data.checks.database === 'up' },
  ];

  return (
    <ul className="divide-y rounded-md border bg-card">
      {rows.map((row) => (
        <li key={row.name} className="flex items-center justify-between px-4 py-3">
          <span className="font-medium">{row.name}</span>
          <span
            className={`flex items-center gap-2 text-sm ${row.up ? 'text-success' : 'text-destructive'}`}
          >
            {row.up ? (
              <CheckCircle2 className="size-4" aria-hidden="true" />
            ) : (
              <XCircle className="size-4" aria-hidden="true" />
            )}
            {row.up ? 'Operational' : 'Unavailable'}
          </span>
        </li>
      ))}
    </ul>
  );
}
