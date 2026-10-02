import type {
  BookingParty,
  FreeStayReason,
  OptimizationMode,
  OvernightStatus,
  PropertyAvailability,
  RoomBillingMode,
  ShareMode,
} from "./values";

export type { PairDecision, SharingLevel } from "./values";

export type Guest = {
  id: string;
  name: string;
  source_party: string;
  tags: string;
  overnight: OvernightStatus;
  attendance?: OvernightStatus;
  wedding_roles?: import("wedding-planner-domain").WeddingRole[];
  partner_id?: string;
  prefer_table_with?: string[];
  avoid_table_with?: string[];
  fixed_bed_group_id: string;
  requires_own_bed: boolean;
  safe_for_our_booking: boolean;
  may_share_bed_with: string[];
  avoid_bed_with: string[];
  can_share_room: boolean;
  room_share_mode: ShareMode;
  may_share_room_with: string[];
  can_share_cottage: boolean;
  cottage_share_mode: ShareMode;
  may_share_cottage_with: string[];
  avoid_room_with: string[];
  avoid_cottage_with: string[];
  priority: number;
  fixed_room_id: string;
  preferred_property_ids: string[];
  outside_cost_gbp: string;
  charge_cap_exempt: boolean;
  free_stay_reasons: FreeStayReason[];
  include_partner_in_free_stay: boolean;
};
export type State = {
  nights?: number;
  guests: Guest[];
  table_plan?: TablePlan;
  dismissed_accommodation_suggestions?: [string, string][];
  couples?: import("wedding-planner-domain").Couple[];
  hosts?: string[];
  payment_modes: Record<string, BookingParty>;
  cottage_options: Record<
    string,
    {
      availability: PropertyAvailability;
      booking_by: BookingParty;
    }
  >;
  reviewed_non_couples: string[][];
  reservations: Record<
    string,
    { guest_ids: string[]; approved_guest_ids: string[] }
  >;
  suite_billing_modes: Record<string, RoomBillingMode>;
  cottage_paid_by_us_gbp: Record<string, string>;
  guest_charge_cap_gbp: string;
  max_cottage_spend_gbp: string;
  default_outside_cost_gbp: string;
  optimization_mode: OptimizationMode;
  [key: string]: unknown;
};
export type {
  TableAllocation,
  TableInput,
  TablePlan,
} from "wedding-planner-domain/seating";

import type { TablePlan } from "wedding-planner-domain/seating";

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
