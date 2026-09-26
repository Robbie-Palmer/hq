import { describe, expect, it } from "vitest";
import {
  type AssetTrackerData,
  AssetTrackerDataSchema,
  buildRepository,
  getAllAccountSummaries,
  getNetWorthTimeSeries,
  getPortfolioFinancialIndependence,
  valuePortfolioAtDate,
} from "@/lib/domain/assettracker";

const source = { kind: "manual" as const, id: "test-entry" };

function mixedCurrencyData(): AssetTrackerData {
  return AssetTrackerDataSchema.parse({
    accounts: [
      {
        id: "cash-gbp",
        name: "Cash",
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
        expectedAnnualReturn: 0.07,
        createdAt: "2025-01-01",
      },
    ],
    snapshots: [{ accountId: "cash-gbp", date: "2025-01-10", balance: 1_000 }],
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
        id: "holding-1",
        accountId: "broker-usd",
        instrumentId: "fund-usd",
        quantity: 10,
        validAt: "2025-01-10",
        acceptedAt: "2025-01-10T12:00:00Z",
        source,
      },
    ],
    priceObservations: [
      {
        id: "price-1",
        instrumentId: "fund-usd",
        currency: "USD",
        price: 100,
        validAt: "2025-01-10",
        acceptedAt: "2025-01-10T12:00:00Z",
        source,
      },
    ],
    exchangeRateObservations: [
      {
        id: "fx-1",
        fromCurrency: "USD",
        toCurrency: "GBP",
        rate: 0.8,
        validAt: "2025-01-10",
        acceptedAt: "2025-02-01T12:00:00Z",
        source,
      },
    ],
    settings: {
      expectedAnnualInflation: 0.025,
      withdrawalRate: 0.04,
      baseCurrency: "GBP",
      valuationMaxAgeDays: 7,
    },
  });
}

describe("portfolio valuation", () => {
  it("values GBP cash and USD quantities in one explicit base currency", () => {
    const valuation = valuePortfolioAtDate(
      buildRepository(mixedCurrencyData()),
      "2025-01-10",
    );

    expect(valuation.baseCurrency).toBe("GBP");
    expect(valuation.total).toBe(1_800);
    expect(valuation.byAccount.get("broker-usd")?.nativeValue).toBe(1_000);
  });

  it("keeps account values native while household views use the base currency", () => {
    const repository = buildRepository(mixedCurrencyData());

    const brokerage = getAllAccountSummaries(repository).find(
      (account) => account.id === "broker-usd",
    );
    const netWorth = getNetWorthTimeSeries(repository).at(-1);
    const financialIndependence = getPortfolioFinancialIndependence(repository);

    expect(brokerage?.latestBalance).toBe(1_000);
    expect(brokerage?.currency).toBe("USD");
    expect(netWorth?.["US brokerage"]).toBe(800);
    expect(netWorth?.total).toBe(1_800);
    expect(financialIndependence.runway.liquid.balance).toBe(1_800);
    expect(financialIndependence.runway.total.balance).toBe(1_800);
  });

  it("can value the same observations in USD through the inverse rate", () => {
    const data = mixedCurrencyData();
    data.settings.baseCurrency = "USD";

    const valuation = valuePortfolioAtDate(buildRepository(data), "2025-01-10");

    expect(valuation.baseCurrency).toBe("USD");
    expect(valuation.total).toBe(2_250);
  });

  it("keeps late rates out of an earlier as-known view", () => {
    const repository = buildRepository(mixedCurrencyData());

    const beforeRate = valuePortfolioAtDate(
      repository,
      "2025-01-10",
      "2025-01-15T00:00:00Z",
    );
    const afterRate = valuePortfolioAtDate(
      repository,
      "2025-01-10",
      "2025-02-02T00:00:00Z",
    );

    expect(beforeRate.total).toBeNull();
    expect(beforeRate.issues).toMatchObject([
      { kind: "missing_exchange_rate", accountId: "broker-usd" },
    ]);
    expect(afterRate.total).toBe(1_800);
  });

  it("applies a correction without rewriting the earlier as-known result", () => {
    const data = mixedCurrencyData();
    data.exchangeRateObservations?.push({
      id: "fx-2",
      fromCurrency: "USD",
      toCurrency: "GBP",
      rate: 0.75,
      validAt: "2025-01-10",
      acceptedAt: "2025-02-03T12:00:00Z",
      source,
      correctsId: "fx-1",
    });
    const repository = buildRepository(data);

    const original = valuePortfolioAtDate(
      repository,
      "2025-01-10",
      "2025-02-02T00:00:00Z",
    );
    const corrected = valuePortfolioAtDate(repository, "2025-01-10");

    expect(original.total).toBe(1_800);
    expect(corrected.total).toBe(1_750);
    expect(valuePortfolioAtDate(repository, "2025-01-10")).toEqual(corrected);
  });

  it("returns an actionable stale-rate state instead of carrying a rate", () => {
    const data = mixedCurrencyData();
    const price = data.priceObservations?.[0];
    if (price == null) throw new Error("Missing price fixture");
    price.validAt = "2025-01-20";
    price.acceptedAt = "2025-01-20T12:00:00Z";
    const valuation = valuePortfolioAtDate(buildRepository(data), "2025-01-20");

    expect(valuation.total).toBeNull();
    expect(valuation.partialTotal).toBe(1_000);
    expect(valuation.issues).toMatchObject([
      {
        kind: "stale_exchange_rate",
        accountId: "broker-usd",
        instrumentId: "fund-usd",
        observedAt: "2025-01-10",
      },
    ]);
  });

  it("does not include an account after its closing date", () => {
    const data = mixedCurrencyData();
    const brokerage = data.accounts.find(
      (account) => account.id === "broker-usd",
    );
    if (brokerage == null) throw new Error("Missing brokerage fixture");
    brokerage.closedAt = "2025-01-10";

    const valuation = valuePortfolioAtDate(buildRepository(data), "2025-01-10");

    expect(valuation.total).toBe(1_000);
    expect(valuation.byAccount.has("broker-usd")).toBe(false);
  });
});
