import { describe, expect, it } from "vitest";
import {
  buildBaseCurrencyFlowSankeyData,
  getDemoAssetTrackerData,
} from "@/lib/assettracker";
import {
  getAllAccountDetails,
  getAssetAllocationTimeSeries,
  getLatestPortfolioValuation,
  getNetWorthTimeSeries,
} from "@/lib/domain/assettracker/assetTrackerQueries";
import { buildRepository } from "@/lib/domain/assettracker/assetTrackerRepository";
import {
  hasFxExposure,
  type NetWorthDataPoint,
  toFxImpactTimeSeries,
} from "@/lib/domain/assettracker/assetTrackerViews";
import { valueAccountAtDate } from "@/lib/domain/assettracker/portfolioValuation";

describe("Asset Tracker demo-data adapter", () => {
  it("isolates the portfolio value caused by exchange-rate changes", () => {
    const series: NetWorthDataPoint[] = [
      {
        date: "2024-01-01",
        total: 180,
        conversion: {
          targetCurrency: "GBP",
          status: "complete",
          partialTotal: 180,
          accounts: [
            conversionAccount("Cash", 100, "GBP", 100),
            conversionAccount("US shares", 100, "USD", 80),
          ],
        },
      },
      {
        date: "2024-02-01",
        total: 250,
        conversion: {
          targetCurrency: "GBP",
          status: "complete",
          partialTotal: 250,
          accounts: [
            conversionAccount("Cash", 110, "GBP", 110),
            conversionAccount("US shares", 200, "USD", 140),
          ],
        },
      },
      {
        date: "2024-03-01",
        total: 120,
        conversion: {
          targetCurrency: "GBP",
          status: "complete",
          partialTotal: 120,
          accounts: [conversionAccount("Cash", 120, "GBP", 120)],
        },
      },
    ];

    expect(hasFxExposure(series, "GBP")).toBe(true);
    expect(toFxImpactTimeSeries(series, "GBP")).toEqual([
      {
        date: "2024-01-01",
        actualTotal: 180,
        fixedRateTotal: 180,
        impact: 0,
      },
      {
        date: "2024-02-01",
        actualTotal: 250,
        fixedRateTotal: 270,
        impact: -20,
      },
      {
        date: "2024-03-01",
        actualTotal: 120,
        fixedRateTotal: 120,
        impact: 0,
      },
    ]);
  });

  it("loads a fully valued multi-currency portfolio", () => {
    const repository = buildRepository(getDemoAssetTrackerData());
    const valuation = getLatestPortfolioValuation(repository);

    expect(repository.accounts.get("us-brokerage")?.currency).toBe("USD");
    expect(repository.transfers).toContainEqual(
      expect.objectContaining({
        fromAccountId: "nationwide-current",
        toAccountId: "us-brokerage",
        fromAmount: 1000,
        toAmount: 1270,
        feeAmount: 4,
        conversionProvider: "Wise",
      }),
    );
    expect(valuation?.date).toBe("2024-12-01");
    expect(valuation?.total).not.toBeNull();
    expect(valuation?.issues).toEqual([]);
    expect(getAssetAllocationTimeSeries(repository)[0]?.date).toBe(
      "2020-06-01",
    );
    expect(repository.settings.targetNetWorth).toEqual({
      amount: 500_000,
      currency: "GBP",
    });
    expect(repository.incomeHistory).toHaveLength(10);
    expect(repository.incomeHistory.at(0)).toEqual({
      date: "2020-06-01",
      amount: 14_400,
      currency: "GBP",
    });
    expect(repository.incomeHistory.at(-1)).toEqual({
      date: "2024-12-01",
      amount: 19_200,
      currency: "GBP",
    });
  });

  it("includes a decision-ready mortgage product in the demo household", () => {
    const repository = buildRepository(getDemoAssetTrackerData());
    const mortgage = repository.accounts.get("home-mortgage");

    expect(mortgage).toMatchObject({
      assetType: "mortgage",
      linkedAccountId: "home",
      expectedAnnualReturn: 0.0425,
      expectedReturnChanges: [{ date: "2028-03-01", rate: 0.0525 }],
      mortgageTerms: {
        overpaymentAllowance: { amount: 10_000, chargeRate: 0.05 },
        fees: [{ date: "2028-03-01", amount: 999 }],
        overpayments: [{ date: "2026-06-01", amount: 5_000 }],
      },
    });
    expect(repository.accounts.get("home")?.assetType).toBe("property");
  });

  it("uses the corrected USD market price in the latest valuation", () => {
    const repository = buildRepository(getDemoAssetTrackerData());
    const account = repository.accounts.get("us-brokerage");

    expect(account).toBeDefined();
    if (account == null) throw new Error("Demo USD account is missing");
    const valuation = valueAccountAtDate(repository, account, "2024-12-01");

    expect(valuation.nativeCurrency).toBe("USD");
    expect(valuation.nativeValue).toBe(11_000);
    expect(valuation.value).toBeCloseTo(8_593.75);
    expect(valuation.inputObservationIds).toContain(
      "us-total-market-price-2024-12-01-corrected",
    );
    expect(valuation.inputObservationIds).not.toContain(
      "us-total-market-price-2024-12-01-original",
    );
    expect(valuation.inputObservationIds).toContain(
      "gbp-usd-2024-12-01-corrected",
    );
    expect(valuation.inputObservationIds).not.toContain(
      "gbp-usd-2024-12-01-original",
    );
  });

  it.each(["GBP", "USD", "EUR"] as const)(
    "has complete historical net worth in %s",
    (currency) => {
      const data = getDemoAssetTrackerData();
      data.settings.baseCurrency = currency;

      const series = getNetWorthTimeSeries(buildRepository(data));

      expect(series).toHaveLength(13);
      expect(series.every((point) => point.total != null)).toBe(true);
      expect(
        series.every(
          (point) =>
            point.conversion == null || point.conversion.status === "complete",
        ),
      ).toBe(true);
    },
  );

  it("includes carried, triangulated, and corrected FX examples", () => {
    const data = getDemoAssetTrackerData();
    data.settings.baseCurrency = "USD";
    const series = getNetWorthTimeSeries(buildRepository(data));

    const juneRates = series
      .find((point) => point.date === "2024-06-01")
      ?.conversion?.accounts.flatMap((account) => account.rates);
    const septemberRates = series
      .find((point) => point.date === "2024-09-15")
      ?.conversion?.accounts.flatMap((account) => account.rates);
    const decemberRates = series
      .find((point) => point.date === "2024-12-01")
      ?.conversion?.accounts.flatMap((account) => account.rates);

    expect(juneRates).toContainEqual(
      expect.objectContaining({ carriedForward: true }),
    );
    expect(septemberRates).toContainEqual(
      expect.objectContaining({ method: "triangulated" }),
    );
    expect(decemberRates).toContainEqual(
      expect.objectContaining({
        observationId: "gbp-usd-2024-12-01-corrected",
      }),
    );
    expect(decemberRates).not.toContainEqual(
      expect.objectContaining({
        observationId: "gbp-usd-2024-12-01-original",
      }),
    );
  });

  it("includes a converted recurring contribution with a fee", () => {
    const data = getDemoAssetTrackerData();

    expect(data.recurringFlows).toContainEqual(
      expect.objectContaining({
        id: "us-brokerage-contribution",
        amount: 300,
        currency: "GBP",
        conversion: {
          received: { amount: 380, currency: "USD" },
          fee: { amount: 2, currency: "GBP" },
          provider: "Wise",
        },
      }),
    );

    const repository = buildRepository(data);
    const sankey = buildBaseCurrencyFlowSankeyData(
      repository,
      getAllAccountDetails(repository),
      "2024-12-01",
    );
    expect(sankey.nodes).toContainEqual(
      expect.objectContaining({ name: "Wise" }),
    );
    expect(sankey.links).toContainEqual(
      expect.objectContaining({ label: "Conversion fee and spread" }),
    );
  });
});

function conversionAccount(
  accountName: string,
  nativeValue: number,
  nativeCurrency: "GBP" | "USD" | "EUR",
  convertedValue: number,
) {
  return {
    accountId: accountName.toLowerCase().replaceAll(" ", "-"),
    accountName,
    nativeValue,
    nativeCurrency,
    convertedValue,
    rates: [],
    issues: [],
  };
}
