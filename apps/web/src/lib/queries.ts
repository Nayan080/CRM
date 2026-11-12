/** Shared TanStack Query keys. Workspace data keys always include the tenant id. */
export const queryKeys = {
  workspaces: ['me', 'workspaces'] as const,
  sessions: ['me', 'sessions'] as const,
  access: (tenantId: string) => ['tenant', tenantId, 'access'] as const,
  members: (tenantId: string) => ['tenant', tenantId, 'members'] as const,
  invitations: (tenantId: string) => ['tenant', tenantId, 'invitations'] as const,
  tenant: (tenantId: string) => ['tenant', tenantId, 'profile'] as const,
  branches: (tenantId: string) => ['tenant', tenantId, 'branches'] as const,
  options: (tenantId: string, category: string) =>
    ['tenant', tenantId, 'options', category] as const,
  partners: (tenantId: string) => ['tenant', tenantId, 'partners'] as const,
  partner: (tenantId: string, id: string) => ['tenant', tenantId, 'partner', id] as const,
  professionals: (tenantId: string) => ['tenant', tenantId, 'professionals'] as const,
  professional: (tenantId: string, id: string) => ['tenant', tenantId, 'professional', id] as const,
  leads: (tenantId: string) => ['tenant', tenantId, 'leads'] as const,
  lead: (tenantId: string, id: string) => ['tenant', tenantId, 'lead', id] as const,
  clients: (tenantId: string) => ['tenant', tenantId, 'clients'] as const,
  client: (tenantId: string, id: string) => ['tenant', tenantId, 'client', id] as const,
  activities: (tenantId: string, subject: string) =>
    ['tenant', tenantId, 'activities', subject] as const,
  appointments: (tenantId: string) => ['tenant', tenantId, 'appointments'] as const,
  matterTypes: (tenantId: string) => ['tenant', tenantId, 'matter-types'] as const,
  matters: (tenantId: string) => ['tenant', tenantId, 'matters'] as const,
  matter: (tenantId: string, id: string) => ['tenant', tenantId, 'matter', id] as const,
  tasks: (tenantId: string) => ['tenant', tenantId, 'tasks'] as const,
  documents: (tenantId: string) => ['tenant', tenantId, 'documents'] as const,
  consents: (tenantId: string, clientId: string) =>
    ['tenant', tenantId, 'consents', clientId] as const,
  shares: (tenantId: string, matterId: string) => ['tenant', tenantId, 'shares', matterId] as const,
  shared: (tenantId: string) => ['tenant', tenantId, 'shared'] as const,
};
