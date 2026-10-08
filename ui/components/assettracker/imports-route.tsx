"use client";

import { AccountHistoryImportDrawer } from "./account-history-import-drawer";
import { DataControls } from "./data-controls";
import { IncomeHistoryImportDrawer } from "./income-history-import-drawer";
import { SalaryCalculationHistory } from "./salary-calculation-history";
import { SalaryHistoryManager } from "./salary-history-manager";
import { SpreadsheetImportDrawer } from "./spreadsheet-import-drawer";

export function ImportsRoute() {
  return (
    <div className="min-w-0 space-y-8 overflow-x-clip">
      <div>
        <h1 className="mb-2 text-3xl font-bold sm:text-4xl">Imports</h1>
        <p className="text-lg text-muted-foreground">
          Import account, income, and salary history or back up the complete
          household stored in this browser.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <SpreadsheetImportDrawer />
        <AccountHistoryImportDrawer />
        <IncomeHistoryImportDrawer />
      </div>
      <SalaryHistoryManager />
      <SalaryCalculationHistory />
      <DataControls mode="data" />
    </div>
  );
}
