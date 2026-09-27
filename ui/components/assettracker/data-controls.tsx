"use client";

import {
  DownloadIcon,
  FileSpreadsheetIcon,
  RotateCcwIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { type ChangeEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CurrencySchema,
  formatAssetTrackerError,
  SUPPORTED_CURRENCIES,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";

export function DataControls() {
  const {
    hasLocalChanges,
    inflation,
    baseCurrency,
    setInflation,
    setBaseCurrency,
    exportData,
    exportCsv,
    importData,
    clearData,
    resetData,
  } = useAssetTracker();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"clear" | "reset" | null>(null);
  const clearLabel = hasLocalChanges ? "Clear all data" : "Clear demo data";
  const clearButtonLabel =
    confirming === "clear" ? `${clearLabel}?` : clearLabel;

  async function handleInflationChange(value: string) {
    if (value === "") return;
    const percent = Number(value);
    if (!Number.isFinite(percent)) return;
    try {
      await setInflation(percent / 100);
      setError(null);
    } catch (err) {
      setError(formatAssetTrackerError(err));
    }
  }

  async function handleBaseCurrencyChange(value: string) {
    try {
      await setBaseCurrency(CurrencySchema.parse(value));
      setError(null);
    } catch (err) {
      setError(formatAssetTrackerError(err));
    }
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      await importData(file);
      setError(null);
    } catch (err) {
      setError(formatAssetTrackerError(err));
    }
  }

  async function handleReset() {
    if (confirming !== "reset") {
      setConfirming("reset");
      return;
    }
    try {
      await resetData();
      setConfirming(null);
      setError(null);
    } catch (err) {
      setError(formatAssetTrackerError(err));
    }
  }

  async function handleClear() {
    if (confirming !== "clear") {
      setConfirming("clear");
      return;
    }
    try {
      await clearData();
      setConfirming(null);
      setError(null);
    } catch (err) {
      setError(formatAssetTrackerError(err));
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {hasLocalChanges
            ? "Your changes are saved in this browser — nothing leaves your device."
            : "This is demo data. Log a balance or add an account to try it; changes are saved in your browser."}
        </p>
        <div className="flex flex-wrap items-center gap-1">
          <label
            htmlFor="expected-inflation"
            className="flex items-center gap-1.5 pr-2 text-sm text-muted-foreground"
          >
            Inflation
            <Input
              id="expected-inflation"
              type="number"
              inputMode="decimal"
              step="0.1"
              min="-99"
              className="h-8 w-16 text-right"
              key={inflation}
              defaultValue={(inflation * 100).toFixed(1)}
              onBlur={(e) => handleInflationChange(e.target.value)}
            />
            %/yr
          </label>
          <div className="flex items-center gap-1.5 pr-2 text-sm text-muted-foreground">
            <span>Base currency</span>
            <Select
              value={baseCurrency}
              onValueChange={handleBaseCurrencyChange}
            >
              <SelectTrigger
                className="h-8 w-20"
                aria-label="Household base currency"
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
          </div>
          <Button variant="ghost" size="sm" onClick={exportData}>
            <DownloadIcon />
            Export
          </Button>
          <Button variant="ghost" size="sm" onClick={exportCsv}>
            <FileSpreadsheetIcon />
            CSV
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <UploadIcon />
            Import
          </Button>
          <Button
            variant={confirming === "clear" ? "destructive" : "ghost"}
            size="sm"
            onClick={handleClear}
          >
            <Trash2Icon />
            {clearButtonLabel}
          </Button>
          {hasLocalChanges && (
            <Button
              variant={confirming === "reset" ? "destructive" : "ghost"}
              size="sm"
              onClick={handleReset}
            >
              <RotateCcwIcon />
              {confirming === "reset" ? "Discard my data?" : "Restore demo"}
            </Button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-label="Import Asset Tracker JSON export"
            onChange={handleImport}
          />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
