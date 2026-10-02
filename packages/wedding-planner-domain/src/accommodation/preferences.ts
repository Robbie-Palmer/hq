import { z } from "zod";
import { parseMoneyToMinorUnits } from "../money";
import {
  BookingPartySchema,
  FreeStayReasonSchema,
  OptimizationModeSchema,
  OvernightStatusSchema,
  PropertyAvailabilitySchema,
  RoomBillingModeSchema,
  ShareModeSchema,
} from "../values";

const ids = z.array(z.string());
const money = z.string().refine((value) => {
  try {
    parseMoneyToMinorUnits(value, "Amount");
    return true;
  } catch {
    return false;
  }
}, "Amount must be non-negative with no more than two decimal places");

export const accommodationPreferencesSchema = z.object({
  overnight: OvernightStatusSchema.default("unknown"),
  fixed_bed_group_id: z.string().default(""),
  requires_own_bed: z.boolean().default(false),
  safe_for_our_booking: z.boolean().default(false),
  may_share_bed_with: ids.default([]),
  avoid_bed_with: ids.default([]),
  can_share_room: z.boolean().default(false),
  room_share_mode: ShareModeSchema.default("none"),
  may_share_room_with: ids.default([]),
  can_share_cottage: z.boolean().default(true),
  cottage_share_mode: ShareModeSchema.default("any"),
  may_share_cottage_with: ids.default([]),
  avoid_room_with: ids.default([]),
  avoid_cottage_with: ids.default([]),
  priority: z.number().int().min(0).default(3),
  fixed_room_id: z.string().default(""),
  preferred_property_ids: ids.default([]),
  outside_cost_gbp: money.default(""),
  charge_cap_exempt: z.boolean().default(false),
  free_stay_reasons: z.array(FreeStayReasonSchema).default([]),
  include_partner_in_free_stay: z.boolean().default(true),
});
export type AccommodationPreferences = z.infer<
  typeof accommodationPreferencesSchema
>;

export const accommodationPlanSchema = z.object({
  nights: z.number().int().positive().default(1),
  guests: z.record(z.string(), accommodationPreferencesSchema).default({}),
  payment_modes: z.record(z.string(), BookingPartySchema).default({}),
  cottage_options: z
    .record(
      z.string(),
      z.object({
        availability: PropertyAvailabilitySchema,
        booking_by: BookingPartySchema,
      }),
    )
    .default({}),
  reservations: z
    .record(z.string(), z.object({ guest_ids: ids, approved_guest_ids: ids }))
    .default({}),
  suite_billing_modes: z.record(z.string(), RoomBillingModeSchema).default({}),
  cottage_paid_by_us_gbp: z
    .record(
      z.string(),
      z.union([money, z.number().nonnegative()]).transform(String),
    )
    .default({}),
  guest_charge_cap_gbp: money.default(""),
  max_cottage_spend_gbp: money.default(""),
  default_outside_cost_gbp: money.default(""),
  optimization_mode: OptimizationModeSchema.default("priority_first"),
});
export type AccommodationPlan = z.infer<typeof accommodationPlanSchema>;
