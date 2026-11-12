import type { MatterStatus } from '@crm/contracts';

export const matterStatusLabel: Record<MatterStatus, string> = {
  OPEN: 'Open',
  ON_HOLD: 'On hold',
  CLOSED: 'Closed',
  ARCHIVED: 'Archived',
};

export const matterStatusTone: Record<MatterStatus, 'neutral' | 'success' | 'warning' | 'danger'> =
  {
    OPEN: 'success',
    ON_HOLD: 'warning',
    CLOSED: 'neutral',
    ARCHIVED: 'neutral',
  };
