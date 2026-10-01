export type Guest = {
  id: string;
  name: string;
  source_party: string;
  tags: string;
  overnight: "unknown" | "yes" | "no";
  fixed_bed_group_id: string;
  requires_own_bed: boolean;
  safe_for_our_booking: boolean;
  may_share_bed_with: string[];
  avoid_bed_with: string[];
  can_share_room: boolean;
  room_share_mode: "none" | "selected" | "any";
  may_share_room_with: string[];
  can_share_cottage: boolean;
  cottage_share_mode: "none" | "selected" | "any";
  may_share_cottage_with: string[];
  avoid_room_with: string[];
  avoid_cottage_with: string[];
  priority: number;
  fixed_room_id: string;
  preferred_property_ids: string[];
  outside_cost_gbp: string;
  charge_cap_exempt: boolean;
  free_stay_reasons: ("immediate_family" | "wedding_party" | "other")[];
  include_partner_in_free_stay: boolean;
};
export type State = {
  nights?: number;
  guests: Guest[];
  payment_modes: Record<string, "couple" | "guests">;
  cottage_options: Record<
    string,
    {
      availability: "unknown" | "available" | "unavailable";
      booking_by: "guests" | "couple";
    }
  >;
  reviewed_non_couples: string[][];
  reservations: Record<
    string,
    { guest_ids: string[]; approved_guest_ids: string[] }
  >;
  suite_billing_modes: Record<string, string>;
  cottage_paid_by_us_gbp: Record<string, string>;
  guest_charge_cap_gbp: string;
  max_cottage_spend_gbp: string;
  default_outside_cost_gbp: string;
  optimization_mode: string;
  [key: string]: unknown;
};
export type PropertyPayment = {
  quoted_pence: number;
  guest_pence: number;
  covered_pence: number;
};
export type SharingLevel = "bed" | "room" | "cottage";
export type PairDecision = "yes" | "no" | "unset";
export type Allocation = {
  status: string;
  rooms: Record<string, string[]>;
  single_bed_assignments: { room_id: string; party_id: string }[];
  outside_parties: string[];
  new_cottage_bookings: string[];
  tentative_cottage_bookings: string[];
  cottage_details: Record<
    string,
    {
      availability: string;
      booking_by: "guests" | "couple";
      cost_gbp: string | null;
      discount_gbp: string | null;
    }
  >;
  couple_booking_outlay_gbp: string;
  new_couple_booking_cost_gbp: string;
  known_cottage_cost_gbp: string;
  known_outside_cost_gbp: string;
  venue_suite_package_value_gbp: string | null;
  unknown_costs: string[];
  billing: {
    total_guest_pence: number;
    venue_unrecovered_pence: number;
    cottage_subsidy_pence: number;
    guest_pence_by_party: Record<string, number>;
    member_amounts_pence_by_party: Record<string, number[]>;
    by_property: Record<string, PropertyPayment>;
  };
  cash_flow: {
    our_final_cost_pence: number;
    already_paid_pence: number;
    still_to_pay_pence: number;
    cottage_guest_reimbursements_pence: number;
    guest_direct_pence: number;
    venue_guest_contributions_pence: number;
    guest_expected_total_pence: number;
    paid_without_room_pence: number;
    outside_we_cover_pence: number;
    outside_member_amounts_pence_by_party: Record<string, number[]>;
    by_property: Record<
      string,
      {
        rent_pence: number;
        already_paid_pence: number;
        still_to_pay_pence: number;
        guest_reimbursements_pence: number;
        our_final_cost_pence: number;
      }
    >;
    outside_by_party: Record<
      string,
      {
        estimate_pence: number;
        guest_pence: number;
        covered_pence: number;
      }
    >;
  };
};
export type PartyName = {
  id: string;
  guests: string[];
  free_guest_indexes: number[];
};
export type BedGroup = { id: string; name: string; guestIds: string[] };

export type Property = {
  id: string;
  name?: string;
  room_summary?: string;
  kind: "venue" | "cottage";
  rate_per_night_gbp?: number;
  booking_cost_gbp?: number;
  couple_booking_discount_percent?: number;
  booking_by?: "couple" | "guests";
  charge_guests?: boolean;
  availability?: "unknown" | "available" | "unavailable";
  already_booked?: boolean;
  paid_by_us_gbp?: string | number;
};

export type Room = {
  id: string;
  name?: string;
  rate_group?: string;
  property_id: string;
  double_beds: number;
  single_beds?: number;
  rate_per_night_gbp?: number;
  billing_mode?: "by_bed" | "full_room" | "couple";
};

export type Party = {
  id: string;
  guests: string[];
  priority: number;
  free_guest_indexes: number[];
  requires_double_bed: boolean;
  can_share_room: boolean;
  can_share_cottage: boolean;
  outside_cost_gbp: string | number | null;
  charge_cap_exempt: boolean;
  safe_for_our_booking: boolean;
  fixed_room_id?: string;
  allowed_room_ids?: string[];
  allowed_property_ids?: string[];
  preferred_property_ids?: string[];
  allowed_room_mates?: string[];
  allowed_cottage_mates?: string[];
  avoid_room_with?: string[];
  avoid_cottage_with?: string[];
  can_share_bed_with?: string[];
};

export type PlannerInput = {
  nights: number;
  venue_lodging_value_gbp: string | number | null;
  venue_suite_package_value_gbp: string | number | null;
  max_cottage_spend_gbp: string | number | null;
  guest_charge_cap_gbp: string | number | null;
  optimization_mode: "priority_first" | "lowest_total_price";
  properties: Property[];
  rooms: Room[];
  parties: Party[];
};

export type Placement = {
  status: "optimal" | "provisional";
  stages: { stage: string; status: string }[];
  rooms: Record<string, string[]>;
  shared_beds: { room_id: string; parties: [string, string] }[];
  single_bed_assignments: { room_id: string; party_id: string }[];
  outside_parties: string[];
  booked_cottages: string[];
};
