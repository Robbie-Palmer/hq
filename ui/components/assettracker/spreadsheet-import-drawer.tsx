"use client";

import { FileSpreadsheetIcon } from "lucide-react";
import { type ChangeEvent, type SubmitEvent, useMemo, useState } from "react";
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
import { Input } from "@/components/ui/input";
import {
  type CapitalFlowKind,
  type ContributionHistoryFormat,
  equalSharedOwnership,
  formatAssetTrackerError,
  type HouseholdMember,
  type Ownership,
  ownershipLabel,
  type PastedHistoryResult,
  parsePastedHistory,
  personalOwnership,
  toCapitalFlowRows,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";

type SpreadsheetImportKind = "balances" | "capitalFlows" | "income";

const EMPTY_RESULT: PastedHistoryResult = { rows: [], issues: [] };
const MAX_SPREADSHEET_FILE_BYTES = 1_000_000;
const FILE_NAME_PATTERN = /\.(csv|tsv)$/i;

function ownerSelectionFor(
  ownership: Ownership | undefined,
  fallbackMemberId: string,
): string {
  if (ownership?.kind === "shared") return "shared";
  return `member:${ownership?.memberId ?? fallbackMemberId}`;
}

function ownershipForSelection(
  selection: string,
  members: readonly HouseholdMember[],
): Ownership {
  return selection === "shared"
    ? equalSharedOwnership(members)
    : personalOwnership(selection.slice(7));
}

function SpreadsheetReview({
  result,
}: Readonly<{ result: PastedHistoryResult }>) {
  if (result.issues.length > 0) {
    return (
      <div className="space-y-2" aria-live="polite">
        <p className="text-sm font-medium text-destructive">
          {`Fix ${result.issues.length} invalid ${result.issues.length === 1 ? "row" : "rows"} in the spreadsheet, then choose the corrected file.`}
        </p>
        <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-destructive/30 p-2 text-xs">
          {result.issues.map((issue) => (
            <li key={`${issue.line}-${issue.message}`}>
              <span className="font-medium text-destructive">
                Line {issue.line}: {issue.message}
              </span>
              {issue.source != null && (
                <code className="mt-0.5 block whitespace-pre-wrap break-all text-muted-foreground">
                  {issue.source}
                </code>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (result.rows.length === 0) return null;

  const previewRows = result.rows.slice(0, 5);
  return (
    <div className="space-y-2" aria-live="polite">
      <p className="text-sm font-medium">
        Review {result.rows.length} {result.rows.length === 1 ? "row" : "rows"}
      </p>
      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Date
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row) => (
              <tr key={row.date} className="border-t">
                <td className="px-3 py-2 font-mono text-xs">{row.date}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.value.toLocaleString("en-GB")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.rows.length > previewRows.length && (
        <p className="text-xs text-muted-foreground">
          Showing the first {previewRows.length} rows. All {result.rows.length}
          rows will be imported.
        </p>
      )}
    </div>
  );
}

export function SpreadsheetImportDrawer() {
  const {
    household,
    householdAccounts,
    importAccountHistory,
    importIncomeHistory,
  } = useAssetTracker();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<SpreadsheetImportKind>("balances");
  const [accountId, setAccountId] = useState(householdAccounts[0]?.id ?? "");
  const initialOwnership = householdAccounts[0]?.ownership;
  const [ownerSelection, setOwnerSelection] = useState(
    ownerSelectionFor(initialOwnership, household.members[0]?.id ?? ""),
  );
  const [contributionFormat, setContributionFormat] =
    useState<ContributionHistoryFormat>("cumulative");
  const [capitalKind, setCapitalKind] =
    useState<CapitalFlowKind>("personalSaving");
  const [fileName, setFileName] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const result = useMemo(
    () => (source === "" ? EMPTY_RESULT : parsePastedHistory(source)),
    [source],
  );
  const needsAccount = kind !== "income";
  const selectedOwnership = ownershipForSelection(
    ownerSelection,
    household.members,
  );
  const canImport =
    result.rows.length > 0 &&
    result.issues.length === 0 &&
    (!needsAccount || accountId !== "");

  function clearFile() {
    setFileName(null);
    setSource("");
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError(null);
    clearFile();
    if (!FILE_NAME_PATTERN.test(file.name)) {
      setError("Choose a CSV or TSV file exported from your spreadsheet.");
      return;
    }
    if (file.size > MAX_SPREADSHEET_FILE_BYTES) {
      setError("Choose a file smaller than 1 MB.");
      return;
    }

    try {
      const contents = await file.text();
      setFileName(file.name);
      setSource(contents);
    } catch {
      setError("Asset Tracker could not read that file.");
    }
  }

  async function importRows() {
    if (kind === "income") {
      await importIncomeHistory({
        income: result.rows.map(({ date, value }) => ({ date, amount: value })),
        ownership: selectedOwnership,
      });
      return;
    }

    if (accountId === "") throw new Error("Choose an account");
    if (kind === "balances") {
      await importAccountHistory({
        accountId,
        balances: result.rows,
        capitalFlows: [],
        capitalFlowKind: "personalSaving",
        replaceCapitalFlows: false,
        ownership: selectedOwnership,
      });
      return;
    }

    await importAccountHistory({
      accountId,
      balances: [],
      capitalFlows: toCapitalFlowRows(result.rows, contributionFormat),
      capitalFlowKind: capitalKind,
      replaceCapitalFlows: contributionFormat === "cumulative",
      ownership: selectedOwnership,
    });
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canImport) return;

    setSubmitting(true);
    setError(null);
    try {
      await importRows();
      clearFile();
      setOpen(false);
    } catch (err) {
      setError(formatAssetTrackerError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button variant="outline">
          <FileSpreadsheetIcon />
          Import spreadsheet
        </Button>
      </DrawerTrigger>
      <DrawerContent className="h-[92dvh] max-h-[92dvh] overflow-hidden">
        <DrawerHeader className="mx-auto w-full max-w-2xl shrink-0">
          <DrawerTitle>Import spreadsheet history</DrawerTitle>
          <DrawerDescription>
            Choose a two-column CSV or TSV file with a date and value on each
            row. A header is optional.
          </DrawerDescription>
        </DrawerHeader>
        <form
          aria-label="Import spreadsheet history"
          onSubmit={handleSubmit}
          className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col overflow-hidden"
        >
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-4">
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="text-sm font-medium">Your file stays private</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Asset Tracker reads it in this browser. It is not uploaded or
                sent to a server.
              </p>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="spreadsheet-import-file"
                className="text-sm font-medium"
              >
                CSV or TSV file
              </label>
              <Input
                id="spreadsheet-import-file"
                type="file"
                accept=".csv,.tsv,text/csv,text/tab-separated-values"
                onChange={handleFileChange}
              />
              {fileName && (
                <p className="text-xs text-muted-foreground">
                  Reviewing {fileName}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="spreadsheet-import-owner"
                className="text-sm font-medium"
              >
                Owned by
              </label>
              <select
                id="spreadsheet-import-owner"
                value={ownerSelection}
                onChange={(event) => setOwnerSelection(event.target.value)}
                className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
              >
                {household.members.map((member) => (
                  <option key={member.id} value={`member:${member.id}`}>
                    {member.displayName}
                  </option>
                ))}
                {household.members.length > 1 && (
                  <option value="shared">Shared equally</option>
                )}
              </select>
              <p className="text-xs text-muted-foreground">
                The review and imported rows will use{" "}
                {ownershipLabel(selectedOwnership, household.members)}.
              </p>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="spreadsheet-import-kind"
                className="text-sm font-medium"
              >
                Import as
              </label>
              <select
                id="spreadsheet-import-kind"
                value={kind}
                onChange={(event) =>
                  setKind(event.target.value as SpreadsheetImportKind)
                }
                className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
              >
                <option value="balances">Account market values</option>
                <option value="capitalFlows">
                  Account contributed capital
                </option>
                <option value="income">Household income</option>
              </select>
            </div>

            {needsAccount && (
              <div className="space-y-1.5">
                <label
                  htmlFor="spreadsheet-import-account"
                  className="text-sm font-medium"
                >
                  Account
                </label>
                <select
                  id="spreadsheet-import-account"
                  value={accountId}
                  onChange={(event) => {
                    const nextAccountId = event.target.value;
                    setAccountId(nextAccountId);
                    const account = householdAccounts.find(
                      ({ id }) => id === nextAccountId,
                    );
                    setOwnerSelection(
                      ownerSelectionFor(
                        account?.ownership,
                        household.members[0]?.id ?? "",
                      ),
                    );
                  }}
                  className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
                  required
                >
                  {householdAccounts.length === 0 && (
                    <option value="">Create an account before importing</option>
                  )}
                  {householdAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} · {account.provider}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {kind === "capitalFlows" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label
                    htmlFor="spreadsheet-contribution-format"
                    className="text-sm font-medium"
                  >
                    Spreadsheet values
                  </label>
                  <select
                    id="spreadsheet-contribution-format"
                    value={contributionFormat}
                    onChange={(event) =>
                      setContributionFormat(
                        event.target.value as ContributionHistoryFormat,
                      )
                    }
                    className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
                  >
                    <option value="cumulative">
                      Total contributed to date
                    </option>
                    <option value="changes">
                      Deposit or withdrawal per row
                    </option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label
                    htmlFor="spreadsheet-capital-kind"
                    className="text-sm font-medium"
                  >
                    Capital source
                  </label>
                  <select
                    id="spreadsheet-capital-kind"
                    value={capitalKind}
                    onChange={(event) =>
                      setCapitalKind(event.target.value as CapitalFlowKind)
                    }
                    className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
                  >
                    <option value="personalSaving">
                      Entered income or cash
                    </option>
                    <option value="debtPrincipal">Debt principal</option>
                    <option value="external">Outside entered income</option>
                  </select>
                </div>
              </div>
            )}

            <SpreadsheetReview result={result} />
          </div>

          <div className="shrink-0 space-y-2 border-t bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {error && <p className="text-sm text-destructive">{error}</p>}
            <p className="text-xs text-muted-foreground">
              Nothing changes until you confirm this review.
              {kind === "income" && result.rows.length > 0
                ? " Confirming replaces the current household income history."
                : ""}
            </p>
            <div className="flex gap-2">
              <Button type="submit" disabled={submitting || !canImport}>
                Import{" "}
                {result.rows.length > 0
                  ? `${result.rows.length} rows`
                  : "reviewed rows"}
              </Button>
              <DrawerClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DrawerClose>
            </div>
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
