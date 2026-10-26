import { z } from "zod";
import { accommodationPlanSchema } from "./accommodation/preferences";
import { validateAccommodationInventory } from "./accommodation/inventory";
import {
  coupleSchema,
  validateCouples,
  weddingGuestSchema,
} from "./core/guests";
import { parseMoneyToMinorUnits } from "./money";
import {
  guestDirectoryMetadataSchema,
  validateGuestDirectory,
} from "./guest-directory";
import { seatingPlanSchema } from "./seating/preferences";
import { collaborativePlaylistSchema } from "./playlist";
import { weddingReadinessPreferencesSchema } from "./readiness";

const weddingPlanSchema = z.object({
  version: z.literal(2),
  guests: z.array(weddingGuestSchema),
  guest_directory: guestDirectoryMetadataSchema.prefault({}),
  couples: z.array(coupleSchema).default([]),
  reviewed_non_couples: z.array(z.tuple([z.string(), z.string()])).default([]),
  hosts: z.array(z.string().min(1)).min(1),
  accommodation: accommodationPlanSchema.prefault({}),
  seating: seatingPlanSchema,
  playlist: collaborativePlaylistSchema.optional(),
  readiness: weddingReadinessPreferencesSchema.prefault({}),
  extensions: z.record(z.string(), z.unknown()).default({}),
});
export type WeddingPlan = z.infer<typeof weddingPlanSchema>;

function validateSeatingReferences(plan: WeddingPlan, ids: Set<string>) {
  if (
    new Set(plan.seating.top_table_guest_ids).size !==
    plan.seating.top_table_guest_ids.length
  )
    throw new Error("Top table guests must be unique");
  if (plan.seating.top_table_guest_ids.some((id) => !ids.has(id)))
    throw new Error("The top table refers to an unknown guest");
  if (
    Object.keys(plan.seating.locked_assignments).some((id) => !ids.has(id)) ||
    Object.values(plan.seating.locked_table_guest_ids)
      .flat()
      .some((id) => !ids.has(id))
  )
    throw new Error("A seating lock refers to an unknown guest");
  const savedPlanIds = new Set(
    plan.seating.saved_plans.map((savedPlan) => savedPlan.id),
  );
  if (savedPlanIds.size !== plan.seating.saved_plans.length)
    throw new Error("Saved seating plan IDs must be unique");
  if (
    plan.seating.chosen_plan_id &&
    !savedPlanIds.has(plan.seating.chosen_plan_id)
  )
    throw new Error("The chosen seating plan does not exist");
  if (
    plan.seating.event_id &&
    !plan.guest_directory.events.some(
      (event) => event.id === plan.seating.event_id,
    )
  )
    throw new Error("The seating plan event does not exist");
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
}

function validateAccommodationReferences(plan: WeddingPlan, ids: Set<string>) {
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
  validateAccommodationInventory(plan);
}

function validateReferences(plan: WeddingPlan): void {
  const ids = new Set(plan.guests.map((guest) => guest.id));
  if (ids.size !== plan.guests.length)
    throw new Error("Guest IDs must be unique");
  validateGuestDirectory(plan);
  validateCouples(plan.couples, ids);
  validateDismissedSuggestions(plan, ids);
  validateSeatingReferences(plan, ids);
  validateAccommodationReferences(plan, ids);
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

function migrateLegacyGuestTags(value: unknown): unknown {
  if (
    !value ||
    typeof value !== "object" ||
    !("guests" in value) ||
    !Array.isArray(value.guests)
  )
    return value;
  return {
    ...value,
    guests: value.guests.map((guest: unknown) => {
      if (!guest || typeof guest !== "object" || !("tags" in guest))
        return guest;
      let legacyTags: string[] = [];
      if (Array.isArray(guest.tags))
        legacyTags = guest.tags.filter(
          (tag): tag is string => typeof tag === "string",
        );
      else if (typeof guest.tags === "string")
        legacyTags = guest.tags
          .split(/[;,]/)
          .map((tag) => tag.trim())
          .filter(Boolean);
      const { tags: _tags, ...guestWithoutTags } = guest;
      return {
        ...guestWithoutTags,
        relationship_groups:
          "relationship_groups" in guest
            ? guest.relationship_groups
            : legacyTags,
      };
    }),
  };
}

export function parseWeddingPlan(value: unknown): WeddingPlan {
  const checked = weddingPlanSchema.safeParse(
    migrateLegacyWeddingParty(migrateLegacyGuestTags(value)),
  );
  if (!checked.success) {
    const issue = checked.error.issues[0];
    throw new Error(
      `This file is not a compatible wedding planner plan (${issue?.path.join(".") || "file"}: ${issue?.message ?? "invalid data"}).`,
    );
  }
  validateReferences(checked.data);
  return checked.data;
}
