import { describe, expect, it } from "vitest";
import {
  compareHousingStrategy,
  type HousingPlanningPosition,
  type HousingStrategyAssumptions,
} from "@/lib/domain/assettracker";

const position: HousingPlanningPosition = {
  asOfDate: "2026-01-01",
  totalNetWorth: 500_000,
  withdrawalCapital: 300_000,
  homeValue: 400_000,
  mortgageBalance: 200_000,
  homeEquity: 200_000,
  annualNonHousingExpenditure: 24_000,
  annualInvestableIncome: 48_000,
  expectedRealReturn: 0.04,
  withdrawalRate: 0.04,
  mortgagePayoffDate: "2046-01-01",
};

function assumptions(
  overrides: Partial<HousingStrategyAssumptions>,
): HousingStrategyAssumptions {
  return {
    kind: "stay",
    moveDate: "2026-01-01",
    salePrice: 0,
    mortgageSettlement: 0,
    transactionCosts: 0,
    taxesAndFees: 0,
    replacementHousingCost: 0,
    annualRent: 0,
    annualOwnershipCost: 6_000,
    annualBorrowingCost: 0,
    equityReleaseAdvance: 0,
    ...overrides,
  };
}

describe("compareHousingStrategy", () => {
  it("keeps all home equity in net worth but none in withdrawal capital when staying", () => {
    const result = compareHousingStrategy(position, assumptions({}));

    expect(result.totalNetWorth).toBe(500_000);
    expect(result.retainedEquity).toBe(200_000);
    expect(result.releasedCapital).toBe(0);
    expect(result.withdrawalCapital).toBe(300_000);
    expect(result.fiTarget).toBe(750_000);
    expect(result.timeline).toEqual([
      {
        startDate: "2026-01-01",
        endDate: "2046-01-01",
        housingState: "Own current home with mortgage",
      },
      {
        startDate: "2046-01-01",
        endDate: null,
        housingState: "Own current home after mortgage payoff",
      },
    ]);
  });

  it("settles the mortgage and releases sale proceeds into FI capital", () => {
    const result = compareHousingStrategy(
      position,
      assumptions({
        kind: "sell-and-rent",
        moveDate: "2027-01-01",
        salePrice: 410_000,
        mortgageSettlement: 195_000,
        transactionCosts: 8_000,
        taxesAndFees: 2_000,
        annualRent: 18_000,
        annualOwnershipCost: 0,
      }),
    );

    expect(result.releasedCapital).toBe(205_000);
    expect(result.retainedEquity).toBe(0);
    expect(result.totalNetWorth).toBe(505_000);
    expect(result.withdrawalCapital).toBeGreaterThan(529_000);
    expect(result.annualExpenditure).toBe(42_000);
    expect(result.timeline).toEqual([
      {
        startDate: "2026-01-01",
        endDate: "2027-01-01",
        housingState: "Own current home until the move completes",
      },
      {
        startDate: "2027-01-01",
        endDate: null,
        housingState: "Rent after sale and mortgage settlement",
      },
    ]);
  });

  it("retains the replacement home and releases only surplus downsizing equity", () => {
    const result = compareHousingStrategy(
      position,
      assumptions({
        kind: "downsize",
        salePrice: 400_000,
        mortgageSettlement: 200_000,
        transactionCosts: 10_000,
        taxesAndFees: 5_000,
        replacementHousingCost: 150_000,
        annualOwnershipCost: 4_000,
      }),
    );

    expect(result.releasedCapital).toBe(35_000);
    expect(result.retainedEquity).toBe(150_000);
    expect(result.totalNetWorth).toBe(485_000);
    expect(result.withdrawalCapital).toBe(335_000);
    expect(result.timeline).toEqual([
      {
        startDate: "2026-01-01",
        endDate: null,
        housingState: "Own replacement home after sale and mortgage settlement",
      },
    ]);
  });

  it("defines equity release as new borrowing, not a net-worth gain", () => {
    const result = compareHousingStrategy(
      position,
      assumptions({
        kind: "equity-release",
        transactionCosts: 3_000,
        taxesAndFees: 2_000,
        equityReleaseAdvance: 80_000,
        annualBorrowingCost: 5_000,
      }),
    );

    expect(result.releasedCapital).toBe(75_000);
    expect(result.retainedEquity).toBe(120_000);
    expect(result.totalNetWorth).toBe(495_000);
    expect(result.withdrawalCapital).toBe(375_000);
    expect(result.annualExpenditure).toBe(35_000);
  });
});
