import { describe, expect, it } from "vitest";
import {
  SharedCostAllocationRequestSchema,
  SharedCostAllocationRuleSchema,
  allocateSharedCost,
  reportSharedCostAllocation,
  selectSharedCostAllocationRule,
  type SharedCostAllocationRequest,
  type SharedCostAllocationRule,
  type SharedCostConsumer,
} from "../src/shared-cost-attribution";
import { period, provenance } from "./fixtures";

const effectivePeriod = {
  startsAt: "2026-01-01T00:00:00.000Z",
  endsAt: "2026-04-01T00:00:00.000Z",
} as const;

function rule(
  candidate: Partial<SharedCostAllocationRule> &
    Pick<SharedCostAllocationRule, "method">,
): SharedCostAllocationRule {
  return SharedCostAllocationRuleSchema.parse({
    id: `rule:${candidate.method}`,
    revision: 1,
    costPoolId: "pool:platform",
    effectivePeriod,
    eligibility: {
      kind: "layer",
      platformId: "platform:engineering",
      layerId: "layer:base",
    },
    postClosurePolicy: "exclude",
    rationale: "Allocate the shared platform bill to its adopters.",
    provenance: provenance(`rule:${candidate.method}`),
    ...candidate,
  });
}

function consumer(
  consumerId: string,
  projectId: string | null,
  candidate: Partial<SharedCostConsumer> = {},
): SharedCostConsumer {
  return {
    consumerId,
    projectId,
    adoptions: [
      {
        kind: "layer",
        platformId: "platform:engineering",
        layerId: "layer:base",
        effectivePeriod,
      },
    ],
    lifecycle: [
      {
        state: "active",
        effectivePeriod,
      },
    ],
    ...candidate,
  };
}

function request(
  allocationRule: SharedCostAllocationRule,
  consumers: readonly SharedCostConsumer[],
  candidate: Partial<SharedCostAllocationRequest> = {},
): SharedCostAllocationRequest {
  return SharedCostAllocationRequestSchema.parse({
    id: "allocation:2026-01",
    rule: allocationRule,
    period,
    sourceCostObservationIds: ["cost:shared:2026-01"],
    amount: { currency: "USD", amount: 100 },
    effect: "charge",
    consumers,
    provenance: provenance("allocation:2026-01"),
    ...candidate,
  });
}

describe("shared platform cost attribution", () => {
  it("supports direct assignment and retains the rule on the report", () => {
    const allocationRule = rule({
      method: "direct",
      consumerId: "consumer:site",
    });
    const run = allocateSharedCost(
      request(allocationRule, [consumer("consumer:site", "project:site")]),
    );
    const report = reportSharedCostAllocation(run, allocationRule);

    expect(run.outputs).toEqual([
      {
        kind: "allocated",
        consumerId: "consumer:site",
        projectId: "project:site",
        amount: { currency: "USD", amount: 100 },
      },
    ]);
    expect(report).toMatchObject({
      gross: { currency: "USD", amount: 100 },
      allocated: { currency: "USD", amount: 100 },
      unallocated: { currency: "USD", amount: 0 },
      reconciles: true,
      shares: [
        {
          projectId: "project:site",
          rule: {
            id: "rule:direct",
            revision: 1,
            method: "direct",
          },
        },
      ],
    });
  });

  it("splits equally among active layer adopters and excludes closed projects", () => {
    const allocationRule = rule({ method: "equal" });
    const closed = consumer("consumer:closed", "project:closed", {
      lifecycle: [
        {
          state: "closed",
          effectivePeriod,
        },
      ],
    });
    const run = allocateSharedCost(
      request(allocationRule, [
        consumer("consumer:alpha", "project:alpha"),
        consumer("consumer:beta", "project:beta"),
        closed,
      ]),
    );

    expect(run.outputs).toEqual([
      {
        kind: "allocated",
        consumerId: "consumer:alpha",
        projectId: "project:alpha",
        amount: { currency: "USD", amount: 50 },
      },
      {
        kind: "allocated",
        consumerId: "consumer:beta",
        projectId: "project:beta",
        amount: { currency: "USD", amount: 50 },
      },
    ]);
  });

  it("uses preferred-slot adoption periods and leaves inactive weights unallocated", () => {
    const allocationRule = rule({
      method: "weighted",
      eligibility: {
        kind: "slot",
        platformId: "platform:engineering",
        layerId: "layer:observability",
        slotId: "slot:telemetry",
      },
      weights: [
        { consumerId: "consumer:site", weight: 3 },
        { consumerId: "consumer:api", weight: 1 },
      ],
    });
    const slotAdopter = consumer("consumer:site", "project:site", {
      adoptions: [
        {
          kind: "slot",
          platformId: "platform:engineering",
          layerId: "layer:observability",
          slotId: "slot:telemetry",
          effectivePeriod,
        },
      ],
    });
    const laterAdopter = consumer("consumer:api", "project:api", {
      adoptions: [
        {
          kind: "slot",
          platformId: "platform:engineering",
          layerId: "layer:observability",
          slotId: "slot:telemetry",
          effectivePeriod: {
            startsAt: "2026-01-15T00:00:00.000Z",
            endsAt: null,
          },
        },
      ],
    });
    const run = allocateSharedCost(
      request(allocationRule, [slotAdopter, laterAdopter]),
    );

    expect(run.outputs).toEqual([
      {
        kind: "allocated",
        consumerId: "consumer:site",
        projectId: "project:site",
        amount: { currency: "USD", amount: 75 },
      },
      {
        kind: "unallocated",
        consumerId: null,
        projectId: null,
        amount: { currency: "USD", amount: 25 },
      },
    ]);
  });

  it("uses evidenced usage without inflating measured consumers", () => {
    const allocationRule = rule({
      method: "usage",
      metricDefinitionId: "metric:requests",
      unit: "request",
    });
    const run = allocateSharedCost(
      request(
        allocationRule,
        [
          consumer("consumer:site", "project:site", {
            usage: {
              quantity: 60,
              metricObservationId: "metric-observation:site",
            },
          }),
          consumer("consumer:api", "project:api", {
            usage: { quantity: null, metricObservationId: null },
          }),
        ],
        {
          usageTotal: {
            quantity: 100,
            metricObservationId: "metric-observation:provider-total",
          },
        },
      ),
    );

    expect(run.outputs).toEqual([
      {
        kind: "allocated",
        consumerId: "consumer:site",
        projectId: "project:site",
        amount: { currency: "USD", amount: 60 },
      },
      {
        kind: "unallocated",
        consumerId: null,
        projectId: null,
        amount: { currency: "USD", amount: 40 },
      },
    ]);
  });

  it("keeps the whole bill unallocated when usage is incomplete without a total", () => {
    const allocationRule = rule({
      method: "usage",
      metricDefinitionId: "metric:requests",
      unit: "request",
    });
    const run = allocateSharedCost(
      request(allocationRule, [
        consumer("consumer:site", "project:site", {
          usage: {
            quantity: 60,
            metricObservationId: "metric-observation:site",
          },
        }),
        consumer("consumer:api", "project:api"),
      ]),
    );

    expect(run.outputs).toEqual([
      {
        kind: "unallocated",
        consumerId: null,
        projectId: null,
        amount: { currency: "USD", amount: 100 },
      },
    ]);
  });

  it("records a zero shared bill even when it has no eligible adopter", () => {
    const allocationRule = rule({ method: "equal" });
    const run = allocateSharedCost(
      request(allocationRule, [], {
        amount: { currency: "USD", amount: 0 },
      }),
    );

    expect(run.outputs).toEqual([
      {
        kind: "unallocated",
        consumerId: null,
        projectId: null,
        amount: { currency: "USD", amount: 0 },
      },
    ]);
  });

  it("can include a closed adopter only when the rule says so", () => {
    const allocationRule = rule({
      method: "direct",
      consumerId: "consumer:closed",
      postClosurePolicy: "include",
    });
    const run = allocateSharedCost(
      request(allocationRule, [
        consumer("consumer:closed", "project:closed", {
          lifecycle: [{ state: "closed", effectivePeriod }],
        }),
      ]),
    );

    expect(run.outputs[0]).toMatchObject({
      kind: "allocated",
      projectId: "project:closed",
      amount: { amount: 100 },
    });
  });

  it("selects one effective rule revision and rejects ambiguous histories", () => {
    const january = rule({
      method: "equal",
      id: "rule:platform",
      revision: 1,
      effectivePeriod: {
        startsAt: "2026-01-01T00:00:00.000Z",
        endsAt: "2026-02-01T00:00:00.000Z",
      },
    });
    const february = rule({
      method: "equal",
      id: "rule:platform",
      revision: 2,
      effectivePeriod: {
        startsAt: "2026-02-01T00:00:00.000Z",
        endsAt: null,
      },
    });

    expect(
      selectSharedCostAllocationRule(
        [january, february],
        "pool:platform",
        period,
      ).revision,
    ).toBe(1);
    expect(() =>
      selectSharedCostAllocationRule(
        [january, { ...january, id: "rule:overlap" }],
        "pool:platform",
        period,
      ),
    ).toThrow(/Multiple/);
  });

  it("reconciles repeating equal shares without a duplicate gross charge", () => {
    const allocationRule = rule({ method: "equal" });
    const run = allocateSharedCost(
      request(allocationRule, [
        consumer("consumer:alpha", "project:alpha"),
        consumer("consumer:beta", "project:beta"),
        consumer("consumer:gamma", "project:gamma"),
      ]),
    );
    const report = reportSharedCostAllocation(run, allocationRule);

    expect(report.shares.map(({ amount }) => amount.amount)).toEqual([
      33.333333334, 33.333333333, 33.333333333,
    ]);
    expect(report.allocated.amount + report.unallocated.amount).toBe(
      report.gross.amount,
    );
    expect(report.roundingResidual.amount).toBe(0);
    expect(report.reconciles).toBe(true);
  });
});
