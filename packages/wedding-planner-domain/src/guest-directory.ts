import { z } from "zod";
import {
  FieldAccessSchema,
  GuestChangeActorSchema,
  type CustomFieldValue,
  type FieldAccess,
  type GuestAccessRole,
  type GuestChangeActor,
} from "./core/guest-profile";
import { type WeddingGuest, weddingGuestSchema } from "./core/guests";

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

export const householdSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  address_lines: z.array(z.string().trim().min(1)).default([]),
  city: z.string().default(""),
  region: z.string().default(""),
  postal_code: z.string().default(""),
  country: z.string().default(""),
  private_notes: z.array(z.string().trim().min(1)).default([]),
});
export type Household = z.infer<typeof householdSchema>;

export const invitationPartySchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  addressee: z.string().default(""),
  greeting: z.string().default(""),
  private_notes: z.array(z.string().trim().min(1)).default([]),
});
export type InvitationParty = z.infer<typeof invitationPartySchema>;

export const weddingEventSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  starts_at: z.iso.datetime({ offset: true }).nullable().default(null),
  location: z.string().default(""),
  private_notes: z.array(z.string().trim().min(1)).default([]),
});
export type WeddingEvent = z.infer<typeof weddingEventSchema>;

export const customFieldDefinitionSchema = z
  .object({
    id: z.string().trim().min(1),
    label: z.string().trim().min(1),
    type: z.enum(["text", "number", "boolean", "date", "choice"]),
    choices: z.array(z.string().trim().min(1)).default([]),
    access: FieldAccessSchema,
  })
  .superRefine((field, context) => {
    if (field.type === "choice" && field.choices.length === 0)
      context.addIssue({
        code: "custom",
        path: ["choices"],
        message: "Choice fields need at least one choice",
      });
    if (field.type !== "choice" && field.choices.length > 0)
      context.addIssue({
        code: "custom",
        path: ["choices"],
        message: "Only choice fields can define choices",
      });
  });
export type CustomFieldDefinition = z.infer<typeof customFieldDefinitionSchema>;

export const guestChangeSchema = z.object({
  field: z.string().trim().min(1),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  provenance: z.string().trim().min(1),
});

export const guestHistoryEntrySchema = z.object({
  id: z.string().trim().min(1),
  guest_id: z.string().trim().min(1),
  changed_at: z.iso.datetime({ offset: true }),
  actor_type: GuestChangeActorSchema,
  actor_id: z.string().trim().min(1).nullable().default(null),
  kind: z.enum(["create", "update", "import"]),
  changes: z.array(guestChangeSchema).min(1),
});
export type GuestHistoryEntry = z.infer<typeof guestHistoryEntrySchema>;

export const guestImportRecordSchema = z.object({
  id: z.string().trim().min(1),
  system: z.string().trim().min(1),
  source_name: z.string().trim().min(1),
  fingerprint: z.string().trim().min(1),
  imported_at: z.iso.datetime({ offset: true }),
  created: z.number().int().min(0),
  merged: z.number().int().min(0),
  skipped: z.number().int().min(0),
});
export type GuestImportRecord = z.infer<typeof guestImportRecordSchema>;

export const guestDirectoryMetadataSchema = z.object({
  households: z.array(householdSchema).default([]),
  invitation_parties: z.array(invitationPartySchema).default([]),
  events: z.array(weddingEventSchema).default([]),
  custom_fields: z.array(customFieldDefinitionSchema).default([]),
  history: z.array(guestHistoryEntrySchema).default([]),
  imports: z.array(guestImportRecordSchema).default([]),
});
export type GuestDirectoryMetadata = z.infer<
  typeof guestDirectoryMetadataSchema
>;

export type GuestDirectory = {
  guests: WeddingGuest[];
  guest_directory: GuestDirectoryMetadata;
};

export type GuestActor = {
  role: GuestAccessRole;
  id?: string;
  guest_id?: string;
};

export function validateGuestDirectory(directory: GuestDirectory): void {
  const guestIds = uniqueIds(directory.guests, "Guest");
  const householdIds = uniqueIds(
    directory.guest_directory.households,
    "Household",
  );
  const partyIds = uniqueIds(
    directory.guest_directory.invitation_parties,
    "Invitation party",
  );
  const eventIds = uniqueIds(directory.guest_directory.events, "Event");
  const customFields = new Map(
    directory.guest_directory.custom_fields.map((field) => [field.id, field]),
  );
  if (customFields.size !== directory.guest_directory.custom_fields.length)
    throw new Error("Custom field IDs must be unique");
  uniqueIds(directory.guest_directory.history, "Guest history");
  uniqueIds(directory.guest_directory.imports, "Guest import");

  for (const guest of directory.guests)
    validateGuestReferences(guest, {
      guestIds,
      householdIds,
      partyIds,
      eventIds,
      customFields,
    });
  for (const history of directory.guest_directory.history)
    if (!guestIds.has(history.guest_id))
      throw new Error("Guest history refers to an unknown guest");
}

function validateGuestReferences(
  guest: WeddingGuest,
  references: {
    guestIds: Set<string>;
    householdIds: Set<string>;
    partyIds: Set<string>;
    eventIds: Set<string>;
    customFields: Map<string, CustomFieldDefinition>;
  },
) {
  if (guest.household_id && !references.householdIds.has(guest.household_id))
    throw new Error(`${guest.id}: household does not exist`);
  if (
    guest.invitation_party_id &&
    !references.partyIds.has(guest.invitation_party_id)
  )
    throw new Error(`${guest.id}: invitation party does not exist`);
  validatePlusOne(guest, references.guestIds);
  validateGuestEvents(guest, references.eventIds);
  validateConstraintIds(guest, references.guestIds);
  validateGuestCustomFields(guest, references.customFields);
}

function validatePlusOne(guest: WeddingGuest, guestIds: Set<string>) {
  if (
    guest.plus_one_of_guest_id &&
    (!guestIds.has(guest.plus_one_of_guest_id) ||
      guest.plus_one_of_guest_id === guest.id)
  )
    throw new Error(`${guest.id}: plus-one host is invalid`);
}

function validateGuestEvents(guest: WeddingGuest, eventIds: Set<string>) {
  for (const eventId of Object.keys(guest.event_responses))
    if (!eventIds.has(eventId))
      throw new Error(`${guest.id}: event response refers to an unknown event`);
}

function validateGuestCustomFields(
  guest: WeddingGuest,
  customFields: Map<string, CustomFieldDefinition>,
) {
  for (const [fieldId, value] of Object.entries(guest.custom_fields)) {
    const definition = customFields.get(fieldId);
    if (!definition)
      throw new Error(`${guest.id}: custom field ${fieldId} is not defined`);
    validateCustomFieldValue(definition, value, guest.id);
  }
}

function uniqueIds(
  values: readonly { id: string }[],
  label: string,
): Set<string> {
  const ids = new Set(values.map((value) => value.id));
  if (ids.size !== values.length)
    throw new Error(`${label} IDs must be unique`);
  return ids;
}

function validateConstraintIds(guest: WeddingGuest, guestIds: Set<string>) {
  const relatedIds = [
    ...guest.seating_constraints.prefer_with,
    ...guest.seating_constraints.avoid_with,
  ];
  if (relatedIds.some((id) => id === guest.id || !guestIds.has(id)))
    throw new Error(
      `${guest.id}: seating constraints contain an invalid guest`,
    );
}

function validateCustomFieldValue(
  definition: CustomFieldDefinition,
  value: CustomFieldValue,
  guestId: string,
) {
  if (value === null) return;
  const valid =
    (definition.type === "text" && typeof value === "string") ||
    (definition.type === "number" && typeof value === "number") ||
    (definition.type === "boolean" && typeof value === "boolean") ||
    (definition.type === "date" &&
      typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value)) ||
    (definition.type === "choice" &&
      typeof value === "string" &&
      definition.choices.includes(value));
  if (!valid)
    throw new Error(
      `${guestId}: custom field ${definition.id} has the wrong value type`,
    );
}

export function canViewGuestField(
  directory: GuestDirectory,
  guestId: string,
  field: string,
  actor: GuestActor,
): boolean {
  return canAccessGuestField(directory, guestId, field, actor, "view");
}

export function canEditGuestField(
  directory: GuestDirectory,
  guestId: string,
  field: string,
  actor: GuestActor,
): boolean {
  return canAccessGuestField(directory, guestId, field, actor, "edit");
}

function canAccessGuestField(
  directory: GuestDirectory,
  guestId: string,
  field: string,
  actor: GuestActor,
  access: keyof FieldAccess,
): boolean {
  if (actor.role === "guest" && actor.guest_id !== guestId) return false;
  const policy = field.startsWith("custom_fields.")
    ? directory.guest_directory.custom_fields.find(
        (item) => item.id === field.slice("custom_fields.".length),
      )?.access
    : builtInGuestFieldAccess[field as keyof WeddingGuest];
  return policy?.[access].includes(actor.role) ?? false;
}

export function updateGuest(
  directory: GuestDirectory,
  guestId: string,
  patch: Partial<WeddingGuest>,
  actor: GuestActor,
  changedAt: string,
  provenance = "manual",
): WeddingGuest {
  const actorType = changeActorType(actor);
  const draft = structuredClone(directory);
  const index = draft.guests.findIndex((guest) => guest.id === guestId);
  const current = draft.guests[index];
  if (!current) throw new Error(`Guest ${guestId} does not exist`);
  if ("id" in patch && patch.id !== guestId)
    throw new Error("Guest IDs cannot be changed");

  const changes = Object.entries(patch)
    .filter(
      ([field, value]) =>
        !sameValue(current[field as keyof WeddingGuest], value),
    )
    .map(([field, value]) => {
      if (!canEditGuestField(draft, guestId, field, actor))
        throw new Error(`${actor.role} cannot edit ${field}`);
      return {
        field,
        before: structuredClone(current[field as keyof WeddingGuest]),
        after: structuredClone(value),
        provenance,
      };
    });
  if (changes.length === 0) return current;

  const updated = weddingGuestSchema.parse({ ...current, ...patch });
  draft.guests[index] = updated;
  draft.guest_directory.history.push({
    id: historyId(guestId, changedAt, draft.guest_directory.history.length),
    guest_id: guestId,
    changed_at: changedAt,
    actor_type: actorType,
    actor_id: actor.id ?? null,
    kind: "update",
    changes,
  });
  validateGuestDirectory(draft);
  directory.guests = draft.guests;
  directory.guest_directory = draft.guest_directory;
  return updated;
}

export function updateGuestCustomField(
  directory: GuestDirectory,
  guestId: string,
  fieldId: string,
  value: CustomFieldValue,
  actor: GuestActor,
  changedAt: string,
  provenance = "manual",
): WeddingGuest {
  const actorType = changeActorType(actor);
  const field = `custom_fields.${fieldId}`;
  if (!canEditGuestField(directory, guestId, field, actor))
    throw new Error(`${actor.role} cannot edit ${field}`);
  const guest = directory.guests.find((item) => item.id === guestId);
  if (!guest) throw new Error(`Guest ${guestId} does not exist`);
  const current = guest.custom_fields[fieldId];
  if (sameValue(current, value)) return guest;

  const draft = structuredClone(directory);
  const updated = draft.guests.find((item) => item.id === guestId);
  if (!updated) throw new Error(`Guest ${guestId} does not exist`);
  updated.custom_fields[fieldId] = value;
  draft.guest_directory.history.push({
    id: historyId(guestId, changedAt, draft.guest_directory.history.length),
    guest_id: guestId,
    changed_at: changedAt,
    actor_type: actorType,
    actor_id: actor.id ?? null,
    kind: "update",
    changes: [{ field, before: current, after: value, provenance }],
  });
  validateGuestDirectory(draft);
  directory.guests = draft.guests;
  directory.guest_directory = draft.guest_directory;
  return updated;
}

function changeActorType(actor: GuestActor): GuestChangeActor {
  if (actor.role === "export_recipient")
    throw new Error("Export recipients cannot change guest data");
  return actor.role;
}

export function visibleGuest(
  directory: GuestDirectory,
  guestId: string,
  actor: GuestActor,
): Partial<WeddingGuest> {
  const guest = directory.guests.find((item) => item.id === guestId);
  if (!guest) throw new Error(`Guest ${guestId} does not exist`);
  const visible = Object.entries(guest).filter(([field]) =>
    canViewGuestField(directory, guestId, field, actor),
  );
  const projected = Object.fromEntries(visible) as Partial<WeddingGuest>;
  projected.custom_fields = Object.fromEntries(
    Object.entries(guest.custom_fields).filter(([field]) =>
      canViewGuestField(directory, guestId, `custom_fields.${field}`, actor),
    ),
  );
  return projected;
}

export function parseGuestDirectory(value: unknown): GuestDirectory {
  const schema = z.object({
    guests: z.array(weddingGuestSchema),
    guest_directory: guestDirectoryMetadataSchema.prefault({}),
  });
  const directory = schema.parse(value);
  validateGuestDirectory(directory);
  return directory;
}

export function historyId(
  guestId: string,
  changedAt: string,
  sequence: number,
): string {
  return `${guestId}:${changedAt}:${sequence}`;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export { CustomFieldValueSchema } from "./core/guest-profile";
