"use client";

import {
  DownloadIcon,
  FileSpreadsheetIcon,
  RotateCcwIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { type ChangeEvent, type RefObject, useRef, useState } from "react";
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
  type AssetTrackerBackupPreview,
  CurrencySchema,
  formatAssetTrackerError,
  SUPPORTED_CURRENCIES,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";

type DataControlsMode = "all" | "data" | "settings";
type DestructiveConfirmation = "clear" | "reset" | null;

interface RestorePreviewState {
  fileName: string;
  value: AssetTrackerBackupPreview;
}

function showsMode(mode: DataControlsMode, section: "data" | "settings") {
  return mode === "all" || mode === section;
}

function storageMessage(hasLocalChanges: boolean): string {
  return hasLocalChanges
    ? "Your changes are saved in this browser. Nothing leaves your device."
    : "This is demo data. Log a balance or add an account to try it; changes are saved in your browser.";
}

function clearButtonText(
  hasLocalChanges: boolean,
  confirming: DestructiveConfirmation,
): string {
  const label = hasLocalChanges ? "Clear all data" : "Clear demo data";
  return confirming === "clear" ? `${label}?` : label;
}

function useDataControlActions() {
  const {
    hasLocalChanges,
    inflation,
    baseCurrency,
    setInflation,
    setBaseCurrency,
    downloadBackup,
    exportCsv,
    previewBackup,
    restoreBackup,
    clearData,
    resetData,
  } = useAssetTracker();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [restorePreview, setRestorePreview] =
    useState<RestorePreviewState | null>(null);
  const [confirmingRestore, setConfirmingRestore] = useState(false);
  const [confirming, setConfirming] = useState<DestructiveConfirmation>(null);

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

  async function handleBackupFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const preview = await previewBackup(file);
      setRestorePreview({ fileName: file.name, value: preview });
      setConfirmingRestore(false);
      setNotice(null);
      setError(null);
    } catch (err) {
      setRestorePreview(null);
      setConfirmingRestore(false);
      setError(formatAssetTrackerError(err));
    }
  }

  async function handleRestore() {
    if (restorePreview == null) return;
    if (!confirmingRestore) {
      setConfirmingRestore(true);
      return;
    }
    try {
      await restoreBackup(restorePreview.value.backup);
      setNotice(`Restored ${restorePreview.fileName}`);
      setRestorePreview(null);
      setConfirmingRestore(false);
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

  function cancelRestore() {
    setRestorePreview(null);
    setConfirmingRestore(false);
  }

  return {
    hasLocalChanges,
    inflation,
    baseCurrency,
    downloadBackup,
    exportCsv,
    fileInputRef,
    error,
    notice,
    restorePreview,
    confirmingRestore,
    confirming,
    handleInflationChange,
    handleBaseCurrencyChange,
    handleBackupFile,
    handleRestore,
    handleReset,
    handleClear,
    cancelRestore,
  };
}

function RestorePreview({
  state,
  confirming,
  onRestore,
  onCancel,
}: Readonly<{
  state: RestorePreviewState;
  confirming: boolean;
  onRestore(): void;
  onCancel(): void;
}>) {
  const { fileName, value } = state;
  const provenance = value.migrated
    ? " is an older export that will be migrated during restore."
    : ` was created ${new Date(value.backup.createdAt).toLocaleString()}.`;

  return (
    <section
      aria-labelledby="restore-preview-title"
      className="space-y-3 rounded-md border bg-background p-4"
    >
      <div>
        <h3 id="restore-preview-title" className="font-medium">
          Review restore
        </h3>
        <p className="text-sm text-muted-foreground">
          {fileName}
          {provenance}
        </p>
      </div>
      <RestoreSummary value={value} />
      <p className="text-sm text-muted-foreground">
        Restoring replaces all current Asset Tracker data in this browser.
        Download a backup first if you may need the current data again.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant={confirming ? "destructive" : "default"}
          size="sm"
          onClick={onRestore}
        >
          {confirming ? "Replace current data?" : "Restore this backup"}
        </Button>
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

function RestoreSummary({
  value,
}: Readonly<{ value: AssetTrackerBackupPreview }>) {
  const balances = (summary: AssetTrackerBackupPreview["current"]) =>
    summary.latestAccountBalances.length === 0
      ? "No balances"
      : summary.latestAccountBalances
          .map(({ currency, amount }) =>
            new Intl.NumberFormat(undefined, {
              style: "currency",
              currency,
            }).format(amount),
          )
          .join(", ");
  const rows = [
    [
      "Household members",
      value.current.householdMembers,
      value.replacement.householdMembers,
    ],
    ["Accounts", value.current.accounts, value.replacement.accounts],
    [
      "Stored records",
      value.current.storedRecords,
      value.replacement.storedRecords,
    ],
    ["Latest balances", balances(value.current), balances(value.replacement)],
  ] as const;
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
      {rows.map(([label, current, replacement]) => (
        <div key={label}>
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="font-medium">
            {current} to {replacement}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function HouseholdSettings({
  inflation,
  baseCurrency,
  onInflationChange,
  onBaseCurrencyChange,
}: Readonly<{
  inflation: number;
  baseCurrency: string;
  onInflationChange(value: string): void;
  onBaseCurrencyChange(value: string): void;
}>) {
  return (
    <>
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
          onBlur={(event) => onInflationChange(event.target.value)}
        />
        %/yr
      </label>
      <div className="flex items-center gap-1.5 pr-2 text-sm text-muted-foreground">
        <span>Base currency</span>
        <Select value={baseCurrency} onValueChange={onBaseCurrencyChange}>
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
    </>
  );
}

function PortableDataActions({
  inputRef,
  onDownload,
  onCsv,
  onFile,
}: Readonly<{
  inputRef: RefObject<HTMLInputElement | null>;
  onDownload(): void;
  onCsv(): void;
  onFile(event: ChangeEvent<HTMLInputElement>): void;
}>) {
  return (
    <>
      <Button variant="ghost" size="sm" onClick={onDownload}>
        <DownloadIcon />
        Download backup
      </Button>
      <Button variant="ghost" size="sm" onClick={onCsv}>
        <FileSpreadsheetIcon />
        CSV
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => inputRef.current?.click()}
      >
        <UploadIcon />
        Restore backup
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        aria-label="Choose Asset Tracker backup file"
        onChange={onFile}
      />
    </>
  );
}

function DestructiveDataActions({
  hasLocalChanges,
  confirming,
  clearLabel,
  onClear,
  onReset,
}: Readonly<{
  hasLocalChanges: boolean;
  confirming: DestructiveConfirmation;
  clearLabel: string;
  onClear(): void;
  onReset(): void;
}>) {
  return (
    <>
      <Button
        variant={confirming === "clear" ? "destructive" : "ghost"}
        size="sm"
        onClick={onClear}
      >
        <Trash2Icon />
        {clearLabel}
      </Button>
      {hasLocalChanges && (
        <Button
          variant={confirming === "reset" ? "destructive" : "ghost"}
          size="sm"
          onClick={onReset}
        >
          <RotateCcwIcon />
          {confirming === "reset" ? "Discard my data?" : "Restore demo"}
        </Button>
      )}
    </>
  );
}

export function DataControls({
  mode = "all",
}: Readonly<{ mode?: DataControlsMode }>) {
  const actions = useDataControlActions();
  const {
    hasLocalChanges,
    inflation,
    baseCurrency,
    downloadBackup,
    exportCsv,
    fileInputRef,
    error,
    notice,
    restorePreview,
    confirmingRestore,
    confirming,
    handleInflationChange,
    handleBaseCurrencyChange,
    handleBackupFile,
    handleRestore,
    handleReset,
    handleClear,
    cancelRestore,
  } = actions;
  const clearButtonLabel = clearButtonText(hasLocalChanges, confirming);
  const showData = showsMode(mode, "data");
  const showSettings = showsMode(mode, "settings");

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {storageMessage(hasLocalChanges)}
        </p>
        <div className="flex flex-wrap items-center gap-1">
          {showSettings && (
            <HouseholdSettings
              inflation={inflation}
              baseCurrency={baseCurrency}
              onInflationChange={handleInflationChange}
              onBaseCurrencyChange={handleBaseCurrencyChange}
            />
          )}
          {showData && (
            <PortableDataActions
              inputRef={fileInputRef}
              onDownload={downloadBackup}
              onCsv={exportCsv}
              onFile={handleBackupFile}
            />
          )}
          {showSettings && (
            <DestructiveDataActions
              hasLocalChanges={hasLocalChanges}
              confirming={confirming}
              clearLabel={clearButtonLabel}
              onClear={handleClear}
              onReset={handleReset}
            />
          )}
        </div>
      </div>
      {showData && (
        <p className="text-sm text-muted-foreground">
          Clearing browser data can remove the working copy. Keep a downloaded
          backup somewhere appropriate.
        </p>
      )}
      {restorePreview && (
        <RestorePreview
          state={restorePreview}
          confirming={confirmingRestore}
          onRestore={handleRestore}
          onCancel={cancelRestore}
        />
      )}
      {notice && <p className="text-sm text-foreground">{notice}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
