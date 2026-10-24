import { accommodationPreferencesSchema } from "./accommodation/preferences";
import type { Guest, State } from "./accommodation/types";
import { partnerId } from "./core/guests";
import type { WeddingPlan } from "./plan";
import { seatingPreferencesSchema } from "./seating/preferences";
import type { TableInput } from "./seating/types";

export function accommodationState(plan: WeddingPlan): State {
  return {
    ...structuredClone(plan.accommodation),
    guests: plan.guests.map(
      (guest): Guest => ({
        ...guest,
        ...accommodationPreferencesSchema.parse(
          plan.accommodation.guests[guest.id] ?? {},
        ),
        partner_id: partnerId(plan.couples, guest.id),
      }),
    ),
  };
}

export function tableInput(plan: WeddingPlan): TableInput {
  const {
    preferences: _preferences,
    dismissed_accommodation_suggestions: _dismissedSuggestions,
    ...tablePlan
  } = plan.seating;
  return {
    guests: plan.guests.map((guest) => ({
      ...guest,
      ...seatingPreferencesSchema.parse(
        plan.seating.preferences[guest.id] ?? {},
      ),
      partner_id: partnerId(plan.couples, guest.id),
    })),
    plan: structuredClone(tablePlan),
    fixed_top_guests: [...plan.hosts],
  };
}
