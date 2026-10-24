export type { PairDecision, SharingLevel } from "./values";

import type {
  CollaborativePlaylist,
  GuestDirectoryMetadata,
  WeddingGuest,
} from "wedding-planner-domain";
import type {
  Guest as AccommodationGuest,
  State as AccommodationState,
} from "wedding-planner-domain/accommodation";
import type {
  SeatingPreferences,
  TablePlan,
} from "wedding-planner-domain/seating";

export type Guest = AccommodationGuest &
  Partial<WeddingGuest> &
  Partial<SeatingPreferences>;

export type WeddingPlanDraft = Omit<AccommodationState, "guests"> & {
  guests: Guest[];
  table_plan?: TablePlan;
  dismissed_accommodation_suggestions?: [string, string][];
  couples?: import("wedding-planner-domain").Couple[];
  hosts?: string[];
  guest_directory?: GuestDirectoryMetadata;
  playlist?: CollaborativePlaylist;
  event_table_plans?: Record<string, TablePlan>;
  reviewed_non_couples: string[][];
  [key: string]: unknown;
};

export type {
  AccommodationAssignment,
  AccommodationAudit,
  AccommodationInventory,
  AccommodationProperty,
  AccommodationRoom,
  Allocation,
  BedGroup,
  Party,
  PartyName,
  Placement,
  PlannerInput,
  Property,
  PropertyPayment,
  Room,
  SelfArrangedStay,
  StayRequirements,
} from "wedding-planner-domain/accommodation";
export type {
  TableAllocation,
  TableInput,
  TablePlan,
} from "wedding-planner-domain/seating";
