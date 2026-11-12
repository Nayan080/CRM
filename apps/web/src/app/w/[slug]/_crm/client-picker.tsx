'use client';

import type { ClientSummary, Paginated } from '@crm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Input, Label } from '@/components/ui/input';
import { selectClass } from '@/components/forms/select-field';
import { apiFetch } from '@/lib/api/client';
import { queryKeys } from '@/lib/queries';
import { useWorkspace } from '../workspace-context';

/** Search-then-choose a client the caller can see. */
export function ClientPicker({
  id,
  label,
  value,
  onChange,
  exclude,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (clientId: string) => void;
  exclude?: string;
}) {
  const { tenantId } = useWorkspace();
  const [q, setQ] = useState('');
  const found = useQuery({
    queryKey: [...queryKeys.clients(tenantId), 'pick', q],
    queryFn: () =>
      apiFetch<Paginated<ClientSummary>>(`/api/v1/clients?q=${encodeURIComponent(q)}&limit=10`, {
        tenantId,
      }),
    enabled: q.trim().length >= 2,
  });
  const options = found.data?.data.filter((c) => c.id !== exclude) ?? [];
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${id}-search`}>{label}</Label>
      <Input
        id={`${id}-search`}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Type 2+ letters of a name, email or number"
      />
      {options.length ? (
        <select
          id={id}
          aria-label={`${label} — choose`}
          className={selectClass}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Choose…</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.displayName} ({c.clientNumber})
            </option>
          ))}
        </select>
      ) : found.isSuccess ? (
        <p className="text-xs text-muted-foreground">No matching client.</p>
      ) : null}
    </div>
  );
}
