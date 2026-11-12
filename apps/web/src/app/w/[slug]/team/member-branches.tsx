'use client';

import type { BranchResponse } from '@crm/contracts';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Shows a member's branches and lets an admin replace them. Branches decide what BRANCH-scope
 * roles (e.g. Branch Manager) can see; the API re-checks every change.
 */
export function MemberBranches({
  memberName,
  current,
  branches,
  canEdit,
  onSave,
}: {
  memberName: string;
  current: { id: string; name: string }[];
  branches: BranchResponse[];
  canEdit: boolean;
  onSave: (branchIds: string[]) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>(current.map((b) => b.id));
  const [saving, setSaving] = useState(false);
  const label = current.length ? current.map((b) => b.name).join(', ') : 'No branch';

  if (!editing) {
    return (
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Branches: {label}</span>
        {canEdit && branches.length > 0 ? (
          <button
            type="button"
            className="text-primary underline-offset-4 hover:underline"
            onClick={() => {
              setSelected(current.map((b) => b.id));
              setEditing(true);
            }}
          >
            Change
          </button>
        ) : null}
      </span>
    );
  }

  const options = branches.filter((b) => b.isActive || selected.includes(b.id));
  return (
    <fieldset className="mt-1 flex flex-col gap-2 rounded-md border p-2 text-sm">
      <legend className="px-1 text-xs text-muted-foreground">Branches for {memberName}</legend>
      {options.map((b) => (
        <label key={b.id} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={selected.includes(b.id)}
            onChange={(e) =>
              setSelected((s) => (e.target.checked ? [...s, b.id] : s.filter((id) => id !== b.id)))
            }
          />
          {b.name}
          {!b.isActive ? <span className="text-xs text-muted-foreground">(inactive)</span> : null}
        </label>
      ))}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={saving}
          onClick={() => {
            setSaving(true);
            void onSave(selected).finally(() => {
              setSaving(false);
              setEditing(false);
            });
          }}
        >
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </fieldset>
  );
}
