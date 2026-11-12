import type { LeadStatus } from '@crm/contracts';

export const leadStatusLabel: Record<LeadStatus, string> = {
  OPEN: 'Open',
  CONVERTED: 'Converted',
  LOST: 'Lost',
};
export const leadStatusTone = { OPEN: 'neutral', CONVERTED: 'success', LOST: 'warning' } as const;
