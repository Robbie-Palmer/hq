import { describe, expect, it } from "vitest";
import {
  AssetTrackerDataSchema,
  applyAddDecisionInterpretation,
  applyAdoptDecisionForecast,
  applyCreateDecisionRecord,
  applyRecordDecisionObservation,
  applyRevisitAdoptedDecision,
  buildAdoptDecisionForecastInput,
  buildRepository,
  type DecisionScenarioComparison,
  reconcileAdoptedDecisionForecast,
  reconcileDecisionRecord,
} from "@/lib/domain/assettracker";

const recordedAt = "2026-10-17T12:00:00.000Z";

function decisionInput() {
  return {
    question: "Should we invest the cash reserve?",
    decisionDate: "2026-10-17",
    selectedScenario: { id: "invest", label: "Invest £10,000" },
    rationale: "The emergency fund remains above six months of spending.",
    action: "Invest £10,000 in the household index fund.",
    forecast: {
      calculationVersion: "portfolio-forecast-v3",
      lineage: [
        {
          id: "cash-balance",
          kind: "financial-fact" as const,
          label: "Cash balance",
          value: "£30,000",
          source: "Bank statement 2026-10",
          validAt: "2026-10-17",
        },
        {
          id: "return-rate",
          kind: "rate" as const,
          label: "Expected return",
          value: "5% nominal",
          source: "Household planning policy",
          validAt: "2026-10-17",
          version: "2026.2",
        },
        {
          id: "isa-rule",
          kind: "tax-rule" as const,
          label: "ISA allowance",
          value: "£20,000",
          source: "HMRC ISA guidance",
          validAt: "2026-10-17",
          version: "2026-27",
        },
        {
          id: "contribution-assumption",
          kind: "assumption" as const,
          label: "Contributions",
          value: "£500 monthly",
          source: "Household plan",
          validAt: "2026-10-17",
        },
      ],
      checkpoints: [
        {
          id: "year-one",
          label: "Portfolio after one year",
          dueDate: "2027-10-17",
          expectedAmount: 16_650,
          currency: "GBP" as const,
        },
      ],
    },
  };
}

describe("decision records", () => {
  it("keeps the frozen forecast when reality and a correction are appended", () => {
    const empty = AssetTrackerDataSchema.parse({ accounts: [], snapshots: [] });
    const created = applyCreateDecisionRecord(
      empty,
      decisionInput(),
      recordedAt,
    );
    const decision = created.decisionRecords?.[0];
    if (decision?.kind !== "tracked")
      throw new Error("Expected tracked decision");
    const originalForecast = structuredClone(decision.forecast);

    const observed = applyRecordDecisionObservation(
      created,
      {
        decisionId: decision.id,
        checkpointId: "year-one",
        actualAmount: 15_300,
        note: "Markets fell and one contribution was missed.",
        divergenceSources: [
          {
            kind: "changed-assumption",
            label: "Market return",
            impactAmount: -850,
          },
          {
            kind: "changed-reality",
            label: "Missed contribution",
            impactAmount: -500,
          },
        ],
      },
      "2027-10-18T08:00:00.000Z",
    );
    const corrected = applyAddDecisionInterpretation(
      observed,
      {
        decisionId: decision.id,
        reason: "The contribution plan was entered incorrectly.",
        revisedRationale:
          "Investing remained affordable with £400 monthly contributions.",
        assumptionChanges: [
          {
            label: "Monthly contribution",
            previousValue: "£500",
            revisedValue: "£400",
          },
        ],
      },
      "2027-10-18T09:00:00.000Z",
    );
    const saved = buildRepository(corrected).decisionRecords[0];
    if (saved?.kind !== "tracked") throw new Error("Expected tracked decision");

    expect(saved.forecast).toEqual(originalForecast);
    expect(saved.observations).toHaveLength(1);
    expect(saved.interpretations).toHaveLength(1);
    expect(reconcileDecisionRecord(saved)[0]).toMatchObject({
      variance: -1_350,
      largestDivergenceSources: [
        { kind: "changed-assumption", impactAmount: -850 },
        { kind: "changed-reality", impactAmount: -500 },
      ],
    });
  });

  it("rejects a second observation for the same checkpoint", () => {
    const empty = AssetTrackerDataSchema.parse({ accounts: [], snapshots: [] });
    const created = applyCreateDecisionRecord(
      empty,
      decisionInput(),
      recordedAt,
    );
    const decision = created.decisionRecords?.[0];
    if (decision?.kind !== "tracked")
      throw new Error("Expected tracked decision");
    const observed = applyRecordDecisionObservation(
      created,
      {
        decisionId: decision.id,
        checkpointId: "year-one",
        actualAmount: 16_000,
        note: "First observation",
        divergenceSources: [],
      },
      "2027-10-18T08:00:00.000Z",
    );

    expect(() =>
      applyRecordDecisionObservation(
        observed,
        {
          decisionId: decision.id,
          checkpointId: "year-one",
          actualAmount: 16_100,
          note: "Replacement observation",
          divergenceSources: [],
        },
        "2027-10-19T08:00:00.000Z",
      ),
    ).toThrow(/already has an observation/);
  });

  it("adopts differently structured planning cases through the same forecast schema", () => {
    const data = liveForecastData();
    const repository = buildRepository(data);
    const home = buildAdoptDecisionForecastInput(
      repository,
      liveComparison({
        decisionId: "renovation",
        actionKind: "payment",
        actionDate: "2026-06-01",
        actionAmount: 8_000,
        planningCaseId: "home-plan",
      }),
      {
        title: "Kitchen renovation live forecast",
        calculationVersion: "decision-scenario-v1",
        reserveMonths: 6,
      },
    );
    const travel = buildAdoptDecisionForecastInput(
      repository,
      liveComparison({
        decisionId: "travel-break",
        actionKind: "receipt",
        actionDate: "2026-09-01",
        actionAmount: 2_000,
        planningCaseId: "travel-plan",
      }),
      {
        title: "Extended travel live forecast",
        calculationVersion: "decision-scenario-v1",
        reserveMonths: null,
      },
    );

    expect(home.planningCases).toEqual([
      { id: "home-plan", name: "Improve the house" },
    ]);
    expect(travel.planningCases).toEqual([
      { id: "travel-plan", name: "Time away" },
    ]);
    expect(home.actions[0]).toMatchObject({ kind: "payment" });
    expect(travel.actions[0]).toMatchObject({ kind: "receipt" });
    expect(home).toMatchObject({
      commitments: [{ id: "council-tax", name: "Council tax" }],
      reservePreference: { coverageMonths: 6 },
      assumptionSets: [
        {
          incomeAssumptionIds: ["bonus"],
          expenditureAssumptionIds: ["energy"],
        },
      ],
    });
  });

  it("reconciles actual cash flows and balances without changing the adopted forecast", () => {
    const data = liveForecastData();
    const input = buildAdoptDecisionForecastInput(
      buildRepository(data),
      liveComparison({
        decisionId: "renovation",
        actionKind: "payment",
        actionDate: "2026-06-01",
        actionAmount: 8_000,
        planningCaseId: "home-plan",
      }),
      {
        title: "Kitchen renovation live forecast",
        calculationVersion: "decision-scenario-v1",
        reserveMonths: 6,
      },
    );
    const adopted = applyAdoptDecisionForecast(data, input, recordedAt);
    const forecast = adopted.decisionRecords?.find(
      (record) => record.kind === "adopted-forecast",
    );
    if (forecast?.kind !== "adopted-forecast") {
      throw new Error("Expected an adopted forecast");
    }
    const frozen = structuredClone(forecast);
    const observed = AssetTrackerDataSchema.parse({
      ...adopted,
      snapshots: [
        ...adopted.snapshots,
        { accountId: "cash", date: "2026-07-01", balance: 13_400 },
      ],
      capitalFlows: [
        ...adopted.capitalFlows,
        {
          accountId: "cash",
          date: "2026-05-01",
          amount: 1_000,
          kind: "personalSaving",
        },
      ],
      futureCashFlows: adopted.futureCashFlows.map((record) =>
        record.id === "renovation"
          ? {
              ...record,
              stages: record.stages.map((stage) => ({
                ...stage,
                actuals: [
                  {
                    id: "renovation-paid",
                    date: "2026-06-08",
                    amount: 8_500,
                    direction: "payment" as const,
                  },
                ],
              })),
            }
          : record,
      ),
      forecastAssumptionSets: [
        {
          ...adopted.forecastAssumptionSets[0],
          status: "superseded" as const,
        },
        {
          ...adopted.forecastAssumptionSets[0],
          id: "household-v2",
          version: 2,
          status: "active" as const,
          supersedesId: "household-v1",
          assumptions: adopted.forecastAssumptionSets[0]?.assumptions.map(
            (assumption) => ({
              ...assumption,
              id: `${assumption.id}-v2`,
            }),
          ),
        },
      ],
    });
    const reconciliation = reconcileAdoptedDecisionForecast(
      forecast,
      buildRepository(observed),
    );

    expect(forecast).toEqual(frozen);
    expect(reconciliation.actions[0]).toMatchObject({
      actualAmount: 8_500,
      amountVariance: 500,
      timingVarianceDays: 7,
    });
    expect(
      new Set(reconciliation.varianceSources.map(({ kind }) => kind)),
    ).toEqual(
      new Set([
        "changed-amount",
        "changed-timing",
        "household-cash-flow",
        "unexplained",
        "revised-assumption",
      ]),
    );
    expect(
      reconciliation.varianceSources.find(
        ({ kind }) => kind === "changed-amount",
      )?.amount,
    ).toBe(500);
    expect(
      reconciliation.varianceSources.find(
        ({ kind }) => kind === "household-cash-flow",
      )?.amount,
    ).toBe(1_000);
    expect(
      reconciliation.varianceSources.find(({ kind }) => kind === "unexplained")
        ?.amount,
    ).toBe(900);
  });

  it("reopens one adopted choice without changing unrelated choices", () => {
    const data = liveForecastData();
    const input = buildAdoptDecisionForecastInput(
      buildRepository(data),
      {
        ...liveComparison({
          decisionId: "renovation",
          actionKind: "payment",
          actionDate: "2026-06-01",
          actionAmount: 8_000,
          planningCaseId: "home-plan",
        }),
        includedDecisionIds: ["renovation", "travel-break"],
        judgments: [
          {
            id: "renovation",
            name: "Renovate the kitchen",
            planningCaseId: "home-plan",
            reversibility: "partly-reversible",
          },
          {
            id: "travel-break",
            name: "Take an extended trip",
            planningCaseId: "travel-plan",
            reversibility: "reversible",
          },
        ],
      },
      {
        title: "Household live forecast",
        calculationVersion: "decision-scenario-v1",
        reserveMonths: 6,
      },
    );
    const adopted = applyAdoptDecisionForecast(data, input, recordedAt);
    const forecast = adopted.decisionRecords?.find(
      (record) => record.kind === "adopted-forecast",
    );
    if (forecast?.kind !== "adopted-forecast") {
      throw new Error("Expected an adopted forecast");
    }
    const revisited = applyRevisitAdoptedDecision(
      adopted,
      {
        forecastId: forecast.id,
        decisionId: "renovation",
        reason: "The contractor quote changed.",
      },
      "2026-02-01T12:00:00.000Z",
    );
    const statuses = new Map(
      revisited.futureCashFlows.flatMap((record) =>
        record.kind === "decision" ? [[record.id, record.status]] : [],
      ),
    );

    expect(statuses.get("renovation")).toBe("considering");
    expect(statuses.get("travel-break")).toBe("selected");
    expect(
      revisited.decisionRecords?.find(({ id }) => id === forecast.id),
    ).toMatchObject({
      reviews: [
        {
          decisionId: "renovation",
          reason: "The contractor quote changed.",
        },
      ],
    });
  });
});

function liveForecastData() {
  return AssetTrackerDataSchema.parse({
    accounts: [
      {
        id: "cash",
        name: "Current account",
        provider: "Bank",
        currency: "GBP",
        assetType: "cash",
        expectedAnnualReturn: 0.02,
        createdAt: "2025-01-01",
      },
    ],
    snapshots: [{ accountId: "cash", date: "2026-01-01", balance: 20_000 }],
    capitalFlows: [],
    planningCases: [
      { id: "home-plan", name: "Improve the house", labels: ["home"] },
      { id: "travel-plan", name: "Time away", labels: ["travel"] },
    ],
    futureCashFlows: [
      {
        id: "council-tax",
        name: "Council tax",
        kind: "commitment",
        status: "active",
        labels: [],
        currency: "GBP",
        stages: [
          {
            id: "annual-bill",
            direction: "payment",
            fromAccountId: "cash",
            dueDate: "2026-04-01",
            amount: 2_000,
            actuals: [],
          },
        ],
      },
      cashFlowDecision({
        id: "renovation",
        name: "Renovate the kitchen",
        planningCaseId: "home-plan",
        direction: "payment",
      }),
      cashFlowDecision({
        id: "travel-break",
        name: "Take an extended trip",
        planningCaseId: "travel-plan",
        direction: "receipt",
      }),
    ],
    forecastAssumptionSets: [
      {
        id: "household-v1",
        seriesId: "household",
        name: "Household changes",
        version: 1,
        status: "active",
        createdAt: "2026-01-01T12:00:00Z",
        assumptions: [
          {
            id: "bonus",
            name: "Annual bonus",
            kind: "income",
            startDate: "2026-03-01",
            monthlyChange: { minimum: 0, expected: 100, maximum: 200 },
            currency: "GBP",
            ownership: { kind: "personal", memberId: "primary" },
            accountId: "cash",
            source: { kind: "manual" },
          },
          {
            id: "energy",
            name: "Energy price change",
            kind: "expenditure",
            startDate: "2026-03-01",
            monthlyChange: { minimum: 50, expected: 75, maximum: 100 },
            currency: "GBP",
            ownership: { kind: "personal", memberId: "primary" },
            source: { kind: "manual" },
          },
        ],
      },
    ],
  });
}

function cashFlowDecision(input: {
  id: string;
  name: string;
  planningCaseId: string;
  direction: "payment" | "receipt";
}) {
  return {
    id: input.id,
    name: input.name,
    planningCaseId: input.planningCaseId,
    kind: "decision" as const,
    status: "considering" as const,
    labels: [],
    currency: "GBP" as const,
    reversibility: "reversible" as const,
    dependencyIds: [],
    alternativeToIds: [],
    stages: [
      {
        id: "main",
        direction: input.direction,
        ...(input.direction === "payment"
          ? { fromAccountId: "cash" }
          : { toAccountId: "cash" }),
        expectedDate: "2026-06-01",
        minimumAmount: 1_000,
        expectedAmount: 2_000,
        maximumAmount: 3_000,
        actuals: [],
      },
    ],
  };
}

function liveComparison(input: {
  decisionId: string;
  planningCaseId: string;
  actionKind: "payment" | "receipt";
  actionDate: string;
  actionAmount: number;
}): DecisionScenarioComparison {
  const totalAfter =
    20_000 + (input.actionKind === "receipt" ? 1 : -1) * input.actionAmount;
  return {
    requestedDecisionIds: [input.decisionId],
    includedDecisionIds: [input.decisionId],
    includedDependencyIds: [],
    warnings: [],
    materialDates: ["2026-07-01"],
    timeline: [
      {
        date: "2026-07-01",
        isMaterialDate: true,
        baseline: scenarioMetrics(20_000),
        lowCost: scenarioMetrics(totalAfter),
        expected: scenarioMetrics(totalAfter),
        highCost: scenarioMetrics(totalAfter),
        cumulativeEffect: scenarioEffect(totalAfter - 20_000),
        marginalEffect: scenarioEffect(totalAfter - 20_000),
        accountEffects: [
          {
            accountId: "cash",
            accountName: "Current account",
            baselineBalance: 20_000,
            expectedBalance: totalAfter,
            lowCostBalance: totalAfter,
            highCostBalance: totalAfter,
            cumulativeEffect: totalAfter - 20_000,
            marginalEffect: totalAfter - 20_000,
          },
        ],
      },
    ],
    goalDates: {
      baseline: null,
      lowCost: null,
      expected: null,
      highCost: null,
    },
    actions: [
      {
        id: `${input.decisionId}:main`,
        sourceDecisionId: input.decisionId,
        sourceStageId: "main",
        accountId: "cash",
        date: input.actionDate,
        cadence: "once",
        kind: input.actionKind,
        name: input.decisionId,
        accountName: "Current account",
        amount: input.actionAmount,
        currency: "GBP",
        countsAsExpenditure: input.actionKind === "payment",
      },
    ],
    fundingMechanics: [
      {
        id: `${input.decisionId}:main`,
        accountId: "cash",
        decisionName: input.decisionId,
        stageName: "Main",
        accountName: "Current account",
        fundingMethod: "cash",
        liquidity: "cash",
        annualReturn: 0.02,
        accessDelayDays: null,
        currency: "GBP",
        convertsToBaseCurrency: false,
        taxAndFees: "Included",
      },
    ],
    judgments: [
      {
        id: input.decisionId,
        name: input.decisionId,
        planningCaseId: input.planningCaseId,
        reversibility: "reversible",
      },
    ],
  };
}

function scenarioMetrics(total: number) {
  return {
    cashBalance: total,
    liquidBalance: total,
    totalBalance: total,
    cashMonths: 10,
    liquidMonths: 10,
    totalMonths: 10,
    reserveCoverageMonths: 6,
    accountShortfalls: [],
  };
}

function scenarioEffect(total: number) {
  return {
    cash: total,
    liquid: total,
    total,
    cashMonths: 0,
    liquidMonths: 0,
    totalMonths: 0,
  };
}
