import { describe, expect, it } from "vitest";
import type { AssetTrackerData } from "@/lib/domain/assettracker/assetTrackerData";
import {
  getAccountDetail,
  getAllAccountDetails,
  getAllAccountSummaries,
  getAssetAllocationTimeSeries,
  getLatestPortfolioValuation,
  getNetWorthTimeSeries,
  getPortfolioAnnualReturn,
  getPortfolioContributionTimeSeries,
  getTotalByAssetType,
} from "@/lib/domain/assettracker/assetTrackerQueries";
import { buildRepository } from "@/lib/domain/assettracker/assetTrackerRepository";

function homeData(): AssetTrackerData {
  return {
    accounts: [
      {
        id: "home",
        name: "Home",
        provider: "Owned",
        currency: "GBP",
        assetType: "property",
        expectedAnnualReturn: 0.03,
        createdAt: "2023-01-01",
      },
      {
        id: "mortgage",
        name: "Mortgage",
        provider: "Nationwide",
        currency: "GBP",
        assetType: "mortgage",
        expectedAnnualReturn: 0.0425,
        linkedAccountId: "home",
        createdAt: "2023-01-01",
      },
      {
        id: "card",
        name: "Credit Card",
        provider: "Amex",
        currency: "GBP",
        assetType: "debt",
        expectedAnnualReturn: 0.249,
        createdAt: "2023-01-01",
      },
    ],
    snapshots: [
      { accountId: "home", date: "2024-01-01", balance: 300000 },
      { accountId: "mortgage", date: "2024-01-01", balance: -210000 },
      { accountId: "card", date: "2024-01-01", balance: -2000 },
    ],
    capitalFlows: [],
    incomeHistory: [],
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

function mixedCurrencyData(): AssetTrackerData {
  const source = { kind: "manual" as const, id: "test" };
  return {
    accounts: [
      {
        id: "cash-gbp",
        name: "GBP cash",
        provider: "Bank",
        currency: "GBP",
        assetType: "cash",
        expectedAnnualReturn: 0,
        createdAt: "2025-01-01",
      },
      {
        id: "broker-usd",
        name: "US brokerage",
        provider: "Broker",
        currency: "USD",
        assetType: "stocks",
        expectedAnnualReturn: 0.05,
        createdAt: "2025-01-01",
      },
    ],
    snapshots: [
      { accountId: "cash-gbp", date: "2025-01-01", balance: 1_000 },
      { accountId: "cash-gbp", date: "2025-01-31", balance: 1_100 },
    ],
    capitalFlows: [
      { accountId: "broker-usd", date: "2025-01-10", amount: 100 },
    ],
    incomeHistory: [],
    transfers: [
      {
        id: "usd-income",
        date: "2025-01-15",
        toAccountId: "broker-usd",
        amount: 50,
        toAmount: 50,
      },
      {
        id: "gbp-spending",
        date: "2025-01-20",
        fromAccountId: "cash-gbp",
        amount: 20,
      },
      {
        id: "internal",
        date: "2025-01-25",
        fromAccountId: "cash-gbp",
        toAccountId: "broker-usd",
        amount: 80,
        fromAmount: 80,
        toAmount: 100,
      },
    ],
    recurringFlows: [],
    plannedExpenditures: [],
    instruments: [
      {
        id: "fund-usd",
        symbol: "FUND",
        name: "US fund",
        currency: "USD",
      },
    ],
    holdingObservations: [
      {
        id: "holding-start",
        accountId: "broker-usd",
        instrumentId: "fund-usd",
        quantity: 10,
        validAt: "2025-01-01",
        acceptedAt: "2025-01-01T12:00:00Z",
        source,
      },
    ],
    priceObservations: [
      {
        id: "price-start",
        instrumentId: "fund-usd",
        currency: "USD",
        price: 90,
        validAt: "2025-01-01",
        acceptedAt: "2025-01-01T12:00:00Z",
        source,
      },
      {
        id: "price-end",
        instrumentId: "fund-usd",
        currency: "USD",
        price: 100,
        validAt: "2025-01-31",
        acceptedAt: "2025-01-31T12:00:00Z",
        source,
      },
    ],
    exchangeRateObservations: [
      {
        id: "usd-gbp",
        fromCurrency: "USD",
        toCurrency: "GBP",
        rate: 0.8,
        validAt: "2025-01-01",
        acceptedAt: "2025-01-01T12:00:00Z",
        source,
      },
    ],
    settings: {
      expectedAnnualInflation: 0.025,
      withdrawalRate: 0.04,
      baseCurrency: "GBP",
      valuationMaxAgeDays: 60,
    },
  };
}

describe("multi-currency portfolio queries", () => {
  it("uses valued holdings and converted flows across every household query", () => {
    const repository = buildRepository(mixedCurrencyData());

    expect(getAllAccountSummaries(repository)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "broker-usd",
          latestBalance: 1_000,
          latestSnapshotDate: "2025-01-31",
        }),
      ]),
    );
    expect(getAccountDetail(repository, "broker-usd")).toMatchObject({
      latestBalance: 1_000,
      latestSnapshotDate: "2025-01-31",
    });
    expect(getAllAccountDetails(repository)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "broker-usd", latestBalance: 1_000 }),
      ]),
    );
    expect(getLatestPortfolioValuation(repository)?.total).toBe(1_900);
    expect(getNetWorthTimeSeries(repository).at(-1)).toMatchObject({
      "GBP cash": 1_100,
      "US brokerage": 800,
      total: 1_900,
    });
    expect(getPortfolioContributionTimeSeries(repository)).toEqual([
      { date: "2025-01-10", contributedCapital: 80 },
      { date: "2025-01-15", contributedCapital: 120 },
      { date: "2025-01-20", contributedCapital: 100 },
    ]);
    expect(getAssetAllocationTimeSeries(repository).at(-1)).toMatchObject({
      cash: 1_100 / 1_900,
      stocks: 800 / 1_900,
      totalAssets: 1_900,
    });
    expect(getTotalByAssetType(repository)).toEqual(
      expect.arrayContaining([
        { assetType: "cash", total: 1_100 },
        { assetType: "stocks", total: 800 },
      ]),
    );
    expect(getPortfolioAnnualReturn(repository)).not.toBeNull();
  });

  it("withholds derived totals when a required exchange rate is missing", () => {
    const data = mixedCurrencyData();
    data.exchangeRateObservations = [];
    const repository = buildRepository(data);

    expect(getLatestPortfolioValuation(repository)?.total).toBeNull();
    expect(getPortfolioContributionTimeSeries(repository)).toEqual([]);
    expect(getAssetAllocationTimeSeries(repository)).toEqual([]);
    expect(getTotalByAssetType(repository)).toEqual([]);
    expect(getPortfolioAnnualReturn(repository)).toBeNull();
  });
});

describe("getTotalByAssetType", () => {
  it("nets a linked mortgage into its property as equity", () => {
    const totals = getTotalByAssetType(buildRepository(homeData()));
    const byType = Object.fromEntries(
      totals.map((t) => [t.assetType, t.total]),
    );

    // Property shows equity (300k − 210k), not gross value, and the mortgage
    // is not double-counted as its own line
    expect(byType.property).toBe(90000);
    expect(byType.mortgage).toBeUndefined();
    // Standalone debt still surfaces as its own negative total
    expect(byType.debt).toBe(-2000);
  });

  it("excludes closed accounts and closed linked mortgages from current totals", () => {
    const data = homeData();
    const mortgage = data.accounts.find((account) => account.id === "mortgage");
    const card = data.accounts.find((account) => account.id === "card");
    if (mortgage == null || card == null) {
      throw new Error("Expected mortgage and card fixtures");
    }
    mortgage.closedAt = "2024-01-01";
    card.closedAt = "2024-01-01";

    const totals = getTotalByAssetType(buildRepository(data));

    expect(totals).toEqual([{ assetType: "property", total: 300_000 }]);
  });
});

describe("getAssetAllocationTimeSeries", () => {
  it("tracks asset-type percentages over time and treats property as home equity", () => {
    const data = homeData();
    data.accounts.push({
      id: "cash",
      name: "Emergency fund",
      provider: "Bank",
      currency: "GBP",
      assetType: "cash",
      expectedAnnualReturn: 0,
      createdAt: "2023-01-01",
    });
    data.snapshots.push(
      { accountId: "cash", date: "2024-01-01", balance: 10_000 },
      { accountId: "home", date: "2025-01-01", balance: 320_000 },
      { accountId: "mortgage", date: "2025-01-01", balance: -200_000 },
      { accountId: "cash", date: "2025-01-01", balance: 20_000 },
    );

    const series = getAssetAllocationTimeSeries(buildRepository(data));

    expect(series).toHaveLength(2);
    expect(series[0]).toMatchObject({
      date: "2024-01-01",
      totalAssets: 100_000,
      cash: 0.1,
      property: 0.9,
    });
    expect(series[1]).toMatchObject({
      date: "2025-01-01",
      totalAssets: 140_000,
    });
    expect(series[1]?.cash).toBeCloseTo(1 / 7);
    expect(series[1]?.property).toBeCloseTo(6 / 7);
    expect(series[1]?.debt).toBeUndefined();
    expect(series[1]?.mortgage).toBeUndefined();
  });

  it("removes closed accounts even when a closing-day snapshot is non-zero", () => {
    const data = homeData();
    data.accounts = [
      {
        id: "cash",
        name: "Cash",
        provider: "Bank",
        currency: "GBP",
        assetType: "cash",
        expectedAnnualReturn: 0,
        createdAt: "2024-01-01",
      },
      {
        id: "stocks",
        name: "Old ISA",
        provider: "Broker",
        currency: "GBP",
        assetType: "stocks",
        expectedAnnualReturn: 0.05,
        createdAt: "2024-01-01",
        closedAt: "2025-01-01",
      },
    ];
    data.snapshots = [
      { accountId: "cash", date: "2024-01-01", balance: 10_000 },
      { accountId: "stocks", date: "2024-01-01", balance: 10_000 },
      { accountId: "cash", date: "2025-01-01", balance: 20_000 },
      { accountId: "stocks", date: "2025-01-01", balance: 10_000 },
    ];

    const series = getAssetAllocationTimeSeries(buildRepository(data));

    expect(series[0]).toMatchObject({ cash: 0.5, stocks: 0.5 });
    expect(series[1]).toMatchObject({ cash: 1, totalAssets: 20_000 });
    expect(series[1]?.stocks).toBeUndefined();
  });

  it("keeps valued allocation points after a linked mortgage closes", () => {
    const data = homeData();
    const mortgage = data.accounts.find((account) => account.id === "mortgage");
    if (mortgage == null) throw new Error("Expected mortgage fixture");
    mortgage.closedAt = "2025-01-01";
    data.accounts.push({
      id: "usd-cash",
      name: "USD cash",
      provider: "Bank",
      currency: "USD",
      assetType: "cash",
      expectedAnnualReturn: 0,
      createdAt: "2024-01-01",
    });
    data.snapshots.push(
      { accountId: "home", date: "2025-01-01", balance: 310_000 },
      { accountId: "mortgage", date: "2025-01-01", balance: -190_000 },
      { accountId: "usd-cash", date: "2025-01-01", balance: 1_000 },
    );
    data.exchangeRateObservations = [
      {
        id: "usd-gbp-2025-01-01",
        fromCurrency: "USD",
        toCurrency: "GBP",
        rate: 0.8,
        validAt: "2025-01-01",
        acceptedAt: "2025-01-01T12:00:00Z",
        source: { kind: "manual", id: "test" },
      },
    ];

    const point = getAssetAllocationTimeSeries(buildRepository(data)).at(-1);

    expect(point).toMatchObject({
      date: "2025-01-01",
      property: 310_000 / 310_800,
      cash: 800 / 310_800,
      totalAssets: 310_800,
    });
  });
});

describe("getNetWorthTimeSeries", () => {
  it("folds the mortgage into the property series and totals net worth", () => {
    const series = getNetWorthTimeSeries(buildRepository(homeData()));
    const point = series.at(-1);

    expect(point?.Home).toBe(90000);
    expect(point?.Mortgage).toBeUndefined();
    expect(point?.total).toBe(88000); // 90,000 equity − 2,000 card
  });

  it("omits contribution-only accounts instead of inventing zero valuations", () => {
    const data = homeData();
    data.accounts.push({
      id: "unvalued-isa",
      name: "Unvalued ISA",
      provider: "Broker",
      currency: "GBP",
      assetType: "stocks",
      expectedAnnualReturn: 0.07,
      createdAt: "2024-01-01",
    });
    data.capitalFlows = [
      {
        accountId: "unvalued-isa",
        date: "2024-01-01",
        amount: 4_000,
      },
    ];

    const point = getNetWorthTimeSeries(buildRepository(data)).at(-1);

    expect(point?.["Unvalued ISA"]).toBeUndefined();
    expect(point?.total).toBe(88_000);
  });

  it("adds a separate estimate for investments awaiting a market valuation", () => {
    const data = homeData();
    data.accounts.push({
      id: "growth-fund",
      name: "Growth fund",
      provider: "Broker",
      currency: "GBP",
      assetType: "stocks",
      expectedAnnualReturn: 0,
      createdAt: "2024-01-01",
    });
    data.snapshots.push(
      { accountId: "growth-fund", date: "2024-01-01", balance: 0 },
      { accountId: "home", date: "2025-01-01", balance: 300_000 },
    );
    data.capitalFlows = [
      { accountId: "growth-fund", date: "2025-01-01", amount: 5_000 },
    ];

    const point = getNetWorthTimeSeries(buildRepository(data)).at(-1);

    expect(point?.["Growth fund"]).toBeUndefined();
    expect(point?.total).toBe(88_000);
    expect(point?.estimatedTotal).toBe(93_000);
  });

  it("adds a capital-flow point without leaking a later valuation", () => {
    const data = homeData();
    data.accounts.push({
      id: "growth-fund",
      name: "Growth fund",
      provider: "Broker",
      currency: "GBP",
      assetType: "stocks",
      expectedAnnualReturn: 0,
      createdAt: "2024-01-01",
    });
    data.snapshots.push(
      {
        accountId: "growth-fund",
        date: "2024-01-01",
        balance: 1_000,
      },
      {
        accountId: "growth-fund",
        date: "2026-01-01",
        balance: 3_000,
      },
    );
    data.capitalFlows = [
      { accountId: "growth-fund", date: "2025-01-01", amount: 500 },
    ];

    const point = getNetWorthTimeSeries(buildRepository(data)).find(
      ({ date }) => date === "2025-01-01",
    );

    expect(point).toMatchObject({
      date: "2025-01-01",
      "Growth fund": 1_000,
      total: 89_000,
      estimatedTotal: 89_500,
    });
  });

  it("omits accounts whose only recorded balance is a closing zero", () => {
    const data = homeData();
    data.accounts.push({
      id: "repaid-loan",
      name: "Repaid loan",
      provider: "Private",
      currency: "GBP",
      assetType: "bonds",
      expectedAnnualReturn: 0,
      createdAt: "2023-01-01",
      closedAt: "2024-01-01",
    });
    data.snapshots.push({
      accountId: "repaid-loan",
      date: "2024-01-01",
      balance: 0,
    });

    const point = getNetWorthTimeSeries(buildRepository(data)).at(-1);

    expect(point?.["Repaid loan"]).toBeUndefined();
    expect(point?.total).toBe(88_000);
  });

  it("removes a closed investment from recorded and estimated net worth", () => {
    const data = homeData();
    data.accounts.push({
      id: "old-isa",
      name: "Old ISA",
      provider: "Broker",
      currency: "GBP",
      assetType: "stocks",
      expectedAnnualReturn: 0.05,
      createdAt: "2023-01-01",
      closedAt: "2025-01-01",
    });
    data.snapshots.push(
      { accountId: "old-isa", date: "2024-01-01", balance: 10_000 },
      { accountId: "home", date: "2025-01-01", balance: 300_000 },
    );

    const series = getNetWorthTimeSeries(buildRepository(data));

    expect(series[0]?.["Old ISA"]).toBe(10_000);
    expect(series.at(-1)?.["Old ISA"]).toBeUndefined();
    expect(series.at(-1)?.total).toBe(88_000);
    expect(series.at(-1)?.estimatedTotal).toBeUndefined();
  });

  it("stops netting a closed mortgage into its linked property", () => {
    const data = homeData();
    const mortgage = data.accounts.find((account) => account.id === "mortgage");
    if (mortgage == null) throw new Error("Expected mortgage fixture");
    mortgage.closedAt = "2025-01-01";
    data.snapshots.push(
      { accountId: "home", date: "2025-01-01", balance: 310_000 },
      { accountId: "mortgage", date: "2025-01-01", balance: -190_000 },
    );

    const point = getNetWorthTimeSeries(buildRepository(data)).at(-1);

    expect(point?.Home).toBe(310_000);
    expect(point?.Mortgage).toBeUndefined();
    expect(point?.total).toBe(308_000);
  });
});

describe("getPortfolioContributionTimeSeries", () => {
  it("accumulates imported and recorded external capital while internal transfers cancel", () => {
    const data = homeData();
    data.capitalFlows = [
      { accountId: "home", date: "2023-01-01", amount: 10_000 },
      { accountId: "home", date: "2023-02-01", amount: 500 },
      { accountId: "mortgage", date: "2023-02-01", amount: -500 },
    ];
    data.transfers = [
      {
        id: "deposit",
        date: "2023-03-01",
        toAccountId: "home",
        amount: 1_000,
      },
      {
        id: "withdrawal",
        date: "2023-04-01",
        fromAccountId: "home",
        amount: 200,
      },
      {
        id: "internal",
        date: "2023-05-01",
        fromAccountId: "home",
        toAccountId: "mortgage",
        amount: 300,
      },
    ];

    expect(getPortfolioContributionTimeSeries(buildRepository(data))).toEqual([
      { date: "2023-01-01", contributedCapital: 10_000 },
      { date: "2023-02-01", contributedCapital: 10_000 },
      { date: "2023-03-01", contributedCapital: 11_000 },
      { date: "2023-04-01", contributedCapital: 10_800 },
    ]);
  });
});

describe("getAccountDetail", () => {
  it("derives net contributed capital and current gain or loss", () => {
    const data = homeData();
    data.capitalFlows = [
      { accountId: "home", date: "2023-01-01", amount: 80000 },
      { accountId: "home", date: "2024-01-01", amount: 10000 },
    ];

    const account = getAccountDetail(buildRepository(data), "home");

    expect(account?.netContributed).toBe(90000);
    expect(account?.gainLoss).toBe(210000);
    expect(account?.capitalFlows).toEqual([
      { date: "2023-01-01", amount: 80000 },
      { date: "2024-01-01", amount: 10000 },
    ]);
  });

  it("rejects duplicate dated capital records before rendering date keys", () => {
    const data = homeData();
    data.capitalFlows = [
      { accountId: "home", date: "2024-01-01", amount: 1000 },
      { accountId: "home", date: "2024-01-01", amount: 2000 },
    ];

    expect(() => buildRepository(data)).toThrow(
      'Duplicate capital flow for account "home" on 2024-01-01',
    );
  });
});

describe("planned expenditure reference validation", () => {
  function dataWithSource(
    overrides: Partial<AssetTrackerData["accounts"][number]>,
  ): AssetTrackerData {
    const data = homeData();
    const source = data.accounts[0];
    if (source == null) throw new Error("Expected source account fixture");
    data.accounts[0] = {
      ...source,
      assetType: "cash",
      ...overrides,
    };
    data.plannedExpenditures = [
      {
        id: "new-car",
        name: "New car",
        amount: 20_000,
        date: "2099-06-01",
        fromAccountId: "home",
      },
    ];
    return data;
  }

  it.each([
    ["closed", { closedAt: "2025-01-01" }],
    ["a liability", { assetType: "debt" as const }],
    ["illiquid", { liquidity: "illiquid" as const }],
  ])(
    "rejects a persisted plan sourced from an account that is %s",
    (_label, overrides) => {
      expect(() => buildRepository(dataWithSource(overrides))).toThrow(
        'Planned expenditure "New car" references ineligible account "home"',
      );
    },
  );
});
