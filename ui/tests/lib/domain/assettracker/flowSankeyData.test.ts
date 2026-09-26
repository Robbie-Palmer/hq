import { describe, expect, it } from "vitest";
import {
  AssetTrackerDataSchema,
  buildBaseCurrencyFlowSankeyData,
  buildRepository,
  getAllAccountSummaries,
} from "@/lib/domain/assettracker";

describe("buildBaseCurrencyFlowSankeyData", () => {
  it("shows a conversion provider, fee, and spread using base-currency values", () => {
    const data = AssetTrackerDataSchema.parse({
      accounts: [
        {
          id: "gbp-cash",
          name: "GBP cash",
          provider: "Bank",
          currency: "GBP",
          assetType: "cash",
          expectedAnnualReturn: 0,
          createdAt: "2025-01-01",
        },
        {
          id: "usd-cash",
          name: "USD cash",
          provider: "Bank",
          currency: "USD",
          assetType: "cash",
          expectedAnnualReturn: 0,
          createdAt: "2025-01-01",
        },
      ],
      snapshots: [
        { accountId: "gbp-cash", date: "2025-01-10", balance: 1_000 },
        { accountId: "usd-cash", date: "2025-01-10", balance: 1_000 },
      ],
      exchangeRateObservations: [
        {
          id: "usd-gbp",
          fromCurrency: "USD",
          toCurrency: "GBP",
          rate: 0.8,
          validAt: "2025-01-10",
          acceptedAt: "2025-01-10T12:00:00Z",
          source: { kind: "manual", id: "test" },
        },
      ],
      recurringFlows: [
        {
          id: "convert-savings",
          name: "Convert savings",
          fromAccountId: "gbp-cash",
          toAccountId: "usd-cash",
          amount: 810,
          currency: "GBP",
          conversion: {
            received: { amount: 1_000, currency: "USD" },
            fee: { amount: 10, currency: "GBP" },
            provider: "Low-cost broker",
          },
          frequency: "monthly",
          startDate: "2025-01-01",
        },
      ],
      settings: {
        expectedAnnualInflation: 0.025,
        withdrawalRate: 0.04,
        baseCurrency: "GBP",
        valuationMaxAgeDays: 7,
      },
    });
    const repository = buildRepository(data);

    const sankey = buildBaseCurrencyFlowSankeyData(
      repository,
      getAllAccountSummaries(repository),
      "2025-01-10",
    );
    const links = sankey.links.map((link) => ({
      source: link.sourceName,
      target: link.targetName,
      value: link.value,
      label: link.label,
    }));

    expect(sankey.nodes).toContainEqual(
      expect.objectContaining({
        id: "__conversion:convert-savings",
        name: "Low-cost broker",
      }),
    );
    expect(links).toEqual(
      expect.arrayContaining([
        {
          source: "GBP cash",
          target: "Low-cost broker",
          value: 820,
          label: "Convert savings",
        },
        {
          source: "Low-cost broker",
          target: "USD cash",
          value: 800,
          label: "Convert savings",
        },
        {
          source: "Low-cost broker",
          target: "External spending",
          value: 20,
          label: "Conversion fee and spread",
        },
      ]),
    );
  });
});
