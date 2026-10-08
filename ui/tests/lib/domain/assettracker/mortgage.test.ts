import { describe, expect, it } from "vitest";
import {
  advanceMortgageTerms,
  buildMortgageSchedule,
  summarizeMortgageCashFlow,
} from "@/lib/domain/assettracker";

describe("buildMortgageSchedule", () => {
  it("starts from a newer recorded balance without replaying historical payments", () => {
    expect(
      advanceMortgageTerms(
        {
          firstPaymentDate: "2026-01-01",
          remainingTermMonths: 24,
          fees: [
            { date: "2026-02-01", amount: 50 },
            { date: "2026-08-01", amount: 75 },
          ],
          overpayments: [{ date: "2026-03-01", amount: 1_000 }],
          termChanges: [
            { date: "2026-04-01", remainingTermMonths: 12 },
            { date: "2027-01-01", remainingTermMonths: 6 },
          ],
        },
        "2026-06-30",
      ),
    ).toEqual({
      firstPaymentDate: "2026-07-01",
      remainingTermMonths: 9,
      fees: [{ date: "2026-08-01", amount: 75 }],
      overpayments: [],
      termChanges: [{ date: "2027-01-01", remainingTermMonths: 6 }],
    });
  });

  it("reconciles every payment from opening balance to payoff", () => {
    const schedule = buildMortgageSchedule({
      openingBalance: -12_000,
      initialAnnualRate: 0,
      terms: {
        firstPaymentDate: "2026-01-15",
        remainingTermMonths: 12,
        fees: [{ date: "2026-01-15", amount: 50 }],
        overpayments: [{ date: "2026-02-15", amount: 2_000 }],
        termChanges: [],
      },
    });

    expect(schedule).toHaveLength(10);
    expect(schedule[0]).toMatchObject({
      date: "2026-01-15",
      openingBalance: 12_000,
      scheduledPayment: 1_000,
      interest: 0,
      principal: 1_000,
      fees: 50,
      overpayment: 0,
      overpaymentCharge: 0,
      totalDue: 1_050,
      closingBalance: 11_000,
    });
    expect(schedule[1]).toMatchObject({
      principal: 3_000,
      overpayment: 2_000,
      closingBalance: 8_000,
    });
    for (const payment of schedule) {
      expect(payment.openingBalance + payment.interest).toBeCloseTo(
        payment.scheduledPayment + payment.overpayment + payment.closingBalance,
        2,
      );
      expect(payment.totalDue).toBeCloseTo(
        payment.scheduledPayment + payment.overpayment + payment.fees,
        2,
      );
    }
    expect(schedule.at(-1)?.closingBalance).toBe(0);
  });

  it("applies future rate and term changes without changing earlier payments", () => {
    const common = {
      openingBalance: -100_000,
      initialAnnualRate: 0.03,
      terms: {
        firstPaymentDate: "2026-01-01",
        remainingTermMonths: 240,
        fees: [],
        overpayments: [],
        termChanges: [],
      },
    };
    const baseline = buildMortgageSchedule(common);
    const changed = buildMortgageSchedule({
      ...common,
      rateChanges: [{ date: "2026-07-01", rate: 0.05 }],
      terms: {
        ...common.terms,
        termChanges: [{ date: "2027-01-01", remainingTermMonths: 120 }],
      },
    });

    expect(changed.slice(0, 6)).toEqual(baseline.slice(0, 6));
    expect(changed[6]?.scheduledPayment).toBeGreaterThan(
      baseline[6]?.scheduledPayment ?? 0,
    );
    expect(changed[12]?.scheduledPayment).toBeGreaterThan(
      changed[11]?.scheduledPayment ?? 0,
    );
  });

  it("summarizes required cash, economic cost, principal, and payoff", () => {
    const schedule = buildMortgageSchedule({
      openingBalance: -12_000,
      initialAnnualRate: 0,
      terms: {
        firstPaymentDate: "2026-01-01",
        remainingTermMonths: 12,
        fees: [{ date: "2026-02-01", amount: 25 }],
        overpayments: [],
        termChanges: [],
      },
    });

    expect(summarizeMortgageCashFlow(schedule, "2025-12-31")).toEqual({
      annualRequiredCashFlow: 12_025,
      annualEconomicCost: 25,
      annualPrincipal: 12_000,
      payoffDate: "2026-12-01",
    });
  });

  it("supports interest-only schedules with a final principal payment", () => {
    const schedule = buildMortgageSchedule({
      openingBalance: -12_000,
      initialAnnualRate: 0.06,
      repaymentType: "interest-only",
      terms: {
        firstPaymentDate: "2026-01-01",
        remainingTermMonths: 12,
        fees: [],
        overpayments: [],
        termChanges: [],
      },
    });

    expect(schedule).toHaveLength(12);
    expect(schedule[0]).toMatchObject({
      scheduledPayment: 60,
      interest: 60,
      principal: 0,
      closingBalance: 12_000,
    });
    expect(schedule.at(-1)).toMatchObject({
      scheduledPayment: 12_060,
      interest: 60,
      principal: 12_000,
      closingBalance: 0,
    });
  });

  it("charges overpayments above the annual allowance", () => {
    const schedule = buildMortgageSchedule({
      openingBalance: -20_000,
      initialAnnualRate: 0,
      monthlyOverpayment: 1_000,
      terms: {
        firstPaymentDate: "2026-01-01",
        remainingTermMonths: 20,
        overpaymentAllowance: { amount: 1_500, chargeRate: 0.05 },
        fees: [],
        overpayments: [],
        termChanges: [],
      },
    });

    expect(schedule[0]?.overpaymentCharge).toBe(0);
    expect(schedule[1]?.overpaymentCharge).toBe(25);
    expect(schedule[1]?.totalDue).toBe(2_025);
  });

  it("uses daily interest for a partial first payment period", () => {
    const [first] = buildMortgageSchedule({
      openingBalance: -10_000,
      initialAnnualRate: 0.0365,
      accrualStartDate: "2026-01-15",
      terms: {
        firstPaymentDate: "2026-02-01",
        remainingTermMonths: 12,
        fees: [],
        overpayments: [],
        termChanges: [],
      },
    });

    expect(first?.interest).toBe(17);
  });
});
