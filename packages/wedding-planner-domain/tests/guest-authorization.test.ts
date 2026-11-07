import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  BUILT_IN_GUEST_FIELDS,
  guestFieldAuthorizer,
  type GuestFieldAction,
  type GuestFieldAuthorizer,
} from "../src/guest-authorization";
import { createCedarGuestFieldAuthorizer } from "../src/guest-authorization-cedar";
import type { GuestAccessRole } from "../src/core/guest-profile";

const checkedInPolicy = readFileSync(
  new URL("../src/guest-authorization.cedar", import.meta.url),
  "utf8",
);
const embeddedPolicyAuthorizer = createCedarGuestFieldAuthorizer();
const checkedInPolicyAuthorizer = createCedarGuestFieldAuthorizer({
  policyText: checkedInPolicy,
});

const authorizers: Array<[string, GuestFieldAuthorizer]> = [
  ["runtime decision table", guestFieldAuthorizer],
  ["embedded policy", embeddedPolicyAuthorizer],
  ["checked-in policy", checkedInPolicyAuthorizer],
];

const roles: GuestAccessRole[] = ["couple", "guest", "export_recipient"];
const actions: GuestFieldAction[] = ["view", "edit"];
const ownershipStates = [true, false] as const;
const ownerOnlyView = new Set([
  "relationship_groups",
  "custom_fields",
  "private_notes",
  "seating_constraints",
  "source_records",
  "field_provenance",
]);
const immutable = new Set(["id", "source_records", "field_provenance"]);
const guestEditable = new Set([
  "name",
  "title",
  "first_name",
  "last_name",
  "suffix",
  "email",
  "phone",
  "attendance",
  "requires_high_chair",
  "dietary_needs",
  "allergies",
  "accessibility_needs",
  "transport",
  "accommodation_details",
  "seating_constraints",
  "event_responses",
]);

function expectedBuiltInDecision(
  role: GuestAccessRole,
  action: GuestFieldAction,
  field: string,
  ownsGuest: boolean,
): boolean {
  if (role === "guest" && !ownsGuest) return false;
  if (action === "view") {
    return role === "couple" || !ownerOnlyView.has(field);
  }
  if (role === "couple") return !immutable.has(field);
  if (role === "guest") return guestEditable.has(field);
  return false;
}

const builtInCases = BUILT_IN_GUEST_FIELDS.flatMap((field) =>
  roles.flatMap((role) =>
    actions.flatMap((action) =>
      ownershipStates.map((ownsGuest) => ({
        action,
        field,
        ownsGuest,
        role,
      })),
    ),
  ),
);

const roleSets = Array.from({ length: 8 }, (_unused, mask) =>
  roles.filter((_role, index) => (mask & (1 << index)) > 0),
);

const customFieldCases = roleSets.flatMap((view) =>
  roleSets.flatMap((edit) =>
    roles.flatMap((role) =>
      actions.flatMap((action) =>
        ownershipStates.map((ownsGuest) => ({
          action,
          edit,
          ownsGuest,
          role,
          view,
        })),
      ),
    ),
  ),
);

describe.each(authorizers)("%s", (_name, authorizer) => {
  it("preserves every built-in field, role, action, and ownership decision", () => {
    for (const { action, field, ownsGuest, role } of builtInCases) {
      expect(
        authorizer.authorize({
          action,
          actor: {
            role,
            guest_id:
              role === "guest"
                ? ownsGuest
                  ? "target"
                  : "another-guest"
                : undefined,
          },
          field,
          guestId: "target",
        }),
        `${role} ${action} ${field} ownsGuest=${ownsGuest}`,
      ).toBe(expectedBuiltInDecision(role, action, field, ownsGuest));
    }
  });

  it("uses custom field access without weakening guest ownership", () => {
    for (const { action, edit, ownsGuest, role, view } of customFieldCases) {
      const allowedRoles = action === "view" ? view : edit;
      const expected =
        allowedRoles.includes(role) && (role !== "guest" || ownsGuest);
      expect(
        authorizer.authorize({
          action,
          actor: {
            role,
            guest_id:
              role === "guest"
                ? ownsGuest
                  ? "target"
                  : "another-guest"
                : undefined,
          },
          customAccess: { view, edit },
          field: "custom_fields.meal",
          guestId: "target",
        }),
      ).toBe(expected);
    }
  });

  it("denies unknown fields, missing custom policy, and unknown actions", () => {
    expect(
      authorizer.authorize({
        action: "view",
        actor: { role: "couple" },
        field: "unknown",
        guestId: "target",
      }),
    ).toBe(false);
    expect(
      authorizer.authorize({
        action: "view",
        actor: { role: "couple" },
        field: "custom_fields.missing",
        guestId: "target",
      }),
    ).toBe(false);
    expect(
      authorizer.authorize({
        action: "delete" as GuestFieldAction,
        actor: { role: "couple" },
        field: "name",
        guestId: "target",
      }),
    ).toBe(false);
  });
});

describe("Cedar policy loading", () => {
  it("fails closed on malformed or invalid policy bundles", () => {
    expect(() =>
      createCedarGuestFieldAuthorizer({ policyText: "this is not Cedar" }),
    ).toThrow("policy parse failure");
    expect(() =>
      createCedarGuestFieldAuthorizer({
        policyText: `@id("wrong-resource")
permit (
  principal is WeddingPlanner::Actor,
  action == WeddingPlanner::Action::"field.view",
  resource is WeddingPlanner::Actor
);`,
      }),
    ).toThrow("validation diagnostics");
  });
});
