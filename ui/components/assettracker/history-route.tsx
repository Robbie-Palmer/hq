"use client";

import { useEffect, useMemo, useState } from "react";
import type { Currency } from "@/lib/domain/assettracker";
import { AssetAllocationHistoryChart } from "./asset-allocation-history-chart";
import { useAssetTracker } from "./asset-tracker-provider";
import { HistoricalCurrencyDisclosure } from "./historical-currency-disclosure";
import {
  HistoryRouteHeader,
  PortfolioHistoryHeader,
} from "./history-route-header";
import { NetWorthChart } from "./net-worth-chart";
import { PortfolioContributionChart } from "./portfolio-contribution-chart";
import { RealGrossSalaryHistory } from "./real-gross-salary-history";
import { RealIncomeHistoryChart } from "./real-income-history-chart";

export function HistoryRoute() {
  const {
    netWorthDataByCurrency,
    contributionData,
    assetAllocationHistory,
    baseCurrency,
    incomeHistory,
    salaryHistory,
  } = useAssetTracker();
  const [historyCurrency, setHistoryCurrency] = useState(baseCurrency);
  const availableCurrencies = useMemo(
    () =>
      Object.entries(netWorthDataByCurrency)
        .filter(([, points]) => points.some(({ total }) => total != null))
        .map(([currency]) => currency as Currency),
    [netWorthDataByCurrency],
  );

  useEffect(() => {
    setHistoryCurrency(
      availableCurrencies.includes(baseCurrency)
        ? baseCurrency
        : (availableCurrencies[0] ?? baseCurrency),
    );
  }, [availableCurrencies, baseCurrency]);

  const netWorthData = netWorthDataByCurrency[historyCurrency];

  return (
    <div className="space-y-10">
      <HistoryRouteHeader />
      <section aria-labelledby="income-history-heading" className="space-y-6">
        <div>
          <h2 id="income-history-heading" className="text-2xl font-semibold">
            Income history
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Salary rates, estimated take-home pay, and recorded income.
          </p>
        </div>
        <RealGrossSalaryHistory salaryHistory={salaryHistory} />
        <RealIncomeHistoryChart
          incomeHistory={incomeHistory}
          currency={baseCurrency}
        />
      </section>
      <section
        aria-labelledby="portfolio-history-heading"
        className="space-y-6 border-t pt-8"
      >
        <PortfolioHistoryHeader
          availableCurrencies={availableCurrencies}
          currency={historyCurrency}
          onCurrencyChange={setHistoryCurrency}
        />
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
        <AssetAllocationHistoryChart data={assetAllocationHistory} />
      </section>
    </div>
  );
}
