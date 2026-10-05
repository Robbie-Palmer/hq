import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { HistoricalCurrencyDisclosure } from "@/components/assettracker/historical-currency-disclosure";
import type { NetWorthDataPoint } from "@/lib/domain/assettracker";

describe("HistoricalCurrencyDisclosure", () => {
  it("shows native values, converted values, lineage, and gaps", async () => {
    const user = userEvent.setup();
    const data: NetWorthDataPoint[] = [
      {
        date: "2025-01-05",
        total: null,
        conversion: {
          targetCurrency: "GBP",
          status: "incomplete",
          partialTotal: 75,
          accounts: [
            {
              accountId: "usd-cash",
              accountName: "USD cash",
              nativeValue: 100,
              nativeCurrency: "USD",
              convertedValue: 75,
              issues: [],
              rates: [
                {
                  observationId: "usd-gbp",
                  fromCurrency: "USD",
                  toCurrency: "GBP",
                  rate: 0.75,
                  source: "Frankfurter",
                  effectiveDate: "2025-01-03",
                  carriedForward: true,
                  method: "triangulated",
                },
              ],
            },
            {
              accountId: "eur-cash",
              accountName: "EUR cash",
              nativeValue: 80,
              nativeCurrency: "EUR",
              convertedValue: null,
              rates: [],
              issues: [{ kind: "missing_exchange_rate", currency: "EUR" }],
            },
          ],
        },
      },
    ];

    render(<HistoricalCurrencyDisclosure data={data} currency="GBP" />);

    expect(screen.getByText("1 of 1 points incomplete")).toBeVisible();
    await user.click(screen.getByText("Exchange-rate history"));
    expect(screen.getByText("US$100.00")).toBeVisible();
    expect(screen.getByText("£75.00")).toBeVisible();
    expect(
      screen.getByText(
        "Frankfurter, effective 2025-01-03, triangulated, carried forward",
      ),
    ).toBeVisible();
    expect(screen.getByText("No EUR exchange rate")).toBeVisible();
    expect(screen.getByText("Conversion unavailable")).toBeVisible();
  });
});
