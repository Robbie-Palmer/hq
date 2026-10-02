import type { WeddingGuest } from "../core/guests";
import type { PairDecision } from "../values";
export type { PairDecision };

export type SeatingPreferences = {
  prefer_table_with: string[];
  avoid_table_with: string[];
};
export type SeatingGuest = WeddingGuest &
  SeatingPreferences & { partner_id?: string };
export type TablePlan = {
  top_table_capacity: number;
  top_table_guest_ids: string[];
  table_capacities: number[];
};
export type TableInput = {
  guests: SeatingGuest[];
  plan: TablePlan;
  fixed_top_guests: string[];
};
export type TableAllocation = {
  status: "optimal" | "provisional";
  tables: {
    id: string;
    name: string;
    capacity: number;
    guest_ids: string[];
    fixed_guests: string[];
  }[];
  preferences_met: number;
  preferences_total: number;
  unmet_preferences: [string, string][];
  warnings: string[];
};

export interface TableAllocator {
  solve(input: TableInput): Promise<TableAllocation>;
}
