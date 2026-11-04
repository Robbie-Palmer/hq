import { describe, expect, it } from "vitest";
import {
  UK_SOLE_TRADER_RULESET_VERSION,
  ukSoleTraderRuleSet,
} from "../src/soleTraderRules";
import { authoritativeSoleTraderExpectations } from "../src/soleTraderSyntheticScenarios";

describe("versioned UK sole-trader rules", () => {
  it("matches the reviewed 2026-27 Class 4 and student-loan thresholds", () => {
    expect(ukSoleTraderRuleSet.rulesetVersion).toBe(
      UK_SOLE_TRADER_RULESET_VERSION,
    );
    expect(ukSoleTraderRuleSet.class4NationalInsurance).toMatchObject(
      authoritativeSoleTraderExpectations.class4,
    );
    expect(ukSoleTraderRuleSet.studentLoans.thresholdsPence["plan-2"]).toBe(
      authoritativeSoleTraderExpectations.plan2.thresholdPence,
    );
    expect(ukSoleTraderRuleSet.studentLoans.standardRateBasisPoints).toBe(
      authoritativeSoleTraderExpectations.plan2.rateBasisPoints,
    );
  });

  it("keeps payment-on-account thresholds and sources in the released ruleset", () => {
    expect(ukSoleTraderRuleSet.paymentsOnAccount).toMatchObject({
      minimumRelevantAmountPence:
        authoritativeSoleTraderExpectations.paymentsOnAccount
          .minimumRelevantAmountPence,
      instalmentShareBasisPoints:
        authoritativeSoleTraderExpectations.paymentsOnAccount
          .instalmentShareBasisPoints,
    });
    expect(ukSoleTraderRuleSet.sources).toHaveLength(5);
    expect(
      ukSoleTraderRuleSet.sources.every(
        (source) => new URL(source.url).hostname === "www.gov.uk",
      ),
    ).toBe(true);
  });
});
