import { z } from "zod";
import type { WeddingGuest } from "../core/guests";
import { parseMoneyToMinorUnits } from "../money";

const ids = z.array(z.string().trim().min(1));
const date = z.iso.date();
const money = z.string().refine((value) => {
  try {
    return parseMoneyToMinorUnits(value, "Accommodation cost") !== null;
  } catch {
    return false;
  }
}, "Amount must be non-negative with no more than two decimal places");

export const stayRequirementsSchema = z
  .object({
    arrives_on: date.nullable().default(null),
    departs_on: date.nullable().default(null),
    must_share_with: ids.default([]),
    must_not_share_with: ids.default([]),
    accessibility_needs: z.array(z.string().trim().min(1)).default([]),
    transport_needs: z.array(z.string().trim().min(1)).default([]),
    needs_child_space: z.boolean().default(false),
    custom_needs: z.array(z.string().trim().min(1)).default([]),
  })
  .superRefine((value, context) => {
    if (
      value.arrives_on &&
      value.departs_on &&
      value.arrives_on >= value.departs_on
    )
      context.addIssue({
        code: "custom",
        path: ["departs_on"],
        message: "Departure must be after arrival",
      });
  });
export type StayRequirements = z.infer<typeof stayRequirementsSchema>;

export const accommodationSubjectSchema = z.object({
  kind: z.enum(["guest", "household"]),
  id: z.string().trim().min(1),
});
export type AccommodationSubject = z.infer<typeof accommodationSubjectSchema>;

const payerSchema = z.object({
  kind: z.enum(["couple", "guest", "household", "guest_direct"]),
  id: z.string().trim().min(1).nullable().default(null),
});

export const accommodationPropertySchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  kind: z.enum(["hotel", "private_house", "room_block", "venue", "other"]),
  address: z.string().default(""),
  provider_name: z.string().default(""),
  provider_contact: z.string().default(""),
  check_in_on: date,
  check_out_on: date,
  booking_deadline: date.nullable().default(null),
  accessibility: z.array(z.string().trim().min(1)).default([]),
  custom_attributes: z.record(z.string(), z.string()).default({}),
  cost: z
    .object({
      basis: z.enum(["nightly", "fixed"]),
      amount_gbp: money,
    })
    .nullable()
    .default(null),
  booking: z
    .object({
      status: z.enum(["researching", "held", "booked", "cancelled"]),
      confirmation_reference: z.string().default(""),
      confirmation_details: z.string().default(""),
      payer: payerSchema,
      commitment_id: z.string().trim().min(1).nullable().default(null),
      payment_ids: ids.default([]),
      cancellation_state: z
        .enum(["not_cancelled", "requested", "cancelled"])
        .default("not_cancelled"),
      refund_state: z
        .enum(["not_applicable", "pending", "partial", "refunded", "lost"])
        .default("not_applicable"),
    })
    .default({
      status: "researching",
      confirmation_reference: "",
      confirmation_details: "",
      payer: { kind: "couple", id: null },
      commitment_id: null,
      payment_ids: [],
      cancellation_state: "not_cancelled",
      refund_state: "not_applicable",
    }),
});
export type AccommodationProperty = z.infer<typeof accommodationPropertySchema>;

export const accommodationRoomSchema = z.object({
  id: z.string().trim().min(1),
  property_id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  capacity: z.number().int().positive(),
  accessibility: z.array(z.string().trim().min(1)).default([]),
  custom_attributes: z.record(z.string(), z.string()).default({}),
  beds: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        name: z.string().trim().min(1),
        kind: z.enum(["single", "double", "sofa_bed", "cot", "other"]),
        capacity: z.number().int().positive(),
      }),
    )
    .default([]),
});
export type AccommodationRoom = z.infer<typeof accommodationRoomSchema>;

export const accommodationAssignmentSchema = z.object({
  id: z.string().trim().min(1),
  subject: accommodationSubjectSchema,
  room_id: z.string().trim().min(1),
  bed_ids: ids.default([]),
  arrives_on: date,
  departs_on: date,
  status: z.enum(["confirmed", "alternative"]).default("confirmed"),
  alternative_to_assignment_id: z
    .string()
    .trim()
    .min(1)
    .nullable()
    .default(null),
  locked: z.boolean().default(false),
  notes: z.string().default(""),
});
export type AccommodationAssignment = z.infer<
  typeof accommodationAssignmentSchema
>;

export const selfArrangedStaySchema = z.object({
  id: z.string().trim().min(1),
  subject: accommodationSubjectSchema,
  arrives_on: date,
  departs_on: date,
  provider_name: z.string().default(""),
  address: z.string().default(""),
  confirmation_details: z.string().default(""),
});
export type SelfArrangedStay = z.infer<typeof selfArrangedStaySchema>;

export const accommodationInventorySchema = z.object({
  properties: z.array(accommodationPropertySchema).default([]),
  rooms: z.array(accommodationRoomSchema).default([]),
  assignments: z.array(accommodationAssignmentSchema).default([]),
  self_arranged_stays: z.array(selfArrangedStaySchema).default([]),
  household_requirements: z
    .record(z.string(), stayRequirementsSchema)
    .default({}),
});
export type AccommodationInventory = z.infer<
  typeof accommodationInventorySchema
>;

type AccommodationPlanLike = {
  guests: WeddingGuest[];
  guest_directory: { households: { id: string; name: string }[] };
  accommodation: {
    guests: Record<
      string,
      {
        overnight: "unknown" | "yes" | "no";
        stay?: StayRequirements | null;
      }
    >;
    inventory: AccommodationInventory;
  };
};

function uniqueIds(values: readonly { id: string }[], label: string) {
  const found = new Set<string>();
  for (const value of values) {
    if (found.has(value.id)) throw new Error(`${label} IDs must be unique`);
    found.add(value.id);
  }
  return found;
}

function validateWindow(
  arrivesOn: string,
  departsOn: string,
  label: string,
): void {
  if (arrivesOn >= departsOn)
    throw new Error(`${label} departure must be after arrival`);
}

function subjectGuestIds(
  plan: AccommodationPlanLike,
  subject: AccommodationSubject,
): string[] {
  if (subject.kind === "guest") return [subject.id];
  return plan.guests
    .filter((guest) => guest.household_id === subject.id)
    .map((guest) => guest.id);
}

function validateSubject(
  subject: AccommodationSubject,
  guestIds: Set<string>,
  householdIds: Set<string>,
): void {
  const valid =
    subject.kind === "guest"
      ? guestIds.has(subject.id)
      : householdIds.has(subject.id);
  if (!valid)
    throw new Error(
      `Accommodation ${subject.kind} ${subject.id} does not exist`,
    );
}

type InventoryReferences = {
  propertyIds: Set<string>;
  roomIds: Set<string>;
  assignmentIds: Set<string>;
  guestIds: Set<string>;
  householdIds: Set<string>;
  beds: Map<string, string>;
  rooms: Map<string, AccommodationRoom>;
  properties: Map<string, AccommodationProperty>;
};

function inventoryReferences(plan: AccommodationPlanLike): InventoryReferences {
  const inventory = plan.accommodation.inventory;
  const propertyIds = uniqueIds(inventory.properties, "Accommodation property");
  const roomIds = uniqueIds(inventory.rooms, "Accommodation room");
  const assignmentIds = uniqueIds(
    inventory.assignments,
    "Accommodation assignment",
  );
  uniqueIds(inventory.self_arranged_stays, "Self-arranged stay");
  const guestIds = new Set(plan.guests.map((guest) => guest.id));
  const householdIds = new Set(
    plan.guest_directory.households.map((household) => household.id),
  );
  const rooms = new Map(inventory.rooms.map((room) => [room.id, room]));
  const properties = new Map(
    inventory.properties.map((property) => [property.id, property]),
  );
  const beds = new Map<string, string>();
  for (const room of inventory.rooms) {
    if (!propertyIds.has(room.property_id))
      throw new Error(`${room.id} refers to an unknown accommodation property`);
    for (const bed of room.beds) {
      if (beds.has(bed.id))
        throw new Error("Accommodation bed IDs must be unique");
      beds.set(bed.id, room.id);
    }
  }
  return {
    propertyIds,
    roomIds,
    assignmentIds,
    guestIds,
    householdIds,
    beds,
    rooms,
    properties,
  };
}

function validatePropertyReferences(
  properties: AccommodationProperty[],
  references: InventoryReferences,
): void {
  const { guestIds, householdIds } = references;
  for (const property of properties) {
    validateWindow(property.check_in_on, property.check_out_on, property.name);
    const payer = property.booking.payer;
    if (payer.kind === "guest" && (!payer.id || !guestIds.has(payer.id)))
      throw new Error(`${property.name} refers to an unknown guest payer`);
    if (
      payer.kind === "household" &&
      (!payer.id || !householdIds.has(payer.id))
    )
      throw new Error(`${property.name} refers to an unknown household payer`);
    if (["couple", "guest_direct"].includes(payer.kind) && payer.id)
      throw new Error(`${property.name} payer must not have an ID`);
  }
}

function validateStayConstraints(
  plan: AccommodationPlanLike,
  references: InventoryReferences,
): void {
  const { guestIds, householdIds } = references;
  for (const [guestId, preferences] of Object.entries(
    plan.accommodation.guests,
  )) {
    const stay = preferences.stay;
    if (!stay) continue;
    const links = [...stay.must_share_with, ...stay.must_not_share_with];
    if (links.some((id) => id === guestId || !guestIds.has(id)))
      throw new Error(`${guestId} has an invalid accommodation constraint`);
  }
  for (const [householdId, requirements] of Object.entries(
    plan.accommodation.inventory.household_requirements,
  )) {
    if (!householdIds.has(householdId))
      throw new Error(`${householdId} accommodation household does not exist`);
    if (
      [
        ...requirements.must_share_with,
        ...requirements.must_not_share_with,
      ].some((id) => !guestIds.has(id))
    )
      throw new Error(`${householdId} has an invalid accommodation constraint`);
  }
}

function validateAssignment(
  assignment: AccommodationAssignment,
  references: InventoryReferences,
): void {
  const {
    assignmentIds,
    beds,
    guestIds,
    householdIds,
    properties,
    roomIds,
    rooms,
  } = references;
  validateSubject(assignment.subject, guestIds, householdIds);
  if (!roomIds.has(assignment.room_id))
    throw new Error(`${assignment.id} refers to an unknown room`);
  if (assignment.bed_ids.some((id) => beds.get(id) !== assignment.room_id))
    throw new Error(`${assignment.id} refers to a bed outside its room`);
  validateWindow(assignment.arrives_on, assignment.departs_on, assignment.id);
  const room = rooms.get(assignment.room_id);
  const property = room ? properties.get(room.property_id) : undefined;
  if (!room || !property)
    throw new Error(`${assignment.id} refers to an unknown accommodation`);
  if (
    assignment.arrives_on < property.check_in_on ||
    assignment.departs_on > property.check_out_on
  )
    throw new Error(`${assignment.id} falls outside the property stay window`);
  if (assignment.status === "alternative") {
    if (
      !assignment.alternative_to_assignment_id ||
      !assignmentIds.has(assignment.alternative_to_assignment_id) ||
      assignment.alternative_to_assignment_id === assignment.id
    )
      throw new Error(`${assignment.id} needs a valid primary assignment`);
    return;
  }
  if (assignment.alternative_to_assignment_id)
    throw new Error(
      `${assignment.id} is primary but links to another assignment`,
    );
}

export function validateAccommodationInventory(
  plan: AccommodationPlanLike,
): void {
  const inventory = plan.accommodation.inventory;
  const references = inventoryReferences(plan);
  validatePropertyReferences(inventory.properties, references);
  validateStayConstraints(plan, references);
  for (const assignment of inventory.assignments) {
    validateAssignment(assignment, references);
  }
  for (const stay of inventory.self_arranged_stays) {
    validateSubject(stay.subject, references.guestIds, references.householdIds);
    validateWindow(stay.arrives_on, stay.departs_on, stay.id);
  }
}

function nightsBetween(arrivesOn: string, departsOn: string): string[] {
  const nights: string[] = [];
  const cursor = new Date(`${arrivesOn}T00:00:00Z`);
  const end = new Date(`${departsOn}T00:00:00Z`);
  while (cursor < end) {
    nights.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return nights;
}

export type AccommodationIssue = {
  kind: "capacity" | "double_booked" | "unmet_need";
  message: string;
  assignment_ids: string[];
  guest_ids: string[];
};

export type AccommodationAudit = {
  issues: AccommodationIssue[];
  unassigned_guest_ids: string[];
  unused_room_ids: string[];
  unused_bed_ids: string[];
};

function assignmentsOverlap(
  first: AccommodationAssignment,
  second: AccommodationAssignment,
): boolean {
  return (
    first.arrives_on < second.departs_on && second.arrives_on < first.departs_on
  );
}

function supportedNeeds(
  property: AccommodationProperty,
  room: AccommodationRoom,
): Set<string> {
  return new Set([
    ...property.accessibility,
    ...room.accessibility,
    ...Object.keys(property.custom_attributes),
    ...Object.values(property.custom_attributes),
    ...Object.keys(room.custom_attributes),
    ...Object.values(room.custom_attributes),
  ]);
}

function requiredNeeds(requirements: StayRequirements): string[] {
  return [
    ...requirements.accessibility_needs,
    ...requirements.transport_needs,
    ...requirements.custom_needs,
    ...(requirements.needs_child_space ? ["child_space"] : []),
  ];
}

type NightOccupant = {
  assignment: AccommodationAssignment;
  guestIds: string[];
};

type NightOccupancy = {
  rooms: Map<string, NightOccupant[]>;
  beds: Map<string, NightOccupant[]>;
  guests: Map<string, AccommodationAssignment[]>;
};

function appendMapValue<T>(map: Map<string, T[]>, key: string, value: T): void {
  map.set(key, [...(map.get(key) ?? []), value]);
}

function collectNightOccupancy(
  plan: AccommodationPlanLike,
  confirmed: AccommodationAssignment[],
): NightOccupancy {
  const occupancy: NightOccupancy = {
    rooms: new Map(),
    beds: new Map(),
    guests: new Map(),
  };
  for (const assignment of confirmed) {
    const guestIds = subjectGuestIds(plan, assignment.subject);
    for (const night of nightsBetween(
      assignment.arrives_on,
      assignment.departs_on,
    )) {
      const roomKey = `${assignment.room_id}:${night}`;
      appendMapValue(occupancy.rooms, roomKey, { assignment, guestIds });
      for (const bedId of assignment.bed_ids) {
        appendMapValue(occupancy.beds, `${bedId}:${night}`, {
          assignment,
          guestIds,
        });
      }
      for (const guestId of guestIds)
        appendMapValue(occupancy.guests, `${guestId}:${night}`, assignment);
    }
  }
  return occupancy;
}

function roomCapacityIssues(
  roomNights: NightOccupancy["rooms"],
  rooms: Map<string, AccommodationRoom>,
): AccommodationIssue[] {
  const issues: AccommodationIssue[] = [];
  for (const [key, occupants] of roomNights) {
    const roomId = key.slice(0, key.lastIndexOf(":"));
    const room = rooms.get(roomId);
    if (!room) continue;
    const guestIds = [...new Set(occupants.flatMap((item) => item.guestIds))];
    if (guestIds.length > room.capacity)
      issues.push({
        kind: "capacity",
        message: `${room.name} exceeds its capacity of ${room.capacity}`,
        assignment_ids: occupants.map((item) => item.assignment.id),
        guest_ids: guestIds,
      });
  }
  return issues;
}

function bedCapacityIssues(
  bedNights: NightOccupancy["beds"],
  beds: Map<string, AccommodationRoom["beds"][number]>,
): AccommodationIssue[] {
  const issues: AccommodationIssue[] = [];
  for (const [key, occupants] of bedNights) {
    const bedId = key.slice(0, key.lastIndexOf(":"));
    const bed = beds.get(bedId);
    if (!bed) continue;
    const guestIds = [...new Set(occupants.flatMap((item) => item.guestIds))];
    if (guestIds.length > bed.capacity)
      issues.push({
        kind: "capacity",
        message: `${bed.name} exceeds its capacity of ${bed.capacity}`,
        assignment_ids: occupants.map((item) => item.assignment.id),
        guest_ids: guestIds,
      });
  }
  return issues;
}

function doubleBookingIssues(
  plan: AccommodationPlanLike,
  guestNights: NightOccupancy["guests"],
): AccommodationIssue[] {
  const issues: AccommodationIssue[] = [];
  for (const [key, assignments] of guestNights) {
    const unique = [...new Set(assignments.map((assignment) => assignment.id))];
    if (unique.length > 1) {
      const guestId = key.slice(0, key.lastIndexOf(":"));
      issues.push({
        kind: "double_booked",
        message: `${plan.guests.find((guest) => guest.id === guestId)?.name ?? "Guest"} has two stays on the same night`,
        assignment_ids: unique,
        guest_ids: [guestId],
      });
    }
  }
  return issues;
}

function assignmentsByGuest(
  plan: AccommodationPlanLike,
  confirmed: AccommodationAssignment[],
): Map<string, AccommodationAssignment> {
  const assignmentByGuest = new Map<string, AccommodationAssignment>();
  for (const assignment of confirmed)
    for (const guestId of subjectGuestIds(plan, assignment.subject))
      assignmentByGuest.set(guestId, assignment);
  return assignmentByGuest;
}

function assignmentAccommodation(
  assignment: AccommodationAssignment,
  rooms: Map<string, AccommodationRoom>,
  properties: Map<string, AccommodationProperty>,
): { room: AccommodationRoom; property: AccommodationProperty } | null {
  const room = rooms.get(assignment.room_id);
  const property = room ? properties.get(room.property_id) : undefined;
  return room && property ? { room, property } : null;
}

function guestNeedIssues(
  plan: AccommodationPlanLike,
  confirmed: AccommodationAssignment[],
  assignmentByGuest: Map<string, AccommodationAssignment>,
  rooms: Map<string, AccommodationRoom>,
  properties: Map<string, AccommodationProperty>,
): AccommodationIssue[] {
  const issues: AccommodationIssue[] = [];
  for (const guest of plan.guests) {
    const stay = plan.accommodation.guests[guest.id]?.stay;
    const assignment = assignmentByGuest.get(guest.id);
    if (!stay || !assignment) continue;
    const accommodation = assignmentAccommodation(
      assignment,
      rooms,
      properties,
    );
    if (!accommodation) continue;
    const { property, room } = accommodation;
    const supported = supportedNeeds(property, room);
    const missing = requiredNeeds(stay).filter((need) => !supported.has(need));
    if (missing.length)
      issues.push({
        kind: "unmet_need",
        message: `${guest.name}: ${missing.join(", ")} not available in ${room.name}`,
        assignment_ids: [assignment.id],
        guest_ids: [guest.id],
      });
    const occupants = new Set(
      confirmed
        .filter(
          (candidate) =>
            candidate.room_id === assignment.room_id &&
            assignmentsOverlap(candidate, assignment),
        )
        .flatMap((candidate) => subjectGuestIds(plan, candidate.subject)),
    );
    const missingShares = stay.must_share_with.filter(
      (id) => !occupants.has(id),
    );
    const forbiddenShares = stay.must_not_share_with.filter((id) =>
      occupants.has(id),
    );
    if (missingShares.length || forbiddenShares.length)
      issues.push({
        kind: "unmet_need",
        message: `${guest.name} has an unmet room-sharing constraint`,
        assignment_ids: [assignment.id],
        guest_ids: [guest.id, ...missingShares, ...forbiddenShares],
      });
  }
  return issues;
}

function householdNeedIssues(
  plan: AccommodationPlanLike,
  assignmentByGuest: Map<string, AccommodationAssignment>,
  rooms: Map<string, AccommodationRoom>,
  properties: Map<string, AccommodationProperty>,
): AccommodationIssue[] {
  const issues: AccommodationIssue[] = [];
  for (const [householdId, requirements] of Object.entries(
    plan.accommodation.inventory.household_requirements,
  )) {
    const guestIds = plan.guests
      .filter((guest) => guest.household_id === householdId)
      .map((guest) => guest.id);
    const assignments = [
      ...new Map(
        guestIds
          .map((id) => assignmentByGuest.get(id))
          .filter((item): item is AccommodationAssignment => Boolean(item))
          .map((item) => [item.id, item]),
      ).values(),
    ];
    for (const assignment of assignments) {
      const accommodation = assignmentAccommodation(
        assignment,
        rooms,
        properties,
      );
      if (!accommodation) continue;
      const { property, room } = accommodation;
      const supported = supportedNeeds(property, room);
      const missing = requiredNeeds(requirements).filter(
        (need) => !supported.has(need),
      );
      if (missing.length)
        issues.push({
          kind: "unmet_need",
          message: `${plan.guest_directory.households.find((item) => item.id === householdId)?.name ?? householdId}: ${missing.join(", ")} not available in ${room.name}`,
          assignment_ids: [assignment.id],
          guest_ids: guestIds,
        });
    }
  }
  return issues;
}

function inventoryUsage(
  plan: AccommodationPlanLike,
  confirmed: AccommodationAssignment[],
): Omit<AccommodationAudit, "issues"> {
  const inventory = plan.accommodation.inventory;
  const assigned = new Set([
    ...confirmed.flatMap((assignment) =>
      subjectGuestIds(plan, assignment.subject),
    ),
    ...inventory.self_arranged_stays.flatMap((stay) =>
      subjectGuestIds(plan, stay.subject),
    ),
  ]);
  const usedRooms = new Set(confirmed.map((assignment) => assignment.room_id));
  const usedBeds = new Set(
    confirmed.flatMap((assignment) => assignment.bed_ids),
  );
  return {
    unassigned_guest_ids: plan.guests
      .filter(
        (guest) =>
          plan.accommodation.guests[guest.id]?.overnight === "yes" &&
          !assigned.has(guest.id),
      )
      .map((guest) => guest.id),
    unused_room_ids: inventory.rooms
      .filter((room) => !usedRooms.has(room.id))
      .map((room) => room.id),
    unused_bed_ids: inventory.rooms
      .flatMap((room) => room.beds)
      .filter((bed) => !usedBeds.has(bed.id))
      .map((bed) => bed.id),
  };
}

export function auditAccommodationInventory(
  plan: AccommodationPlanLike,
): AccommodationAudit {
  validateAccommodationInventory(plan);
  const inventory = plan.accommodation.inventory;
  const rooms = new Map(inventory.rooms.map((room) => [room.id, room]));
  const properties = new Map(
    inventory.properties.map((property) => [property.id, property]),
  );
  const beds = new Map(
    inventory.rooms.flatMap((room) => room.beds.map((bed) => [bed.id, bed])),
  );
  const confirmed = inventory.assignments.filter(
    (assignment) => assignment.status === "confirmed",
  );
  const occupancy = collectNightOccupancy(plan, confirmed);
  const assignmentByGuest = assignmentsByGuest(plan, confirmed);
  return {
    issues: [
      ...roomCapacityIssues(occupancy.rooms, rooms),
      ...bedCapacityIssues(occupancy.beds, beds),
      ...doubleBookingIssues(plan, occupancy.guests),
      ...guestNeedIssues(plan, confirmed, assignmentByGuest, rooms, properties),
      ...householdNeedIssues(plan, assignmentByGuest, rooms, properties),
    ],
    ...inventoryUsage(plan, confirmed),
  };
}

export type ProviderManifest = {
  property: {
    name: string;
    address: string;
    check_in_on: string;
    check_out_on: string;
    confirmation_reference: string;
  };
  rooms: {
    name: string;
    stays: {
      names: string[];
      arrives_on: string;
      departs_on: string;
      accessibility_needs: string[];
      transport_needs: string[];
    }[];
  }[];
};

export function accommodationProviderManifest(
  plan: AccommodationPlanLike,
  propertyId: string,
): ProviderManifest {
  validateAccommodationInventory(plan);
  const inventory = plan.accommodation.inventory;
  const property = inventory.properties.find((item) => item.id === propertyId);
  if (!property) throw new Error("Accommodation property does not exist");
  const rooms = inventory.rooms.filter(
    (room) => room.property_id === propertyId,
  );
  return {
    property: {
      name: property.name,
      address: property.address,
      check_in_on: property.check_in_on,
      check_out_on: property.check_out_on,
      confirmation_reference: property.booking.confirmation_reference,
    },
    rooms: rooms.map((room) => ({
      name: room.name,
      stays: inventory.assignments
        .filter(
          (assignment) =>
            assignment.room_id === room.id && assignment.status === "confirmed",
        )
        .map((assignment) => {
          const guestIds = subjectGuestIds(plan, assignment.subject);
          const householdRequirements =
            assignment.subject.kind === "household"
              ? inventory.household_requirements[assignment.subject.id]
              : undefined;
          return {
            names: guestIds.map(
              (id) => plan.guests.find((guest) => guest.id === id)?.name ?? id,
            ),
            arrives_on: assignment.arrives_on,
            departs_on: assignment.departs_on,
            accessibility_needs: [
              ...new Set([
                ...guestIds.flatMap(
                  (id) =>
                    plan.accommodation.guests[id]?.stay?.accessibility_needs ??
                    [],
                ),
                ...(householdRequirements?.accessibility_needs ?? []),
              ]),
            ],
            transport_needs: [
              ...new Set([
                ...guestIds.flatMap(
                  (id) =>
                    plan.accommodation.guests[id]?.stay?.transport_needs ?? [],
                ),
                ...(householdRequirements?.transport_needs ?? []),
              ]),
            ],
          };
        }),
    })),
  };
}

export type GuestAccommodationItinerary = {
  guest: string;
  stay:
    | {
        arranged_by: "planner";
        property: string;
        address: string;
        room: string;
        arrives_on: string;
        departs_on: string;
        confirmation_reference: string;
      }
    | {
        arranged_by: "guest";
        provider: string;
        address: string;
        arrives_on: string;
        departs_on: string;
        confirmation_details: string;
      }
    | null;
};

export function guestAccommodationItinerary(
  plan: AccommodationPlanLike,
  guestId: string,
): GuestAccommodationItinerary {
  validateAccommodationInventory(plan);
  const guest = plan.guests.find((item) => item.id === guestId);
  if (!guest) throw new Error("Guest does not exist");
  const inventory = plan.accommodation.inventory;
  const assignment = inventory.assignments.find(
    (item) =>
      item.status === "confirmed" &&
      subjectGuestIds(plan, item.subject).includes(guestId),
  );
  if (assignment) {
    const room = inventory.rooms.find((item) => item.id === assignment.room_id);
    if (!room) throw new Error("Accommodation room does not exist");
    const property = inventory.properties.find(
      (item) => item.id === room.property_id,
    );
    if (!property) throw new Error("Accommodation property does not exist");
    return {
      guest: guest.name,
      stay: {
        arranged_by: "planner",
        property: property.name,
        address: property.address,
        room: room.name,
        arrives_on: assignment.arrives_on,
        departs_on: assignment.departs_on,
        confirmation_reference: property.booking.confirmation_reference,
      },
    };
  }
  const selfArranged = inventory.self_arranged_stays.find((item) =>
    subjectGuestIds(plan, item.subject).includes(guestId),
  );
  return {
    guest: guest.name,
    stay: selfArranged
      ? {
          arranged_by: "guest",
          provider: selfArranged.provider_name,
          address: selfArranged.address,
          arrives_on: selfArranged.arrives_on,
          departs_on: selfArranged.departs_on,
          confirmation_details: selfArranged.confirmation_details,
        }
      : null,
  };
}
