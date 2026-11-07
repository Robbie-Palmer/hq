import { describe, expect, it } from "vitest";
import {
  BusinessValuationTreatmentSchema,
  CompanyEquityValuationSchema,
  calculateAdjustedNetAssets,
  companyValuationAt,
} from "@/app/_projects/personal-finance-app/domain";
import { businessValuationFixture } from "@/app/_projects/personal-finance-app/tests/fixtures/businessValuation";

describe("owned-business valuation", () => {
  it("calculates adjusted net assets with liabilities, tax, VAT, FX, and reserve lineage", () => {
    const fixture = businessValuationFixture();
    const result = calculateAdjustedNetAssets(fixture.calculationInput);

    expect(result.complete).toBe(true);
    expect(result.knownSubtotal).toBe(120_000);
    expect(result.valuation).toMatchObject({
      method: "adjusted-net-assets",
      evidenceKind: "calculation",
      evidenceAt: "2026-10-01T09:00:00.000Z",
      amount: { state: "known", currency: "GBP", amount: 120_000 },
      operatingReserve: {
        amount: { state: "known", amount: 30_000 },
        unavailableForExtraction: true,
        assumptionId: "northstar-operating-reserve-2026",
      },
      inputs: {
        accountObservationIds: ["company-cash-value-2026-09-30"],
        liabilityAccountObservationIds: ["company-loan-value-2026-09-30"],
        obligationIds: ["northstar-corporation-tax-2026", "northstar-vat-2026"],
        exchangeRateObservationIds: ["usd-gbp-2026-09-30"],
        assumptionIds: ["northstar-operating-reserve-2026"],
      },
    });
    expect(result.components.map(({ kind, amount }) => [kind, amount])).toEqual(
      [
        ["asset", 200_000],
        ["liability", -50_000],
        ["obligation", -20_000],
        ["obligation", -10_000],
      ],
    );
    expect(result.valuation.lineage.parentRecordIds).toEqual([
      "company-cash-value-2026-09-30",
      "company-loan-value-2026-09-30",
      "northstar-corporation-tax-2026",
      "northstar-vat-2026",
      "usd-gbp-2026-09-30",
      "northstar-operating-reserve-2026",
    ]);
  });

  it("preserves negative equity instead of flooring the company at zero", () => {
    const fixture = businessValuationFixture();
    const cash = fixture.accountValues.find(
      ({ accountId }) => accountId === "company-cash",
    );
    if (cash?.amount.state !== "known")
      throw new Error("fixture has no cash value");
    cash.amount.amount = 25_000;

    const result = calculateAdjustedNetAssets(fixture.calculationInput);

    expect(result.valuation.amount).toEqual({
      state: "known",
      currency: "GBP",
      amount: -60_000,
    });
  });

  it("returns an explicit unknown result and a partial subtotal for missing inputs", () => {
    const fixture = businessValuationFixture();
    fixture.calculationInput.accountValues = fixture.accountValues.filter(
      ({ accountId }) => accountId !== "company-loan",
    );
    fixture.calculationInput.obligations =
      fixture.data.entityObligations.filter(
        ({ obligationId }) => obligationId !== "northstar-vat-2026",
      );

    const result = calculateAdjustedNetAssets(fixture.calculationInput);

    expect(result.complete).toBe(false);
    expect(result.knownSubtotal).toBe(180_000);
    expect(result.valuation.amount).toEqual({
      state: "amount-not-recorded",
      currency: "GBP",
    });
    expect(result.issues).toEqual([
      { kind: "missing_account_value", subjectId: "company-loan" },
      { kind: "missing_obligation", subjectId: "northstar-vat-2026" },
    ]);
  });

  it("does not carry stale positions or missing exchange rates into a precise value", () => {
    const staleFixture = businessValuationFixture();
    const cash = staleFixture.accountValues.find(
      ({ accountId }) => accountId === "company-cash",
    );
    if (cash == null) throw new Error("fixture has no cash value");
    cash.validAt = "2026-08-01";
    const stale = calculateAdjustedNetAssets(staleFixture.calculationInput);

    expect(stale.issues).toContainEqual({
      kind: "stale_account_value",
      subjectId: "company-cash",
      observedAt: "2026-08-01",
    });
    expect(stale.valuation.amount.state).toBe("amount-not-recorded");

    const missingRateFixture = businessValuationFixture();
    missingRateFixture.calculationInput.exchangeRateObservations = [];
    const missingRate = calculateAdjustedNetAssets(
      missingRateFixture.calculationInput,
    );
    expect(missingRate.issues).toContainEqual({
      kind: "missing_exchange_rate",
      subjectId: "company-cash",
    });
    expect(missingRate.valuation.amount.state).toBe("amount-not-recorded");
  });

  it("selects corrected ranged observations by knowledge time and reports staleness", () => {
    const fixture = businessValuationFixture();
    const original = CompanyEquityValuationSchema.parse({
      recordId: "northstar-market-value-original",
      companyEntityId: "company:northstar",
      validAt: "2026-09-30",
      acceptedAt: "2026-10-01T09:00:00.000Z",
      method: "externally-supported",
      evidenceKind: "observation",
      evidenceAt: "2026-09-30T16:00:00.000Z",
      amount: { state: "known", currency: "GBP", amount: 300_000 },
      range: { currency: "GBP", lowerBound: 250_000, upperBound: 350_000 },
      lineage: fixture.calculationInput.lineage,
    });
    const correction = CompanyEquityValuationSchema.parse({
      ...original,
      recordId: "northstar-market-value-correction",
      acceptedAt: "2026-10-15T09:00:00.000Z",
      amount: { state: "known", currency: "GBP", amount: 280_000 },
      range: { currency: "GBP", lowerBound: 260_000, upperBound: 310_000 },
      correctsId: original.recordId,
    });

    expect(
      companyValuationAt({
        valuations: [original, correction],
        companyEntityId: "company:northstar",
        validAt: "2026-09-30",
        asKnownAt: "2026-10-10T00:00:00.000Z",
        maxAgeDays: 31,
      }),
    ).toMatchObject({
      status: "available",
      valuation: { recordId: original.recordId },
    });
    expect(
      companyValuationAt({
        valuations: [original, correction],
        companyEntityId: "company:northstar",
        validAt: "2026-09-30",
        asKnownAt: "2026-10-20T00:00:00.000Z",
        maxAgeDays: 31,
      }),
    ).toMatchObject({
      status: "available",
      valuation: { recordId: correction.recordId, range: correction.range },
    });
    expect(
      companyValuationAt({
        valuations: [original, correction],
        companyEntityId: "company:northstar",
        validAt: "2026-12-31",
        asKnownAt: "2027-01-01T00:00:00.000Z",
        maxAgeDays: 31,
      }),
    ).toMatchObject({ status: "stale", ageDays: 92 });
  });

  it("supports an explicit dated exclusion treatment", () => {
    const fixture = businessValuationFixture();
    const exclusion = BusinessValuationTreatmentSchema.parse({
      recordId: "northstar-excluded",
      companyEntityId: "company:northstar",
      effectiveFrom: "2026-01-01",
      acceptedAt: "2026-01-01T00:00:00.000Z",
      kind: "exclude",
      reason: "Household policy excludes private businesses",
      lineage: fixture.calculationInput.lineage,
    });

    expect(
      companyValuationAt({
        valuations: [],
        treatments: [exclusion],
        companyEntityId: "company:northstar",
        validAt: "2026-09-30",
        asKnownAt: "2026-10-01T00:00:00.000Z",
        maxAgeDays: 31,
      }),
    ).toEqual({ status: "excluded", treatment: exclusion });
  });
});
