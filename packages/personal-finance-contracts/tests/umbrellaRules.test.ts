import { describe, expect, it } from "vitest";
import {
  resolveMinimumWageRule,
  resolveUmbrellaPayrollRule,
  ukUmbrellaRuleSet,
} from "../src/umbrellaRules";

describe("effective-dated umbrella rules", () => {
  it("resolves the 2025-26 and 2026-27 payroll periods", () => {
    const prior = resolveUmbrellaPayrollRule("2025-26", "2026-03-31");
    const current = resolveUmbrellaPayrollRule("2026-27", "2026-11-06");

    expect(prior?.ruleId).toBe("uk.umbrella.payroll.2025-26");
    expect(prior?.studentLoans.thresholdsPence["plan-5"]).toBeNull();
    expect(current).toMatchObject({
      ruleId: "uk.umbrella.payroll.2026-27",
      employerNationalInsurance: {
        rateBasisPoints: 1_500,
        secondaryThresholdPence: { weekly: 9_600, monthly: 41_700 },
      },
    });
    expect(current?.studentLoans.thresholdsPence["plan-5"]).toEqual({
      weekly: 48_076,
      monthly: 208_333,
    });
  });

  it("uses the calendar-date minimum-wage boundary", () => {
    expect(
      resolveMinimumWageRule("2026-03-31")?.hourlyRatesPence[
        "age-21-and-over"
      ],
    ).toBe(1_221);
    expect(
      resolveMinimumWageRule("2026-04-01")?.hourlyRatesPence[
        "age-21-and-over"
      ],
    ).toBe(1_271);
  });

  it("records official levy and holiday rules without assuming applicability", () => {
    expect(ukUmbrellaRuleSet.apprenticeshipLevy).toMatchObject({
      rateBasisPoints: 50,
      annualPayBillThresholdPence: 300_000_000,
      annualAllowancePence: 1_500_000,
    });
    expect(ukUmbrellaRuleSet.holidayPay).toMatchObject({
      statutoryRolledUpRateBasisPoints: 1_207,
      eligibleWorkerPatterns: ["irregular-hours", "part-year"],
    });
    expect(
      ukUmbrellaRuleSet.sources.every(
        ({ url }) => new URL(url).hostname === "www.gov.uk",
      ),
    ).toBe(true);
  });

  it("returns no rule outside reviewed periods", () => {
    expect(resolveUmbrellaPayrollRule("2027-28", "2027-11-06")).toBeUndefined();
    expect(resolveMinimumWageRule("2024-03-31")).toBeUndefined();
  });
});
