import { z } from "zod";
import {
  BillingPeriodSchema,
  EffectivePeriodSchema,
  IdentifierSchema,
  type Provenance,
  ProvenanceSchema,
  selectLatestSourceRevisions,
  TimePeriodSchema,
  TimestampSchema,
} from "./model";

export const CurrencySchema = z.string().regex(/^[A-Z]{3}$/);

export const MoneySchema = z
  .object({
    currency: CurrencySchema,
    amount: z.number().finite().nonnegative(),
  })
  .strict();
export type Money = z.infer<typeof MoneySchema>;

export const SignedMoneySchema = z
  .object({
    currency: CurrencySchema,
    amount: z.number().finite(),
  })
  .strict();
export type SignedMoney = z.infer<typeof SignedMoneySchema>;

export const CostBasisSchema = z.enum(["actual", "estimated", "forecast"]);
export type CostBasis = z.infer<typeof CostBasisSchema>;

export const ChargeModelSchema = z.enum([
  "recurring",
  "usage",
  "one-off",
]);

const CostObservationBaseSchema = z.object({
  id: IdentifierSchema,
  providerAccountId: IdentifierSchema,
  billingPeriodId: BillingPeriodSchema.shape.id,
  servicePeriod: TimePeriodSchema,
  amount: MoneySchema,
  effect: z.enum(["charge", "credit"]),
  basis: CostBasisSchema,
  chargeModel: ChargeModelSchema,
  taxTreatment: z.enum(["included", "excluded", "unknown"]),
  purpose: IdentifierSchema,
  provenance: ProvenanceSchema,
  correctsCostObservationId: IdentifierSchema.nullable(),
});

const DirectCostObservationSchema = CostObservationBaseSchema.extend({
  kind: z.literal("direct"),
  projectId: IdentifierSchema,
}).strict();

const SharedCostObservationSchema = CostObservationBaseSchema.extend({
  kind: z.literal("shared"),
  costPoolId: IdentifierSchema,
}).strict();

const AllocatedCostObservationSchema = CostObservationBaseSchema.extend({
  kind: z.literal("allocated"),
  projectId: IdentifierSchema,
  costPoolId: IdentifierSchema,
  allocationRunId: IdentifierSchema,
}).strict();

const UnallocatedCostObservationSchema = CostObservationBaseSchema.extend({
  kind: z.literal("unallocated"),
  costPoolId: IdentifierSchema,
  allocationRunId: IdentifierSchema,
}).strict();

const ExcludedCostObservationSchema = CostObservationBaseSchema.extend({
  kind: z.literal("excluded"),
  projectId: IdentifierSchema.nullable(),
  costPoolId: IdentifierSchema.nullable(),
  reason: z.string().trim().min(1),
}).strict();

export const CostObservationSchema = z.discriminatedUnion("kind", [
  DirectCostObservationSchema,
  SharedCostObservationSchema,
  AllocatedCostObservationSchema,
  UnallocatedCostObservationSchema,
  ExcludedCostObservationSchema,
]);
export type CostObservation = z.infer<typeof CostObservationSchema>;
type ProjectCostObservation = Extract<
  CostObservation,
  { readonly kind: "direct" | "allocated" }
>;

export const CostPoolSchema = z
  .object({
    id: IdentifierSchema,
    platformId: IdentifierSchema,
    name: z.string().trim().min(1),
    effectivePeriod: EffectivePeriodSchema,
    provenance: ProvenanceSchema,
  })
  .strict();
export type CostPool = z.infer<typeof CostPoolSchema>;

const AllocationRuleBaseSchema = z.object({
  id: IdentifierSchema,
  revision: z.number().int().positive(),
  costPoolId: IdentifierSchema,
  effectivePeriod: EffectivePeriodSchema,
  rationale: z.string().trim().min(1),
  provenance: ProvenanceSchema,
});

const FixedShareSchema = z
  .object({
    consumerId: IdentifierSchema,
    projectId: IdentifierSchema.nullable(),
    share: z.number().finite().positive().max(1),
  })
  .strict();

const FixedAllocationRuleSchema = AllocationRuleBaseSchema.extend({
  method: z.literal("fixed-share"),
  shares: z.array(FixedShareSchema).min(1),
})
  .strict()
  .superRefine((rule, context) => {
    const consumers = new Set(rule.shares.map(({ consumerId }) => consumerId));
    if (consumers.size !== rule.shares.length) {
      context.addIssue({
        code: "custom",
        message: "A fixed allocation rule cannot repeat a consumer",
        path: ["shares"],
      });
    }
    const total = rule.shares.reduce((sum, { share }) => sum + share, 0);
    if (total > 1 + Number.EPSILON * rule.shares.length) {
      context.addIssue({
        code: "custom",
        message: "Fixed allocation shares cannot exceed one",
        path: ["shares"],
      });
    }
  });

const ConsumptionAllocationRuleSchema = AllocationRuleBaseSchema.extend({
  method: z.literal("consumption"),
  metricDefinitionId: IdentifierSchema,
  unit: IdentifierSchema,
})
  .strict();

export const AllocationRuleSchema = z.union([
  FixedAllocationRuleSchema,
  ConsumptionAllocationRuleSchema,
]);
export type AllocationRule = z.infer<typeof AllocationRuleSchema>;

const AllocationInputSchema = z
  .object({
    consumerId: IdentifierSchema,
    projectId: IdentifierSchema.nullable(),
    quantity: z.number().finite().nonnegative().nullable(),
    metricObservationId: IdentifierSchema.nullable(),
  })
  .strict();

const AllocationOutputSchema = z
  .object({
    kind: z.enum(["allocated", "unallocated"]),
    consumerId: IdentifierSchema.nullable(),
    projectId: IdentifierSchema.nullable(),
    amount: MoneySchema,
  })
  .strict()
  .superRefine((output, context) => {
    if (output.kind === "allocated" && output.consumerId === null) {
      context.addIssue({
        code: "custom",
        message: "An allocated output needs a consumer",
        path: ["consumerId"],
      });
    }
    if (
      output.kind === "unallocated" &&
      (output.consumerId !== null || output.projectId !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "An unallocated output cannot name a consumer or project",
        path: ["consumerId"],
      });
    }
  });

export const AllocationRunSchema = z
  .object({
    id: IdentifierSchema,
    costPoolId: IdentifierSchema,
    ruleId: IdentifierSchema,
    ruleRevision: z.number().int().positive(),
    period: TimePeriodSchema,
    sourceCostObservationIds: z.array(IdentifierSchema).min(1),
    amount: MoneySchema,
    effect: z.enum(["charge", "credit"]),
    inputs: z.array(AllocationInputSchema),
    outputs: z.array(AllocationOutputSchema).min(1),
    roundingResidual: SignedMoneySchema,
    provenance: ProvenanceSchema,
  })
  .strict()
  .superRefine((run, context) => {
    const inputConsumers = new Set(run.inputs.map(({ consumerId }) => consumerId));
    if (inputConsumers.size !== run.inputs.length) {
      context.addIssue({
        code: "custom",
        message: "An allocation run cannot repeat an input consumer",
        path: ["inputs"],
      });
    }
    const currencies = new Set([
      run.amount.currency,
      run.roundingResidual.currency,
      ...run.outputs.map(({ amount }) => amount.currency),
    ]);
    if (currencies.size !== 1) {
      context.addIssue({
        code: "custom",
        message: "An allocation run must use one billed currency",
        path: ["outputs"],
      });
      return;
    }
    const outputTotal = run.outputs.reduce(
      (sum, output) => sum + output.amount.amount,
      0,
    );
    if (!amountsEqual(outputTotal + run.roundingResidual.amount, run.amount.amount)) {
      context.addIssue({
        code: "custom",
        message: "Allocation outputs and rounding residual must reconcile to the pool amount",
        path: ["outputs"],
      });
    }
  });
export type AllocationRun = z.infer<typeof AllocationRunSchema>;

const CumulativeCostQuerySchema = z
  .object({
    projectId: IdentifierSchema,
    period: TimePeriodSchema,
    asOf: TimestampSchema.optional(),
  })
  .strict();
export type CumulativeCostQuery = z.infer<typeof CumulativeCostQuerySchema>;

export interface CostContribution {
  readonly observationId: string;
  readonly kind: "direct" | "allocated";
  readonly basis: CostBasis;
  readonly amount: SignedMoney;
  readonly provenance: {
    readonly sourceIdentity: string;
    readonly sourceRevision: string;
    readonly ingestionRunId: string;
    readonly methodId: string;
    readonly methodVersion: string;
  };
}

export interface CumulativeCostTotal {
  readonly currency: string;
  readonly amount: number;
  readonly byBasis: Readonly<Record<CostBasis, number>>;
  readonly byAttribution: Readonly<Record<"direct" | "allocated", number>>;
}

export interface CumulativeCostResult {
  readonly projectId: string;
  readonly period: z.infer<typeof TimePeriodSchema>;
  readonly totals: readonly CumulativeCostTotal[];
  readonly contributions: readonly CostContribution[];
}

const amountPrecision = 1_000_000_000;

const normalizeAmount = (amount: number): number =>
  Math.round(amount * amountPrecision) / amountPrecision;

const amountsEqual = (left: number, right: number): boolean =>
  Math.abs(left - right) <=
  Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * 32;

const signedAmount = (observation: CostObservation): number =>
  observation.effect === "credit"
    ? -observation.amount.amount
    : observation.amount.amount;

const isProjectContribution = (
  observation: CostObservation,
  projectId: string,
): observation is ProjectCostObservation =>
  (observation.kind === "direct" || observation.kind === "allocated") &&
  observation.projectId === projectId;

export function queryCumulativeProjectCost(
  records: readonly CostObservation[],
  input: CumulativeCostQuery,
): CumulativeCostResult {
  const query = CumulativeCostQuerySchema.parse(input);
  const observations = records.map((record) => CostObservationSchema.parse(record));
  const current = selectLatestSourceRevisions(observations, query.asOf);
  const contributions = current
    .filter(
      (observation): observation is ProjectCostObservation =>
        isProjectContribution(observation, query.projectId) &&
        observation.servicePeriod.startsAt >= query.period.startsAt &&
        observation.servicePeriod.endsAt <= query.period.endsAt,
    )
    .map((observation): CostContribution => ({
      observationId: observation.id,
      kind: observation.kind,
      basis: observation.basis,
      amount: {
        currency: observation.amount.currency,
        amount: signedAmount(observation),
      },
      provenance: {
        sourceIdentity: JSON.stringify(observation.provenance.source.identity),
        sourceRevision: observation.provenance.source.revision,
        ingestionRunId: observation.provenance.source.ingestionRunId,
        methodId: observation.provenance.method.id,
        methodVersion: observation.provenance.method.version,
      },
    }))
    .sort(
      (left, right) =>
        left.amount.currency.localeCompare(right.amount.currency) ||
        left.observationId.localeCompare(right.observationId),
    );

  const totals = new Map<string, CumulativeCostTotal>();
  for (const contribution of contributions) {
    const currency = contribution.amount.currency;
    const existing = totals.get(currency) ?? {
      currency,
      amount: 0,
      byBasis: { actual: 0, estimated: 0, forecast: 0 },
      byAttribution: { direct: 0, allocated: 0 },
    };
    const amount = contribution.amount.amount;
    totals.set(currency, {
      currency,
      amount: normalizeAmount(existing.amount + amount),
      byBasis: {
        ...existing.byBasis,
        [contribution.basis]: normalizeAmount(
          existing.byBasis[contribution.basis] + amount,
        ),
      },
      byAttribution: {
        ...existing.byAttribution,
        [contribution.kind]: normalizeAmount(
          existing.byAttribution[contribution.kind] + amount,
        ),
      },
    });
  }

  return {
    projectId: query.projectId,
    period: query.period,
    totals: [...totals.values()].sort((left, right) =>
      left.currency.localeCompare(right.currency),
    ),
    contributions,
  };
}

export function validateAllocationRuleForPeriod(
  rule: AllocationRule,
  period: z.infer<typeof TimePeriodSchema>,
): AllocationRule {
  const parsedRule = AllocationRuleSchema.parse(rule);
  const parsedPeriod = TimePeriodSchema.parse(period);
  if (
    parsedRule.effectivePeriod.startsAt > parsedPeriod.startsAt ||
    (parsedRule.effectivePeriod.endsAt !== null &&
      parsedRule.effectivePeriod.endsAt < parsedPeriod.endsAt)
  ) {
    throw new Error("The allocation rule is not effective for the full period");
  }
  return parsedRule;
}

export type { Provenance };
