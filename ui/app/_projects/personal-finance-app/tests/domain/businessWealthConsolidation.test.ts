import { describe, expect, it } from "vitest";
import {
  BusinessValuationTreatmentSchema,
  type CompanyEquityValuation,
  CompanyEquityValuationSchema,
  calculateAdjustedNetAssets,
  consolidateHouseholdWealth,
  type HouseholdConsolidationInput,
} from "@/app/_projects/personal-finance-app/domain";
import { businessValuationFixture } from "@/app/_projects/personal-finance-app/tests/fixtures/businessValuation";

function consolidate(
  valuation: CompanyEquityValuation,
  overrides: Partial<HouseholdConsolidationInput> = {},
) {
  const fixture = businessValuationFixture();
  return consolidateHouseholdWealth({
    selectedPersonEntityIds: ["person:alex", "person:sam"],
    validAt: "2026-09-30",
    asKnownAt: "2026-10-15T00:00:00.000Z",
    baseCurrency: "GBP",
    accounts: fixture.data.accounts,
    accountValues: fixture.accountValues,
    financialEntities: fixture.data.financialEntities,
    accountOwnerships: fixture.data.accountOwnerships,
    shareOwnershipInterests: fixture.data.shareOwnershipInterests,
    companyEquityValuations: [valuation],
    entityTransfers: fixture.data.entityTransfers,
    exchangeRateObservations: fixture.exchangeRateObservations,
    maxValuationAgeDays: 31,
    maxAccountValueAgeDays: 31,
    maxExchangeRateAgeDays: 7,
    ...overrides,
  });
}

describe("owned-business household consolidation", () => {
  it("uses one ownership-weighted interest and excludes every underlying company position", () => {
    const fixture = businessValuationFixture();
    const valuation = calculateAdjustedNetAssets(
      fixture.calculationInput,
    ).valuation;

    const result = consolidate(valuation);

    expect(result.knownSubtotal).toBe(120_000);
    expect(result.includedContributionIds).toEqual([
      "account:alex-cash",
      "account:shared-cash",
      "business-interest:company:northstar",
    ]);
    expect(result.excludedUnderlyingIds).toEqual([
      "company-cash",
      "company-loan",
      "northstar-corporation-tax-2026",
      "northstar-vat-2026",
    ]);
    expect(
      result.contributions.filter(
        ({ subjectId }) => subjectId === "company-cash",
      ),
    ).toEqual([]);
    expect(result.businessReconciliations).toMatchObject([
      {
        basis: "underlying-company-position",
        wholeCompanyAmount: 120_000,
        selectedOwnershipFraction: 0.75,
        selectedInterestAmount: 90_000,
        outsideOwnershipFraction: 0.25,
        operatingReserve: {
          amount: { state: "known", amount: 30_000 },
          unavailableForExtraction: true,
        },
      },
    ]);
    expect(result.eliminatedTransferIds).toEqual(["transfer-dividend-v1"]);
  });

  it("applies the ownership percentage effective on each valuation date", () => {
    const fixture = businessValuationFixture();
    const before = CompanyEquityValuationSchema.parse({
      recordId: "northstar-value-2026-06-30",
      companyEntityId: "company:northstar",
      validAt: "2026-06-30",
      acceptedAt: "2026-07-01T00:00:00.000Z",
      method: "manual",
      evidenceKind: "observation",
      evidenceAt: "2026-06-30T17:00:00.000Z",
      amount: { state: "known", currency: "GBP", amount: 100_000 },
      lineage: fixture.calculationInput.lineage,
    });
    const after = CompanyEquityValuationSchema.parse({
      ...before,
      recordId: "northstar-value-2026-09-30",
      validAt: "2026-09-30",
      acceptedAt: "2026-10-01T00:00:00.000Z",
      evidenceAt: "2026-09-30T17:00:00.000Z",
    });
    const companyAccounts = fixture.data.accounts.filter((account) =>
      account.id.startsWith("company-"),
    );

    const historical = consolidate(before, {
      selectedPersonEntityIds: ["person:alex"],
      validAt: "2026-06-30",
      asKnownAt: "2026-07-02T00:00:00.000Z",
      accounts: companyAccounts,
      accountValues: [],
      companyEquityValuations: [before],
    });
    const current = consolidate(after, {
      selectedPersonEntityIds: ["person:alex"],
      accounts: companyAccounts,
      accountValues: [],
      companyEquityValuations: [before, after],
    });

    expect(historical.knownSubtotal).toBe(75_000);
    expect(
      historical.businessReconciliations[0]?.selectedOwnershipFraction,
    ).toBe(0.75);
    expect(current.knownSubtotal).toBe(40_000);
    expect(current.businessReconciliations[0]?.selectedOwnershipFraction).toBe(
      0.4,
    );
  });

  it("preserves direct valuation ranges and foreign-currency provenance", () => {
    const fixture = businessValuationFixture();
    const direct = CompanyEquityValuationSchema.parse({
      recordId: "northstar-external-usd",
      companyEntityId: "company:northstar",
      validAt: "2026-09-30",
      acceptedAt: "2026-10-01T09:00:00.000Z",
      method: "externally-supported",
      evidenceKind: "observation",
      evidenceAt: "2026-09-30T17:00:00.000Z",
      amount: { state: "known", currency: "USD", amount: 100_000 },
      range: { currency: "USD", lowerBound: 80_000, upperBound: 120_000 },
      lineage: fixture.calculationInput.lineage,
    });

    const result = consolidate(direct);
    const contribution = result.contributions.find(
      ({ kind }) => kind === "business-interest",
    );

    expect(contribution).toMatchObject({
      amount: 60_000,
      range: { currency: "GBP", lowerBound: 48_000, upperBound: 72_000 },
      inputRecordIds: [
        "northstar-external-usd",
        "interest-alex-current",
        "interest-sam-current",
        "usd-gbp-2026-09-30",
      ],
    });
    expect(result.businessReconciliations[0]?.basis).toBe("direct-valuation");
    expect(result.exchangeRateObservationIds).toEqual(["usd-gbp-2026-09-30"]);
    expect(result.excludedUnderlyingIds).toEqual([
      "company-cash",
      "company-loan",
    ]);
  });

  it("keeps stale, unknown, and unsupported company values out of the total", () => {
    const fixture = businessValuationFixture();
    const known = calculateAdjustedNetAssets(
      fixture.calculationInput,
    ).valuation;
    const stale = consolidate(known, {
      validAt: "2026-12-31",
      asKnownAt: "2027-01-01T00:00:00.000Z",
      maxValuationAgeDays: 31,
      maxAccountValueAgeDays: Number.MAX_SAFE_INTEGER,
    });
    expect(stale.knownSubtotal).toBe(30_000);
    expect(stale.issues).toContainEqual({
      kind: "stale_company_valuation",
      subjectId: "company:northstar",
      observedAt: "2026-09-30",
    });

    const missingInputFixture = businessValuationFixture();
    missingInputFixture.calculationInput.accountValues = [];
    const unknown = calculateAdjustedNetAssets(
      missingInputFixture.calculationInput,
    ).valuation;
    expect(consolidate(unknown).issues).toContainEqual({
      kind: "company_valuation_not_recorded",
      subjectId: "company:northstar",
    });

    const unsupported = CompanyEquityValuationSchema.parse({
      ...known,
      recordId: "northstar-unsupported",
      method: "manual",
      evidenceKind: "observation",
      amount: {
        state: "unsupported",
        currency: "GBP",
        reason: "Revenue multiple valuations are not supported",
      },
      inputs: undefined,
      operatingReserve: undefined,
    });
    expect(consolidate(unsupported).issues).toContainEqual({
      kind: "unsupported_company_valuation",
      subjectId: "company:northstar",
      reason: "Revenue multiple valuations are not supported",
    });
  });

  it("uses accepted corrections without rewriting earlier household results", () => {
    const fixture = businessValuationFixture();
    const original = CompanyEquityValuationSchema.parse({
      recordId: "northstar-manual-original",
      companyEntityId: "company:northstar",
      validAt: "2026-09-30",
      acceptedAt: "2026-10-01T09:00:00.000Z",
      method: "manual",
      evidenceKind: "observation",
      evidenceAt: "2026-09-30T17:00:00.000Z",
      amount: { state: "known", currency: "GBP", amount: 200_000 },
      lineage: fixture.calculationInput.lineage,
    });
    const correction = CompanyEquityValuationSchema.parse({
      ...original,
      recordId: "northstar-manual-correction",
      acceptedAt: "2026-11-01T09:00:00.000Z",
      amount: { state: "known", currency: "GBP", amount: 240_000 },
      correctsId: original.recordId,
    });

    const before = consolidate(original, {
      companyEquityValuations: [original, correction],
      asKnownAt: "2026-10-15T00:00:00.000Z",
    });
    const after = consolidate(correction, {
      companyEquityValuations: [original, correction],
      asKnownAt: "2026-11-15T00:00:00.000Z",
    });

    expect(before.knownSubtotal).toBe(180_000);
    expect(before.valuationRecordIds).toEqual([original.recordId]);
    expect(after.knownSubtotal).toBe(210_000);
    expect(after.valuationRecordIds).toEqual([correction.recordId]);
  });

  it("selects the latest accepted correction to a direct account value", () => {
    const fixture = businessValuationFixture();
    const valuation = calculateAdjustedNetAssets(
      fixture.calculationInput,
    ).valuation;
    const original = fixture.accountValues.find(
      ({ accountId }) => accountId === "alex-cash",
    );
    if (original == null) throw new Error("fixture has no Alex cash value");
    const correction = {
      ...original,
      recordId: "alex-cash-value-correction",
      acceptedAt: "2026-11-01T09:00:00.000Z",
      correctsId: original.recordId,
      amount: {
        state: "known" as const,
        currency: "GBP" as const,
        amount: 25_000,
      },
    };
    const accountValues = [...fixture.accountValues, correction];

    const before = consolidate(valuation, {
      accountValues,
      asKnownAt: "2026-10-15T00:00:00.000Z",
    });
    const after = consolidate(valuation, {
      accountValues,
      asKnownAt: "2026-11-15T00:00:00.000Z",
    });

    expect(before.knownSubtotal).toBe(120_000);
    expect(after.knownSubtotal).toBe(125_000);
    expect(
      after.contributions.find(({ id }) => id === "account:alex-cash")
        ?.inputRecordIds,
    ).toContain(correction.recordId);
  });

  it("honours explicit exclusion and never treats a selected company as a person", () => {
    const fixture = businessValuationFixture();
    const valuation = calculateAdjustedNetAssets(
      fixture.calculationInput,
    ).valuation;
    const exclusion = BusinessValuationTreatmentSchema.parse({
      recordId: "exclude-northstar",
      companyEntityId: "company:northstar",
      effectiveFrom: "2026-01-01",
      acceptedAt: "2026-01-01T00:00:00.000Z",
      kind: "exclude",
      reason: "Excluded by household policy",
      lineage: fixture.calculationInput.lineage,
    });

    const result = consolidate(valuation, {
      selectedPersonEntityIds: [
        "person:alex",
        "person:sam",
        "company:northstar",
      ],
      companyValuationTreatments: [exclusion],
    });

    expect(result.knownSubtotal).toBe(30_000);
    expect(result.excludedBusinessIds).toEqual(["company:northstar"]);
    expect(result.valuationTreatmentRecordIds).toEqual([exclusion.recordId]);
    expect(result.includedContributionIds).toEqual([
      "account:alex-cash",
      "account:shared-cash",
    ]);
    expect(
      result.contributions.some(
        ({ subjectId }) => subjectId === "company-cash",
      ),
    ).toBe(false);
  });
});
