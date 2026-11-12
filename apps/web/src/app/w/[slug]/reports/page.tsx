'use client';

import type { DocumentsReport, LeadsReport, MattersReport, WorkloadReport } from '@crm/contracts';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { selectClass } from '@/components/forms/select-field';
import { ErrorState, ForbiddenState, LoadingState } from '@/components/states/state-view';
import { Card } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { apiFetch } from '@/lib/api/client';
import { formatDate } from '@/lib/form-values';
import { useBranches } from '@/lib/use-options';
import { matterStatusLabel } from '../matters/matter-status';
import { useWorkspace } from '../workspace-context';

function useReport<T>(name: string, qs: string, enabled: boolean) {
  const { tenantId } = useWorkspace();
  return useQuery({
    queryKey: ['tenant', tenantId, 'report', name, qs],
    queryFn: () => apiFetch<T>(`/api/v1/reports/${name}${qs ? `?${qs}` : ''}`, { tenantId }),
    enabled,
  });
}

function Section<T>({
  title,
  q,
  children,
}: {
  title: string;
  q: ReturnType<typeof useReport<T>>;
  children: (data: T) => ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {q.isPending ? <LoadingState /> : null}
      {q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : null}
      {q.data ? children(q.data) : null}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col rounded-md border px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
    </div>
  );
}

/** Horizontal bars. Values are always printed as text, so no information depends on the bar. */
function Bars({ rows }: { rows: { label: string; value: number; note?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length)
    return <p className="text-sm text-muted-foreground">No data for this period.</p>;
  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-2">
          <span className="truncate" title={r.label}>
            {r.label}
          </span>
          <span className="h-2.5 rounded-full bg-muted" aria-hidden="true">
            <span
              className="block h-2.5 rounded-full bg-primary"
              style={{ width: `${(r.value / max) * 100}%` }}
            />
          </span>
          <span className="tabular-nums text-muted-foreground">
            {r.value}
            {r.note ? ` · ${r.note}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

const pct = (part: number, whole: number) =>
  whole ? `${Math.round((part / whole) * 100)}% converted` : undefined;

export default function ReportsPage() {
  const { tenantId, slug, can } = useWorkspace();
  const branches = useBranches(tenantId, can('branch:read'));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [branchId, setBranchId] = useState('');
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  if (branchId) qs.set('branchId', branchId);
  const query = qs.toString();
  const period = new URLSearchParams(query);
  period.delete('branchId');

  const showLeads = can('lead:read');
  const showMatters = can('matter:read');
  const showWorkload = can('member:read') && can('matter:read') && can('task:read');
  const showDocuments = can('audit:read') && can('document:read');
  const leads = useReport<LeadsReport>('leads', query, can('report:read') && showLeads);
  const matters = useReport<MattersReport>('matters', query, can('report:read') && showMatters);
  const workload = useReport<WorkloadReport>('workload', '', can('report:read') && showWorkload);
  const documents = useReport<DocumentsReport>(
    'documents',
    period.toString(),
    can('report:read') && showDocuments,
  );

  if (!can('report:read')) return <ForbiddenState />;
  const shownPeriod = leads.data?.period ?? matters.data?.period ?? documents.data?.period;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rep-from">From</Label>
          <Input id="rep-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rep-to">To</Label>
          <Input id="rep-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        {branches.data?.length ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rep-branch">Branch</Label>
            <select
              id="rep-branch"
              className={`${selectClass} w-auto`}
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
            >
              <option value="">All branches I can see</option>
              {branches.data.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <p className="text-sm text-muted-foreground">
          {shownPeriod
            ? `Showing ${formatDate(shownPeriod.from)} – ${formatDate(shownPeriod.to)} (UTC). `
            : ''}
          Only records you can access are counted.
        </p>
      </div>

      {showLeads ? (
        <Section title="Leads & referrals" q={leads}>
          {(r) => (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <Stat label="New leads" value={r.totals.created} />
                <Stat label="Converted" value={r.totals.converted} />
                <Stat label="Still open" value={r.totals.open} />
                <Stat label="Lost" value={r.totals.lost} />
                <Stat
                  label="Conversion"
                  value={r.totals.conversionRate === null ? '—' : `${r.totals.conversionRate}%`}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                Median time to convert:{' '}
                {r.medianDaysToConvert === null ? '—' : `${r.medianDaysToConvert} days`}
              </p>
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">By source</h3>
                  <Bars
                    rows={r.bySource.map((s) => ({
                      label: s.source?.name ?? 'Not recorded',
                      value: s.created,
                      note: pct(s.converted, s.created),
                    }))}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">By referring partner</h3>
                  <Bars
                    rows={r.byPartner.map((p) => ({
                      label: p.partner.name,
                      value: p.created,
                      note: pct(p.converted, p.created),
                    }))}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">By month</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="font-medium">Month</th>
                      <th className="font-medium">New</th>
                      <th className="font-medium">Converted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.byMonth.map((m) => (
                      <tr key={m.month} className="border-t">
                        <td className="py-1">{m.month}</td>
                        <td className="tabular-nums">{m.created}</td>
                        <td className="tabular-nums">{m.converted}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Section>
      ) : null}

      {showMatters ? (
        <Section title="Matters" q={matters}>
          {(r) => (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
                {(['OPEN', 'ON_HOLD', 'CLOSED', 'ARCHIVED'] as const).map((s) => (
                  <Stat key={s} label={matterStatusLabel[s]} value={r.byStatus[s]} />
                ))}
                <Stat label="Opened in period" value={r.openedInPeriod} />
                <Stat label="Closed in period" value={r.closedInPeriod} />
              </div>
              <div className="grid gap-6 lg:grid-cols-3">
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">Open by type</h3>
                  <Bars rows={r.openByType.map((x) => ({ label: x.type.name, value: x.count }))} />
                </div>
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">Open by stage</h3>
                  <Bars
                    rows={r.openByStage.map((x) => ({
                      label: `${x.type.name} · ${x.stage?.name ?? 'No stage'}`,
                      value: x.count,
                    }))}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">Age of open matters</h3>
                  <Bars rows={r.ageing.map((x) => ({ label: x.label, value: x.count }))} />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">
                  Overdue deadlines ({r.overdueDeadlines.count})
                </h3>
                {r.overdueDeadlines.items.length ? (
                  <ul className="divide-y rounded-md border text-sm">
                    {r.overdueDeadlines.items.map((d) => (
                      <li
                        key={`${d.matterId}:${d.deadline}:${d.dueAt}`}
                        className="flex flex-wrap justify-between gap-2 px-3 py-1.5"
                      >
                        <Link
                          className="text-primary underline-offset-4 hover:underline"
                          href={`/w/${slug}/matters/${d.matterId}`}
                        >
                          {d.reference} · {d.title}
                        </Link>
                        <span className="text-muted-foreground">
                          {d.deadline} · due {formatDate(d.dueAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">None.</p>
                )}
              </div>
            </div>
          )}
        </Section>
      ) : null}

      {showWorkload ? (
        <Section title="Team workload (now)" q={workload}>
          {(r) => (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="font-medium">Team member</th>
                  <th className="font-medium">Open matters</th>
                  <th className="font-medium">Open tasks</th>
                  <th className="font-medium">Overdue tasks</th>
                  <th className="font-medium">Deadlines, next 14 days</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((row) => (
                  <tr key={row.member.id} className="border-t">
                    <td className="py-1">{row.member.name}</td>
                    <td className="tabular-nums">{row.openMatters}</td>
                    <td className="tabular-nums">{row.openTasks}</td>
                    <td className="tabular-nums">{row.overdueTasks}</td>
                    <td className="tabular-nums">{row.deadlinesNext14Days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      ) : null}

      {showDocuments ? (
        <Section title="Documents & sharing" q={documents}>
          {(r) => (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
                <Stat label="Files uploaded" value={r.uploads} />
                <Stat label="Downloads" value={r.downloads} />
                <Stat label="…by external collaborators" value={r.downloadsViaShare} />
                <Stat label="Active shares (now)" value={r.activeShares} />
                <Stat label="Shares created" value={r.sharesCreated} />
                <Stat label="Shares revoked" value={r.sharesRevoked} />
              </div>
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">Most downloaded</h3>
                <Bars
                  rows={r.topDownloaded.map((d) => ({
                    label: d.document.title,
                    value: d.downloads,
                  }))}
                />
              </div>
            </div>
          )}
        </Section>
      ) : null}
    </div>
  );
}
