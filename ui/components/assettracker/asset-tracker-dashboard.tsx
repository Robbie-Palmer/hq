"use client";

import { formatAccountCurrency, formatAnnualRate } from "@/lib/assettracker";
import { realRate } from "@/lib/domain/assettracker";
import { AccountBalanceChart } from "./account-balance-chart";
import { AssetAllocationChart } from "./asset-allocation-chart";
import { useAssetTracker } from "./asset-tracker-provider";

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
    accountDetails,
    contributionData,
    assetAllocation,
    portfolioReturn,
    positionSummary,
    inflation,
    baseCurrency,
    valuationDate,
    valuationIssues,
  } = useAssetTracker();
  const contributedCapital = contributionData.at(-1)?.contributedCapital;
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
      <div>
        <h1 className="text-4xl font-bold mb-2">Asset Tracker</h1>
        <p className="text-lg text-muted-foreground">
          Track and visualise your portfolio across accounts.
        </p>
      </div>
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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="border rounded-lg p-6">
          <p className="text-sm text-muted-foreground">Total assets</p>
          <p className="text-3xl font-bold mt-1">
            {positionSummary == null
              ? "Unavailable"
              : formatAccountCurrency(
                  positionSummary.grossAssets,
                  baseCurrency,
                )}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Before liabilities
          </p>
        </div>
        <div className="border rounded-lg p-6">
          <p className="text-sm text-muted-foreground">Liabilities</p>
          <p className="text-3xl font-bold mt-1">
            {positionSummary == null
              ? "Unavailable"
              : formatAccountCurrency(
                  positionSummary.liabilities,
                  baseCurrency,
                )}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Debt across open accounts
          </p>
        </div>
        <div className="border rounded-lg p-6">
          <p className="text-sm text-muted-foreground">Net worth</p>
          <p className="text-3xl font-bold mt-1">
            {positionSummary == null
              ? "Unavailable"
              : formatAccountCurrency(positionSummary.netWorth, baseCurrency)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Assets less liabilities
          </p>
        </div>
        <div className="border rounded-lg p-6">
          <p className="text-sm text-muted-foreground">Liquid assets</p>
          <p className="text-3xl font-bold mt-1">
            {positionSummary == null
              ? "Unavailable"
              : formatAccountCurrency(
                  positionSummary.liquidAssets,
                  baseCurrency,
                )}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Cash and investments without access restrictions
          </p>
        </div>
        <div className="border rounded-lg p-6">
          <p className="text-sm text-muted-foreground">Contributed capital</p>
          <p className="text-3xl font-bold mt-1">
            {contributedCapital == null
              ? "Unavailable"
              : formatAccountCurrency(contributedCapital, baseCurrency)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Deposits minus withdrawals
          </p>
        </div>
        <div className="border rounded-lg p-6">
          <p className="text-sm text-muted-foreground">Portfolio growth</p>
          <p className="text-3xl font-bold mt-1">
            {portfolioReturn != null
              ? `${formatAnnualRate(portfolioReturn)}/yr`
              : "Unavailable"}
          </p>
          {portfolioReturn != null && (
            <p className="text-xs text-muted-foreground mt-1">
              {formatAnnualRate(realRate(portfolioReturn, inflation))}/yr after
              inflation · excludes recorded contributions
            </p>
          )}
        </div>
      </div>
      <div className="grid gap-8 lg:grid-cols-2">
        <AssetAllocationChart data={assetAllocation} currency={baseCurrency} />
        <AccountBalanceChart accounts={accountDetails} />
      </div>
    </div>
  );
}
