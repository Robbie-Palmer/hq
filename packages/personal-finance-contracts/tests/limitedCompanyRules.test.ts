import { describe, expect, it } from "vitest";
import {
  SUPPORTED_LIMITED_COMPANY_TAX_YEARS,
  UK_LIMITED_COMPANY_RULESET_VERSION,
  ukLimitedCompanyRuleSet,
} from "../src/limitedCompanyRules";

describe("UK limited-company rules", () => {
  it("publishes effective-dated official rules for both supported periods", () => {
    expect(SUPPORTED_LIMITED_COMPANY_TAX_YEARS).toEqual([
      "2025-26",
      "2026-27",
    ]);
    expect(ukLimitedCompanyRuleSet.rulesetVersion).toBe(
      UK_LIMITED_COMPANY_RULESET_VERSION,
    );
    expect(ukLimitedCompanyRuleSet.corporationTax).toMatchObject({
      effectiveFrom: "2025-04-01",
      effectiveTo: "2027-03-31",
      smallProfitsRateBasisPoints: 1_900,
      mainRateBasisPoints: 2_500,
      lowerLimitPence: 5_000_000,
      upperLimitPence: 25_000_000,
      marginalReliefNumerator: 3,
      marginalReliefDenominator: 200,
    });
    expect(ukLimitedCompanyRuleSet.payroll).toMatchObject({
      secondaryThresholdPence: 500_000,
      employerRateBasisPoints: 1_500,
      employmentAllowancePence: 1_050_000,
    });
    expect(ukLimitedCompanyRuleSet.vat).toMatchObject({
      registrationThresholdPence: 9_000_000,
      flatRateJoinThresholdPence: 15_000_000,
      cashAndAnnualJoinThresholdPence: 135_000_000,
      limitedCostRateBasisPoints: 1_650,
    });
  });

  it("keeps every source on an authoritative HTTPS host", () => {
    expect(ukLimitedCompanyRuleSet.sources.length).toBeGreaterThan(8);
    for (const source of ukLimitedCompanyRuleSet.sources) {
      const url = new URL(source.url);
      expect(url.protocol).toBe("https:");
      expect(
        url.hostname === "www.gov.uk" ||
          url.hostname.endsWith(".service.gov.uk"),
      ).toBe(true);
      expect(source.checkedOn).toBe("2026-11-06");
    }
  });
});
