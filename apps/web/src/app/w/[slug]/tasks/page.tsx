'use client';

import { ForbiddenState } from '@/components/states/state-view';
import { TasksPanel } from '../_crm/tasks-panel';
import { useWorkspace } from '../workspace-context';

export default function TasksPage() {
  const { can } = useWorkspace();
  if (!can('task:read')) return <ForbiddenState />;
  return <TasksPanel title="Tasks" initialFilter="mine" />;
}
