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
  return {
    guests: plan.guests.map((guest) => ({
      ...guest,
      ...seatingPreferencesSchema.parse(
        plan.seating.preferences[guest.id] ?? {},
      ),
      partner_id: partnerId(plan.couples, guest.id),
    })),
    plan: {
      ...(plan.seating.table_layout
        ? { table_layout: structuredClone(plan.seating.table_layout) }
        : {}),
      top_table_capacity: plan.seating.top_table_capacity,
      table_capacities: [...plan.seating.table_capacities],
      top_table_guest_ids: [...plan.seating.top_table_guest_ids],
    },
    fixed_top_guests: [...plan.hosts],
  };
}
