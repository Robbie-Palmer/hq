import { describe, expect, it } from "vitest";
import {
  AllocationRuleSchema,
  AllocationRunSchema,
  CostObservationSchema,
  queryCumulativeProjectCost,
  validateAllocationRuleForPeriod,
  type CostObservation,
} from "../src/costs";
import { period, provenance } from "./fixtures";

const baseCost = {
  providerAccountId: "account:primary",
  billingPeriodId: "billing:2026-01",
  servicePeriod: period,
  effect: "charge" as const,
  basis: "actual" as const,
  chargeModel: "usage" as const,
  taxTreatment: "included" as const,
  purpose: "hosting",
  correctsCostObservationId: null,
};

function cost(candidate: unknown): CostObservation {
  return CostObservationSchema.parse(candidate);
}

describe("cost observations", () => {
  it("keeps attribution, certainty, credits, and currencies separate", () => {
    const records = [
      cost({
        ...baseCost,
        id: "cost:direct",
        kind: "direct",
        projectId: "project:site",
        amount: { currency: "USD", amount: 100 },
        provenance: provenance("cost:direct"),
      }),
      cost({
        ...baseCost,
        id: "cost:allocated",
        kind: "allocated",
        projectId: "project:site",
        costPoolId: "pool:platform",
        allocationRunId: "allocation:1",
        basis: "estimated",
        amount: { currency: "USD", amount: 20 },
        provenance: provenance("cost:allocated"),
      }),
      cost({
        ...baseCost,
        id: "cost:credit",
        kind: "direct",
        projectId: "project:site",
        effect: "credit",
        chargeModel: "one-off",
        amount: { currency: "USD", amount: 5 },
        provenance: provenance("cost:credit"),
      }),
      cost({
        ...baseCost,
        id: "cost:forecast",
        kind: "direct",
        projectId: "project:site",
        basis: "forecast",
        chargeModel: "recurring",
        amount: { currency: "USD", amount: 7 },
        provenance: provenance("cost:forecast"),
      }),
      cost({
        ...baseCost,
        id: "cost:gbp",
        kind: "direct",
        projectId: "project:site",
        amount: { currency: "GBP", amount: 10 },
        provenance: provenance("cost:gbp"),
      }),
      cost({
        ...baseCost,
        id: "cost:shared",
        kind: "shared",
        costPoolId: "pool:platform",
        amount: { currency: "USD", amount: 80 },
        provenance: provenance("cost:shared"),
      }),
      cost({
        ...baseCost,
        id: "cost:unallocated",
        kind: "unallocated",
        costPoolId: "pool:platform",
        allocationRunId: "allocation:1",
        amount: { currency: "USD", amount: 60 },
        provenance: provenance("cost:unallocated"),
      }),
      cost({
        ...baseCost,
        id: "cost:excluded",
        kind: "excluded",
        projectId: "project:site",
        costPoolId: null,
        reason: "Labour is outside operating cost.",
        amount: { currency: "USD", amount: 1_000 },
        provenance: provenance("cost:excluded"),
      }),
    ];

    const result = queryCumulativeProjectCost(records, {
      projectId: "project:site",
      period,
    });

    expect(result.totals).toEqual([
      {
        currency: "GBP",
        amount: 10,
        byBasis: { actual: 10, estimated: 0, forecast: 0 },
        byAttribution: { direct: 10, allocated: 0 },
      },
      {
        currency: "USD",
        amount: 122,
        byBasis: { actual: 95, estimated: 20, forecast: 7 },
        byAttribution: { direct: 102, allocated: 20 },
      },
    ]);
    expect(result.contributions.map(({ observationId }) => observationId)).not.toContain(
      "cost:shared",
    );
    expect(result.contributions[0]?.provenance).toMatchObject({
      ingestionRunId: "run:1",
      methodId: "collector:billing",
      sourceRevision: "1",
    });
  });

  it("uses the latest source revision and supports historical as-of queries", () => {
    const original = cost({
      ...baseCost,
      id: "cost:original",
      kind: "direct",
      projectId: "project:site",
      amount: { currency: "USD", amount: 100 },
      provenance: provenance("invoice:line-1"),
    });
    const correction = cost({
      ...baseCost,
      id: "cost:correction",
      kind: "direct",
      projectId: "project:site",
      amount: { currency: "USD", amount: 120 },
      correctsCostObservationId: "cost:original",
      provenance: provenance(
        "invoice:line-1",
        "2",
        "2026-02-10T00:00:00.000Z",
        "2026-02-11T00:00:00.000Z",
      ),
    });

    expect(
      queryCumulativeProjectCost([original, correction], {
        projectId: "project:site",
        period,
      }).totals[0]?.amount,
    ).toBe(120);
    expect(
      queryCumulativeProjectCost([original, correction], {
        projectId: "project:site",
        period,
        asOf: "2026-02-05T00:00:00.000Z",
      }).totals[0]?.amount,
    ).toBe(100);
  });

  it("filters by project and enclosed service period and orders contributions", () => {
    const directCost = (
      id: string,
      projectId: string,
      servicePeriod: CostObservation["servicePeriod"],
    ): CostObservation =>
      cost({
        ...baseCost,
        id,
        kind: "direct",
        projectId,
        servicePeriod,
        amount: { currency: "USD", amount: 1 },
        provenance: provenance(id),
      });
    const records = [
      directCost("cost:z", "project:site", period),
      directCost("cost:wrong-project", "project:api", period),
      directCost("cost:a", "project:site", period),
      directCost("cost:starts-before", "project:site", {
        startsAt: "2025-12-31T00:00:00.000Z",
        endsAt: "2026-01-31T00:00:00.000Z",
      }),
      directCost("cost:ends-after", "project:site", {
        startsAt: "2026-01-02T00:00:00.000Z",
        endsAt: "2026-02-02T00:00:00.000Z",
      }),
    ];

    const result = queryCumulativeProjectCost(records, {
      projectId: "project:site",
      period,
    });

    expect(result.contributions.map(({ observationId }) => observationId)).toEqual([
      "cost:a",
      "cost:z",
    ]);
    expect(result.totals[0]?.amount).toBe(2);
  });
});

describe("shared cost allocation", () => {
  const fixedRule = AllocationRuleSchema.parse({
    id: "rule:fixed",
    revision: 1,
    costPoolId: "pool:platform",
    method: "fixed-share",
    effectivePeriod: {
      startsAt: "2026-01-01T00:00:00.000Z",
      endsAt: "2026-04-01T00:00:00.000Z",
    },
    rationale: "Approved while provider usage is unavailable.",
    shares: [
      { consumerId: "consumer:site", projectId: "project:site", share: 0.7 },
      { consumerId: "consumer:private", projectId: null, share: 0.2 },
    ],
    provenance: provenance("rule:fixed"),
  });

  it("supports effective fixed and consumption rules", () => {
    expect(validateAllocationRuleForPeriod(fixedRule, period)).toEqual(fixedRule);
    expect(
      validateAllocationRuleForPeriod(fixedRule, {
        startsAt: "2026-01-01T00:00:00.000Z",
        endsAt: "2026-04-01T00:00:00.000Z",
      }),
    ).toEqual(fixedRule);
    expect(
      AllocationRuleSchema.parse({
        id: "rule:usage",
        revision: 1,
        costPoolId: "pool:platform",
        method: "consumption",
        effectivePeriod: {
          startsAt: "2026-01-01T00:00:00.000Z",
          endsAt: "2026-04-01T00:00:00.000Z",
        },
        rationale: "Allocate from provider usage.",
        metricDefinitionId: "metric:requests",
        unit: "request",
        provenance: provenance("rule:usage"),
      }).method,
    ).toBe("consumption");
  });

  it("records private consumers, unallocated cost, and rounding residual", () => {
    const run = AllocationRunSchema.parse({
      id: "allocation:1",
      costPoolId: "pool:platform",
      ruleId: fixedRule.id,
      ruleRevision: fixedRule.revision,
      period,
      sourceCostObservationIds: ["cost:shared"],
      amount: { currency: "USD", amount: 100 },
      effect: "charge",
      inputs: [
        {
          consumerId: "consumer:site",
          projectId: "project:site",
          quantity: null,
          metricObservationId: null,
        },
        {
          consumerId: "consumer:private",
          projectId: null,
          quantity: null,
          metricObservationId: null,
        },
      ],
      outputs: [
        {
          kind: "allocated",
          consumerId: "consumer:site",
          projectId: "project:site",
          amount: { currency: "USD", amount: 69.99 },
        },
        {
          kind: "unallocated",
          consumerId: null,
          projectId: null,
          amount: { currency: "USD", amount: 30 },
        },
      ],
      roundingResidual: { currency: "USD", amount: 0.01 },
      provenance: provenance("allocation:1"),
    });

    expect(run.outputs).toHaveLength(2);
    expect(() =>
      AllocationRunSchema.parse({
        ...run,
        outputs: [run.outputs[0]],
      }),
    ).toThrow(/reconcile/);
  });

  it("rejects a rule outside its effective dates", () => {
    expect(() =>
      validateAllocationRuleForPeriod(fixedRule, {
        startsAt: "2025-12-01T00:00:00.000Z",
        endsAt: "2026-01-15T00:00:00.000Z",
      }),
    ).toThrow(/not effective/);
    expect(() =>
      validateAllocationRuleForPeriod(fixedRule, {
        startsAt: "2026-03-01T00:00:00.000Z",
        endsAt: "2026-05-01T00:00:00.000Z",
      }),
    ).toThrow(/not effective/);
  });
});
