"use client";

import { AccountHistoryImportDrawer } from "./account-history-import-drawer";
import { AssetAllocationHistoryChart } from "./asset-allocation-history-chart";
import { useAssetTracker } from "./asset-tracker-provider";
import { NetWorthChart } from "./net-worth-chart";
import { PortfolioContributionChart } from "./portfolio-contribution-chart";
import { RealIncomeHistoryChart } from "./real-income-history-chart";

export function HistoryRoute() {
  const {
    netWorthData,
    contributionData,
    assetAllocationHistory,
    baseCurrency,
    incomeHistory,
  } = useAssetTracker();

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="mb-2 text-4xl font-bold">History</h1>
          <p className="text-lg text-muted-foreground">
            Follow net worth, contributed capital, and allocation over time.
          </p>
        </div>
        <AccountHistoryImportDrawer />
      </div>
      <NetWorthChart data={netWorthData} currency={baseCurrency} />
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
