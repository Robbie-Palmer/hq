import {
  accommodationState,
  type Couple,
  parseWeddingPlan,
  tableInput,
  type WeddingPlan,
} from "wedding-planner-domain";
import { accommodationPreferencesSchema } from "wedding-planner-domain/accommodation";
import { seatingPreferencesSchema } from "wedding-planner-domain/seating";
import type { State, TablePlan } from "./types";

/** The flat editor DTO preserves existing controls and v1 backups. It is not the persisted domain model. */
export function toEditorState(plan: WeddingPlan): State {
  const rooms = accommodationState(plan);
  const seating = tableInput(plan);
  return {
    ...plan.extensions,
    ...rooms,
    guests: rooms.guests.map((guest) => ({
      ...guest,
      ...seating.guests.find((person) => person.id === guest.id),
    })),
    reviewed_non_couples: structuredClone(plan.reviewed_non_couples),
    couples: structuredClone(plan.couples),
    hosts: [...plan.hosts],
    table_plan: structuredClone(seating.plan),
    dismissed_accommodation_suggestions: structuredClone(
      plan.seating.dismissed_accommodation_suggestions,
    ),
  };
}

export function defaultTablePlan(state: State): TablePlan {
  return (
    state.table_plan ?? {
      top_table_capacity: 10,
      top_table_guest_ids: [],
      table_capacities: Array.from(
        { length: Math.max(1, Math.ceil(state.guests.length / 8)) },
        () => 8,
      ),
    }
  );
}

function migrateCouples(state: State): Couple[] {
  if (state.couples) return structuredClone(state.couples);
  const groups = new Map<string, string[]>();
  for (const guest of state.guests) {
    if (guest.fixed_bed_group_id)
      groups.set(guest.fixed_bed_group_id, [
        ...(groups.get(guest.fixed_bed_group_id) ?? []),
        guest.id,
      ]);
  }
  return [...groups].flatMap(([id, guests]) =>
    guests.length === 2 ? [{ id, guest_ids: guests as [string, string] }] : [],
  );
}

export function editorStateToPlan(state: State): WeddingPlan {
  const {
    guests,
    couples,
    hosts,
    table_plan,
    reviewed_non_couples,
    dismissed_accommodation_suggestions,
    ...accommodation
  } = state;
  const tables = defaultTablePlan(state);
  // Unknown legacy fields remain available for round trips, separate from domain fields.
  const extensions = Object.fromEntries(
    Object.entries(accommodation).filter(
      ([key]) =>
        ![
          "nights",
          "payment_modes",
          "cottage_options",
          "reservations",
          "suite_billing_modes",
          "cottage_paid_by_us_gbp",
          "guest_charge_cap_gbp",
          "max_cottage_spend_gbp",
          "default_outside_cost_gbp",
          "optimization_mode",
        ].includes(key),
    ),
  );
  return parseWeddingPlan({
    version: 2,
    guests: guests.map((guest) => ({
      ...guest,
      wedding_roles:
        guest.wedding_roles ??
        (tables.top_table_guest_ids.includes(guest.id)
          ? ["wedding_party"]
          : []),
    })),
    couples: migrateCouples(state),
    hosts: hosts ?? ["You", "Your fiancé"],
    reviewed_non_couples,
    accommodation: {
      ...accommodation,
      guests: Object.fromEntries(
        guests.map((guest) => [
          guest.id,
          accommodationPreferencesSchema.parse(guest),
        ]),
      ),
    },
    seating: {
      table_layout: tables.table_layout,
      top_table_guest_ids: tables.top_table_guest_ids,
      top_table_capacity: tables.top_table_capacity,
      table_capacities: tables.table_capacities,
      preferences: Object.fromEntries(
        guests.map((guest) => [
          guest.id,
          seatingPreferencesSchema.parse(guest),
        ]),
      ),
      dismissed_accommodation_suggestions,
    },
    extensions,
  });
}

export function editDomain(
  state: State,
  command: (plan: WeddingPlan) => void,
): void {
  const plan = editorStateToPlan(state);
  command(plan);
  Object.assign(state, toEditorState(parseWeddingPlan(plan)));
}
