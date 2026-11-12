import { z } from 'zod';
import { uuidSchema } from './common.js';
import type { NamedRef } from './crm.js';
import type { MatterStatus } from './matters.js';

/** Period filter for reports. Defaults: the last 90 days up to today (inclusive). */
export const reportQuerySchema = z
  .object({
    from: z.iso.date('Use the format YYYY-MM-DD').optional(),
    to: z.iso.date('Use the format YYYY-MM-DD').optional(),
    branchId: uuidSchema.optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    path: ['to'],
    message: 'Must be on or after the start',
  });
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export interface ReportPeriod {
  from: string;
  to: string;
}

export interface LeadsReport {
  period: ReportPeriod;
  totals: {
    created: number;
    converted: number;
    lost: number;
    open: number;
    conversionRate: number | null;
  };
  bySource: { source: NamedRef | null; created: number; converted: number }[];
  byPartner: { partner: NamedRef; created: number; converted: number }[];
  /** Median days from lead created to converted, for leads converted in the period. */
  medianDaysToConvert: number | null;
  byMonth: { month: string; created: number; converted: number }[];
}

export interface MattersReport {
  period: ReportPeriod;
  /** Current counts (not limited to the period). */
  byStatus: Record<MatterStatus, number>;
  openByType: { type: NamedRef; count: number }[];
  openByStage: { type: NamedRef; stage: NamedRef | null; count: number }[];
  openByBranch: { branch: NamedRef | null; count: number }[];
  /** Open and on-hold matters by days since opened. */
  ageing: { label: string; count: number }[];
  openedInPeriod: number;
  closedInPeriod: number;
  overdueDeadlines: {
    count: number;
    items: {
      matterId: string;
      reference: string;
      title: string;
      deadline: string;
      dueAt: string;
    }[];
  };
}

export interface WorkloadReport {
  rows: {
    member: NamedRef;
    openMatters: number;
    openTasks: number;
    overdueTasks: number;
    deadlinesNext14Days: number;
  }[];
}

export interface DocumentsReport {
  period: ReportPeriod;
  uploads: number;
  downloads: number;
  downloadsViaShare: number;
  activeShares: number;
  sharesCreated: number;
  sharesRevoked: number;
  topDownloaded: { document: { id: string; title: string }; downloads: number }[];
}
