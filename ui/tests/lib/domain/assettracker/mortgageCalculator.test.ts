import { describe, expect, it } from "vitest";
import {
  calculateMortgageOptions,
  type MortgageCalculatorAssumptions,
} from "@/lib/domain/assettracker";

function assumptions(
  overrides: Partial<MortgageCalculatorAssumptions> = {},
): MortgageCalculatorAssumptions {
  return {
    purchasePrice: 300_000,
    availableFunds: 100_000,
    depositAmount: 60_000,
    initialAnnualRate: 0.04,
    termMonths: 240,
    repaymentType: "repayment",
    accrualStartDate: "2026-01-15",
    firstPaymentDate: "2026-02-01",
    fixedPeriodEnd: "2028-02-01",
    followOnAnnualRate: 0.06,
    refinanceFee: 999,
    purchaseFees: 1_000,
    taxes: 2_000,
    transactionCosts: 3_000,
    monthlyOverpayment: 0,
    overpaymentAllowance: 10_000,
    overpaymentChargeRate: 0.05,
    ...overrides,
  };
}

describe("calculateMortgageOptions", () => {
  it("compares deposit amount, percentage, liquidity, repayment, and interest", () => {
    const result = calculateMortgageOptions(assumptions());

    expect(result.depositOptions).toHaveLength(3);
    expect(result.selected).toMatchObject({
      depositAmount: 60_000,
      depositPercentage: 0.2,
      openingLoan: 240_000,
      loanToValue: 0.8,
      retainedLiquidity: 34_000,
      fundingShortfall: 0,
    });
    expect(result.depositOptions[0]?.initialMonthlyPayment).toBeGreaterThan(
      result.selected.initialMonthlyPayment,
    );
    expect(result.depositOptions[2]?.totalInterest).toBeLessThan(
      result.selected.totalInterest,
    );
  });

  it("models fix expiry, refinancing, and rate stress", () => {
    const result = calculateMortgageOptions(assumptions());
    const firstAfterFix = result.selected.schedule.find(
      (row) => row.date === "2028-02-01",
    );

    expect(firstAfterFix?.annualRate).toBe(0.06);
    expect(firstAfterFix?.fees).toBe(999);
    expect(result.selected.balanceAtFixExpiry).toBeGreaterThan(0);
    expect(result.rateStress.map((row) => row.initialAnnualRate)).toEqual([
      0.02, 0.04, 0.06,
    ]);
    expect(result.rateStress[2]?.totalInterest).toBeGreaterThan(
      result.rateStress[1]?.totalInterest ?? 0,
    );
  });

  it("covers zero interest and exact payoff", () => {
    const result = calculateMortgageOptions(
      assumptions({
        purchasePrice: 120_000,
        depositAmount: 0,
        initialAnnualRate: 0,
        followOnAnnualRate: 0,
        fixedPeriodEnd: undefined,
        refinanceFee: 0,
        purchaseFees: 0,
        taxes: 0,
        transactionCosts: 0,
        termMonths: 12,
      }),
    );

    expect(result.selected.initialMonthlyPayment).toBe(10_000);
    expect(result.selected.totalInterest).toBe(0);
    expect(result.selected.schedule).toHaveLength(12);
    expect(result.selected.schedule.at(-1)?.closingBalance).toBe(0);
  });

  it("includes overpayment penalties and pays off early", () => {
    const result = calculateMortgageOptions(
      assumptions({
        purchasePrice: 100_000,
        depositAmount: 0,
        availableFunds: 0,
        initialAnnualRate: 0,
        followOnAnnualRate: 0,
        fixedPeriodEnd: undefined,
        refinanceFee: 0,
        purchaseFees: 0,
        taxes: 0,
        transactionCosts: 0,
        termMonths: 100,
        monthlyOverpayment: 1_000,
        overpaymentAllowance: 500,
        overpaymentChargeRate: 0.1,
      }),
    );

    expect(result.selected.schedule[0]?.overpaymentCharge).toBe(50);
    expect(result.selected.schedule).toHaveLength(50);
    expect(result.selected.schedule.at(-1)?.closingBalance).toBe(0);
  });

  it("supports interest-only scenarios", () => {
    const result = calculateMortgageOptions(
      assumptions({
        repaymentType: "interest-only",
        termMonths: 12,
        fixedPeriodEnd: undefined,
        refinanceFee: 0,
      }),
    );

    expect(result.selected.schedule[0]?.principal).toBe(0);
    expect(result.selected.schedule.at(-1)?.principal).toBe(240_000);
  });
});
