'use client';

import { ForbiddenState } from '@/components/states/state-view';
import { AppointmentsPanel } from '../_crm/timeline';
import { useWorkspace } from '../workspace-context';

export default function CalendarPage() {
  const { can } = useWorkspace();
  if (!can('appointment:read')) return <ForbiddenState />;
  return <AppointmentsPanel title="Upcoming appointments" />;
}
