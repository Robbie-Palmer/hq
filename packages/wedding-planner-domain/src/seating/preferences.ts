import { z } from "zod";
import type { PairDecision, SeatingGuest } from "./types";

export const seatingPreferencesSchema = z.object({
  prefer_table_with: z.array(z.string()).default([]),
  avoid_table_with: z.array(z.string()).default([]),
});
export const tablePlanSchema = z.object({
  table_layout: z
    .record(
      z.string().regex(/^(top|table-[1-9]\d*)$/),
      z.object({
        name: z.string().max(80).optional(),
        shape: z.enum(["round", "long"]).optional(),
        x: z.number().min(100).max(900).optional(),
        y: z.number().min(100).max(10000).optional(),
        rotation: z.number().min(0).lt(360).optional(),
      }),
    )
    .optional(),
  top_table_capacity: z.number().int().min(2).max(100),
  top_table_guest_ids: z
    .array(z.string())
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "Top table guests must be unique",
    ),
  table_capacities: z.array(z.number().int().min(1).max(100)).max(100),
});
export const seatingPlanSchema = tablePlanSchema.extend({
  top_table_guest_ids: tablePlanSchema.shape.top_table_guest_ids.default([]),
  preferences: z.record(z.string(), seatingPreferencesSchema).default({}),
  dismissed_accommodation_suggestions: z
    .array(z.tuple([z.string(), z.string()]))
    .default([]),
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
