'use client';

import { EmptyState } from '@/components/states/state-view';
import { useWorkspace } from './workspace-context';

export default function WorkspaceHomePage() {
  const { access, can } = useWorkspace();
  if (access.kind === 'EXTERNAL') {
    return (
      <EmptyState
        title="External access"
        description="You only see matters and documents this agency shares with you. Open “Shared with me”."
      />
    );
  }
  return (
    <EmptyState
      title="Workspace ready"
      description={`Use the menu above for leads, clients, matters and tasks.${
        can('member:read') ? ' Manage your team from the Team tab.' : ''
      }`}
    />
  );
}
