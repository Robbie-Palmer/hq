import { describe, expect, it } from "vitest";
import {
  AssetTrackerDataSchema,
  applyAddDecisionInterpretation,
  applyCreateDecisionRecord,
  applyRecordDecisionObservation,
  buildRepository,
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
});
