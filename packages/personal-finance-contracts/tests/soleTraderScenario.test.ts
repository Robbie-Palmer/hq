import { parseCountryCode } from "iso-codes";
import { describe, expect, it } from "vitest";
import {
  SOLE_TRADER_CALCULATION_VERSION,
  evaluateSoleTraderScenario,
} from "../src/soleTraderScenario";
import {
  correctedSoleTraderScenario,
  employmentPlusTradingSoleTraderScenario,
  higherPensionSoleTraderScenario,
  lowRevenueSoleTraderScenario,
  unsupportedLossSoleTraderScenario,
  vatThresholdSoleTraderScenario,
} from "../src/soleTraderSyntheticScenarios";

describe("UK sole-trader side-income scenario", () => {
  it("calculates employment plus trading, cash timing, reserve, and obligations", () => {
    const result = evaluateSoleTraderScenario(
      employmentPlusTradingSoleTraderScenario,
    );

    expect(result.available).toBe(true);
    expect(result.calculationVersion).toBe(SOLE_TRADER_CALCULATION_VERSION);
    expect(result.profit).toEqual({
      grossRevenuePence: 1_000_000,
      totalBusinessCostsPence: 280_000,
      accountingProfitPence: 720_000,
      allowableExpensesPence: 280_000,
      disallowableExpensesPence: 0,
      deductionMethod: "actual-expenses",
      tradingAllowancePence: 0,
      taxableProfitPence: 720_000,
    });
    expect(result.tax?.baseline).toMatchObject({
      annualIncomePence: 6_050_000,
      studentLoanIncomePence: 6_000_000,
      incomeTaxPence: 1_063_200,
      studentLoanPence: 275_535,
    });
    expect(result.tax?.withSoleTraderProfit).toMatchObject({
      annualIncomePence: 6_770_000,
      studentLoanIncomePence: 6_720_000,
      incomeTaxPence: 1_351_200,
      class4NationalInsurancePence: 0,
      studentLoanPence: 340_335,
      studentLoanDueThroughSelfAssessmentPence: 64_800,
    });
    expect(result.tax?.incremental).toEqual({
      incomeTaxPence: 288_000,
      class4NationalInsurancePence: 0,
      studentLoanPence: 64_800,
      totalPence: 352_800,
    });
    expect(result.tax?.nationalInsuranceRecord).toBe(
      "class-2-treated-as-paid",
    );
    expect(result.tax?.payments).toMatchObject({
      relevantAmountPence: 288_000,
      paymentsOnAccountRequired: true,
      eachPaymentOnAccountPence: 144_000,
      balancingPaymentPence: 352_800,
    });
    expect(result.household.netBenefitPence).toBe(367_200);
    expect(result.cashFlow.totals).toMatchObject({
      cashReceivedPence: 900_000,
      unpaidInvoicesPence: 100_000,
      bookkeepingCostsPence: 30_000,
      accountancyCostsPence: 50_000,
      personalWithdrawalsPence: 350_000,
      availableCashPence: 120_000,
      taxReservePence: 150_000,
    });
    expect(result.reserve).toMatchObject({
      annualLiabilityReservePence: 352_800,
      firstDeadlineCashNeedPence: 496_800,
      currentReservePence: 150_000,
      annualLiabilityReserveGapPence: 202_800,
      firstDeadlineReserveGapPence: 346_800,
    });
    expect(result.obligations.selfAssessmentRegistration).toEqual({
      status: "required",
      dueOn: "2027-10-05",
    });
    expect(result.obligations.paymentsOnAccount).toMatchObject({
      required: true,
      studentLoansExcludedFromBasis: true,
    });
    expect(result.obligations.paymentsOnAccount.schedule).toEqual([
      {
        kind: "balancing-payment",
        dueOn: "2028-01-31",
        amountPence: 352_800,
        creditsNextTaxYear: false,
      },
      {
        kind: "first-payment-on-account",
        dueOn: "2028-01-31",
        amountPence: 144_000,
        creditsNextTaxYear: true,
      },
      {
        kind: "second-payment-on-account",
        dueOn: "2028-07-31",
        amountPence: 144_000,
        creditsNextTaxYear: true,
      },
    ]);
  });

  it("uses full trading-allowance relief for low revenue and keeps unpaid cash separate", () => {
    const result = evaluateSoleTraderScenario(lowRevenueSoleTraderScenario);

    expect(result.available).toBe(true);
    expect(result.profit).toMatchObject({
      accountingProfitPence: 35_000,
      deductionMethod: "trading-allowance",
      tradingAllowancePence: 50_000,
      taxableProfitPence: 0,
    });
    expect(result.tax?.incremental.totalPence).toBe(0);
    expect(result.tax?.nationalInsuranceRecord).toBe(
      "voluntary-class-2-available",
    );
    expect(result.cashFlow.totals).toMatchObject({
      cashReceivedPence: 40_000,
      unpaidInvoicesPence: 10_000,
      availableCashPence: 15_000,
    });
    expect(result.obligations.selfAssessmentRegistration.status).toBe(
      "not-required",
    );
    expect(result.obligations.vatRegistration).toEqual({
      status: "optional",
      voluntaryRegistrationAvailable: true,
    });
  });

  it("never combines actual expenses with the trading allowance", () => {
    const result = evaluateSoleTraderScenario({
      ...employmentPlusTradingSoleTraderScenario,
      deductionMethod: "trading-allowance",
    });

    expect(result.profit).toMatchObject({
      allowableExpensesPence: 280_000,
      deductionMethod: "trading-allowance",
      tradingAllowancePence: 100_000,
      taxableProfitPence: 900_000,
    });
  });

  it("applies both payment-on-account exceptions at their exact boundaries", () => {
    const belowCashThreshold = evaluateSoleTraderScenario({
      ...employmentPlusTradingSoleTraderScenario,
      incomeTaxDeductedAtSourcePence: 1_251_201,
    });
    const exactlyEightyPercentAtSource = evaluateSoleTraderScenario({
      ...employmentPlusTradingSoleTraderScenario,
      incomeTaxDeductedAtSourcePence: 1_080_960,
    });
    const moreThanEightyPercentAtSource = evaluateSoleTraderScenario({
      ...employmentPlusTradingSoleTraderScenario,
      incomeTaxDeductedAtSourcePence: 1_080_961,
    });

    expect(
      belowCashThreshold.tax?.payments.paymentsOnAccountRequired,
    ).toBe(false);
    expect(
      exactlyEightyPercentAtSource.tax?.payments.paymentsOnAccountRequired,
    ).toBe(true);
    expect(
      moreThanEightyPercentAtSource.tax?.payments.paymentsOnAccountRequired,
    ).toBe(false);
  });

  it("adds postgraduate repayments to the annual delta but not payments on account", () => {
    const result = evaluateSoleTraderScenario({
      ...employmentPlusTradingSoleTraderScenario,
      studentLoan: {
        ...employmentPlusTradingSoleTraderScenario.studentLoan,
        postgraduateLoan: true,
        postgraduateLoanDeductedByPayePence: 234_000,
      },
    });

    expect(result.tax?.incremental.studentLoanPence).toBe(108_000);
    expect(result.tax?.incremental.totalPence).toBe(396_000);
    expect(result.tax?.payments.relevantAmountPence).toBe(288_000);
    expect(result.tax?.payments.eachPaymentOnAccountPence).toBe(144_000);
  });

  it("distinguishes disallowable costs from accounting profit", () => {
    const result = evaluateSoleTraderScenario({
      ...employmentPlusTradingSoleTraderScenario,
      expenseTreatments:
        employmentPlusTradingSoleTraderScenario.expenseTreatments.map(
          (treatment) =>
            treatment.factId === "fact:accountancy"
              ? { ...treatment, taxTreatment: "disallowable" as const }
              : treatment,
        ),
    });

    expect(result.profit).toMatchObject({
      totalBusinessCostsPence: 280_000,
      accountingProfitPence: 720_000,
      allowableExpensesPence: 230_000,
      disallowableExpensesPence: 50_000,
      taxableProfitPence: 770_000,
    });
  });

  it("flags a trading loss instead of assuming a relief", () => {
    const result = evaluateSoleTraderScenario(
      unsupportedLossSoleTraderScenario,
    );

    expect(result.available).toBe(false);
    expect(result.tax).toBeNull();
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "unsupported-trading-loss",
        state: "unsupported",
      }),
    );
  });

  it("stops before tax for international and non-sole-trader structures", () => {
    const crossBorder = evaluateSoleTraderScenario({
      ...employmentPlusTradingSoleTraderScenario,
      sideIncomeCase: {
        ...employmentPlusTradingSoleTraderScenario.sideIncomeCase,
        customerArrangements:
          employmentPlusTradingSoleTraderScenario.sideIncomeCase.customerArrangements.map(
            (arrangement) => ({
              ...arrangement,
              customerJurisdiction: parseCountryCode("US"),
            }),
          ),
      },
    });
    const company = evaluateSoleTraderScenario({
      ...employmentPlusTradingSoleTraderScenario,
      sideIncomeCase: {
        ...employmentPlusTradingSoleTraderScenario.sideIncomeCase,
        businesses:
          employmentPlusTradingSoleTraderScenario.sideIncomeCase.businesses.map(
            (business) => ({
              ...business,
              structure: "uk-limited-company" as const,
            }),
          ),
      },
    });

    expect(crossBorder.tax).toBeNull();
    expect(crossBorder.issues).toContainEqual(
      expect.objectContaining({ code: "cross-border", state: "unsupported" }),
    );
    expect(company.tax).toBeNull();
    expect(company.issues).toContainEqual(
      expect.objectContaining({
        code: "non-sole-trader-structure",
        state: "unsupported",
      }),
    );
  });

  it("recalculates from a corrected released case revision", () => {
    const original = evaluateSoleTraderScenario(
      employmentPlusTradingSoleTraderScenario,
    );
    const corrected = evaluateSoleTraderScenario(correctedSoleTraderScenario);

    expect(corrected.available).toBe(true);
    expect(corrected.profit.taxableProfitPence).toBe(520_000);
    expect(corrected.tax?.incremental.totalPence).toBeLessThan(
      original.tax?.incremental.totalPence ?? 0,
    );
    expect(
      corrected.lineage.sourceLineage.find(
        (source) => source.factId === "fact:freelance-revenue",
      )?.sourceRevision,
    ).toBe("2");
  });

  it("shows the marginal Income Tax effect of a changed pension contribution", () => {
    const original = evaluateSoleTraderScenario(
      employmentPlusTradingSoleTraderScenario,
    );
    const higherPension = evaluateSoleTraderScenario(
      higherPensionSoleTraderScenario,
    );

    expect(higherPension.available).toBe(true);
    expect(higherPension.tax?.incremental.incomeTaxPence).toBeLessThan(
      original.tax?.incremental.incomeTaxPence ?? 0,
    );
    expect(higherPension.tax?.incremental.studentLoanPence).toBe(
      original.tax?.incremental.studentLoanPence,
    );
  });

  it("requires VAT above the rolling threshold and calculates both Class 4 bands", () => {
    const result = evaluateSoleTraderScenario(vatThresholdSoleTraderScenario);

    expect(result.available).toBe(true);
    expect(result.obligations.vatRegistration).toEqual({
      status: "required",
      voluntaryRegistrationAvailable: false,
    });
    expect(result.profit.taxableProfitPence).toBe(9_220_000);
    expect(result.tax?.withSoleTraderProfit.class4NationalInsurancePence).toBe(
      310_060,
    );
  });

  it("exports fact, rule, and official-source lineage", () => {
    const result = evaluateSoleTraderScenario(
      employmentPlusTradingSoleTraderScenario,
    );

    expect(result.lineage.financialFactIds).toContain(
      "fact:freelance-revenue",
    );
    expect(result.lineage.ruleIds).toContain(
      "uk.sole-trader.class-4-ni.2026-27",
    );
    expect(result.lineage.taxRuleDatasetVersion).toMatch(/^2026\.10\./);
    expect(
      result.lineage.sources.every(
        (source) => new URL(source.url).protocol === "https:",
      ),
    ).toBe(true);
  });
});
