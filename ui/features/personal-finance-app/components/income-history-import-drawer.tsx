"use client";

import { ClipboardPasteIcon, Trash2Icon } from "lucide-react";
import { type SubmitEvent, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  formatAssetTrackerError,
  parsePastedHistory,
} from "@/features/personal-finance-app/domain";
import { useAssetTracker } from "./asset-tracker-provider";

function parseIncomeSource(source: string) {
  return source.trim() === ""
    ? { rows: [], issues: [] }
    : parsePastedHistory(source);
}

export function IncomeHistoryImportDrawer() {
  const { incomeHistory, importIncomeHistory, clearIncomeHistory } =
    useAssetTracker();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const result = useMemo(() => parseIncomeSource(source), [source]);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitted = parseIncomeSource(source);
    if (submitted.issues.length > 0) {
      setError("Fix the invalid rows before importing");
      return;
    }
    if (submitted.rows.length === 0) {
      setError("Paste at least one income row");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await importIncomeHistory({
        income: submitted.rows.map(({ date, value }) => ({
          date,
          amount: value,
        })),
      });
      setSource("");
      setOpen(false);
    } catch (err) {
      setError(formatAssetTrackerError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleClear() {
    try {
      await clearIncomeHistory();
      setError(null);
      setOpen(false);
    } catch (err) {
      setError(formatAssetTrackerError(err));
    }
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button variant="outline" size="sm">
          <ClipboardPasteIcon />
          {incomeHistory.length > 0
            ? "Replace income history"
            : "Add income history"}
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="mx-auto w-full max-w-2xl">
          <DrawerTitle>Portfolio income history</DrawerTitle>
          <DrawerDescription>
            Paste income received in each period. Use the period-end date and
            the total income across the household.
            {incomeHistory.length > 0 &&
              " Importing will replace all existing income history."}
          </DrawerDescription>
        </DrawerHeader>
        <form
          aria-label="Import portfolio income history"
          onSubmit={handleSubmit}
          className="mx-auto flex w-full max-w-2xl flex-col gap-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <label
            htmlFor="portfolio-income-history"
            className="text-sm font-medium"
          >
            Period end and income
          </label>
          <textarea
            id="portfolio-income-history"
            rows={10}
            wrap="off"
            spellCheck={false}
            className="min-h-52 w-full resize-y rounded-md border bg-transparent px-3 py-2 font-mono text-sm leading-5 shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            placeholder={"date,income\n2025-01-31,4500\n2025-02-28,4500"}
            value={source}
            onChange={(event) => setSource(event.target.value)}
          />
          {result.issues.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-destructive/30 p-2 text-xs text-destructive">
              {result.issues.map((issue) => (
                <li key={`${issue.line}-${issue.message}`}>
                  Line {issue.line}: {issue.message}
                </li>
              ))}
            </ul>
          )}
          {result.issues.length === 0 && result.rows.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {result.rows.length}{" "}
              {result.rows.length === 1 ? "period" : "periods"} ready.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            For a meaningful reconciliation, use the same period ends as your
            complete account balance history. Internal account transfers must be
            recorded as equal withdrawals and deposits so they cancel out.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              disabled={
                submitting ||
                result.issues.length > 0 ||
                result.rows.length === 0
              }
            >
              Import{" "}
              {result.rows.length > 0
                ? `${result.rows.length} periods`
                : "history"}
            </Button>
            <DrawerClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DrawerClose>
            {incomeHistory.length > 0 && (
              <Button type="button" variant="ghost" onClick={handleClear}>
                <Trash2Icon />
                Clear income history
              </Button>
            )}
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
