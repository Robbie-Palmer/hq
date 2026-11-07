import * as cedar from "@cedar-policy/cedar-wasm";
import { compileCedarPolicySet } from "cedar-authorization";

import type { FieldAccess, GuestAccessRole } from "./core/guest-profile";
import guestAuthorizationSchema from "./guest-authorization.cedarschema.json" with {
  type: "json",
};
import {
  BUILT_IN_GUEST_FIELDS,
  type GuestFieldAction,
  type GuestFieldAuthorizer,
} from "./guest-authorization";

const ALL_ROLES_VIEW_FIELDS = BUILT_IN_GUEST_FIELDS.filter(
  (field) =>
    ![
      "relationship_groups",
      "custom_fields",
      "private_notes",
      "seating_constraints",
      "source_records",
      "field_provenance",
    ].includes(field),
);

const COUPLE_EDIT_FIELDS = BUILT_IN_GUEST_FIELDS.filter(
  (field) => !["id", "source_records", "field_provenance"].includes(field),
);

const GUEST_EDIT_FIELDS = [
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
] as const;

function cedarStringList(values: readonly string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

function builtInPermit(options: {
  action: GuestFieldAction;
  fields: readonly string[];
  id: string;
  role: GuestAccessRole;
  selfOnly?: boolean;
}): string {
  const selfCondition = options.selfOnly
    ? "\n  principal.guestId == resource.guestId &&"
    : "";
  return `@id(${JSON.stringify(options.id)})
permit (
  principal is WeddingPlanner::Actor,
  action == WeddingPlanner::Action::${JSON.stringify(`field.${options.action}`)},
  resource is WeddingPlanner::GuestField
)
when {
  principal.role == ${JSON.stringify(options.role)} &&${selfCondition}
  ${cedarStringList(options.fields)}.contains(resource.name)
};`;
}

export const GUEST_AUTHORIZATION_POLICY = [
  builtInPermit({
    action: "view",
    fields: BUILT_IN_GUEST_FIELDS,
    id: "couple-view-built-in-guest-fields",
    role: "couple",
  }),
  builtInPermit({
    action: "edit",
    fields: COUPLE_EDIT_FIELDS,
    id: "couple-edit-built-in-guest-fields",
    role: "couple",
  }),
  builtInPermit({
    action: "view",
    fields: ALL_ROLES_VIEW_FIELDS,
    id: "guest-view-own-built-in-fields",
    role: "guest",
    selfOnly: true,
  }),
  builtInPermit({
    action: "edit",
    fields: GUEST_EDIT_FIELDS,
    id: "guest-edit-own-built-in-fields",
    role: "guest",
    selfOnly: true,
  }),
  builtInPermit({
    action: "view",
    fields: ALL_ROLES_VIEW_FIELDS,
    id: "export-recipient-view-built-in-fields",
    role: "export_recipient",
  }),
  `@id("view-custom-guest-field")
permit (
  principal is WeddingPlanner::Actor,
  action == WeddingPlanner::Action::"field.view",
  resource is WeddingPlanner::GuestField
)
when {
  resource.custom &&
  (
    (principal.role == "couple" && resource.coupleCanView) ||
    (principal.role == "guest" && resource.guestCanView && principal.guestId == resource.guestId) ||
    (principal.role == "export_recipient" && resource.exportRecipientCanView)
  )
};`,
  `@id("edit-custom-guest-field")
permit (
  principal is WeddingPlanner::Actor,
  action == WeddingPlanner::Action::"field.edit",
  resource is WeddingPlanner::GuestField
)
when {
  resource.custom &&
  (
    (principal.role == "couple" && resource.coupleCanEdit) ||
    (principal.role == "guest" && resource.guestCanEdit && principal.guestId == resource.guestId) ||
    (principal.role == "export_recipient" && resource.exportRecipientCanEdit)
  )
};`,
  `@id("never-access-another-guest-as-guest")
forbid (
  principal is WeddingPlanner::Actor,
  action in WeddingPlanner::Action::"field",
  resource is WeddingPlanner::GuestField
)
when {
  principal.role == "guest" && principal.guestId != resource.guestId
};`,
].join("\n\n");

function roleAllowed(
  access: FieldAccess | undefined,
  role: GuestAccessRole,
  action: GuestFieldAction,
): boolean {
  return access?.[action].includes(role) ?? false;
}

export function createCedarGuestFieldAuthorizer(
  options: { policyText?: string; schema?: cedar.Schema } = {},
): GuestFieldAuthorizer {
  const schema =
    options.schema ?? (guestAuthorizationSchema as unknown as cedar.Schema);
  const policySet = compileCedarPolicySet({
    engine: cedar,
    label: "Wedding Planner",
    policies: options.policyText ?? GUEST_AUTHORIZATION_POLICY,
    schema,
  });

  return {
    authorize(request) {
      const custom = request.field.startsWith("custom_fields.");
      if (custom && !request.customAccess) return false;

      const principal = {
        type: "WeddingPlanner::Actor",
        id:
          request.actor.id ??
          `${request.actor.role}:${request.actor.guest_id ?? "unidentified"}`,
      };
      const resource = {
        type: "WeddingPlanner::GuestField",
        id: `${request.guestId}:${request.field}`,
      };
      const answer = policySet.authorize({
        principal,
        action: {
          type: "WeddingPlanner::Action",
          id: `field.${request.action}`,
        },
        resource,
        context: {},
        schema,
        validateRequest: true,
        entities: [
          {
            uid: principal,
            attrs: {
              guestId: request.actor.guest_id ?? "",
              role: request.actor.role,
            },
            parents: [],
          },
          {
            uid: resource,
            attrs: {
              coupleCanEdit: roleAllowed(
                request.customAccess,
                "couple",
                "edit",
              ),
              coupleCanView: roleAllowed(
                request.customAccess,
                "couple",
                "view",
              ),
              custom,
              exportRecipientCanEdit: roleAllowed(
                request.customAccess,
                "export_recipient",
                "edit",
              ),
              exportRecipientCanView: roleAllowed(
                request.customAccess,
                "export_recipient",
                "view",
              ),
              guestCanEdit: roleAllowed(request.customAccess, "guest", "edit"),
              guestCanView: roleAllowed(request.customAccess, "guest", "view"),
              guestId: request.guestId,
              name: request.field,
            },
            parents: [],
          },
        ],
      });
      return answer.decision === "allow";
    },
  };
}
