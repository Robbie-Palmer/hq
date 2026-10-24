import { z } from "zod";
import type { PairDecision, SeatingGuest, TableAllocation } from "./types";

export const seatingPreferencesSchema = z.object({
  prefer_table_with: z.array(z.string()).default([]),
  avoid_table_with: z.array(z.string()).default([]),
});
export const tablePlanSchema = z.object({
  event_id: z.string().min(1).optional(),
  table_layout: z
    .record(
      z.string().regex(/^(top|table-[1-9]\d*)$/),
      z.object({
        name: z.string().max(80).optional(),
        shape: z.enum(["round", "long"]).optional(),
        x: z.number().min(100).max(900).optional(),
        y: z.number().min(100).max(10000).optional(),
        rotation: z.number().min(0).lt(360).optional(),
        accessible_seat_indexes: z
          .array(z.number().int().min(0).max(99))
          .default([]),
        high_chair_seat_indexes: z
          .array(z.number().int().min(0).max(99))
          .default([]),
      }),
    )
    .optional(),
  venue_elements: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1).max(80),
        kind: z.enum([
          "dance_floor",
          "stage",
          "bar",
          "door",
          "pillar",
          "other",
        ]),
        x: z.number().min(0).max(1000),
        y: z.number().min(0).max(10000),
        width: z.number().positive().max(1000),
        height: z.number().positive().max(10000),
        rotation: z.number().min(0).lt(360).default(0),
      }),
    )
    .default([]),
  top_table_capacity: z.number().int().min(2).max(100),
  top_table_guest_ids: z
    .array(z.string())
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "Top table guests must be unique",
    ),
  table_capacities: z.array(z.number().int().min(1).max(100)).max(100),
  locked_assignments: z
    .record(
      z.string(),
      z.object({
        table_id: z.string().regex(/^(top|table-[1-9]\d*)$/),
        seat_index: z.number().int().min(0).max(99).optional(),
      }),
    )
    .default({}),
  locked_table_guest_ids: z
    .record(z.string().regex(/^(top|table-[1-9]\d*)$/), z.array(z.string()))
    .default({}),
  role_table_preferences: z
    .record(z.string(), z.array(z.string().regex(/^(top|table-[1-9]\d*)$/)))
    .default({}),
  relationship_group_table_preferences: z
    .record(z.string(), z.array(z.string().regex(/^(top|table-[1-9]\d*)$/)))
    .default({}),
  keep_invitation_parties_together: z.boolean().default(false),
  keep_relationship_groups_together: z.array(z.string()).default([]),
});
export const seatingPlanSchema = tablePlanSchema.extend({
  top_table_guest_ids: tablePlanSchema.shape.top_table_guest_ids.default([]),
  preferences: z.record(z.string(), seatingPreferencesSchema).default({}),
  dismissed_accommodation_suggestions: z
    .array(z.tuple([z.string(), z.string()]))
    .default([]),
  saved_plans: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1).max(80),
        event_id: z.string().min(1).optional(),
        created_at: z.iso.datetime({ offset: true }),
        allocation: z.custom<TableAllocation>((value) => {
          if (!value || typeof value !== "object") return false;
          const allocation = value as Partial<TableAllocation>;
          return (
            (allocation.status === "optimal" ||
              allocation.status === "provisional") &&
            Array.isArray(allocation.tables) &&
            Array.isArray(allocation.explanations) &&
            Array.isArray(allocation.unsatisfied_preferences)
          );
        }, "Saved table plan is invalid"),
      }),
    )
    .default([]),
  chosen_plan_id: z.string().optional(),
});

export function tablePairDecision(
  first: Pick<SeatingGuest, "id" | "prefer_table_with" | "avoid_table_with">,
  second: Pick<SeatingGuest, "id" | "prefer_table_with" | "avoid_table_with">,
): PairDecision {
  if (
    first.avoid_table_with.includes(second.id) ||
    second.avoid_table_with.includes(first.id)
  )
    return "no";
  if (
    first.prefer_table_with.includes(second.id) ||
    second.prefer_table_with.includes(first.id)
  )
    return "yes";
  return "unset";
}
