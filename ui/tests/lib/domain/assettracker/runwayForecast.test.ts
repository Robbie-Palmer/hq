import { describe, expect, it } from "vitest";
import {
  type AssetTrackerData,
  buildRepository,
  buildRunwayForecast,
  defaultHouseholdFields,
} from "@/lib/domain/assettracker";

function forecastData(): AssetTrackerData {
  return {
    ...defaultHouseholdFields(),
    accounts: [
      {
        id: "current",
        name: "Current account",
        provider: "Bank",
        currency: "GBP",
        assetType: "cash",
        liquidity: "cash",
        expectedAnnualReturn: 0,
        createdAt: "2025-01-01",
      },
      {
        id: "isa",
        name: "Stocks ISA",
        provider: "Broker",
        currency: "GBP",
        assetType: "stocks",
        liquidity: "liquid",
        expectedAnnualReturn: 0,
        createdAt: "2025-01-01",
      },
      {
        id: "pension",
        name: "Workplace pension",
        provider: "Provider",
        currency: "GBP",
        assetType: "stocks",
        liquidity: "illiquid",
        expectedAnnualReturn: 0,
        createdAt: "2025-01-01",
      },
      {
        id: "debt",
        name: "Loan",
        provider: "Lender",
        currency: "GBP",
        assetType: "debt",
        expectedAnnualReturn: 0,
        createdAt: "2025-01-01",
      },
    ],
    snapshots: [
      { accountId: "current", date: "2026-01-01", balance: 10_000 },
      { accountId: "isa", date: "2026-01-01", balance: 20_000 },
      { accountId: "pension", date: "2026-01-01", balance: 30_000 },
      { accountId: "debt", date: "2026-01-01", balance: -5_000 },
    ],
    capitalFlows: [],
    incomeHistory: [],
    salaryHistory: [],
    transfers: [],
    recurringFlows: [
      {
        id: "salary",
        name: "Salary",
        toAccountId: "current",
        amount: 3_000,
        currency: "GBP",
        frequency: "monthly",
        startDate: "2025-01-01",
      },
      {
        id: "isa-saving",
        name: "ISA saving",
        fromAccountId: "current",
        toAccountId: "isa",
        amount: 500,
        currency: "GBP",
        frequency: "monthly",
        startDate: "2025-01-01",
      },
      {
        id: "employer-pension",
        name: "Employer pension",
        toAccountId: "pension",
        amount: 300,
        currency: "GBP",
        frequency: "monthly",
        startDate: "2025-01-01",
      },
    ],
    plannedExpenditures: [
      {
        id: "holiday",
        name: "Holiday",
        amount: 6_000,
        date: "2026-01-15",
        fromAccountId: "current",
      },
    ],
    planningCases: [],
    futureCashFlows: [
      {
        id: "holiday",
        name: "Holiday",
        kind: "commitment",
        status: "active",
        changeability: "variable",
        refundable: false,
        labels: [],
        currency: "GBP",
        stages: [
          {
            id: "payment-1",
            fromAccountId: "current",
            amount: 6_000,
            dueDate: "2026-01-15",
            actuals: [],
          },
        ],
      },
    ],
    forecastAssumptionSets: [],
    settings: {
      expectedAnnualInflation: 0,
      withdrawalRate: 0.04,
      baseCurrency: "GBP",
      valuationMaxAgeDays: 7,
    },
  };
}

describe("buildRunwayForecast", () => {
  it("projects income, transfers, spending, and a dated purchase by access tier", () => {
    const projection = buildRunwayForecast({
      repository: buildRepository(forecastData()),
      annualExpenditure: 24_000,
      annualCurrentExpenditure: 24_000,
      startDate: "2026-01-01",
      months: 1,
    });

    expect(projection).toHaveLength(2);
    expect(projection[0]).toMatchObject({
      cashBalance: 10_000,
      liquidBalance: 30_000,
      totalBalance: 55_000,
    });
    expect(projection[1]).toMatchObject({
      cashBalance: 4_500,
      liquidBalance: 25_000,
      totalBalance: 50_300,
      baselineCashMonths: 5.25,
      baselineLiquidMonths: 15.5,
      baselineTotalMonths: 28.15,
    });
    expect(projection[1]?.cashMonths).toBe(2.25);
    expect(projection[1]?.liquidMonths).toBe(12.5);
    expect(projection[1]?.totalMonths).toBe(25.15);
  });

  it("returns no forecast until spending can be reconciled", () => {
    expect(
      buildRunwayForecast({
        repository: buildRepository(forecastData()),
        annualExpenditure: null,
        annualCurrentExpenditure: null,
        startDate: "2026-01-01",
      }),
    ).toEqual([]);
  });

  it("can fund a purchase from an ISA without reducing the cash line", () => {
    const data = forecastData();
    const cashFlow = data.futureCashFlows[0];
    if (cashFlow?.kind !== "commitment") {
      throw new Error("fixture has no commitment");
    }
    data.futureCashFlows[0] = {
      ...cashFlow,
      stages: cashFlow.stages.map((stage) => ({
        ...stage,
        fromAccountId: "isa",
      })),
    };
    const projection = buildRunwayForecast({
      repository: buildRepository(data),
      annualExpenditure: 24_000,
      annualCurrentExpenditure: 24_000,
      startDate: "2026-01-01",
      months: 1,
    });

    expect(projection[1]).toMatchObject({
      cashBalance: 10_500,
      liquidBalance: 25_000,
      totalBalance: 50_300,
    });
  });

  it("compounds balances at their expected return after inflation", () => {
    const data = forecastData();
    const cash = data.accounts[0];
    if (!cash) throw new Error("fixture has no cash account");
    cash.expectedAnnualReturn = 0.12;
    data.recurringFlows = [];
    data.plannedExpenditures = [];
    data.futureCashFlows = [];
    const projection = buildRunwayForecast({
      repository: buildRepository(data),
      annualExpenditure: 0,
      annualCurrentExpenditure: 12_000,
      startDate: "2026-01-01",
      months: 1,
    });

    expect(projection[1]?.cashBalance).toBeCloseTo(
      10_000 * 1.12 ** (1 / 12),
      2,
    );
  });

  it("scales a converted payment and fee when a liability is nearly repaid", () => {
    const data = forecastData();
    const debt = data.accounts.find((account) => account.id === "debt");
    const debtSnapshot = data.snapshots.find(
      (snapshot) => snapshot.accountId === "debt",
    );
    if (debt == null || debtSnapshot == null) {
      throw new Error("fixture has no debt account");
    }
    debt.currency = "USD";
    debtSnapshot.balance = -500;
    data.recurringFlows = [
      {
        id: "debt-payment",
        name: "Debt payment",
        fromAccountId: "current",
        toAccountId: "debt",
        amount: 500,
        currency: "GBP",
        conversion: {
          received: { amount: 625, currency: "USD" },
          fee: { amount: 10, currency: "GBP" },
          provider: "Broker",
        },
        frequency: "monthly",
        startDate: "2025-01-01",
      },
    ];
    data.plannedExpenditures = [];
    data.futureCashFlows = [];
    data.exchangeRateObservations = [
      {
        id: "usd-gbp-2026-01-01",
        fromCurrency: "USD",
        toCurrency: "GBP",
        rate: 0.8,
        validAt: "2026-01-01",
        acceptedAt: "2026-01-01T12:00:00Z",
        source: { kind: "manual", id: "test" },
      },
    ];

    const projection = buildRunwayForecast({
      repository: buildRepository(data),
      annualExpenditure: 0,
      annualCurrentExpenditure: 12_000,
      startDate: "2026-01-01",
      months: 1,
    });

    expect(projection[1]).toMatchObject({
      cashBalance: 9_592,
      totalBalance: 59_592,
    });
  });

  it("applies dated household changes and exposes each monthly cash-flow class", () => {
    const data = forecastData();
    data.planningCases = [
      { id: "case-a", name: "Case A", labels: [] },
      { id: "case-b", name: "Case B", labels: [] },
    ];
    data.recurringFlows.push(
      {
        id: "ordinary-bills",
        name: "Ordinary bills",
        fromAccountId: "current",
        amount: 800,
        currency: "GBP",
        frequency: "monthly",
        startDate: "2025-01-01",
      },
      {
        id: "expired-cost",
        name: "Expired cost",
        fromAccountId: "current",
        amount: 600,
        currency: "GBP",
        frequency: "monthly",
        startDate: "2025-01-01",
        endDate: "2025-12-31",
      },
    );
    data.futureCashFlows = [
      {
        id: "commitment-a",
        name: "Commitment A",
        planningCaseId: "case-a",
        kind: "commitment",
        status: "active",
        changeability: "fixed",
        refundable: false,
        labels: [],
        currency: "GBP",
        stages: [
          {
            id: "payment-1",
            fromAccountId: "current",
            dueDate: "2026-01-15",
            amount: 600,
            actuals: [],
          },
        ],
      },
      {
        id: "commitment-b",
        name: "Commitment B",
        planningCaseId: "case-b",
        kind: "commitment",
        status: "active",
        changeability: "variable",
        refundable: false,
        labels: [],
        currency: "GBP",
        stages: [
          {
            id: "payment-1",
            fromAccountId: "current",
            dueDate: "2026-01-20",
            amount: 700,
            actuals: [],
          },
        ],
      },
      {
        id: "possible-choice",
        name: "Possible choice",
        kind: "decision",
        status: "considering",
        reversibility: "reversible",
        dependencyIds: [],
        alternativeToIds: [],
        labels: [],
        currency: "GBP",
        stages: [
          {
            id: "cash-flow-1",
            fromAccountId: "current",
            expectedDate: "2026-01-18",
            minimumAmount: 200,
            expectedAmount: 400,
            maximumAmount: 900,
            actuals: [],
          },
        ],
      },
    ];
    data.forecastAssumptionSets = [
      {
        id: "household-baseline-v1",
        seriesId: "household-baseline",
        name: "Household baseline",
        version: 1,
        status: "active",
        createdAt: "2026-01-01T12:00:00Z",
        assumptions: [
          {
            id: "income-change",
            name: "Income change",
            kind: "income",
            startDate: "2026-01-01",
            endDate: "2026-02-28",
            monthlyChange: { minimum: 300, expected: 500, maximum: 700 },
            currency: "GBP",
            ownership: { kind: "personal", memberId: "primary" },
            accountId: "current",
            source: { kind: "manual-take-home" },
          },
          {
            id: "temporary-cost",
            name: "Temporary cost",
            kind: "expenditure",
            startDate: "2026-01-01",
            endDate: "2026-01-31",
            monthlyChange: { minimum: 100, expected: 200, maximum: 400 },
            currency: "GBP",
            ownership: { kind: "personal", memberId: "primary" },
            source: { kind: "manual" },
          },
        ],
      },
    ];

    const projection = buildRunwayForecast({
      repository: buildRepository(data),
      annualExpenditure: 24_000,
      annualCurrentExpenditure: 24_000,
      startDate: "2026-01-01",
      months: 2,
    });

    expect(projection[1]).toMatchObject({
      cashBalance: 9_500,
      monthlyBreakdown: {
        baselineExpenditure: 2_000,
        explicitIncomeChange: { minimum: 300, expected: 500, maximum: 700 },
        explicitExpenditureChange: {
          minimum: 100,
          expected: 200,
          maximum: 400,
        },
        externalIncome: 3_300,
        accountTransfers: 500,
        debtPayments: 0,
        ordinaryRecurringOutflowsCoveredByBaseline: 800,
        committedCashFlows: 1_300,
        selectedDecisionCashFlows: 0,
        possibleDecisions: { minimum: 200, expected: 400, maximum: 900 },
      },
    });
    expect(projection[2]?.monthlyBreakdown).toMatchObject({
      explicitIncomeChange: { expected: 500 },
      explicitExpenditureChange: { expected: 0 },
      committedCashFlows: 0,
      possibleDecisions: { expected: 0 },
    });
  });
});
