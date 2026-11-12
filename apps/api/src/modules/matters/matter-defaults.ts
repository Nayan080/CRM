import { DEFAULT_MATTER_STAGES, DEFAULT_MATTER_TYPES } from '@crm/contracts';
import type { Tx } from '../../infra/prisma/prisma.service.js';

/**
 * DEC-13: a new workspace gets generic, editable example matter types and stages.
 * Runs inside tenant creation (RLS tenant already set). Existing workspaces got the same
 * values from the Stage 5 migration.
 */
export async function seedMatterTypeDefaults(tx: Tx, tenantId: string): Promise<void> {
  for (const [index, name] of DEFAULT_MATTER_TYPES.entries()) {
    const type = await tx.matterType.create({
      data: { tenantId, name, sortOrder: index + 1 },
      select: { id: true },
    });
    await tx.matterStage.createMany({
      data: DEFAULT_MATTER_STAGES.map((stage, i) => ({
        tenantId,
        matterTypeId: type.id,
        name: stage.name,
        isTerminal: stage.isTerminal,
        sortOrder: i + 1,
      })),
    });
  }
}
