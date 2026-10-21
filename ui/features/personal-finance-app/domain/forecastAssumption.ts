import { z } from "zod";
import { AccountIdSchema } from "./account";
import { CurrencySchema, DEFAULT_BASE_CURRENCY } from "./currency";
import { OwnershipSchema } from "./household";

const OptionalTextSchema = z.string().trim().min(1).optional();

export const ForecastAmountRangeSchema = z
  .object({
    minimum: z.number(),
    expected: z.number(),
    maximum: z.number(),
  })
  .superRefine((range, context) => {
    if (range.minimum > range.expected || range.expected > range.maximum) {
      context.addIssue({
        code: "custom",
        message:
          "Forecast amounts must run from minimum to expected to maximum",
      });
    }
  });
export type ForecastAmountRange = z.infer<typeof ForecastAmountRangeSchema>;

export const ForecastAssumptionSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("manual-take-home"),
  }),
  z.object({
    kind: z.literal("manual"),
  }),
  z.object({
    kind: z.literal("tax-derived"),
    taxYear: z.string().trim().min(1),
    calculationVersion: z.string().trim().min(1),
    ruleDatasetVersion: z.string().trim().min(1),
  }),
]);
export type ForecastAssumptionSource = z.infer<
  typeof ForecastAssumptionSourceSchema
>;

export const ForecastAssumptionBaseSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  kind: z.enum(["income", "expenditure"]),
  startDate: z.iso.date(),
  endDate: z.iso.date().optional(),
  monthlyChange: ForecastAmountRangeSchema,
  currency: CurrencySchema.default(DEFAULT_BASE_CURRENCY),
  confidence: z.number().min(0).max(1).optional(),
  ownership: OwnershipSchema,
  accountId: AccountIdSchema.optional(),
  source: ForecastAssumptionSourceSchema,
  sourceNotes: OptionalTextSchema,
});

export const ForecastAssumptionSchema =
  ForecastAssumptionBaseSchema.superRefine((assumption, context) => {
    if (
      assumption.endDate != null &&
      assumption.endDate < assumption.startDate
    ) {
      context.addIssue({
        code: "custom",
        message: "An assumption cannot end before it starts",
      });
    }
    if (assumption.kind === "income" && assumption.accountId == null) {
      context.addIssue({
        code: "custom",
        message: "An income change needs a destination account",
      });
    }
    if (
      assumption.kind === "expenditure" &&
      assumption.source.kind === "manual-take-home"
    ) {
      context.addIssue({
        code: "custom",
        message: "Manual take-home is only an income source",
      });
    }
  });
export type ForecastAssumption = z.infer<typeof ForecastAssumptionSchema>;

export const ForecastAssumptionSetSchema = z.object({
  id: z.string().trim().min(1),
  seriesId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  version: z.number().int().positive(),
  status: z.enum(["active", "superseded"]).default("active"),
  createdAt: z.iso.datetime({ offset: true }),
  supersedesId: z.string().trim().min(1).optional(),
  assumptions: z.array(ForecastAssumptionSchema).default([]),
});
export type ForecastAssumptionSet = z.infer<typeof ForecastAssumptionSetSchema>;

export function forecastAssumptionIsActive(
  assumption: ForecastAssumption,
  date: string,
): boolean {
  return (
    assumption.startDate <= date &&
    (assumption.endDate == null || date <= assumption.endDate)
  );
}

export function activeForecastAssumptions(
  sets: readonly ForecastAssumptionSet[],
  date: string,
): ForecastAssumption[] {
  return sets
    .filter(({ status }) => status === "active")
    .flatMap(({ assumptions }) => assumptions)
    .filter((assumption) => forecastAssumptionIsActive(assumption, date));
}
