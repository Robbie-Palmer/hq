"use client";

import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CurrencySchema,
  SUPPORTED_CURRENCIES,
} from "@/lib/domain/assettracker";
import { AccountHistoryImportDrawer } from "./account-history-import-drawer";
import { AssetAllocationHistoryChart } from "./asset-allocation-history-chart";
import { useAssetTracker } from "./asset-tracker-provider";
import { HistoricalCurrencyDisclosure } from "./historical-currency-disclosure";
import { NetWorthChart } from "./net-worth-chart";
import { PortfolioContributionChart } from "./portfolio-contribution-chart";
import { RealIncomeHistoryChart } from "./real-income-history-chart";

export function HistoryRoute() {
  const {
    netWorthDataByCurrency,
    contributionData,
    assetAllocationHistory,
    baseCurrency,
    incomeHistory,
  } = useAssetTracker();
  const [historyCurrency, setHistoryCurrency] = useState(baseCurrency);

  useEffect(() => setHistoryCurrency(baseCurrency), [baseCurrency]);

  const netWorthData = netWorthDataByCurrency[historyCurrency];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="mb-2 text-3xl font-bold sm:text-4xl">History</h1>
          <p className="text-lg text-muted-foreground">
            Follow net worth, contributed capital, and allocation over time.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">
            Show net worth in
          </span>
          <Select
            value={historyCurrency}
            onValueChange={(value) =>
              setHistoryCurrency(CurrencySchema.parse(value))
            }
          >
            <SelectTrigger
              className="w-24"
              aria-label="Historical target currency"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_CURRENCIES.map((currency) => (
                <SelectItem key={currency} value={currency}>
                  {currency}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <AccountHistoryImportDrawer />
        </div>
      </div>
      <NetWorthChart
        data={netWorthData}
        currency={historyCurrency}
        baseCurrencyData={netWorthDataByCurrency[baseCurrency]}
        householdBaseCurrency={baseCurrency}
      />
      <HistoricalCurrencyDisclosure
        data={netWorthData}
        currency={historyCurrency}
      />
      <PortfolioContributionChart
        data={contributionData}
        currency={baseCurrency}
      />
      <RealIncomeHistoryChart
        incomeHistory={incomeHistory}
        currency={baseCurrency}
      />
      <AssetAllocationHistoryChart data={assetAllocationHistory} />
    </div>
  );
}
