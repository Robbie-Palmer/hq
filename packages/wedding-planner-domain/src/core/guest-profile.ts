import { z } from "zod";

const uniqueStrings = z
  .array(z.string().trim().min(1))
  .refine((values) => new Set(values).size === values.length, {
    message: "Values must be unique",
  });

export const GuestAccessRoleSchema = z.enum([
  "couple",
  "guest",
  "export_recipient",
]);
export type GuestAccessRole = z.infer<typeof GuestAccessRoleSchema>;

export const GuestChangeActorSchema = z.enum([
  "couple",
  "guest",
  "integration",
]);
export type GuestChangeActor = z.infer<typeof GuestChangeActorSchema>;

export const FieldAccessSchema = z.object({
  view: z.array(GuestAccessRoleSchema),
  edit: z.array(GuestAccessRoleSchema),
});
export type FieldAccess = z.infer<typeof FieldAccessSchema>;

export const CustomFieldTypeSchema = z.enum([
  "text",
  "number",
  "boolean",
  "date",
  "choice",
]);
export type CustomFieldType = z.infer<typeof CustomFieldTypeSchema>;

export const CustomFieldValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export type CustomFieldValue = z.infer<typeof CustomFieldValueSchema>;

export const EventInvitationStatusSchema = z.enum([
  "not_invited",
  "invited",
  "waitlisted",
]);
export const EventResponseStatusSchema = z.enum([
  "unknown",
  "attending",
  "declined",
]);

export const guestEventResponseSchema = z.object({
  invitation: EventInvitationStatusSchema.default("not_invited"),
  response: EventResponseStatusSchema.default("unknown"),
  responded_at: z.iso.datetime({ offset: true }).nullable().default(null),
  party_size: z.number().int().min(0).nullable().default(null),
  notes: z.string().default(""),
});
export type GuestEventResponse = z.infer<typeof guestEventResponseSchema>;

export const guestTransportSchema = z.object({
  status: z
    .enum(["unknown", "not_needed", "needed", "arranged"])
    .default("unknown"),
  mode: z.string().default(""),
  arrival: z.string().default(""),
  departure: z.string().default(""),
  notes: z.string().default(""),
});

export const guestAccommodationSchema = z.object({
  status: z
    .enum(["unknown", "not_needed", "needed", "requested", "arranged"])
    .default("unknown"),
  property: z.string().default(""),
  arrival_date: z.string().default(""),
  departure_date: z.string().default(""),
  notes: z.string().default(""),
});

export const guestSeatingConstraintsSchema = z.object({
  prefer_with: uniqueStrings.default([]),
  avoid_with: uniqueStrings.default([]),
  requires_accessible_seat: z.boolean().default(false),
  notes: z.string().default(""),
});

export const guestSourceRecordSchema = z.object({
  system: z.string().trim().min(1),
  external_id: z.string().trim().min(1).nullable().default(null),
  import_id: z.string().trim().min(1),
  row_number: z.number().int().positive(),
  imported_at: z.iso.datetime({ offset: true }),
  source_name: z.string().trim().min(1),
});
export type GuestSourceRecord = z.infer<typeof guestSourceRecordSchema>;

export const guestProfileSchema = z.object({
  title: z.string().trim().default(""),
  first_name: z.string().trim().default(""),
  last_name: z.string().trim().default(""),
  suffix: z.string().trim().default(""),
  email: z.string().trim().default(""),
  phone: z.string().trim().default(""),
  household_id: z.string().trim().min(1).nullable().default(null),
  invitation_party_id: z.string().trim().min(1).nullable().default(null),
  plus_one_of_guest_id: z.string().trim().min(1).nullable().default(null),
  plus_one_allowance: z.number().int().min(0).default(0),
  is_child: z.boolean().default(false),
  relationship_groups: uniqueStrings.default([]),
  dietary_needs: uniqueStrings.default([]),
  allergies: uniqueStrings.default([]),
  accessibility_needs: uniqueStrings.default([]),
  transport: guestTransportSchema.prefault({}),
  accommodation_details: guestAccommodationSchema.prefault({}),
  seating_constraints: guestSeatingConstraintsSchema.prefault({}),
  event_responses: z
    .record(z.string().trim().min(1), guestEventResponseSchema)
    .default({}),
  custom_fields: z
    .record(z.string().trim().min(1), CustomFieldValueSchema)
    .default({}),
  private_notes: z.array(z.string().trim().min(1)).default([]),
  source_records: z.array(guestSourceRecordSchema).default([]),
  field_provenance: z
    .record(z.string().trim().min(1), z.array(guestSourceRecordSchema))
    .default({}),
});

export type GuestProfile = z.infer<typeof guestProfileSchema>;
