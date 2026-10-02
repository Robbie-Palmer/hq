"use client";

import {
  type WeddingRole,
  WeddingRoleSchema,
  weddingRoleLabels,
} from "wedding-planner-domain";
import type { Guest } from "@/lib/wedding-planner/types";

export function GuestRoles({
  guest,
  onChange,
}: Readonly<{ guest: Guest; onChange: (roles: WeddingRole[]) => void }>) {
  const selected = guest.wedding_roles ?? [];
  return (
    <fieldset className="guest-wedding-roles mb-6">
      <legend className="editor-label">Wedding roles</legend>
      <p className="editor-hint">
        Choose every role that applies. Top-table seats and free accommodation
        are separate choices.
      </p>
      <div className="toggle-grid">
        {WeddingRoleSchema.options.map((role) => (
          <label className="editor-toggle" key={role}>
            <input
              type="checkbox"
              aria-label={`${guest.name}: ${weddingRoleLabels[role]}`}
              checked={selected.includes(role)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, role]
                    : selected.filter((value) => value !== role),
                )
              }
            />
            <span>
              <strong>{weddingRoleLabels[role]}</strong>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
