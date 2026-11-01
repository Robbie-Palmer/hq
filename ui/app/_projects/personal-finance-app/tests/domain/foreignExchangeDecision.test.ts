import { describe, expect, it } from "vitest";
import {
  compareForeignExchangeDecision,
  createForeignExchangeDecisionRecord,
  type ForeignExchangeDecisionInput,
  foreignExchangeReconciliationSummary,
  reconcileForeignExchangeDecision,
} from "@/app/_projects/personal-finance-app/domain/foreignExchangeDecision";

function decisionInput(): ForeignExchangeDecisionInput {
  return {
    amount: 10_000,
    sourceCurrency: "GBP",
    targetCurrency: "EUR",
    comparedAt: "2026-10-31T10:00:00Z",
    referenceRate: {
      rate: 1.2,
      source: {
        provider: "Reference provider",
        label: "GBP/EUR reference snapshot",
        url: "https://reference.example/rates/gbp-eur",
        observedAt: "2026-10-31T09:45:00Z",
      },
    },
    providerQuote: {
      rate: 1.176,
      fixedFee: 5,
      percentageFee: 0.5,
      source: {
        provider: "Conversion provider",
        label: "Transfer quote Q-123",
        url: "https://quote.example/Q-123",
        observedAt: "2026-10-31T09:50:00Z",
      },
    },
    futureRate: 1.23,
    stressRate: 1.1,
    stagedNowPercentage: 40,
  };
}

describe("foreign exchange decision comparison", () => {
  it("compares sourced now, delayed, and staged cases with provider costs", () => {
    const comparison = compareForeignExchangeDecision(decisionInput());

    expect(comparison.quoteAgeMinutes).toBe(10);
    expect(comparison.spreadPercentage).toBeCloseTo(2);
    expect(comparison.sources).toEqual([
      expect.objectContaining({ input: "Reference rate", rate: 1.2 }),
      expect.objectContaining({ input: "Available quote", rate: 1.176 }),
    ]);
    expect(comparison.scenarios.map(({ id }) => id)).toEqual([
      "now",
      "delay-future",
      "delay-stress",
      "staged-future",
      "staged-stress",
    ]);

    const now = comparison.scenarios[0];
    expect(now?.sourceFees).toBe(55);
    expect(now?.grossReferenceProceeds).toBe(12_000);
    expect(now?.netProceeds).toBeCloseTo(11_695.32);
    expect(now?.spreadAndFeeCost).toBeCloseTo(304.68);
    expect(now?.assumption).toBe(false);

    const delayed = comparison.scenarios[1];
    expect(delayed?.executableRate).toBeCloseTo(1.2054);
    expect(delayed?.breakEvenFutureRate).toBeCloseTo(1.2);
    expect(delayed?.assumption).toBe(true);

    const staged = comparison.scenarios[3];
    expect(staged?.sourceFees).toBe(60);
    expect(staged?.breakEvenFutureRate).toBeCloseTo(1.201);
    expect(staged?.netProceeds).toBeGreaterThan(now?.netProceeds ?? 0);
  });

  it("rejects same-currency comparisons and future source timestamps", () => {
    const sameCurrency = decisionInput();
    sameCurrency.targetCurrency = "GBP";
    expect(() => compareForeignExchangeDecision(sameCurrency)).toThrow(
      "Conversion currencies must differ",
    );

    const futureSource = decisionInput();
    futureSource.providerQuote.source.observedAt = "2026-10-31T10:01:00Z";
    expect(() => compareForeignExchangeDecision(futureSource)).toThrow(
      "Source time cannot be later than the comparison",
    );
  });

  it("saves the complete assumptions and reconciles the completed conversion", () => {
    const comparison = compareForeignExchangeDecision(decisionInput());
    const record = createForeignExchangeDecisionRecord({
      id: "fx-decision-1",
      savedAt: "2026-10-31T10:05:00Z",
      selectedScenarioId: "staged-future",
      rationale: "Split the timing risk across two conversions.",
      comparison,
    });

    expect(record.assumptions.referenceRate.source.url).toBe(
      "https://reference.example/rates/gbp-eur",
    );
    expect(record.assumptions.futureRate).toBe(1.23);
    expect(record.expectedNetProceeds).toBe(
      comparison.scenarios[3]?.netProceeds,
    );

    const reconciled = reconcileForeignExchangeDecision(record, {
      completedAt: "2026-11-14T12:00:00Z",
      sourceAmount: 10_000,
      targetAmount: 11_900,
      sourceFees: 60,
      note: "Both provider transfers settled.",
    });
    const summary = foreignExchangeReconciliationSummary(reconciled);
    expect(summary?.actualRate).toBeCloseTo(11_900 / 9_940);
    expect(summary?.netProceedsVariance).toBeCloseTo(
      11_900 - record.expectedNetProceeds,
    );
  });

  it("does not accept a completed conversion dated before the decision", () => {
    const comparison = compareForeignExchangeDecision(decisionInput());
    const record = createForeignExchangeDecisionRecord({
      id: "fx-decision-1",
      savedAt: "2026-10-31T10:05:00Z",
      selectedScenarioId: "now",
      rationale: "Use the available quote.",
      comparison,
    });

    expect(() =>
      reconcileForeignExchangeDecision(record, {
        completedAt: "2026-10-31T10:00:00Z",
        sourceAmount: 10_000,
        targetAmount: 11_600,
        sourceFees: 55,
        note: "Settlement record",
      }),
    ).toThrow("Completed conversion cannot predate the decision");
  });
});
