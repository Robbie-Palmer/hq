"use client";

import { useAssetTracker } from "./asset-tracker-provider";
import { FlowSankeyChart } from "./flow-sankey-chart";
import { IncomeExpenditureChart } from "./income-expenditure-chart";
import { IncomeHistoryImportDrawer } from "./income-history-import-drawer";
import { RecordTransferDrawer } from "./record-transfer-drawer";
import { RecurringFlowsManager } from "./recurring-flows-manager";
import { UpcomingFlows } from "./upcoming-flows";

export function CashFlowRoute() {
  const { flowSankeyData, baseCurrency, incomeHistory, financialIndependence } =
    useAssetTracker();

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="mb-2 text-4xl font-bold">Cash flow</h1>
          <p className="text-lg text-muted-foreground">
            Manage expected money movement, transfers, income, and spending.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <IncomeHistoryImportDrawer />
          <RecordTransferDrawer />
        </div>
      </div>
      <UpcomingFlows />
      <RecurringFlowsManager />
      <FlowSankeyChart data={flowSankeyData} currency={baseCurrency} />
      <IncomeExpenditureChart
        incomeHistory={incomeHistory}
        periods={financialIndependence.periods}
        currency={baseCurrency}
      />
    </div>
  );
}
