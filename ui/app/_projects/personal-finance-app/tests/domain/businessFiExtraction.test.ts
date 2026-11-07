import {
  corporationTaxBoundaryScenario,
  insufficientProfitLimitedCompanyScenario,
} from "personal-finance-contracts/limited-company-synthetic-scenarios";
import { describe, expect, it } from "vitest";
import {
  type BusinessFiPlanInput,
  compareBusinessFiPlans,
  evaluateBusinessFiPlan,
} from "@/app/_projects/personal-finance-app/domain";
import {
  businessFiPlanFixture,
  fullBusinessOwnershipFixture,
} from "@/app/_projects/personal-finance-app/tests/fixtures/businessFiExtraction";

describe("business FI extraction", () => {
  it("stages company cash and pension value without treating the business valuation as spendable", () => {
    const result = evaluateBusinessFiPlan(businessFiPlanFixture());

    expect(result.status).toBe("available");
    expect(result.company).toMatchObject({
      grossCompanyValuePence: 25_000_000,
      ownershipShare: 1,
      netHouseholdValuePence: 25_000_000,
      excludedFromAccessibleCapital: true,
    });
    expect(result.capital.totalEconomicNetWorthPence).toBe(30_000_000);
    expect(result.capital.capitalAvailableNowPence).toBe(5_000_000);
    expect(result.capital.futureAccessibleCapitalPence).toBeGreaterThan(
      1_000_000,
    );
    expect(result.capital.fiEligibleCapitalPence).toBeLessThan(
      result.capital.totalEconomicNetWorthPence +
        result.strategyNetHouseholdValuePence,
    );
    expect(result.periods).toHaveLength(2);
    expect(result.periods[0]).toMatchObject({
      timing: {
        salaryPaidOn: "2026-03-31",
        dividendPaidOn: "2026-03-31",
        employerPensionContributedOn: "2026-03-31",
      },
      company: { operatingReservePence: 0 },
      taxAndAllowances: {
        employmentAllowanceUsedPence: 0,
        pensionAnnualAllowancePence: 6_000_000,
        pensionTotalCapacityPence: 6_000_000,
        pensionExcessPence: 0,
      },
    });
    expect(result.pensionContributions[0]).toMatchObject({
      accessibleOn: "2035-04-06",
      supported: true,
    });
    expect(result.deferredEvent).toMatchObject({
      kind: "deferred-dividend",
      destination: "household-cash",
    });
    expect(result.lineage).toMatchObject({
      valuationRecordIds: ["valuation:software-company"],
      constraintRecordIds: [
        "constraint:period:2025-26",
        "constraint:period:2026-27",
      ],
      limitedCompanyCalculationVersion: "1",
      limitedCompanyRulesetVersion: "2026-11-06",
    });
    expect(result.lineage.ownershipRecordIds).toEqual([
      "ownership:software-company:full",
    ]);
    expect(result.lineage.ruleIds.length).toBeGreaterThan(0);
  });

  it("supports explicit exclusion while keeping company value in net worth", () => {
    const input = businessFiPlanFixture();
    input.treatment = {
      kind: "exclude",
      recordId: "fi-treatment:exclude",
      reason: "Do not rely on the company for FI.",
    };

    const result = evaluateBusinessFiPlan(input);

    expect(result.status).toBe("excluded");
    expect(result.capital).toMatchObject({
      totalEconomicNetWorthPence: 30_000_000,
      capitalAvailableNowPence: 5_000_000,
      futureAccessibleCapitalPence: 1_000_000,
      fiEligibleCapitalPence: 9_200_000,
      incrementalFiEligibleCapitalPence: 0,
    });
    expect(result.periods).toEqual([]);
  });

  it("retains surplus behind dated operating reserves until an extraction is selected", () => {
    const extracted = evaluateBusinessFiPlan(businessFiPlanFixture());
    const retainedInput = businessFiPlanFixture();
    if (retainedInput.treatment.kind !== "limited-company-extraction") {
      throw new Error("Missing extraction treatment");
    }
    retainedInput.treatment.deferredExtraction = { kind: "retain" };
    retainedInput.liquidityConstraints =
      retainedInput.liquidityConstraints?.map((constraint) => ({
        ...constraint,
        operatingReservePence: 100_000,
        companyLiabilitiesPence: 50_000,
      }));

    const retained = evaluateBusinessFiPlan(retainedInput);

    expect(retained.status).toBe("available");
    expect(retained.deferredEvent).toBeNull();
    expect(retained.company.retainedCompanyCashPence).toBeGreaterThan(0);
    expect(retained.company.retainedDistributableReservesPence).toBeGreaterThan(
      0,
    );
    expect(retained.capital.futureAccessibleCapitalPence).toBeLessThan(
      extracted.capital.futureAccessibleCapitalPence,
    );
    expect(retained.deductions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "operating-reserve",
          amountPence: 100_000,
        }),
        expect.objectContaining({
          kind: "company-liabilities",
          amountPence: 50_000,
        }),
      ]),
    );
  });

  it("blocks the affected strategy when dividends exceed distributable reserves", () => {
    const result = evaluateBusinessFiPlan(
      businessFiPlanFixture({
        scenario: insufficientProfitLimitedCompanyScenario,
        strategyId: "strategy:excess-dividend",
      }),
    );

    expect(result.status).toBe("blocked");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "insufficient-distributable-profits" }),
      ]),
    );
    expect(result.capital.incrementalFiEligibleCapitalPence).toBe(0);
  });

  it("uses dated ownership and blocks extraction after ownership falls below full control", () => {
    const input = businessFiPlanFixture();
    const [full] = fullBusinessOwnershipFixture();
    if (full == null) throw new Error("Missing full ownership fixture");
    input.shareOwnershipInterests = [
      { ...full, effectiveTo: "2026-07-01" },
      {
        ...full,
        recordId: "ownership:software-company:half",
        fraction: { state: "known", fraction: 0.5 },
        effectiveFrom: "2026-07-01",
      },
    ];

    const result = evaluateBusinessFiPlan(input);

    expect(result.status).toBe("blocked");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "unsupported-extraction-ownership",
          companyPeriodId: "period:2026-27",
        }),
      ]),
    );
    expect(result.lineage.ownershipRecordIds).toEqual([
      "ownership:software-company:full",
      "ownership:software-company:half",
    ]);
  });

  it("uses the released Corporation Tax boundary and rejects periods outside its effective rules", () => {
    const supported = evaluateBusinessFiPlan(
      businessFiPlanFixture({
        scenario: corporationTaxBoundaryScenario(5_000_000),
        strategyId: "strategy:boundary",
      }),
    );
    const unsupportedInput = businessFiPlanFixture({
      scenario: corporationTaxBoundaryScenario(5_000_000),
      strategyId: "strategy:boundary",
    });
    const unsupportedScenario = structuredClone(
      unsupportedInput.limitedCompanyScenario,
    );
    if (unsupportedScenario == null)
      throw new Error("Missing boundary scenario");
    const period = unsupportedScenario.companyPeriods[0];
    if (period == null) throw new Error("Missing boundary period");
    period.taxYear = "2027-28";
    period.accountingPeriodStartsOn = "2027-04-01";
    period.accountingPeriodEndsOn = "2028-03-31";
    unsupportedInput.limitedCompanyScenario = unsupportedScenario;
    if (unsupportedInput.treatment.kind !== "limited-company-extraction") {
      throw new Error("Missing extraction treatment");
    }
    unsupportedInput.treatment.periodTimings = [
      {
        companyPeriodId: period.id,
        salaryPaidOn: period.accountingPeriodEndsOn,
        dividendPaidOn: period.accountingPeriodEndsOn,
        employerPensionContributedOn: period.accountingPeriodEndsOn,
        householdCashAvailableOn: period.accountingPeriodEndsOn,
      },
    ];
    unsupportedInput.liquidityConstraints = [
      {
        recordId: "constraint:outside-tax-rules",
        companyPeriodId: period.id,
        effectiveFrom: period.accountingPeriodStartsOn,
        acceptedAt: unsupportedInput.asKnownAt,
        operatingReservePence: 0,
        companyLiabilitiesPence: 0,
        unavailableCashPence: 0,
        inputRecordIds: [],
      },
    ];

    const unsupported = evaluateBusinessFiPlan(unsupportedInput);

    expect(supported.status).toBe("available");
    expect(supported.periods[0]?.company).toMatchObject({
      closingDistributableReservesPence: expect.any(Number),
    });
    expect(unsupported.status).toBe("blocked");
    expect(unsupported.issues.map(({ kind }) => kind)).toContain(
      "unsupported-tax-year",
    );
    expect(unsupported.issues.map(({ kind }) => kind)).toContain(
      "unsupported-corporation-tax-period",
    );
  });

  it("blocks unavailable cash after tax, liabilities, and a dated operating reserve", () => {
    const input = businessFiPlanFixture();
    input.liquidityConstraints = input.liquidityConstraints?.map(
      (constraint, index) =>
        index === 1
          ? {
              ...constraint,
              operatingReservePence: 100_000_000,
              companyLiabilitiesPence: 5_000_000,
              unavailableCashPence: 1_000_000,
            }
          : constraint,
    );

    const result = evaluateBusinessFiPlan(input);

    expect(result.status).toBe("blocked");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "unavailable-company-cash",
          companyPeriodId: "period:2026-27",
        }),
        expect.objectContaining({ kind: "unavailable-later-extraction-cash" }),
      ]),
    );
    expect(result.capital.incrementalFiEligibleCapitalPence).toBe(0);
  });

  it("does not count cash or pension transfers already present in household balances", () => {
    const baseline = evaluateBusinessFiPlan(businessFiPlanFixture());
    const reflectedIds = [
      "business-fi:continue-trading:period:2025-26:household-cash",
      "business-fi:continue-trading:period:2025-26:employer-pension",
    ];
    const reflected = evaluateBusinessFiPlan(
      businessFiPlanFixture({ reflectedEventIds: reflectedIds }),
    );
    const firstCash = baseline.periods[0]?.events.find(
      ({ kind }) => kind === "household-cash",
    );
    const firstPension = baseline.periods[0]?.events.find(
      ({ kind }) => kind === "employer-pension",
    );
    if (firstCash == null || firstPension == null) {
      throw new Error("Missing first-period extraction events");
    }

    expect(reflected.status).toBe("available");
    expect(
      baseline.capital.incrementalFiEligibleCapitalPence -
        reflected.capital.incrementalFiEligibleCapitalPence,
    ).toBe(
      firstCash.netHouseholdValuePence + firstPension.netHouseholdValuePence,
    );
    expect(reflected.strategyNetHouseholdValuePence).toBe(
      baseline.strategyNetHouseholdValuePence,
    );
    expect(
      reflected.periods[0]?.events
        .filter(
          (event) => event.alreadyReflected && reflectedIds.includes(event.id),
        )
        .map(({ id }) => id),
    ).toEqual(reflectedIds);
  });

  it("compares an available plan without letting a blocked alternative contaminate it", () => {
    const excluded = businessFiPlanFixture();
    excluded.id = "exclude";
    excluded.treatment = {
      kind: "exclude",
      recordId: "fi-treatment:exclude",
      reason: "Keep the company outside FI planning.",
    };
    const blocked = businessFiPlanFixture({
      scenario: insufficientProfitLimitedCompanyScenario,
      strategyId: "strategy:excess-dividend",
    });
    blocked.id = "blocked";

    const results = compareBusinessFiPlans([
      blocked,
      businessFiPlanFixture(),
      excluded,
    ] as BusinessFiPlanInput[]);

    expect(results.map(({ status }) => status)).toEqual([
      "available",
      "excluded",
      "blocked",
    ]);
    expect(results[0]?.issues).toEqual([]);
  });
});
