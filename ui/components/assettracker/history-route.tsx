"use client";

import { useEffect, useMemo, useState } from "react";
import type { Currency } from "@/lib/domain/assettracker";
import { AssetAllocationHistoryChart } from "./asset-allocation-history-chart";
import { useAssetTracker } from "./asset-tracker-provider";
import { HistoricalCurrencyDisclosure } from "./historical-currency-disclosure";
import { HistoryRouteHeader } from "./history-route-header";
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
    <div className="space-y-8">
      <HistoryRouteHeader
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
      <RealGrossSalaryHistory salaryHistory={salaryHistory} />
      <RealIncomeHistoryChart
        incomeHistory={incomeHistory}
        currency={baseCurrency}
      />
      <AssetAllocationHistoryChart data={assetAllocationHistory} />
    </div>
  );
}
