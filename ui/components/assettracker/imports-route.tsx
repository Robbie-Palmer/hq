"use client";

import { AccountHistoryImportDrawer } from "./account-history-import-drawer";
import { DataControls } from "./data-controls";
import { IncomeHistoryImportDrawer } from "./income-history-import-drawer";
import { SpreadsheetImportDrawer } from "./spreadsheet-import-drawer";

export function ImportsRoute() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-2 text-4xl font-bold">Imports</h1>
        <p className="text-lg text-muted-foreground">
          Move account history, income history, and portable Asset Tracker data
          in or out of this browser.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <SpreadsheetImportDrawer />
        <AccountHistoryImportDrawer />
        <IncomeHistoryImportDrawer />
      </div>
      <DataControls mode="data" />
    </div>
  );
}
