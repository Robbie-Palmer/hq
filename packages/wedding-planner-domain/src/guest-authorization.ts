import type { FieldAccess, GuestAccessRole } from "./core/guest-profile";
import type { WeddingGuest } from "./core/guests";

export type GuestFieldAction = "view" | "edit";

export type GuestFieldAuthorizationRequest = {
  action: GuestFieldAction;
  actor: {
    id?: string;
    guest_id?: string;
    role: GuestAccessRole;
  };
  customAccess?: FieldAccess;
  field: string;
  guestId: string;
};

export interface GuestFieldAuthorizer {
  authorize(request: GuestFieldAuthorizationRequest): boolean;
}

export const BUILT_IN_GUEST_FIELDS = [
  "id",
  "name",
  "title",
  "first_name",
  "last_name",
  "suffix",
  "email",
  "phone",
  "source_party",
  "attendance",
  "wedding_roles",
  "household_id",
  "invitation_party_id",
  "plus_one_of_guest_id",
  "plus_one_allowance",
  "is_child",
  "requires_high_chair",
  "relationship_groups",
  "dietary_needs",
  "allergies",
  "accessibility_needs",
  "transport",
  "accommodation_details",
  "seating_constraints",
  "event_responses",
  "custom_fields",
  "private_notes",
  "source_records",
  "field_provenance",
] as const;

const ownerRoles: GuestAccessRole[] = ["couple"];
const allRoles: GuestAccessRole[] = [
  ...ownerRoles,
  "guest",
  "export_recipient",
];
const selfEditableRoles: GuestAccessRole[] = [...ownerRoles, "guest"];

export const builtInGuestFieldAccess = {
  id: { view: allRoles, edit: [] },
  name: { view: allRoles, edit: selfEditableRoles },
  title: { view: allRoles, edit: selfEditableRoles },
  first_name: { view: allRoles, edit: selfEditableRoles },
  last_name: { view: allRoles, edit: selfEditableRoles },
  suffix: { view: allRoles, edit: selfEditableRoles },
  email: { view: allRoles, edit: selfEditableRoles },
  phone: { view: allRoles, edit: selfEditableRoles },
  source_party: { view: allRoles, edit: ownerRoles },
  attendance: { view: allRoles, edit: selfEditableRoles },
  wedding_roles: { view: allRoles, edit: ownerRoles },
  household_id: { view: allRoles, edit: ownerRoles },
  invitation_party_id: { view: allRoles, edit: ownerRoles },
  plus_one_of_guest_id: { view: allRoles, edit: ownerRoles },
  plus_one_allowance: { view: allRoles, edit: ownerRoles },
  is_child: { view: allRoles, edit: ownerRoles },
  requires_high_chair: { view: allRoles, edit: selfEditableRoles },
  relationship_groups: { view: ownerRoles, edit: ownerRoles },
  dietary_needs: { view: allRoles, edit: selfEditableRoles },
  allergies: { view: allRoles, edit: selfEditableRoles },
  accessibility_needs: { view: allRoles, edit: selfEditableRoles },
  transport: { view: allRoles, edit: selfEditableRoles },
  accommodation_details: { view: allRoles, edit: selfEditableRoles },
  seating_constraints: { view: ownerRoles, edit: selfEditableRoles },
  event_responses: { view: allRoles, edit: selfEditableRoles },
  custom_fields: { view: ownerRoles, edit: ownerRoles },
  private_notes: { view: ownerRoles, edit: ownerRoles },
  source_records: { view: ownerRoles, edit: [] },
  field_provenance: { view: ownerRoles, edit: [] },
} satisfies Record<keyof WeddingGuest, FieldAccess>;

export const guestFieldAuthorizer: GuestFieldAuthorizer = {
  authorize(request) {
    if (
      request.actor.role === "guest" &&
      request.actor.guest_id !== request.guestId
    ) {
      return false;
    }
    const access = request.field.startsWith("custom_fields.")
      ? request.customAccess
      : builtInGuestFieldAccess[request.field as keyof WeddingGuest];
    return access?.[request.action]?.includes(request.actor.role) ?? false;
  },
};
