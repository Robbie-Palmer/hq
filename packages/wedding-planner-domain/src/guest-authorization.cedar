@id("couple-view-built-in-guest-fields")
permit (
  principal is WeddingPlanner::Actor,
  action == WeddingPlanner::Action::"field.view",
  resource is WeddingPlanner::GuestField
)
when {
  principal.role == "couple" &&
  [
    "id", "name", "title", "first_name", "last_name", "suffix", "email",
    "phone", "source_party", "attendance", "wedding_roles", "household_id",
    "invitation_party_id", "plus_one_of_guest_id", "plus_one_allowance",
    "is_child", "requires_high_chair", "relationship_groups", "dietary_needs",
    "allergies", "accessibility_needs", "transport", "accommodation_details",
    "seating_constraints", "event_responses", "custom_fields", "private_notes",
    "source_records", "field_provenance"
  ].contains(resource.name)
};

@id("couple-edit-built-in-guest-fields")
permit (
  principal is WeddingPlanner::Actor,
  action == WeddingPlanner::Action::"field.edit",
  resource is WeddingPlanner::GuestField
)
when {
  principal.role == "couple" &&
  [
    "name", "title", "first_name", "last_name", "suffix", "email", "phone",
    "source_party", "attendance", "wedding_roles", "household_id",
    "invitation_party_id", "plus_one_of_guest_id", "plus_one_allowance",
    "is_child", "requires_high_chair", "relationship_groups", "dietary_needs",
    "allergies", "accessibility_needs", "transport", "accommodation_details",
    "seating_constraints", "event_responses", "custom_fields", "private_notes"
  ].contains(resource.name)
};

@id("guest-view-own-built-in-fields")
permit (
  principal is WeddingPlanner::Actor,
  action == WeddingPlanner::Action::"field.view",
  resource is WeddingPlanner::GuestField
)
when {
  principal.role == "guest" &&
  principal.guestId == resource.guestId &&
  [
    "id", "name", "title", "first_name", "last_name", "suffix", "email",
    "phone", "source_party", "attendance", "wedding_roles", "household_id",
    "invitation_party_id", "plus_one_of_guest_id", "plus_one_allowance",
    "is_child", "requires_high_chair", "dietary_needs", "allergies",
    "accessibility_needs", "transport", "accommodation_details", "event_responses"
  ].contains(resource.name)
};

@id("guest-edit-own-built-in-fields")
permit (
  principal is WeddingPlanner::Actor,
  action == WeddingPlanner::Action::"field.edit",
  resource is WeddingPlanner::GuestField
)
when {
  principal.role == "guest" &&
  principal.guestId == resource.guestId &&
  [
    "name", "title", "first_name", "last_name", "suffix", "email", "phone",
    "attendance", "requires_high_chair", "dietary_needs", "allergies",
    "accessibility_needs", "transport", "accommodation_details",
    "seating_constraints", "event_responses"
  ].contains(resource.name)
};

@id("export-recipient-view-built-in-fields")
permit (
  principal is WeddingPlanner::Actor,
  action == WeddingPlanner::Action::"field.view",
  resource is WeddingPlanner::GuestField
)
when {
  principal.role == "export_recipient" &&
  [
    "id", "name", "title", "first_name", "last_name", "suffix", "email",
    "phone", "source_party", "attendance", "wedding_roles", "household_id",
    "invitation_party_id", "plus_one_of_guest_id", "plus_one_allowance",
    "is_child", "requires_high_chair", "dietary_needs", "allergies",
    "accessibility_needs", "transport", "accommodation_details", "event_responses"
  ].contains(resource.name)
};

@id("view-custom-guest-field")
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
};

@id("edit-custom-guest-field")
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
};

@id("never-access-another-guest-as-guest")
forbid (
  principal is WeddingPlanner::Actor,
  action in WeddingPlanner::Action::"field",
  resource is WeddingPlanner::GuestField
)
when {
  principal.role == "guest" && principal.guestId != resource.guestId
};
