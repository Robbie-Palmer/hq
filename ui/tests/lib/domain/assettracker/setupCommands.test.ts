import { describe, expect, it } from "vitest";
import {
  applySaveTaxSetup,
  applySetMortgageTerms,
} from "@/lib/domain/assettracker/assetTrackerCommands";
import { AssetTrackerDataSchema } from "@/lib/domain/assettracker/assetTrackerData";
import { getHouseholdTaxEstimate } from "@/lib/domain/assettracker/taxPosition";

describe("Asset Tracker setup commands", () => {
  it("adds modelling terms to an imported mortgage", () => {
    const data = AssetTrackerDataSchema.parse({
      accounts: [
        {
          id: "mortgage",
          name: "Mortgage",
          provider: "Bank",
          currency: "GBP",
          assetType: "mortgage",
          expectedAnnualReturn: 0.04,
          createdAt: "2020-01-01",
        },
      ],
      snapshots: [],
    });

    const next = applySetMortgageTerms(data, {
      accountId: "mortgage",
      firstPaymentDate: "2026-11-01",
      remainingTermMonths: 216,
      annualInterestRate: 0.045,
      interestRateEffectiveFrom: "2026-10-08",
    });

    expect(next.accounts[0]?.mortgageTerms).toEqual({
      firstPaymentDate: "2026-11-01",
      remainingTermMonths: 216,
      fees: [],
      overpayments: [],
      termChanges: [],
    });
    expect(next.accounts[0]?.expectedReturnChanges).toEqual([
      { date: "2026-10-08", rate: 0.045 },
    ]);
  });

  it("creates a default-backed profile and explicit income assumption", () => {
    const data = AssetTrackerDataSchema.parse({ accounts: [], snapshots: [] });
    const next = applySaveTaxSetup(data, {
      taxYear: "2026-27",
      people: [
        {
          memberId: "primary",
          jurisdiction: "england-and-northern-ireland",
          residence: "full-year-uk",
          hasTaxableBenefits: false,
          nationalInsuranceCategory: "A",
          isCompanyDirector: false,
          flexiblyAccessedPension: false,
          annualTaxableIncomePence: 5_000_000,
        },
      ],
    });

    expect(next.taxPosition?.profiles[0]).toMatchObject({
      memberId: "primary",
      nationalInsuranceCategory: "A",
      evidence: { kind: "assumption" },
    });
    expect(next.taxPosition?.income[0]).toMatchObject({
      memberId: "primary",
      amountPence: 5_000_000,
      evidence: { kind: "assumption" },
    });
    expect(getHouseholdTaxEstimate(next).available).toBe(true);
  });
});
