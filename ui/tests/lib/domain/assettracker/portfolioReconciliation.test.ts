import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetTrackerData } from "@/lib/domain/assettracker";
import {
  buildRepository,
  getNetWorthTimeSeries,
  getPortfolioFinancialIndependence,
  reconcilePortfolio,
  representativeAnnualCurrentExpenditure,
  representativeAnnualExpenditure,
  representativeAnnualSavings,
} from "@/lib/domain/assettracker";

afterEach(() => {
  vi.useRealTimers();
});

function portfolioData(): AssetTrackerData {
  return {
    accounts: [
      {
        id: "portfolio",
        name: "Portfolio",
        provider: "Broker",
        currency: "GBP",
        assetType: "stocks",
        expectedAnnualReturn: 0.05,
        createdAt: "2024-01-01",
      },
    ],
    snapshots: [
      { accountId: "portfolio", date: "2024-01-31", balance: 100_000 },
      { accountId: "portfolio", date: "2024-02-29", balance: 108_000 },
      { accountId: "portfolio", date: "2024-03-31", balance: 113_000 },
    ],
    capitalFlows: [
      { accountId: "portfolio", date: "2024-02-15", amount: 5_000 },
      { accountId: "portfolio", date: "2024-03-15", amount: 2_000 },
    ],
    incomeHistory: [
      { date: "2024-02-29", amount: 10_000, currency: "GBP" },
      { date: "2024-03-31", amount: 8_000, currency: "GBP" },
    ],
    transfers: [],
    recurringFlows: [],
    plannedExpenditures: [],
    settings: {
      expectedAnnualInflation: 0.025,
      withdrawalRate: 0.04,
      baseCurrency: "GBP",
      valuationMaxAgeDays: 7,
    },
  };
}

describe("reconcilePortfolio", () => {
  it("separates balance changes into retained income, expenditure, and valuation gains", () => {
    const periods = reconcilePortfolio(buildRepository(portfolioData()));

    expect(periods).toHaveLength(2);
    expect(periods[0]).toMatchObject({
      startDate: "2024-01-31",
      endDate: "2024-02-29",
      openingNetWorth: 100_000,
      closingNetWorth: 108_000,
      income: 10_000,
      netCapitalFlow: 5_000,
      retainedIncomeSource: "recorded-flows",
      valuationGain: 3_000,
      expenditure: 5_000,
    });
    expect(periods[1]).toMatchObject({
      startDate: "2024-02-29",
      endDate: "2024-03-31",
      openingNetWorth: 108_000,
      closingNetWorth: 113_000,
      income: 8_000,
      netCapitalFlow: 2_000,
      retainedIncomeSource: "recorded-flows",
      valuationGain: 3_000,
      expenditure: 6_000,
    });

    for (const period of periods) {
      expect(
        period.openingNetWorth +
          period.income -
          period.expenditure +
          period.valuationGain,
      ).toBe(period.closingNetWorth);
    }
  });

  it("converts historical income into the selected base currency", () => {
    const data = portfolioData();
    data.settings.baseCurrency = "USD";
    data.settings.valuationMaxAgeDays = 90;
    data.exchangeRateObservations = [
      {
        id: "gbp-usd",
        fromCurrency: "GBP",
        toCurrency: "USD",
        rate: 1.25,
        validAt: "2024-01-31",
        acceptedAt: "2024-01-31T12:00:00Z",
        source: { kind: "manual", id: "test" },
      },
    ];

    const periods = reconcilePortfolio(buildRepository(data));

    expect(periods.map((period) => period.income)).toEqual([12_500, 10_000]);
  });

  it("falls back to balance changes for balances-only spreadsheet data", () => {
    const data = portfolioData();
    data.snapshots = [
      { accountId: "portfolio", date: "2017-10-28", balance: 10_000 },
      { accountId: "portfolio", date: "2017-11-28", balance: 10_396 },
      { accountId: "portfolio", date: "2017-12-28", balance: 11_116.77 },
      { accountId: "portfolio", date: "2018-01-28", balance: 11_415.42 },
    ];
    data.capitalFlows = [];
    data.incomeHistory = [
      { date: "2017-11-28", amount: 1_574.36, currency: "GBP" },
      { date: "2017-12-28", amount: 1_574.36, currency: "GBP" },
      { date: "2018-01-28", amount: 1_574.36, currency: "GBP" },
    ];

    const periods = reconcilePortfolio(buildRepository(data));

    expect(periods).toHaveLength(3);
    for (const [index, expected] of [1_178.36, 853.59, 1_275.71].entries()) {
      expect(periods[index]?.expenditure).toBeCloseTo(expected);
    }
    expect(
      periods.every(
        (period) =>
          period.retainedIncomeSource === "balance-change" &&
          period.valuationGain === 0,
      ),
    ).toBe(true);
  });

  it("cancels signed internal transfers across accounts", () => {
    const data = portfolioData();
    data.accounts.push({
      id: "cash",
      name: "Cash",
      provider: "Bank",
      currency: "GBP",
      assetType: "cash",
      expectedAnnualReturn: 0,
      createdAt: "2024-01-01",
    });
    data.snapshots.push(
      { accountId: "cash", date: "2024-01-31", balance: 10_000 },
      { accountId: "cash", date: "2024-02-29", balance: 5_000 },
    );
    data.capitalFlows.push(
      { accountId: "cash", date: "2024-02-10", amount: -1_000 },
      { accountId: "portfolio", date: "2024-02-10", amount: 1_000 },
    );

    expect(reconcilePortfolio(buildRepository(data))[0]?.netCapitalFlow).toBe(
      5_000,
    );
  });

  it("separates debt principal and external capital from personal saving", () => {
    const data = portfolioData();
    data.capitalFlows.push(
      {
        accountId: "portfolio",
        date: "2024-02-15",
        amount: 1_000,
        kind: "debtPrincipal",
      },
      {
        accountId: "portfolio",
        date: "2024-02-15",
        amount: 750,
        kind: "external",
      },
    );

    const period = reconcilePortfolio(buildRepository(data))[0];

    expect(period).toMatchObject({
      netCapitalFlow: 6_750,
      personalCapitalFlow: 6_000,
      debtPrincipalFlow: 1_000,
      externalCapitalFlow: 750,
      expenditure: 4_000,
      currentExpenditure: 5_000,
      valuationGain: 1_250,
    });
    expect(
      (period?.openingNetWorth ?? 0) +
        (period?.income ?? 0) -
        (period?.expenditure ?? 0) +
        (period?.externalCapitalFlow ?? 0) +
        (period?.valuationGain ?? 0),
    ).toBe(period?.closingNetWorth);
  });

  it("skips periods whose income boundaries do not match balance observations", () => {
    const data = portfolioData();
    data.snapshots = [
      { accountId: "portfolio", date: "2024-01-31", balance: 100_000 },
      { accountId: "portfolio", date: "2024-03-31", balance: 113_000 },
    ];

    expect(reconcilePortfolio(buildRepository(data))).toEqual([]);
  });

  it("uses median annualised expenditure from the latest periods", () => {
    const periods = reconcilePortfolio(buildRepository(portfolioData()));
    const expected = (5_000 * (365.2425 / 29) + 6_000 * (365.2425 / 31)) / 2;

    expect(representativeAnnualExpenditure(periods)).toBeCloseTo(expected);
    expect(representativeAnnualCurrentExpenditure(periods)).toBeCloseTo(
      expected,
    );
  });

  it("uses only the latest 12 periods and smooths a recent outlier", () => {
    const periods = Array.from({ length: 13 }, (_, index) => {
      const year = 2024 + Math.floor(index / 12);
      const month = String((index % 12) + 1).padStart(2, "0");
      return {
        startDate: `${year}-${month}-01`,
        endDate: `${year}-${month}-28`,
        openingNetWorth: 0,
        closingNetWorth: 0,
        income: 0,
        netCapitalFlow: 0,
        personalCapitalFlow: 0,
        debtPrincipalFlow: 0,
        externalCapitalFlow: 0,
        retainedIncomeSource: "recorded-flows" as const,
        valuationGain: 0,
        expenditure: index === 0 || index === 12 ? 100_000 : 1_000,
        currentExpenditure: index === 0 || index === 12 ? 100_000 : 1_000,
        days: 30,
        annualizedExpenditure: 0,
        annualizedCurrentExpenditure: 0,
      };
    });

    expect(representativeAnnualExpenditure(periods)).toBeCloseTo(
      (12_000 * 365.2425) / 360,
    );
  });

  it("derives savings rate, cash runway, and a portfolio FI date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
    const data = portfolioData();
    data.accounts.push({
      id: "cash",
      name: "Emergency fund",
      provider: "Bank",
      currency: "GBP",
      assetType: "cash",
      expectedAnnualReturn: 0.01,
      createdAt: "2024-01-01",
    });
    data.accounts.push({
      id: "pension",
      name: "Workplace pension",
      provider: "Pension provider",
      currency: "GBP",
      assetType: "stocks",
      expectedAnnualReturn: 0.05,
      createdAt: "2024-01-01",
    });
    data.snapshots.push(
      { accountId: "cash", date: "2024-01-31", balance: 12_000 },
      { accountId: "cash", date: "2024-02-29", balance: 12_000 },
      { accountId: "cash", date: "2024-03-31", balance: 12_000 },
      { accountId: "pension", date: "2024-01-31", balance: 20_000 },
      { accountId: "pension", date: "2024-02-29", balance: 20_000 },
      { accountId: "pension", date: "2024-03-31", balance: 20_000 },
    );

    const result = getPortfolioFinancialIndependence(buildRepository(data));
    const expectedAnnualSavings = representativeAnnualSavings(result.periods);

    expect(result.savingsRate).toBeCloseTo(7_000 / 18_000);
    expect(result.representativeAnnualSavings).toBe(expectedAnnualSavings);
    expect(result.emergencyFund).toBe(12_000);
    expect(result.emergencyFundMonths).toBeCloseTo(
      (12_000 * 12) / (result.representativeAnnualExpenditure ?? 1),
    );
    expect(result.runway.cash.balance).toBe(12_000);
    expect(result.runway.liquid.balance).toBe(125_000);
    expect(result.runway.total.balance).toBe(145_000);
    expect(result.runway.liquid.months).toBeLessThan(
      result.runway.total.months ?? 0,
    );
    expect(result.expectedRealReturn).toBeGreaterThan(0);
    expect(result.yearsToFi).toBeGreaterThan(0);
    expect(result.projectedFiDate).not.toBeNull();
    expect(result.projection.at(-1)?.projected).toBeGreaterThanOrEqual(
      result.target ?? Number.POSITIVE_INFINITY,
    );
  });

  it("uses active take-home and pension compensation for current savings", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
    const data = portfolioData();
    data.accounts.push({
      id: "closed-pension",
      name: "Closed pension",
      provider: "Old provider",
      currency: "GBP",
      assetType: "stocks",
      expectedAnnualReturn: 0.05,
      createdAt: "2024-01-01",
      closedAt: "2025-12-31",
    });
    data.recurringFlows = [
      {
        id: "salary",
        name: "Salary",
        toAccountId: "portfolio",
        amount: 3_500,
        currency: "USD",
        conversion: {
          received: { amount: 2_800, currency: "GBP" },
          fee: { amount: 5, currency: "USD" },
          provider: "Current account",
        },
        compensationKind: "takeHomeIncome",
        frequency: "monthly",
        startDate: "2025-01-01",
      },
      {
        id: "employee-pension",
        name: "Employee pension",
        toAccountId: "portfolio",
        amount: 700,
        currency: "GBP",
        compensationKind: "employeePension",
        frequency: "monthly",
        startDate: "2025-01-01",
      },
      {
        id: "employer-pension",
        name: "Employer pension",
        toAccountId: "portfolio",
        amount: 350,
        currency: "GBP",
        compensationKind: "employerPension",
        frequency: "monthly",
        startDate: "2025-01-01",
      },
      {
        id: "closed-pension-contribution",
        name: "Closed pension contribution",
        toAccountId: "closed-pension",
        amount: 1_000,
        currency: "GBP",
        compensationKind: "employerPension",
        frequency: "monthly",
        startDate: "2025-01-01",
      },
    ];

    const result = getPortfolioFinancialIndependence(buildRepository(data));
    const annualExpenditure = result.representativeAnnualExpenditure ?? 0;
    const expectedTakeHomeSavings = 33_600 - annualExpenditure;
    const expectedAnnualSavings = expectedTakeHomeSavings + 12_600;

    expect(result.currentCompensation).toEqual({
      annualTakeHomeIncome: 33_600,
      annualTakeHomeSavings: expectedTakeHomeSavings,
      annualEmployeePensionContribution: 8_400,
      annualEmployerPensionContribution: 4_200,
    });
    expect(result.representativeAnnualSavings).toBeCloseTo(
      expectedAnnualSavings,
    );
    expect(result.takeHomeSavingsRate).toBeCloseTo(
      expectedTakeHomeSavings / 33_600,
    );
    expect(result.savingsRate).toBeCloseTo(expectedAnnualSavings / 46_200);
  });

  it("includes complete home equity in net worth and FI progress", () => {
    const data = portfolioData();
    data.accounts = [
      {
        id: "home",
        name: "Home",
        provider: "Owned",
        currency: "GBP",
        assetType: "property",
        expectedAnnualReturn: 0.03,
        createdAt: "2024-01-01",
      },
      {
        id: "mortgage",
        name: "Mortgage",
        provider: "Lender",
        currency: "GBP",
        assetType: "mortgage",
        expectedAnnualReturn: 0.04,
        linkedAccountId: "home",
        createdAt: "2024-01-01",
      },
    ];
    data.snapshots = [
      { accountId: "home", date: "2024-01-31", balance: 300_000 },
      { accountId: "mortgage", date: "2024-01-31", balance: -200_000 },
      { accountId: "home", date: "2024-02-29", balance: 300_000 },
      { accountId: "mortgage", date: "2024-02-29", balance: -200_000 },
    ];
    data.capitalFlows = [];
    data.incomeHistory = [
      { date: "2024-02-29", amount: 3_200, currency: "GBP" },
    ];
    const repository = buildRepository(data);
    const currentNetWorth =
      getNetWorthTimeSeries(repository).at(-1)?.total ?? 0;
    const result = getPortfolioFinancialIndependence(repository);

    expect(currentNetWorth).toBe(100_000);
    expect(result.progress).toBeGreaterThan(0);
  });
});
