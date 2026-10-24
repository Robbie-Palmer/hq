import type { WeddingGuest } from "../core/guests";
export type { PairDecision } from "../values";

export type SeatingPreferences = {
  prefer_table_with: string[];
  avoid_table_with: string[];
};
export type SeatingGuest = Pick<
  WeddingGuest,
  "id" | "name" | "attendance" | "wedding_roles"
> &
  Partial<
    Pick<
      WeddingGuest,
      | "source_party"
      | "invitation_party_id"
      | "is_child"
      | "requires_high_chair"
      | "relationship_groups"
      | "dietary_needs"
      | "allergies"
      | "accessibility_needs"
      | "seating_constraints"
    >
  > &
  SeatingPreferences & { partner_id?: string };
export type VenueElement = {
  id: string;
  name: string;
  kind: "dance_floor" | "stage" | "bar" | "door" | "pillar" | "other";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};
export type TableAppearance = {
  name?: string;
  shape?: "round" | "long";
  x?: number;
  y?: number;
  rotation?: number;
  accessible_seat_indexes?: number[];
  high_chair_seat_indexes?: number[];
};
export type LockedSeatAssignment = {
  table_id: string;
  seat_index?: number;
};
export type SavedTablePlan = {
  id: string;
  name: string;
  event_id?: string;
  created_at: string;
  allocation: TableAllocation;
};
export type TablePlan = {
  event_id?: string;
  table_layout?: Record<string, TableAppearance>;
  venue_elements?: VenueElement[];
  top_table_capacity: number;
  top_table_guest_ids: string[];
  table_capacities: number[];
  locked_assignments?: Record<string, LockedSeatAssignment>;
  locked_table_guest_ids?: Record<string, string[]>;
  role_table_preferences?: Record<string, string[]>;
  relationship_group_table_preferences?: Record<string, string[]>;
  keep_invitation_parties_together?: boolean;
  keep_relationship_groups_together?: string[];
  saved_plans?: SavedTablePlan[];
  chosen_plan_id?: string;
};
export type TableInput = {
  guests: SeatingGuest[];
  plan: TablePlan;
  fixed_top_guests: string[];
};
export type TableAllocation = {
  status: "optimal" | "provisional";
  score: {
    earned: number;
    possible: number;
  };
  tables: {
    id: string;
    name: string;
    capacity: number;
    guest_ids: string[];
    fixed_guests: string[];
    seats: {
      index: number;
      guest_id?: string;
      accessible: boolean;
      high_chair: boolean;
      locked: boolean;
    }[];
    locked: boolean;
  }[];
  preferences_met: number;
  preferences_total: number;
  unmet_preferences: [string, string][];
  unsatisfied_preferences: {
    guest_ids: string[];
    description: string;
    weight: number;
  }[];
  explanations: {
    guest_id: string;
    table_id: string;
    seat_index: number;
    factors: string[];
  }[];
  warnings: string[];
};

export interface TableAllocator {
  solve(input: TableInput): Promise<TableAllocation>;
}
