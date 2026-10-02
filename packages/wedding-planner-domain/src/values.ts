import { z } from "zod";

export const OVERNIGHT_STATUSES = ["unknown", "yes", "no"] as const;
export const OvernightStatusSchema = z.enum(OVERNIGHT_STATUSES);
export type OvernightStatus = z.infer<typeof OvernightStatusSchema>;

export const SHARE_MODES = ["none", "selected", "any"] as const;
export const ShareModeSchema = z.enum(SHARE_MODES);
export type ShareMode = z.infer<typeof ShareModeSchema>;

export const FREE_STAY_REASONS = [
  "immediate_family",
  "wedding_party",
  "other",
] as const;
export const FreeStayReasonSchema = z.enum(FREE_STAY_REASONS);
export type FreeStayReason = z.infer<typeof FreeStayReasonSchema>;

export const PROPERTY_AVAILABILITIES = [
  "unknown",
  "available",
  "unavailable",
] as const;
export const PropertyAvailabilitySchema = z.enum(PROPERTY_AVAILABILITIES);
export type PropertyAvailability = z.infer<typeof PropertyAvailabilitySchema>;

export const BOOKING_PARTIES = ["guests", "couple"] as const;
export const BookingPartySchema = z.enum(BOOKING_PARTIES);
export type BookingParty = z.infer<typeof BookingPartySchema>;

export const OPTIMIZATION_MODES = [
  "priority_first",
  "lowest_total_price",
] as const;
export const OptimizationModeSchema = z.enum(OPTIMIZATION_MODES);
export type OptimizationMode = z.infer<typeof OptimizationModeSchema>;

export const ROOM_BILLING_MODES = ["by_bed", "full_room", "couple"] as const;
export const RoomBillingModeSchema = z.enum(ROOM_BILLING_MODES);
export type RoomBillingMode = z.infer<typeof RoomBillingModeSchema>;

export const PROPERTY_KINDS = ["venue", "cottage"] as const;
export const PropertyKindSchema = z.enum(PROPERTY_KINDS);
export type PropertyKind = z.infer<typeof PropertyKindSchema>;

export const SHARING_LEVELS = ["bed", "room", "cottage"] as const;
export const SharingLevelSchema = z.enum(SHARING_LEVELS);
export type SharingLevel = z.infer<typeof SharingLevelSchema>;

export const PAIR_DECISIONS = ["yes", "no", "unset"] as const;
export const PairDecisionSchema = z.enum(PAIR_DECISIONS);
export type PairDecision = z.infer<typeof PairDecisionSchema>;

export const PLACEMENT_STATUSES = ["optimal", "provisional"] as const;
export const PlacementStatusSchema = z.enum(PLACEMENT_STATUSES);
export type PlacementStatus = z.infer<typeof PlacementStatusSchema>;

export const UNKNOWN_COST_KINDS = ["cottage", "outside"] as const;
export const UnknownCostKindSchema = z.enum(UNKNOWN_COST_KINDS);
export type UnknownCostKind = z.infer<typeof UnknownCostKindSchema>;
