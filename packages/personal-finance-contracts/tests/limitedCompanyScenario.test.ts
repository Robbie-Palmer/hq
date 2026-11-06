import { describe, expect, it } from "vitest";
import {
  LIMITED_COMPANY_CALCULATION_VERSION,
  evaluateLimitedCompanyScenario,
} from "../src/limitedCompanyScenario";
import {
  corporationTaxBoundaryScenario,
  insufficientProfitLimitedCompanyScenario,
  multiPeriodLimitedCompanyScenario,
} from "../src/limitedCompanySyntheticScenarios";

const pensionStrategy = () =>
  evaluateLimitedCompanyScenario(multiPeriodLimitedCompanyScenario).strategies.find(
    ({ id }) => id === "strategy:pension-and-retain",
  );

describe("UK limited-company side-income scenario", () => {
  it("keeps the company separate and carries retained reserves across periods", () => {
    const result = evaluateLimitedCompanyScenario(
      multiPeriodLimitedCompanyScenario,
    );
    const strategy = result.strategies.find(
      ({ id }) => id === "strategy:pension-and-retain",
    );

    expect(result.calculationVersion).toBe(
      LIMITED_COMPANY_CALCULATION_VERSION,
    );
    expect(result.entityBoundary).toEqual({
      companyCashIsHouseholdCash: false,
      vatIncludedInCompanyRevenue: false,
      retainedProfitRequiresLaterExtraction: true,
    });
    expect(strategy?.periods).toHaveLength(2);
    expect(strategy?.periods[0]?.profit).toMatchObject({
      grossRevenuePence: 4_000_000,
      totalOperatingCostsPence: 300_000,
      salaryPence: 1_257_000,
      employerNationalInsurancePence: 113_550,
      employerPensionContributionPence: 1_000_000,
      taxableProfitPence: 1_329_450,
      dividendDeclaredPence: 500_000,
    });
    expect(strategy?.periods[1]?.profit.distributableProfitBeforeDividendPence)
      .toBeGreaterThan(strategy?.periods[0]?.profit.closingDistributableReservesPence ?? 0);
    expect(strategy?.periods[1]?.companyCash.separatelyOwnedByCompany).toBe(
      true,
    );
    expect(strategy?.periods[1]?.companyCash.unpaidCorporationTaxPence).toBe(
      (strategy?.periods[0]?.profit.corporationTax.corporationTaxPence ?? 0) +
        (strategy?.periods[1]?.profit.corporationTax.corporationTaxPence ?? 0),
    );
    expect(strategy?.deferredExtraction.grossDividendPence).toBeGreaterThan(0);
    expect(strategy?.deferredExtraction.estimatedLaterDividendTaxPence)
      .toBeGreaterThan(0);
  });

  it("stacks salary and dividends on the owner's employment income", () => {
    const result = evaluateLimitedCompanyScenario(
      multiPeriodLimitedCompanyScenario,
    );
    const pension = result.strategies.find(
      ({ id }) => id === "strategy:pension-and-retain",
    );
    const cash = result.strategies.find(
      ({ id }) => id === "strategy:cash-first",
    );

    expect(pension?.periods[1]?.household.incrementalPersonalTaxPence)
      .toBeGreaterThan(0);
    expect(cash?.periods[1]?.household.incrementalPersonalTaxPence)
      .toBeGreaterThan(
        pension?.periods[1]?.household.incrementalPersonalTaxPence ?? 0,
      );
    expect(result.comparison).toHaveLength(2);
    expect(result.recommendedStrategyId).not.toBeNull();
  });

  it.each([
    [5_000_000, "small-profits", 950_000],
    [10_000_000, "marginal-relief", 2_275_000],
    [25_000_000, "main-rate", 6_250_000],
  ])(
    "applies the Corporation Tax boundary at %ip",
    (profitPence, expectedBand, expectedTaxPence) => {
      const result = evaluateLimitedCompanyScenario(
        corporationTaxBoundaryScenario(profitPence),
      );
      const tax = result.strategies[0]?.periods[0]?.profit.corporationTax;

      expect(tax?.band).toBe(expectedBand);
      expect(tax?.corporationTaxPence).toBe(expectedTaxPence);
    },
  );

  it("scales both marginal-relief limits for associated companies", () => {
    const result = evaluateLimitedCompanyScenario(
      corporationTaxBoundaryScenario(5_000_000, 2),
    );
    const tax = result.strategies[0]?.periods[0]?.profit.corporationTax;

    expect(tax).toMatchObject({
      band: "marginal-relief",
      lowerLimitPence: 2_500_000,
      upperLimitPence: 12_500_000,
      marginalReliefPence: 112_500,
      corporationTaxPence: 1_137_500,
    });
  });

  it("does not grant Employment Allowance to an otherwise lone director", () => {
    const period = pensionStrategy()?.periods[0];

    expect(period?.payroll).toMatchObject({
      directorLiabilityPence: 113_550,
      grossLiabilityPence: 113_550,
      employmentAllowanceUsedPence: 0,
      employerNiPence: 113_550,
    });
  });

  it("uses an explicitly eligible Employment Allowance without making NI negative", () => {
    const scenario = structuredClone(multiPeriodLimitedCompanyScenario);
    const plan = scenario.strategies[0]?.periodPlans[0];
    if (plan === undefined) throw new Error("Missing synthetic plan");
    plan.employmentAllowanceEligibility = "eligible";
    plan.employmentAllowanceRemainingPence = 1_050_000;
    const result = evaluateLimitedCompanyScenario(scenario);
    const payroll = result.strategies[0]?.periods[0]?.payroll;

    expect(payroll?.grossLiabilityPence).toBe(113_550);
    expect(payroll?.employmentAllowanceUsedPence).toBe(113_550);
    expect(payroll?.employerNiPence).toBe(0);
  });

  it("rejects pension input above the available annual capacity", () => {
    const scenario = structuredClone(multiPeriodLimitedCompanyScenario);
    const plan = scenario.strategies[0]?.periodPlans[0];
    if (plan === undefined) throw new Error("Missing synthetic plan");
    plan.employerPensionContributionPence = 7_000_000;
    const result = evaluateLimitedCompanyScenario(scenario);

    expect(result.strategies[0]?.issues).toContainEqual(
      expect.objectContaining({
        code: "unsupported-pension-annual-allowance-charge",
        state: "unsupported",
      }),
    );
    expect(result.strategies[0]?.periods[0]?.pension).toMatchObject({
      annualAllowancePence: 6_000_000,
      excessPence: 1_000_000,
    });
  });

  it("models standard VAT as a separate liability with its own deadline", () => {
    const period = pensionStrategy()?.periods[1];

    expect(period?.vat).toMatchObject({
      registrationStatus: "required",
      scheme: "standard-accrual",
      outputVatPence: 2_000_000,
      inputVatReclaimedPence: 200_000,
      liabilityPence: 1_800_000,
      returnDueOn: "2027-05-07",
      passThroughVatIncludedInRevenue: false,
    });
    expect(period?.profit.grossRevenuePence).toBe(10_000_000);
  });

  it("uses the explicit 16.5% limited-cost flat rate and blocks ordinary input VAT", () => {
    const scenario = structuredClone(multiPeriodLimitedCompanyScenario);
    const vat = scenario.companyPeriods[1]?.vat;
    if (vat === undefined) throw new Error("Missing synthetic VAT period");
    vat.scheme = "flat-rate";
    vat.flatRatePercentageBasisPoints = 1_650;
    vat.limitedCostBusiness = "yes";
    const result = evaluateLimitedCompanyScenario(scenario);
    const flatRate = result.strategies[0]?.periods[1]?.vat;

    expect(flatRate).toMatchObject({
      scheme: "flat-rate",
      inputVatReclaimedPence: 0,
      liabilityPence: 1_980_000,
    });
  });

  it("keeps cash-accounting eligibility explicit", () => {
    const scenario = structuredClone(multiPeriodLimitedCompanyScenario);
    const vat = scenario.companyPeriods[1]?.vat;
    if (vat === undefined) throw new Error("Missing synthetic VAT period");
    vat.scheme = "cash-accounting";
    vat.allReturnsAndPaymentsUpToDate = "unknown";
    const result = evaluateLimitedCompanyScenario(scenario);

    expect(result.strategies[0]?.issues).toContainEqual(
      expect.objectContaining({
        code: "cash-vat-eligibility-unconfirmed",
        state: "needs-review",
      }),
    );
  });

  it("uses separate VAT scheme thresholds for joining and continuing", () => {
    const joining = structuredClone(multiPeriodLimitedCompanyScenario);
    const continuing = structuredClone(multiPeriodLimitedCompanyScenario);
    const joiningVat = joining.companyPeriods[1]?.vat;
    const continuingVat = continuing.companyPeriods[1]?.vat;
    if (joiningVat === undefined || continuingVat === undefined) {
      throw new Error("Missing synthetic VAT period");
    }
    for (const vat of [joiningVat, continuingVat]) {
      vat.scheme = "flat-rate";
      vat.taxableTurnoverPence = 20_000_000;
      vat.flatRatePercentageBasisPoints = 1_650;
      vat.limitedCostBusiness = "yes";
    }
    joiningVat.schemeUse = "joining";
    continuingVat.schemeUse = "continuing";

    const joiningResult = evaluateLimitedCompanyScenario(joining);
    const continuingResult = evaluateLimitedCompanyScenario(continuing);
    expect(joiningResult.strategies[0]?.issues).toContainEqual(
      expect.objectContaining({ code: "flat-rate-vat-turnover-ineligible" }),
    );
    expect(
      continuingResult.strategies[0]?.issues.some(
        ({ code }) => code === "flat-rate-vat-turnover-ineligible",
      ),
    ).toBe(false);
  });

  it("rejects dividends above distributable profits", () => {
    const result = evaluateLimitedCompanyScenario(
      insufficientProfitLimitedCompanyScenario,
    );

    expect(result.available).toBe(false);
    expect(result.strategies[0]?.feasible).toBe(false);
    expect(result.strategies[0]?.issues).toContainEqual(
      expect.objectContaining({
        code: "insufficient-distributable-profits",
        state: "unsupported",
      }),
    );
  });

  it("publishes operating costs, administration time, deadlines, and lineage", () => {
    const result = evaluateLimitedCompanyScenario(
      multiPeriodLimitedCompanyScenario,
    );
    const strategy = result.strategies[0];
    const second = strategy?.periods[1];

    expect(second?.profit.categoryCostsPence).toMatchObject({
      direct: 650_000,
      accountancy: 180_000,
      bookkeeping: 90_000,
      payroll: 80_000,
      "companies-house": 5_000,
    });
    expect(strategy?.totals.valuedAdministrationTimePence).toBe(310_000);
    expect(second?.deadlines).toMatchObject({
      annualAccountsDueOn: "2027-12-31",
      corporationTaxPaymentDueOn: "2028-01-01",
      companyTaxReturnDueOn: "2028-03-31",
      vatReturnAndPaymentDueOn: "2027-05-07",
    });
    expect(result.lineage.financialFactIds).toContain(
      "fact:company-revenue-2026",
    );
    expect(result.lineage.sources.some(({ id }) => id === "corporation-tax-rates"))
      .toBe(true);
  });

  it("returns explicit unsupported states instead of guessing", () => {
    const scenario = structuredClone(multiPeriodLimitedCompanyScenario);
    scenario.unsupportedComplexities = ["loans-to-participators"];
    const unsupportedPeriod = scenario.companyPeriods[1];
    if (unsupportedPeriod === undefined) {
      throw new Error("Missing synthetic company period");
    }
    unsupportedPeriod.taxYear = "2027-28";
    const result = evaluateLimitedCompanyScenario(scenario);

    expect(result.available).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unsupported-loans-to-participators" }),
        expect.objectContaining({ code: "unsupported-tax-year" }),
      ]),
    );
  });
});
