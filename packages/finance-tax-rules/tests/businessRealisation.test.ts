import { describe, expect, it } from "vitest";
import {
  calculateCapitalRealisationTax,
  calculateDividendRealisationTax,
  resolveBusinessRealisationTaxRules,
} from "../src/businessRealisation";

const eligibleRelief = {
  state: "assessed" as const,
  intendsToClaim: true,
  nonEmiOrdinaryShares: true,
  officerOrEmployeeForTwoYears: true,
  tradingCompanyForTwoYears: true,
  heldForTwoYears: true,
  ordinaryShareCapitalPercent: 100,
  votingRightsPercent: 100,
  economicEntitlement: {
    kind: "company-sale-proceeds" as const,
    percent: 100,
  },
  priorLifetimeQualifyingGainsPence: 0,
};

describe("business realisation tax rules", () => {
  it("resolves effective-dated BADR, CGT, dividend, and dissolution rules", () => {
    const beforeRateChange = resolveBusinessRealisationTaxRules("2026-04-05");
    const afterRateChange = resolveBusinessRealisationTaxRules("2026-04-06");

    expect(beforeRateChange).toMatchObject({
      available: true,
      rules: {
        businessAssetDisposalRelief: { rateBasisPoints: 1_400 },
      },
    });
    expect(afterRateChange).toMatchObject({
      available: true,
      rules: {
        dividendAllowancePence: 50_000,
        dividendRates: {
          basicBasisPoints: 1_075,
          higherBasisPoints: 3_575,
          additionalBasisPoints: 3_935,
        },
        capitalGains: {
          annualExemptAmountPence: 300_000,
          basicRateBasisPoints: 1_800,
          higherRateBasisPoints: 2_400,
        },
        businessAssetDisposalRelief: {
          rateBasisPoints: 1_800,
          lifetimeLimitPence: 100_000_000,
        },
        strikingOffCapitalDistributionLimitPence: 2_500_000,
      },
    });
  });

  it("applies the remaining BADR lifetime limit and ordinary CGT to the excess", () => {
    const result = calculateCapitalRealisationTax({
      date: "2026-10-01",
      proceedsPence: 150_000_000,
      allowableCostPence: 0,
      lossesAppliedPence: 0,
      remainingAnnualExemptAmountPence: 300_000,
      remainingBasicRateBandPence: 3_770_000,
      reliefEligibility: {
        ...eligibleRelief,
        priorLifetimeQualifyingGainsPence: 10_000_000,
      },
    });

    expect(result).toMatchObject({
      available: true,
      gainPence: 150_000_000,
      taxableGainPence: 149_700_000,
      businessAssetDisposalReliefGainPence: 90_000_000,
      standardRateGainPence: 59_700_000,
      reliefApplied: true,
      taxPence: 30_528_000,
    });
  });

  it("blocks a precise result when BADR eligibility is unknown", () => {
    const result = calculateCapitalRealisationTax({
      date: "2026-10-01",
      proceedsPence: 50_000_000,
      allowableCostPence: 10_000_000,
      lossesAppliedPence: 0,
      remainingAnnualExemptAmountPence: 300_000,
      remainingBasicRateBandPence: 3_770_000,
      reliefEligibility: {
        state: "unknown",
        reason: "Trading-company status has not been verified",
      },
    });

    expect(result).toMatchObject({
      available: false,
      taxPence: null,
      unsupported: [
        {
          code: "unknown-business-asset-disposal-relief-eligibility",
        },
      ],
    });
  });

  it("uses the remaining dividend allowance and income-tax bands", () => {
    const result = calculateDividendRealisationTax({
      date: "2026-10-01",
      distributionPence: 10_000_000,
      remainingDividendAllowancePence: 50_000,
      remainingBasicRateBandPence: 1_000_000,
      remainingHigherRateBandPence: 5_000_000,
    });

    expect(result).toMatchObject({
      available: true,
      taxableDividendPence: 9_950_000,
      basicRateDividendPence: 1_000_000,
      higherRateDividendPence: 5_000_000,
      additionalRateDividendPence: 3_950_000,
      taxPence: 3_449_325,
    });
  });
});
