import { describe, expect, it } from "vitest";
import {
  buildBaseCurrencyFlowSankeyData,
  getDemoAssetTrackerData,
} from "@/lib/assettracker";
import {
  getAllAccountDetails,
  getAssetAllocationTimeSeries,
  getLatestPortfolioValuation,
} from "@/lib/domain/assettracker/assetTrackerQueries";
import { buildRepository } from "@/lib/domain/assettracker/assetTrackerRepository";
import { valueAccountAtDate } from "@/lib/domain/assettracker/portfolioValuation";

describe("Asset Tracker demo-data adapter", () => {
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
