import { z } from "zod";
import {
  AllocationRunSchema,
  MoneySchema,
  type AllocationRun,
  type Money,
  type SignedMoney,
} from "./costs";
import {
  EffectivePeriodSchema,
  IdentifierSchema,
  ProvenanceSchema,
  TimePeriodSchema,
  type EffectivePeriod,
  type TimePeriod,
} from "./model";

const AllocationEligibilitySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("layer"),
      platformId: IdentifierSchema,
      layerId: IdentifierSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("slot"),
      platformId: IdentifierSchema,
      layerId: IdentifierSchema,
      slotId: IdentifierSchema,
    })
    .strict(),
]);
export type AllocationEligibility = z.infer<
  typeof AllocationEligibilitySchema
>;

const AllocationRuleBaseSchema = z.object({
  id: IdentifierSchema,
  revision: z.number().int().positive(),
  costPoolId: IdentifierSchema,
  effectivePeriod: EffectivePeriodSchema,
  eligibility: AllocationEligibilitySchema,
  postClosurePolicy: z.enum(["exclude", "include"]),
  rationale: z.string().trim().min(1),
  provenance: ProvenanceSchema,
});

const DirectAssignmentRuleSchema = AllocationRuleBaseSchema.extend({
  method: z.literal("direct"),
  consumerId: IdentifierSchema,
}).strict();

const EqualShareRuleSchema = AllocationRuleBaseSchema.extend({
  method: z.literal("equal"),
}).strict();

const WeightSchema = z
  .object({
    consumerId: IdentifierSchema,
    weight: z.number().positive(),
  })
  .strict();

const WeightedShareRuleSchema = AllocationRuleBaseSchema.extend({
  method: z.literal("weighted"),
  weights: z.array(WeightSchema).min(1),
})
  .strict()
  .superRefine((rule, context) => {
    const consumers = new Set(rule.weights.map(({ consumerId }) => consumerId));
    if (consumers.size !== rule.weights.length) {
      context.addIssue({
        code: "custom",
        message: "A weighted allocation rule cannot repeat a consumer",
        path: ["weights"],
      });
    }
  });

const UsageShareRuleSchema = AllocationRuleBaseSchema.extend({
  method: z.literal("usage"),
  metricDefinitionId: IdentifierSchema,
  unit: IdentifierSchema,
}).strict();

export const SharedCostAllocationRuleSchema = z.discriminatedUnion("method", [
  DirectAssignmentRuleSchema,
  EqualShareRuleSchema,
  WeightedShareRuleSchema,
  UsageShareRuleSchema,
]);
export type SharedCostAllocationRule = z.infer<
  typeof SharedCostAllocationRuleSchema
>;

const LayerAdoptionSchema = z
  .object({
    kind: z.literal("layer"),
    platformId: IdentifierSchema,
    layerId: IdentifierSchema,
    effectivePeriod: EffectivePeriodSchema,
  })
  .strict();

const SlotAdoptionSchema = z
  .object({
    kind: z.literal("slot"),
    platformId: IdentifierSchema,
    layerId: IdentifierSchema,
    slotId: IdentifierSchema,
    effectivePeriod: EffectivePeriodSchema,
  })
  .strict();

export const ProjectCostAdoptionSchema = z.discriminatedUnion("kind", [
  LayerAdoptionSchema,
  SlotAdoptionSchema,
]);
export type ProjectCostAdoption = z.infer<typeof ProjectCostAdoptionSchema>;

export const ProjectLifecyclePeriodSchema = z
  .object({
    state: z.enum(["active", "closed", "archived"]),
    effectivePeriod: EffectivePeriodSchema,
  })
  .strict();
export type ProjectLifecyclePeriod = z.infer<
  typeof ProjectLifecyclePeriodSchema
>;

const UsageEvidenceSchema = z
  .object({
    quantity: z.number().nonnegative().nullable(),
    metricObservationId: IdentifierSchema.nullable(),
  })
  .strict()
  .superRefine((usage, context) => {
    if ((usage.quantity === null) !== (usage.metricObservationId === null)) {
      context.addIssue({
        code: "custom",
        message: "Usage quantity and metric observation must both be present or absent",
      });
    }
  });

export const SharedCostConsumerSchema = z
  .object({
    consumerId: IdentifierSchema,
    projectId: IdentifierSchema.nullable(),
    adoptions: z.array(ProjectCostAdoptionSchema).min(1),
    lifecycle: z.array(ProjectLifecyclePeriodSchema).min(1),
    usage: UsageEvidenceSchema.optional(),
  })
  .strict()
  .superRefine((consumer, context) => {
    validateNonOverlappingPeriods(
      consumer.lifecycle,
      ({ effectivePeriod }) => effectivePeriod,
      context,
      ["lifecycle"],
    );
  });
export type SharedCostConsumer = z.infer<typeof SharedCostConsumerSchema>;

const UsageTotalSchema = z
  .object({
    quantity: z.number().nonnegative(),
    metricObservationId: IdentifierSchema,
  })
  .strict();

export const SharedCostAllocationRequestSchema = z
  .object({
    id: IdentifierSchema,
    rule: SharedCostAllocationRuleSchema,
    period: TimePeriodSchema,
    sourceCostObservationIds: z.array(IdentifierSchema).min(1),
    amount: MoneySchema,
    effect: z.enum(["charge", "credit"]),
    consumers: z.array(SharedCostConsumerSchema),
    usageTotal: UsageTotalSchema.optional(),
    provenance: ProvenanceSchema,
  })
  .strict()
  .superRefine((request, context) => {
    const consumers = new Set(
      request.consumers.map(({ consumerId }) => consumerId),
    );
    if (consumers.size !== request.consumers.length) {
      context.addIssue({
        code: "custom",
        message: "An allocation request cannot repeat a consumer",
        path: ["consumers"],
      });
    }
    if (request.rule.method !== "usage" && request.usageTotal !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Only a usage allocation can provide total usage",
        path: ["usageTotal"],
      });
    }
  });
export type SharedCostAllocationRequest = z.infer<
  typeof SharedCostAllocationRequestSchema
>;

export interface SharedCostRuleReference {
  readonly id: string;
  readonly revision: number;
  readonly method: SharedCostAllocationRule["method"];
  readonly rationale: string;
}

export interface SharedCostProjectShare {
  readonly consumerId: string;
  readonly projectId: string | null;
  readonly amount: Money;
  readonly rule: SharedCostRuleReference;
}

export interface SharedCostAllocationReport {
  readonly allocationRunId: string;
  readonly costPoolId: string;
  readonly period: TimePeriod;
  readonly effect: "charge" | "credit";
  readonly gross: Money;
  readonly allocated: Money;
  readonly unallocated: Money;
  readonly roundingResidual: SignedMoney;
  readonly reconciles: boolean;
  readonly shares: readonly SharedCostProjectShare[];
  readonly rule: SharedCostRuleReference & {
    readonly effectivePeriod: EffectivePeriod;
    readonly eligibility: AllocationEligibility;
    readonly postClosurePolicy: "exclude" | "include";
  };
}

const amountPrecision = 1_000_000_000;

function normalizeAmount(amount: number): number {
  return Math.round(amount * amountPrecision) / amountPrecision;
}

function amountsEqual(left: number, right: number): boolean {
  return (
    Math.abs(left - right) <=
    Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * 32
  );
}

function coversPeriod(
  effectivePeriod: EffectivePeriod,
  period: TimePeriod,
): boolean {
  return (
    effectivePeriod.startsAt <= period.startsAt &&
    (effectivePeriod.endsAt === null || effectivePeriod.endsAt >= period.endsAt)
  );
}

function periodsOverlap(
  left: EffectivePeriod,
  right: EffectivePeriod,
): boolean {
  return (
    (right.endsAt === null || left.startsAt < right.endsAt) &&
    (left.endsAt === null || right.startsAt < left.endsAt)
  );
}

function validateNonOverlappingPeriods<T>(
  records: readonly T[],
  period: (record: T) => EffectivePeriod,
  context: z.RefinementCtx,
  path: PropertyKey[],
): void {
  for (let leftIndex = 0; leftIndex < records.length; leftIndex += 1) {
    const left = records[leftIndex];
    if (left === undefined) continue;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < records.length;
      rightIndex += 1
    ) {
      const right = records[rightIndex];
      if (right !== undefined && periodsOverlap(period(left), period(right))) {
        context.addIssue({
          code: "custom",
          message: "Effective periods cannot overlap",
          path,
        });
        return;
      }
    }
  }
}

function adoptionMatches(
  adoption: ProjectCostAdoption,
  eligibility: AllocationEligibility,
): boolean {
  return (
    adoption.kind === eligibility.kind &&
    adoption.platformId === eligibility.platformId &&
    adoption.layerId === eligibility.layerId &&
    (adoption.kind === "layer" ||
      (eligibility.kind === "slot" && adoption.slotId === eligibility.slotId))
  );
}

function isEligible(
  consumer: SharedCostConsumer,
  rule: SharedCostAllocationRule,
  period: TimePeriod,
): boolean {
  const hasAdoption = consumer.adoptions.some(
    (adoption) =>
      adoptionMatches(adoption, rule.eligibility) &&
      coversPeriod(adoption.effectivePeriod, period),
  );
  if (!hasAdoption) return false;

  return consumer.lifecycle.some(
    (lifecycle) =>
      coversPeriod(lifecycle.effectivePeriod, period) &&
      (lifecycle.state === "active" || rule.postClosurePolicy === "include"),
  );
}

function assertRuleEffective(
  rule: SharedCostAllocationRule,
  period: TimePeriod,
): void {
  if (!coversPeriod(rule.effectivePeriod, period)) {
    throw new Error("The shared cost allocation rule is not effective for the full period");
  }
}

interface FractionalShare {
  readonly consumer: SharedCostConsumer;
  readonly fraction: number;
}

function sharesForRequest(
  request: SharedCostAllocationRequest,
): readonly FractionalShare[] {
  const eligible = new Set(
    request.consumers
      .filter((consumer) => isEligible(consumer, request.rule, request.period))
      .map(({ consumerId }) => consumerId),
  );

  switch (request.rule.method) {
    case "direct": {
      const { consumerId: directConsumerId } = request.rule;
      const consumer = request.consumers.find(
        ({ consumerId }) => consumerId === directConsumerId,
      );
      return consumer !== undefined && eligible.has(consumer.consumerId)
        ? [{ consumer, fraction: 1 }]
        : [];
    }
    case "equal": {
      const consumers = request.consumers.filter(({ consumerId }) =>
        eligible.has(consumerId),
      );
      return consumers.map((consumer) => ({
        consumer,
        fraction: 1 / consumers.length,
      }));
    }
    case "weighted": {
      const totalWeight = request.rule.weights.reduce(
        (total, { weight }) => total + weight,
        0,
      );
      const consumersById = new Map(
        request.consumers.map((consumer) => [consumer.consumerId, consumer]),
      );
      return request.rule.weights.flatMap(({ consumerId, weight }) => {
        const consumer = consumersById.get(consumerId);
        return consumer !== undefined && eligible.has(consumerId)
          ? [{ consumer, fraction: weight / totalWeight }]
          : [];
      });
    }
    case "usage": {
      const incomplete = request.consumers.some(
        ({ usage }) =>
          usage?.quantity === undefined || usage?.quantity === null,
      );
      if (incomplete && request.usageTotal === undefined) return [];

      const observedTotal = request.consumers.reduce(
        (total, { usage }) => total + (usage?.quantity ?? 0),
        0,
      );
      const denominator = request.usageTotal?.quantity ?? observedTotal;
      if (denominator === 0) return [];
      if (observedTotal > denominator && !amountsEqual(observedTotal, denominator)) {
        throw new Error("Consumer usage cannot exceed the evidenced total usage");
      }
      return request.consumers.flatMap((consumer) => {
        const quantity = consumer.usage?.quantity;
        return quantity !== undefined &&
          quantity !== null &&
          quantity > 0 &&
          eligible.has(consumer.consumerId)
          ? [{ consumer, fraction: quantity / denominator }]
          : [];
      });
    }
  }
}

interface UnitAllocation {
  readonly consumer: SharedCostConsumer | null;
  units: number;
  readonly remainder: number;
}

function allocateUnits(
  amount: number,
  shares: readonly FractionalShare[],
): readonly UnitAllocation[] {
  const totalUnits = Math.round(amount * amountPrecision);
  if (!Number.isSafeInteger(totalUnits)) {
    throw new TypeError("The shared cost amount exceeds supported precision");
  }
  const allocatedFraction = shares.reduce(
    (total, { fraction }) => total + fraction,
    0,
  );
  if (allocatedFraction > 1 && !amountsEqual(allocatedFraction, 1)) {
    throw new Error("Allocation shares cannot exceed the gross cost");
  }

  const candidates: UnitAllocation[] = shares.map(({ consumer, fraction }) => {
    const exact = totalUnits * fraction;
    const units = Math.floor(exact);
    return { consumer, units, remainder: exact - units };
  });
  const unallocatedExact = totalUnits * Math.max(0, 1 - allocatedFraction);
  const unallocatedUnits = Math.floor(unallocatedExact);
  candidates.push({
    consumer: null,
    units: unallocatedUnits,
    remainder: unallocatedExact - unallocatedUnits,
  });

  let remaining = totalUnits - candidates.reduce((sum, item) => sum + item.units, 0);
  const remainderOrder = [...candidates].sort(
    (left, right) =>
      right.remainder - left.remainder ||
      (left.consumer?.consumerId ?? "~unallocated").localeCompare(
        right.consumer?.consumerId ?? "~unallocated",
      ),
  );
  for (const candidate of remainderOrder) {
    if (remaining === 0) break;
    candidate.units += 1;
    remaining -= 1;
  }
  return candidates;
}

export function selectSharedCostAllocationRule(
  rules: readonly SharedCostAllocationRule[],
  costPoolId: string,
  period: TimePeriod,
): SharedCostAllocationRule {
  const parsedPeriod = TimePeriodSchema.parse(period);
  const parsedRules = rules.map((rule) => SharedCostAllocationRuleSchema.parse(rule));
  const revisions = new Set<string>();
  for (const rule of parsedRules) {
    const revisionKey = `${rule.id}:${rule.revision}`;
    if (revisions.has(revisionKey)) {
      throw new Error(`Allocation rule revision '${revisionKey}' is duplicated`);
    }
    revisions.add(revisionKey);
  }
  const matches = parsedRules.filter(
    (rule) =>
      rule.costPoolId === costPoolId && coversPeriod(rule.effectivePeriod, parsedPeriod),
  );
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? "No shared cost allocation rule covers the full period"
        : "Multiple shared cost allocation rules cover the full period",
    );
  }
  const match = matches[0];
  if (match === undefined) {
    throw new Error("No shared cost allocation rule covers the full period");
  }
  return match;
}

export function allocateSharedCost(
  input: SharedCostAllocationRequest,
): AllocationRun {
  const request = SharedCostAllocationRequestSchema.parse(input);
  assertRuleEffective(request.rule, request.period);
  const shares = sharesForRequest(request);
  const allocations = allocateUnits(request.amount.amount, shares);
  const outputs: AllocationRun["outputs"] = allocations
    .filter(
      ({ consumer, units }) =>
        consumer !== null || units > 0 || allocations.length === 1,
    )
    .map(({ consumer, units }) => ({
      kind: consumer === null ? "unallocated" : "allocated",
      consumerId: consumer?.consumerId ?? null,
      projectId: consumer?.projectId ?? null,
      amount: {
        currency: request.amount.currency,
        amount: normalizeAmount(units / amountPrecision),
      },
    }));

  return AllocationRunSchema.parse({
    id: request.id,
    costPoolId: request.rule.costPoolId,
    ruleId: request.rule.id,
    ruleRevision: request.rule.revision,
    period: request.period,
    sourceCostObservationIds: request.sourceCostObservationIds,
    amount: request.amount,
    effect: request.effect,
    inputs: request.consumers.map((consumer) => ({
      consumerId: consumer.consumerId,
      projectId: consumer.projectId,
      quantity: consumer.usage?.quantity ?? null,
      metricObservationId: consumer.usage?.metricObservationId ?? null,
    })),
    outputs,
    roundingResidual: {
      currency: request.amount.currency,
      amount: 0,
    },
    provenance: request.provenance,
  });
}

export function reportSharedCostAllocation(
  runInput: AllocationRun,
  ruleInput: SharedCostAllocationRule,
): SharedCostAllocationReport {
  const run = AllocationRunSchema.parse(runInput);
  const rule = SharedCostAllocationRuleSchema.parse(ruleInput);
  if (
    run.costPoolId !== rule.costPoolId ||
    run.ruleId !== rule.id ||
    run.ruleRevision !== rule.revision
  ) {
    throw new Error("The allocation run does not reference this rule revision");
  }
  assertRuleEffective(rule, run.period);

  const allocatedAmount = normalizeAmount(
    run.outputs
      .filter(({ kind }) => kind === "allocated")
      .reduce((total, output) => total + output.amount.amount, 0),
  );
  const unallocatedAmount = normalizeAmount(
    run.outputs
      .filter(({ kind }) => kind === "unallocated")
      .reduce((total, output) => total + output.amount.amount, 0),
  );
  const ruleReference: SharedCostRuleReference = {
    id: rule.id,
    revision: rule.revision,
    method: rule.method,
    rationale: rule.rationale,
  };
  const reconciledAmount = normalizeAmount(
    allocatedAmount + unallocatedAmount + run.roundingResidual.amount,
  );

  return {
    allocationRunId: run.id,
    costPoolId: run.costPoolId,
    period: run.period,
    effect: run.effect,
    gross: run.amount,
    allocated: { currency: run.amount.currency, amount: allocatedAmount },
    unallocated: { currency: run.amount.currency, amount: unallocatedAmount },
    roundingResidual: run.roundingResidual,
    reconciles: amountsEqual(reconciledAmount, run.amount.amount),
    shares: run.outputs.flatMap((output) =>
      output.kind === "allocated" && output.consumerId !== null
        ? [
            {
              consumerId: output.consumerId,
              projectId: output.projectId,
              amount: output.amount,
              rule: ruleReference,
            },
          ]
        : [],
    ),
    rule: {
      ...ruleReference,
      effectivePeriod: rule.effectivePeriod,
      eligibility: rule.eligibility,
      postClosurePolicy: rule.postClosurePolicy,
    },
  };
}
