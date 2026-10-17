import { z } from "zod";
import { CurrencySchema, DEFAULT_BASE_CURRENCY } from "./currency";
import { OwnershipSchema } from "./household";

const OptionalTextSchema = z.string().trim().min(1).optional();

export const SPENDING_BASELINE_SERIES_ID = "household-spending";

export const SpendingBaselineSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("manual") }),
  z.object({
    kind: z.literal("reconciled"),
    periodStartDate: z.iso.date(),
    periodEndDate: z.iso.date(),
  }),
]);
export type SpendingBaselineSource = z.infer<
  typeof SpendingBaselineSourceSchema
>;

const SpendingBaselineShapeSchema = z.object({
  id: z.string().trim().min(1),
  seriesId: z.string().trim().min(1),
  version: z.number().int().positive(),
  status: z.enum(["active", "superseded"]),
  effectiveDate: z.iso.date(),
  annualEssentialSpending: z.number().nonnegative(),
  annualDiscretionarySpending: z.number().nonnegative(),
  annualDebtCashFlow: z.number().nonnegative(),
  currency: CurrencySchema.default(DEFAULT_BASE_CURRENCY),
  ownership: OwnershipSchema,
  source: SpendingBaselineSourceSchema,
  sourceNotes: OptionalTextSchema,
  createdAt: z.iso.datetime({ offset: true }),
  supersedesId: z.string().trim().min(1).optional(),
});

function validateReconciliationPeriod(
  baseline: { source: SpendingBaselineSource },
  context: z.RefinementCtx,
) {
  if (
    baseline.source.kind === "reconciled" &&
    baseline.source.periodStartDate > baseline.source.periodEndDate
  ) {
    context.addIssue({
      code: "custom",
      message: "The reconciliation period cannot end before it starts",
      path: ["source", "periodEndDate"],
    });
  }
}

export const SpendingBaselineSchema = SpendingBaselineShapeSchema.superRefine(
  validateReconciliationPeriod,
);
export type SpendingBaseline = z.infer<typeof SpendingBaselineSchema>;

export const SaveSpendingBaselineInputSchema = SpendingBaselineShapeSchema.omit(
  {
    id: true,
    seriesId: true,
    version: true,
    status: true,
    createdAt: true,
    supersedesId: true,
  },
).superRefine(validateReconciliationPeriod);
export type SaveSpendingBaselineInput = z.input<
  typeof SaveSpendingBaselineInputSchema
>;

export function annualOrdinarySpending(
  baseline: Pick<
    SpendingBaseline,
    "annualEssentialSpending" | "annualDiscretionarySpending"
  >,
): number {
  return (
    baseline.annualEssentialSpending + baseline.annualDiscretionarySpending
  );
}

export function annualCurrentSpending(
  baseline: Pick<
    SpendingBaseline,
    | "annualEssentialSpending"
    | "annualDiscretionarySpending"
    | "annualDebtCashFlow"
  >,
): number {
  return annualOrdinarySpending(baseline) + baseline.annualDebtCashFlow;
}

export function activeSpendingBaseline(
  baselines: readonly SpendingBaseline[],
  date: string,
): SpendingBaseline | null {
  return (
    baselines
      .filter(
        (baseline) =>
          baseline.status === "active" && baseline.effectiveDate <= date,
      )
      .toSorted(
        (left, right) =>
          right.effectiveDate.localeCompare(left.effectiveDate) ||
          right.version - left.version,
      )[0] ?? null
  );
}
