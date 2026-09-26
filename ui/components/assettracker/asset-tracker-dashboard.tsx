"use client";

import { useState } from "react";
import {
  formatAccountCurrency,
  formatAnnualRate,
  realRate,
} from "@/lib/domain/assettracker";
import { AccountBalanceChart } from "./account-balance-chart";
import { AccountDetailSheet } from "./account-detail-sheet";
import { AccountHistoryImportDrawer } from "./account-history-import-drawer";
import { AccountsTable } from "./accounts-table";
import { AddAccountDrawer } from "./add-account-drawer";
import { AssetAllocationChart } from "./asset-allocation-chart";
import { AssetAllocationHistoryChart } from "./asset-allocation-history-chart";
import { useAssetTracker } from "./asset-tracker-provider";
import { DataControls } from "./data-controls";
import { FlowSankeyChart } from "./flow-sankey-chart";
import { LogBalanceDrawer } from "./log-balance-drawer";
import { NetWorthChart } from "./net-worth-chart";
import { PortfolioContributionChart } from "./portfolio-contribution-chart";
import { PortfolioGoal } from "./portfolio-goal";
import { RecordTransferDrawer } from "./record-transfer-drawer";
import { UpcomingFlows } from "./upcoming-flows";

function staleObservationMessage(
  count: number,
  singular: string,
  plural: string,
): string {
  if (count === 0) return "";
  const noun = count === 1 ? singular : plural;
  const verb = count === 1 ? "is" : "are";
  return `${count} ${noun} ${verb} missing or stale. `;
}

export function AssetTrackerDashboard() {
  const {
    accounts,
    accountDetails,
    netWorthData,
    contributionData,
    assetAllocation,
    assetAllocationHistory,
    portfolioReturn,
    inflation,
    baseCurrency,
    valuationDate,
    valuationIssues,
    flowSankeyData,
  } = useAssetTracker();
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    null,
  );

  const openAccounts = accounts.filter((a) => a.isOpen);
  const contributedCapital = contributionData.at(-1)?.contributedCapital;
  const latestNetWorth = netWorthData.at(-1)?.total ?? null;
  const missingPrices = valuationIssues.filter(
    (issue) => issue.kind === "missing_price" || issue.kind === "stale_price",
  ).length;
  const missingRates = valuationIssues.length - missingPrices;
  const missingRateMessage = staleObservationMessage(
    missingRates,
    "exchange rate",
    "exchange rates",
  );
  const missingPriceMessage = staleObservationMessage(
    missingPrices,
    "holding price",
    "holding prices",
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-4xl font-bold mb-2">Asset Tracker</h1>
          <p className="text-lg text-muted-foreground">
            Track and visualise your portfolio across accounts.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <AccountHistoryImportDrawer />
          <LogBalanceDrawer />
          <RecordTransferDrawer />
          <AddAccountDrawer />
        </div>
      </div>
      <DataControls />
      {valuationIssues.length > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm"
        >
          <p className="font-medium">Portfolio total unavailable</p>
          <p className="mt-1 text-muted-foreground">
            {missingRateMessage}
            {missingPriceMessage}
            Import current observations before using the {baseCurrency} total
            {valuationDate == null ? "." : ` for ${valuationDate}.`}
          </p>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <div className="border rounded-lg p-6">
          <p className="text-sm text-muted-foreground">Market net worth</p>
          <p className="text-3xl font-bold mt-1">
            {latestNetWorth == null
              ? "Unavailable"
              : formatAccountCurrency(latestNetWorth, baseCurrency)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Latest valuations less liabilities
          </p>
        </div>
        <div className="border rounded-lg p-6">
          <p className="text-sm text-muted-foreground">Portfolio Growth</p>
          <p className="text-3xl font-bold mt-1">
            {portfolioReturn != null
              ? `${formatAnnualRate(portfolioReturn)}/yr`
              : "—"}
          </p>
          {portfolioReturn != null && (
            <p className="text-xs text-muted-foreground mt-1">
              {formatAnnualRate(realRate(portfolioReturn, inflation))}/yr after
              inflation · excludes recorded contributions
            </p>
          )}
        </div>
        <div className="border rounded-lg p-6">
          <p className="text-sm text-muted-foreground">Contributed capital</p>
          <p className="text-3xl font-bold mt-1">
            {contributedCapital == null
              ? "—"
              : formatAccountCurrency(contributedCapital, baseCurrency)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Deposits minus withdrawals
          </p>
        </div>
        <div className="border rounded-lg p-6">
          <p className="text-sm text-muted-foreground">Open Accounts</p>
          <p className="text-3xl font-bold mt-1">{openAccounts.length}</p>
        </div>
        <div className="border rounded-lg p-6">
          <p className="text-sm text-muted-foreground">Asset Types</p>
          <p className="text-3xl font-bold mt-1">{assetAllocation.length}</p>
        </div>
      </div>
      <NetWorthChart data={netWorthData} currency={baseCurrency} />
      <PortfolioContributionChart
        data={contributionData}
        currency={baseCurrency}
      />
      <AssetAllocationHistoryChart data={assetAllocationHistory} />
      <PortfolioGoal />
      <div className="grid gap-8 lg:grid-cols-2">
        <UpcomingFlows />
        <FlowSankeyChart data={flowSankeyData} currency={baseCurrency} />
      </div>
      <div className="grid gap-8 lg:grid-cols-2">
        <AssetAllocationChart data={assetAllocation} currency={baseCurrency} />
        <AccountBalanceChart accounts={accountDetails} />
      </div>
      <div>
        <h2 className="text-2xl font-semibold mb-4">Accounts</h2>
        <AccountsTable
          accounts={accountDetails}
          onSelectAccount={setSelectedAccountId}
        />
      </div>
      <AccountDetailSheet
        accountId={selectedAccountId}
        onClose={() => setSelectedAccountId(null)}
      />
    </div>
  );
}
