'use client';

import type { AutomationSettingsResponse } from '@crm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { ApiError, apiFetch } from '@/lib/api/client';
import { useWorkspace } from '../workspace-context';

function Form({ current }: { current: AutomationSettingsResponse }) {
  const { tenantId } = useWorkspace();
  const queryClient = useQueryClient();
  const [days, setDays] = useState(current.deadlineReminderDays.join(', '));
  const [lead, setLead] = useState(current.leadFollowUpDays?.toString() ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const parsed = days
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .map(Number);
    if (parsed.some((n) => !Number.isInteger(n))) {
      setError('Use whole numbers separated by commas, e.g. 7, 1');
      return;
    }
    try {
      await apiFetch('/api/v1/automation-settings', {
        method: 'PUT',
        tenantId,
        body: { deadlineReminderDays: parsed, leadFollowUpDays: lead ? Number(lead) : null },
      });
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: ['tenant', tenantId, 'automation'] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    }
  };
  return (
    <form onSubmit={(e) => void save(e)} className="flex flex-col gap-4" noValidate>
      {error ? <Alert>{error}</Alert> : null}
      {saved ? <Alert tone="success">Saved.</Alert> : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="auto-deadline-days">
          Deadline reminders: days before (up to 3, e.g. 7, 1)
        </Label>
        <Input
          id="auto-deadline-days"
          value={days}
          onChange={(e) => setDays(e.target.value)}
          placeholder="Off"
          className="max-w-xs"
        />
        <p className="text-xs text-muted-foreground">
          Emails the staff assigned to the matter. Leave empty to turn off.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="auto-lead-days">
          Lead follow-up: remind the owner after this many days without activity
        </Label>
        <Input
          id="auto-lead-days"
          type="number"
          min={1}
          max={90}
          value={lead}
          onChange={(e) => setLead(e.target.value)}
          placeholder="Off"
          className="max-w-xs"
        />
      </div>
      <div>
        <Button type="submit" variant="outline">
          Save automation
        </Button>
      </div>
    </form>
  );
}

/** Settings: agency automation switches (off by default). Stage tasks are set per stage below. */
export function AutomationSettings() {
  const { tenantId } = useWorkspace();
  const q = useQuery({
    queryKey: ['tenant', tenantId, 'automation'],
    queryFn: () =>
      apiFetch<AutomationSettingsResponse>('/api/v1/automation-settings', { tenantId }),
  });
  return (
    <Card className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">Automation</h2>
        <p className="text-sm text-muted-foreground">
          Off until you turn it on. Automatic tasks per stage are set under Matter types &amp;
          stages.
        </p>
      </div>
      {q.data ? <Form current={q.data} /> : null}
    </Card>
  );
}
