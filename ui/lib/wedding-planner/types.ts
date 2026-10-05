export type { PairDecision, SharingLevel } from "./values";

import type { WeddingGuest } from "wedding-planner-domain";
import type {
  Guest as AccommodationGuest,
  State as AccommodationState,
} from "wedding-planner-domain/accommodation";
import type {
  SeatingPreferences,
  TablePlan,
} from "wedding-planner-domain/seating";

export type Guest = AccommodationGuest &
  Partial<Pick<WeddingGuest, "attendance" | "wedding_roles">> &
  Partial<SeatingPreferences>;

export type WeddingPlanDraft = Omit<AccommodationState, "guests"> & {
  guests: Guest[];
  table_plan?: TablePlan;
  dismissed_accommodation_suggestions?: [string, string][];
  couples?: import("wedding-planner-domain").Couple[];
  hosts?: string[];
  reviewed_non_couples: string[][];
  [key: string]: unknown;
};

export type {
  Allocation,
  BedGroup,
  Party,
  PartyName,
  Placement,
  PlannerInput,
  Property,
  PropertyPayment,
  Room,
} from "wedding-planner-domain/accommodation";
export type {
  TableAllocation,
  TableInput,
  TablePlan,
} from "wedding-planner-domain/seating";
