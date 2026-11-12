'use client';

import type { MatterStageResponse, MatterTypeResponse } from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { ErrorState, LoadingState } from '@/components/states/state-view';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ApiError, apiFetch } from '@/lib/api/client';
import { queryKeys } from '@/lib/queries';
import { useMatterTypes } from '@/lib/use-options';
import { useWorkspace } from '../workspace-context';

/** Small "type a name + Add" form. */
function AddRow({ label, onAdd }: { label: string; onAdd: (value: string) => Promise<void> }) {
  const [value, setValue] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    void onAdd(value.trim()).then(() => setValue(''));
  };
  return (
    <form onSubmit={submit} className="flex gap-2">
      <Input
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={120}
      />
      <Button type="submit" variant="outline" size="sm">
        Add
      </Button>
    </form>
  );
}

/** Stage 8: tasks created automatically when a matter enters this stage. */
function StageTasks({
  stage,
  base,
  run,
}: {
  stage: MatterStageResponse;
  base: string;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const { tenantId } = useWorkspace();
  const [title, setTitle] = useState('');
  const [days, setDays] = useState('');
  const templates = stage.taskTemplates ?? [];
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    void run(() =>
      apiFetch(base, {
        method: 'POST',
        tenantId,
        body: { title: title.trim(), ...(days ? { dueInDays: Number(days) } : {}) },
      }),
    ).then(() => {
      setTitle('');
      setDays('');
    });
  };
  return (
    <div className="flex w-full flex-col gap-1 pl-5 text-xs">
      {templates.map((t) => (
        <div key={t.id} className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">
            Auto task: <span className="text-foreground">{t.title}</span>
            {t.dueInDays !== null
              ? ` · due in ${t.dueInDays} day${t.dueInDays === 1 ? '' : 's'}`
              : ''}
            {t.assignToMatterLead ? ' · to the matter lead' : ' · unassigned'}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void run(() => apiFetch(`${base}/${t.id}`, { method: 'DELETE', tenantId }))
            }
          >
            Remove
          </Button>
        </div>
      ))}
      <form onSubmit={add} className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={`Auto task for ${stage.name}`}
          placeholder="Add a task created on entering this stage"
          className="h-8 max-w-xs text-xs"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
        />
        <Input
          aria-label={`Due in days for ${stage.name}`}
          placeholder="Due in days"
          type="number"
          min={0}
          max={365}
          className="h-8 w-28 text-xs"
          value={days}
          onChange={(e) => setDays(e.target.value)}
        />
        <Button type="submit" size="sm" variant="outline">
          Add
        </Button>
      </form>
    </div>
  );
}

function TypeEditor({
  type,
  run,
}: {
  type: MatterTypeResponse;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const { tenantId } = useWorkspace();
  const base = `/api/v1/matter-types/${type.id}`;
  const call = (path: string, method: string, body?: object) =>
    run(() => apiFetch(path, { method, tenantId, ...(body ? { body } : {}) }));
  const [name, setName] = useState(type.name);

  return (
    <details className="rounded-md border">
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium">
        {type.name} {type.isActive ? null : <Badge>Inactive</Badge>}
        <span className="text-muted-foreground">
          · {type.stages.length} stages · {type.checklist.length} checklist items
        </span>
      </summary>
      <div className="flex flex-col gap-4 border-t p-3">
        <div className="flex flex-wrap gap-2">
          <Input
            aria-label={`Name of ${type.name}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="max-w-xs"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!name.trim() || name === type.name}
            onClick={() => void call(base, 'PATCH', { name })}
          >
            Rename
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void call(base, 'PATCH', { isActive: !type.isActive })}
          >
            {type.isActive ? 'Deactivate' : 'Activate'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void call(base, 'DELETE')}>
            Delete
          </Button>
        </div>
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold">Stages (in order)</h4>
          <ol className="divide-y rounded-md border text-sm">
            {type.stages.map((s, i) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5"
              >
                <span>
                  {i + 1}. {s.name} {s.isTerminal ? <Badge>Final</Badge> : null}{' '}
                  {s.isActive ? null : <Badge>Inactive</Badge>}
                </span>
                <span className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Move ${s.name} up`}
                    disabled={i === 0}
                    onClick={() => {
                      const prev = type.stages[i - 1];
                      if (!prev) return;
                      void run(async () => {
                        await apiFetch(`${base}/stages/${s.id}`, {
                          method: 'PATCH',
                          tenantId,
                          body: { sortOrder: prev.sortOrder },
                        });
                        await apiFetch(`${base}/stages/${prev.id}`, {
                          method: 'PATCH',
                          tenantId,
                          body: { sortOrder: s.sortOrder },
                        });
                      });
                    }}
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void call(`${base}/stages/${s.id}`, 'PATCH', { isTerminal: !s.isTerminal })
                    }
                  >
                    {s.isTerminal ? 'Not final' : 'Mark final'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void call(`${base}/stages/${s.id}`, 'PATCH', { isActive: !s.isActive })
                    }
                  >
                    {s.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void call(`${base}/stages/${s.id}`, 'DELETE')}
                  >
                    Delete
                  </Button>
                </span>
                <StageTasks stage={s} base={`${base}/stages/${s.id}/tasks`} run={run} />
              </li>
            ))}
          </ol>
          <AddRow
            label={`New stage for ${type.name}`}
            onAdd={(v) => call(`${base}/stages`, 'POST', { name: v })}
          />
        </div>
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold">Checklist for new matters</h4>
          <p className="text-xs text-muted-foreground">
            Copied into each new matter of this type. Changing it never changes existing matters.
          </p>
          {type.checklist.length ? (
            <ul className="divide-y rounded-md border text-sm">
              {type.checklist.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                  <span>
                    {c.title} {c.isRequired ? null : <Badge>Optional</Badge>}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void call(`${base}/checklist/${c.id}`, 'DELETE')}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No checklist items.</p>
          )}
          <AddRow
            label={`New checklist item for ${type.name}`}
            onAdd={(v) => call(`${base}/checklist`, 'POST', { title: v })}
          />
        </div>
      </div>
    </details>
  );
}

export function MatterTypesSettings() {
  const { tenantId } = useWorkspace();
  const queryClient = useQueryClient();
  const types = useMatterTypes(tenantId);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    }
    await queryClient.invalidateQueries({ queryKey: queryKeys.matterTypes(tenantId) });
  };

  return (
    <Card className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">Matter types & stages</h2>
        <p className="text-sm text-muted-foreground">
          Your own service types and workflow stages. The starting examples are generic — rename,
          change or delete them. Legal requirements are not built in.
        </p>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {types.isPending ? <LoadingState /> : null}
      {types.isError ? <ErrorState onRetry={() => void types.refetch()} /> : null}
      <div className="flex flex-col gap-2">
        {types.data?.map((type) => (
          <TypeEditor key={`${type.id}:${type.name}`} type={type} run={run} />
        ))}
      </div>
      <AddRow
        label="New matter type"
        onAdd={(name) =>
          run(() => apiFetch('/api/v1/matter-types', { method: 'POST', tenantId, body: { name } }))
        }
      />
    </Card>
  );
}
