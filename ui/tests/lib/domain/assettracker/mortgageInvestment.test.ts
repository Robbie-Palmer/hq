import { describe, expect, it } from "vitest";
import {
  buildMortgageInvestmentSensitivity,
  compareMortgageOverpaymentWithInvestment,
  type MortgageInvestmentComparisonInput,
} from "@/lib/domain/assettracker";

function input(
  overrides: Partial<MortgageInvestmentComparisonInput> = {},
): MortgageInvestmentComparisonInput {
  return {
    asOfDate: "2026-01-01",
    openingMortgageBalance: 100_000,
    initialMortgageRate: 0.04,
    rateChanges: [],
    mortgageTerms: {
      firstPaymentDate: "2026-02-01",
      remainingTermMonths: 120,
      fees: [],
      overpayments: [],
      termChanges: [],
    },
    propertyValue: 300_000,
    propertyAnnualReturn: 0.02,
    availableCapital: 20_000,
    monthlySurplus: 500,
    otherLiquidAssets: 50_000,
    otherNetWorth: 25_000,
    annualSpendingAfterMortgage: 24_000,
    withdrawalRate: 0.04,
    horizonMonths: 120,
    investmentAnnualReturn: 0.06,
    investmentVolatility: 0.15,
    investmentStressMultiple: 1,
    investmentTaxRate: 0,
    investmentAnnualFeeRate: 0,
    penaltyFreeOverpayment: 10_000,
    overpaymentChargeRate: 0,
    ...overrides,
  };
}

describe("compareMortgageOverpaymentWithInvestment", () => {
  it("uses the same starting position and reports separate mortgage, investment, housing, cash-flow, and FI results", () => {
    const result = compareMortgageOverpaymentWithInvestment(input());

    expect(result.overpay.lumpSumOverpayment).toBe(20_000);
    expect(result.invest.lumpSumOverpayment).toBe(0);
    expect(result.overpay.interestPaid).toBeLessThan(
      result.invest.interestPaid,
    );
    expect(
      result.overpay.mortgagePayoffDate.localeCompare(
        result.invest.mortgagePayoffDate,
      ),
    ).toBeLessThan(0);
    expect(result.invest.investmentBalance).toBeGreaterThan(
      result.overpay.investmentBalance,
    );
    expect(result.overpay.propertyValue).toBe(result.invest.propertyValue);
    expect(result.overpay.timeline).toHaveLength(120);
    expect(result.invest.timeline).toHaveLength(120);
    expect(result.overpay.projectedFiDate).not.toBeUndefined();
    expect(result.invest.firstYearMortgageCashRequired).toBeGreaterThan(0);
  });

  it("charges only the overpayment above the contractual allowance", () => {
    const result = compareMortgageOverpaymentWithInvestment(
      input({
        availableCapital: 21_000,
        penaltyFreeOverpayment: 10_000,
        overpaymentChargeRate: 0.1,
      }),
    );

    expect(result.overpay.lumpSumOverpayment).toBe(20_000);
    expect(result.overpay.overpaymentCharge).toBe(1_000);
    expect(result.overpay.mortgageFeesAndCharges).toBe(1_000);
  });

  it("models a rate-fix expiry without changing payments before the expiry", () => {
    const fixed = compareMortgageOverpaymentWithInvestment(input());
    const expiring = compareMortgageOverpaymentWithInvestment(
      input({ rateChanges: [{ date: "2028-02-01", rate: 0.09 }] }),
    );

    expect(
      expiring.invest.timeline.find((point) => point.date === "2027-02-01"),
    ).toEqual(
      fixed.invest.timeline.find((point) => point.date === "2027-02-01"),
    );
    expect(expiring.invest.interestPaid).toBeGreaterThan(
      fixed.invest.interestPaid,
    );
  });

  it("shows negative-return drawdown without treating it as a guaranteed outcome", () => {
    const result = compareMortgageOverpaymentWithInvestment(
      input({
        investmentAnnualReturn: -0.1,
        investmentVolatility: 0.2,
        horizonMonths: 60,
      }),
    );

    expect(result.invest.investmentBalance).toBeLessThan(50_000);
    expect(result.invest.stressedInvestmentBalance).toBeLessThan(
      result.invest.investmentBalance,
    );
    expect(result.invest.drawdownExposure).toBeGreaterThan(0);
  });

  it("handles enough capital to repay the mortgage on the first payment date", () => {
    const result = compareMortgageOverpaymentWithInvestment(
      input({
        openingMortgageBalance: 12_000,
        availableCapital: 20_000,
        mortgageTerms: {
          firstPaymentDate: "2026-02-01",
          remainingTermMonths: 12,
          fees: [],
          overpayments: [],
          termChanges: [],
        },
      }),
    );

    expect(result.overpay.mortgagePayoffDate).toBe("2026-02-01");
    expect(result.overpay.mortgageBalance).toBe(0);
    expect(result.overpay.timeline[0]?.mortgageBalance).toBe(0);
  });

  it("finds the zero-rate break-even case", () => {
    const result = compareMortgageOverpaymentWithInvestment(
      input({
        initialMortgageRate: 0,
        investmentAnnualReturn: 0,
        propertyAnnualReturn: 0,
        monthlySurplus: 0,
        penaltyFreeOverpayment: 100_000,
      }),
    );

    expect(result.breakEvenInvestmentReturn).not.toBeNull();
    expect(result.breakEvenInvestmentReturn ?? 1).toBeCloseTo(0, 3);
    expect(
      Math.abs(result.invest.netWorth - result.overpay.netWorth),
    ).toBeLessThan(1);
  });

  it("varies mortgage and investment returns independently in sensitivity results", () => {
    const results = buildMortgageInvestmentSensitivity(
      input({ horizonMonths: 60 }),
      [0.02, 0.08],
      [-0.05, 0.1],
    );

    expect(results).toHaveLength(4);
    expect(
      results.find(
        (entry) =>
          entry.mortgageRate === 0.08 && entry.investmentReturn === -0.05,
      )?.investNetWorthAdvantage,
    ).toBeLessThan(0);
    expect(
      results.find(
        (entry) =>
          entry.mortgageRate === 0.02 && entry.investmentReturn === 0.1,
      )?.investNetWorthAdvantage,
    ).toBeGreaterThan(0);
  });
});
