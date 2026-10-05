import { accommodationState } from "wedding-planner-domain";
import { buildInput as domainBuildInput } from "wedding-planner-domain/accommodation";
import { z } from "zod";
import { parseMoneyToMinorUnits } from "@/lib/generic/money";
import { editorStateToPlan } from "./editor-projection";
import { type AccommodationSetup, weddingAccommodationSetup } from "./setup";
import { tablePlanSchema, validateTableLinks } from "./table-state";
import type { WeddingPlanDraft } from "./types";
import {
  BookingPartySchema,
  FreeStayReasonSchema,
  OptimizationModeSchema,
  OvernightStatusSchema,
  PropertyAvailabilitySchema,
  RoomBillingModeSchema,
  ShareModeSchema,
} from "./values";

const idList = z.array(z.string());
const money = z.union([z.string(), z.number()]).transform(String);
const guestSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1),
  source_party: z.string().default(""),
  tags: z.string().default(""),
  overnight: OvernightStatusSchema,
  attendance: OvernightStatusSchema.optional(),
  prefer_table_with: idList.optional(),
  avoid_table_with: idList.optional(),
  fixed_bed_group_id: z.string().default(""),
  requires_own_bed: z.boolean().default(false),
  safe_for_our_booking: z.boolean().default(false),
  may_share_bed_with: idList.default([]),
  avoid_bed_with: idList.default([]),
  can_share_room: z.boolean().default(false),
  room_share_mode: ShareModeSchema.default("none"),
  may_share_room_with: idList.default([]),
  can_share_cottage: z.boolean().default(true),
  cottage_share_mode: ShareModeSchema.default("any"),
  may_share_cottage_with: idList.default([]),
  avoid_room_with: idList.default([]),
  avoid_cottage_with: idList.default([]),
  priority: z.number().int().min(0).default(3),
  fixed_room_id: z.string().default(""),
  preferred_property_ids: idList.default([]),
  outside_cost_gbp: z.string().default(""),
  charge_cap_exempt: z.boolean().default(false),
  free_stay_reasons: z.array(FreeStayReasonSchema).default([]),
  include_partner_in_free_stay: z.boolean().default(true),
});

const cottageChoice = z.object({
  availability: PropertyAvailabilitySchema,
  booking_by: BookingPartySchema,
});

const stateSchema = z.looseObject({
  nights: z.number().int().positive().default(1),
  guests: z.array(guestSchema).min(1),
  table_plan: tablePlanSchema.optional(),
  payment_modes: z.record(z.string(), BookingPartySchema),
  cottage_options: z.record(z.string(), cottageChoice),
  cottage_paid_by_us_gbp: z.record(z.string(), money),
  reviewed_non_couples: z.array(z.tuple([z.string(), z.string()])).default([]),
  reservations: z
    .record(
      z.string(),
      z.object({ guest_ids: idList, approved_guest_ids: idList }),
    )
    .default({}),
  suite_billing_modes: z.record(z.string(), RoomBillingModeSchema).default({}),
  guest_charge_cap_gbp: z.string().default(""),
  max_cottage_spend_gbp: z.string().default(""),
  default_outside_cost_gbp: z.string().default(""),
  optimization_mode: OptimizationModeSchema.default("priority_first"),
});

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === "string");
}

function migrateLegacyReservation(
  parsed: z.infer<typeof stateSchema>,
  setup: AccommodationSetup,
): WeddingPlanDraft {
  const legacy = setup.reservation?.legacyFields;
  const roomId = setup.reservation?.roomId;
  const reservations = { ...parsed.reservations };
  if (roomId && legacy && !reservations[roomId]) {
    const legacyData = parsed as Record<string, unknown>;
    const guestIds = legacyData[legacy.guestIds];
    const approvedGuestIds = legacyData[legacy.approvedGuestIds];
    if (stringList(guestIds)) {
      reservations[roomId] = {
        guest_ids: guestIds,
        approved_guest_ids: stringList(approvedGuestIds)
          ? approvedGuestIds
          : [],
      };
    }
  }
  const normalized = { ...parsed, reservations } as WeddingPlanDraft;
  if (legacy) {
    delete normalized[legacy.guestIds];
    delete normalized[legacy.approvedGuestIds];
  }
  return normalized;
}

function validateGuestLinks(state: WeddingPlanDraft, ids: Set<string>): void {
  for (const guest of state.guests) {
    for (const field of [
      "may_share_bed_with",
      "avoid_bed_with",
      "may_share_room_with",
      "may_share_cottage_with",
      "avoid_room_with",
      "avoid_cottage_with",
      "prefer_table_with",
      "avoid_table_with",
    ] as const) {
      if (guest[field]?.some((id) => !ids.has(id) || id === guest.id))
        throw new Error(`${guest.name}: ${field} has an invalid guest`);
    }
  }
}

function validateReservations(
  state: WeddingPlanDraft,
  ids: Set<string>,
  setup: AccommodationSetup,
): void {
  const rooms = new Set(setup.input.rooms.map((room) => room.id));
  for (const [roomId, reservation] of Object.entries(state.reservations)) {
    if (!rooms.has(roomId))
      throw new Error(`${roomId} reservation refers to an unknown room`);
    if (
      [...reservation.guest_ids, ...reservation.approved_guest_ids].some(
        (id) => !ids.has(id),
      )
    )
      throw new Error(`${roomId} reservation has an invalid guest`);
  }
  if (setup.reservation && !setup.reservation.guestIds(state).length)
    throw new Error(`Choose the existing ${setup.reservation.label} guests`);
}

export function parseState(
  value: unknown,
  setup: AccommodationSetup = weddingAccommodationSetup,
  validateInventory = true,
): WeddingPlanDraft {
  const checked = stateSchema.safeParse(value);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    const field = issue?.path.join(".") || "file";
    throw new Error(
      `This file is not a compatible wedding planner plan (${field}: ${issue?.message ?? "invalid data"}).`,
    );
  }
  const normalized = migrateLegacyReservation(checked.data, setup);
  if (
    validateInventory &&
    setup.fixedNights &&
    normalized.nights !== setup.fixedNights
  )
    throw new Error(`This plan must cover ${setup.fixedNights} night(s)`);
  const ids = new Set(normalized.guests.map((guest) => guest.id));
  if (ids.size !== normalized.guests.length)
    throw new Error("Guest IDs must be unique");
  validateGuestLinks(normalized, ids);
  validateTableLinks(normalized, ids);
  if (validateInventory) validateReservations(normalized, ids, setup);
  for (const [id, paid] of Object.entries(normalized.cottage_paid_by_us_gbp)) {
    parseMoneyToMinorUnits(paid, `${id} already paid`);
  }
  parseMoneyToMinorUnits(
    normalized.max_cottage_spend_gbp,
    "Maximum cottage spend",
  );
  parseMoneyToMinorUnits(
    normalized.default_outside_cost_gbp,
    "Default outside cost",
  );
  parseMoneyToMinorUnits(normalized.guest_charge_cap_gbp, "Guest charge cap");
  for (const guest of normalized.guests)
    parseMoneyToMinorUnits(
      guest.outside_cost_gbp,
      `${guest.name} outside cost`,
    );
  return normalized;
}

export function buildInput(
  state: WeddingPlanDraft,
  setup: AccommodationSetup = weddingAccommodationSetup,
) {
  return domainBuildInput(
    accommodationState(editorStateToPlan(parseState(state, setup))),
    setup,
  );
}
