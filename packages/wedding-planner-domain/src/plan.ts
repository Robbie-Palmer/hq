import { z } from "zod";
import { accommodationPlanSchema } from "./accommodation/preferences";
import {
  coupleSchema,
  validateCouples,
  weddingGuestSchema,
} from "./core/guests";
import { parseMoneyToMinorUnits } from "./money";
import { seatingPlanSchema } from "./seating/preferences";

const weddingPlanSchema = z.object({
  version: z.literal(2),
  guests: z.array(weddingGuestSchema),
  couples: z.array(coupleSchema).default([]),
  reviewed_non_couples: z.array(z.tuple([z.string(), z.string()])).default([]),
  hosts: z.array(z.string().min(1)).min(1),
  accommodation: accommodationPlanSchema.prefault({}),
  seating: seatingPlanSchema,
  extensions: z.record(z.string(), z.unknown()).default({}),
});
export type WeddingPlan = z.infer<typeof weddingPlanSchema>;

function validateReferences(plan: WeddingPlan): void {
  const ids = new Set(plan.guests.map((guest) => guest.id));
  if (ids.size !== plan.guests.length)
    throw new Error("Guest IDs must be unique");
  validateCouples(plan.couples, ids);
  validateDismissedSuggestions(plan, ids);
  if (
    new Set(plan.seating.top_table_guest_ids).size !==
    plan.seating.top_table_guest_ids.length
  )
    throw new Error("Top table guests must be unique");
  if (plan.seating.top_table_guest_ids.some((id) => !ids.has(id)))
    throw new Error("The top table refers to an unknown guest");
  if (
    plan.reviewed_non_couples.some(
      ([a, b]) => a === b || !ids.has(a) || !ids.has(b),
    )
  )
    throw new Error("A reviewed invitation pair has an invalid guest");
  for (const [id, preferences] of Object.entries(plan.seating.preferences)) {
    validateGuestLinks(ids, id, [
      ...preferences.prefer_table_with,
      ...preferences.avoid_table_with,
    ]);
  }
  for (const [id, preferences] of Object.entries(plan.accommodation.guests)) {
    validateGuestLinks(ids, id, [
      ...preferences.may_share_bed_with,
      ...preferences.avoid_bed_with,
      ...preferences.may_share_room_with,
      ...preferences.avoid_room_with,
      ...preferences.may_share_cottage_with,
      ...preferences.avoid_cottage_with,
    ]);
  }
  for (const reservation of Object.values(plan.accommodation.reservations)) {
    if (
      [...reservation.guest_ids, ...reservation.approved_guest_ids].some(
        (id) => !ids.has(id),
      )
    )
      throw new Error("A reservation has an invalid guest");
  }
  for (const paid of Object.values(plan.accommodation.cottage_paid_by_us_gbp))
    parseMoneyToMinorUnits(paid, "Already paid");
}

function validateDismissedSuggestions(
  plan: WeddingPlan,
  ids: Set<string>,
): void {
  if (
    plan.seating.dismissed_accommodation_suggestions.some(
      ([a, b]) => a === b || !ids.has(a) || !ids.has(b),
    )
  )
    throw new Error("A dismissed seating suggestion has an invalid guest");
}

function validateGuestLinks(
  ids: Set<string>,
  id: string,
  links: string[],
): void {
  if (!ids.has(id) || links.some((other) => !ids.has(other) || other === id))
    throw new Error(`${id}: preferences have an invalid guest`);
}

function migrateLegacyWeddingParty(value: unknown): unknown {
  if (
    !value ||
    typeof value !== "object" ||
    !("wedding_party_guest_ids" in value)
  )
    return value;
  const legacyIds = z.array(z.string()).parse(value.wedding_party_guest_ids);
  if (
    !("seating" in value) ||
    !value.seating ||
    typeof value.seating !== "object" ||
    Array.isArray(value.seating)
  )
    return value;
  const guests =
    "guests" in value && Array.isArray(value.guests)
      ? value.guests.map((guest: unknown) => {
          if (
            !guest ||
            typeof guest !== "object" ||
            "wedding_roles" in guest ||
            !("id" in guest)
          )
            return guest;
          return {
            ...guest,
            wedding_roles: legacyIds.includes(String(guest.id))
              ? ["wedding_party"]
              : [],
          };
        })
      : undefined;
  return {
    ...value,
    guests,
    seating: { top_table_guest_ids: legacyIds, ...value.seating },
  };
}

export function parseWeddingPlan(value: unknown): WeddingPlan {
  const checked = weddingPlanSchema.safeParse(migrateLegacyWeddingParty(value));
  if (!checked.success) {
    const issue = checked.error.issues[0];
    throw new Error(
      `This file is not a compatible wedding planner plan (${issue?.path.join(".") || "file"}: ${issue?.message ?? "invalid data"}).`,
    );
  }
  validateReferences(checked.data);
  return checked.data;
}
