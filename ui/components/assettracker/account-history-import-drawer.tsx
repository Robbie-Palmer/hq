"use client";

import { ClipboardPasteIcon } from "lucide-react";
import {
  type ReactNode,
  type SubmitEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  type AccountDetailView,
  type CapitalFlowKind,
  type ContributionHistoryFormat,
  formatAssetTrackerError,
  type PastedHistoryResult,
  parsePastedHistory,
  toCapitalFlowRows,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";

const EMPTY_RESULT: PastedHistoryResult = { rows: [], issues: [] };

const CAPITAL_KIND_COPY: Record<
  CapitalFlowKind,
  { label: string; description: string }
> = {
  personalSaving: {
    label: "From entered income or cash",
    description:
      "Your deposits, including employee pension contributions already represented in income. These reduce current and long-term spending.",
  },
  debtPrincipal: {
    label: "Debt principal",
    description:
      "Mortgage or loan principal. It builds equity and counts in current spending, but not long-term FI spending.",
  },
  external: {
    label: "Outside entered income",
    description:
      "Employer pension contributions, gifts, or inheritance. These build capital without reducing spending from the income you entered.",
  },
};

function HistoryPreview({
  label,
  result,
  source,
  textareaId,
}: Readonly<{
  label: string;
  result: PastedHistoryResult;
  source: string;
  textareaId: string;
}>) {
  function selectLine(line: number) {
    const textarea = document.getElementById(textareaId);
    if (!(textarea instanceof HTMLTextAreaElement)) return;

    let start = 0;
    for (let currentLine = 1; currentLine < line; currentLine++) {
      const newline = source.indexOf("\n", start);
      if (newline === -1) return;
      start = newline + 1;
    }
    let end = source.indexOf("\n", start);
    if (end === -1) end = source.length;
    if (source[end - 1] === "\r") end--;

    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(start, end);
    const parsedLineHeight = Number.parseFloat(
      window.getComputedStyle(textarea).lineHeight,
    );
    const lineHeight = Number.isFinite(parsedLineHeight)
      ? parsedLineHeight
      : 20;
    const scrollTop = Math.max(0, (line - 2) * lineHeight);
    textarea.scrollTop = scrollTop;
    textarea.scrollLeft = 0;
    const lineNumbers = document.getElementById(`${textareaId}-line-numbers`);
    if (lineNumbers) lineNumbers.scrollTop = scrollTop;
  }

  if (result.issues.length > 0) {
    return (
      <div className="space-y-2 text-xs">
        <p className="text-destructive">
          {result.issues.length} {label.toLowerCase()}{" "}
          {result.issues.length === 1 ? "row needs" : "rows need"} attention.
          Select one to jump to it.
        </p>
        <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-destructive/30 p-1">
          {result.issues.map((issue) => (
            <li key={`${issue.line}-${issue.message}`}>
              <button
                type="button"
                className="w-full rounded-sm px-2 py-1.5 text-left hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => selectLine(issue.line)}
              >
                <span className="font-medium text-destructive">
                  Line {issue.line}: {issue.message}
                </span>
                {issue.source != null && (
                  <code className="mt-0.5 block whitespace-pre-wrap break-all text-muted-foreground">
                    {issue.source}
                  </code>
                )}
              </button>
            </li>
          ))}
        </ul>
        {result.rows.length > 0 && (
          <p className="text-muted-foreground">
            {result.rows.length} other{" "}
            {result.rows.length === 1 ? "row is" : "rows are"} valid.
          </p>
        )}
      </div>
    );
  }
  if (result.rows.length === 0) return null;
  const first = result.rows[0];
  const last = result.rows.at(-1);
  const rowLabel = result.rows.length === 1 ? "row" : "rows";
  return (
    <p className="text-xs text-muted-foreground">
      {result.rows.length} {label.toLowerCase()} {rowLabel} ready
      {first && last ? ` · ${first.date} to ${last.date}` : ""}
    </p>
  );
}

function HistoryTextarea({
  id,
  label,
  description,
  placeholder,
  value,
  onChange,
}: Readonly<{
  id: string;
  label: string;
  description: string;
  placeholder: string;
  value: string;
  onChange(value: string): void;
}>) {
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const lineCount = value.split(/\r?\n/).length;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <p className="text-xs text-muted-foreground">{description}</p>
      <div className="flex h-52 w-full items-stretch overflow-hidden rounded-md border bg-transparent shadow-xs focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]">
        <div
          id={`${id}-line-numbers`}
          ref={lineNumbersRef}
          aria-hidden="true"
          className="w-12 shrink-0 overflow-hidden border-r bg-muted/40 px-2 py-2 text-right font-mono text-sm leading-5 text-muted-foreground select-none"
        >
          <div className="whitespace-pre">
            {Array.from({ length: lineCount }, (_, index) => index + 1).join(
              "\n",
            )}
          </div>
        </div>
        <textarea
          id={id}
          rows={10}
          wrap="off"
          spellCheck={false}
          className="h-full min-h-0 min-w-0 flex-1 resize-none overflow-auto bg-transparent px-3 py-2 font-mono text-sm leading-5 outline-none"
          placeholder={placeholder}
          value={value}
          onScroll={(event) => {
            if (lineNumbersRef.current) {
              lineNumbersRef.current.scrollTop = event.currentTarget.scrollTop;
            }
          }}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </div>
  );
}

interface AccountHistoryImportDrawerProps {
  /** Locks the importer to one account when opened from account details. */
  account?: AccountDetailView;
  trigger?: ReactNode;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
export function AccountHistoryImportDrawer({
  account: fixedAccount,
  trigger,
}: Readonly<AccountHistoryImportDrawerProps>) {
  const { accountDetails, importAccountHistory } = useAssetTracker();
  const availableAccounts = fixedAccount
    ? [fixedAccount]
    : (accountDetails ?? []);
  const [open, setOpen] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState(
    fixedAccount?.id ?? availableAccounts[0]?.id ?? "",
  );
  const [balances, setBalances] = useState("");
  const [capitalFlows, setCapitalFlows] = useState("");
  const [contributionFormat, setContributionFormat] =
    useState<ContributionHistoryFormat>("cumulative");
  const [capitalKind, setCapitalKind] =
    useState<CapitalFlowKind>("personalSaving");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const account =
    fixedAccount ??
    availableAccounts.find((candidate) => candidate.id === selectedAccountId);

  const availableAccountIds = availableAccounts
    .map((candidate) => candidate.id)
    .join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: availableAccountIds fingerprints membership instead of the array's identity
  useEffect(() => {
    if (fixedAccount) {
      setSelectedAccountId(fixedAccount.id);
      return;
    }
    setSelectedAccountId((current) =>
      availableAccounts.some((candidate) => candidate.id === current)
        ? current
        : (availableAccounts[0]?.id ?? ""),
    );
  }, [fixedAccount, availableAccountIds]);

  const balanceResult = useMemo(
    () =>
      balances.trim() === "" ? EMPTY_RESULT : parsePastedHistory(balances),
    [balances],
  );
  const capitalResult = useMemo(
    () =>
      capitalFlows.trim() === ""
        ? EMPTY_RESULT
        : parsePastedHistory(capitalFlows),
    [capitalFlows],
  );
  const hasIssues =
    balanceResult.issues.length > 0 || capitalResult.issues.length > 0;
  const capitalFlowRows = useMemo(
    () => toCapitalFlowRows(capitalResult.rows, contributionFormat),
    [capitalResult.rows, contributionFormat],
  );
  const rowCount = balanceResult.rows.length + capitalFlowRows.length;
  const accountKey = account?.id ?? "unselected";
  const balanceTextareaId = `balance-history-${accountKey}`;
  const capitalTextareaId = `capital-history-${accountKey}`;

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account) {
      setError("Choose an account");
      return;
    }
    if (hasIssues) {
      setError("Fix the highlighted rows before importing");
      return;
    }
    if (rowCount === 0) {
      setError("Paste at least one balance or deposit/withdrawal");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await importAccountHistory({
        accountId: account.id,
        balances: balanceResult.rows,
        capitalFlows: capitalFlowRows,
        capitalFlowKind: capitalKind,
        replaceCapitalFlows: contributionFormat === "cumulative",
      });
      setBalances("");
      setCapitalFlows("");
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
        {trigger ?? (
          <Button
            variant="outline"
            size={fixedAccount ? "sm" : "default"}
            disabled={availableAccounts.length === 0}
          >
            <ClipboardPasteIcon />
            {fixedAccount ? "Paste history" : "Import history"}
          </Button>
        )}
      </DrawerTrigger>
      <DrawerContent className="h-[92dvh] max-h-[92dvh] overflow-hidden">
        <DrawerHeader className="mx-auto w-full max-w-4xl shrink-0">
          <DrawerTitle>
            {fixedAccount
              ? `Paste history for ${fixedAccount.name}`
              : "Import account history"}
          </DrawerTitle>
          <DrawerDescription>
            Add market values and contributed capital as separate histories.
            Copy two columns from a spreadsheet. Headers are optional, and
            comma- or tab-separated values both work.
          </DrawerDescription>
        </DrawerHeader>
        <form
          aria-label={`Import history for ${account?.name ?? "an account"}`}
          onSubmit={handleSubmit}
          className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col overflow-hidden"
        >
          <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto overscroll-contain p-4 md:grid-cols-2">
            {!fixedAccount && (
              <div className="flex flex-col gap-1.5 md:col-span-2">
                <label
                  htmlFor="history-import-account"
                  className="text-sm font-medium"
                >
                  Account
                </label>
                <select
                  id="history-import-account"
                  value={selectedAccountId}
                  onChange={(event) => setSelectedAccountId(event.target.value)}
                  className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
                  required
                >
                  {availableAccounts.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name} · {candidate.provider}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex min-w-0 flex-col gap-2">
              <HistoryTextarea
                id={balanceTextareaId}
                label="Market value history"
                description="What the account or property was worth on each date."
                placeholder={
                  "date,market value\n2024-01-31,12500\n2024-02-29,13120"
                }
                value={balances}
                onChange={setBalances}
              />
              <HistoryPreview
                label="Balance"
                result={balanceResult}
                source={balances}
                textareaId={balanceTextareaId}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor={`capital-kind-${accountKey}`}
                  className="text-sm font-medium"
                >
                  How this capital was funded
                </label>
                <select
                  id={`capital-kind-${accountKey}`}
                  value={capitalKind}
                  onChange={(event) =>
                    setCapitalKind(event.target.value as CapitalFlowKind)
                  }
                  className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
                >
                  {Object.entries(CAPITAL_KIND_COPY).map(([value, copy]) => (
                    <option key={value} value={value}>
                      {copy.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  {CAPITAL_KIND_COPY[capitalKind].description}
                </p>
                <p className="text-xs text-muted-foreground">
                  If an account has more than one source, import each source
                  separately. They can share the same dates.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor={`contribution-format-${accountKey}`}
                  className="text-sm font-medium"
                >
                  Contribution history format
                </label>
                <select
                  id={`contribution-format-${accountKey}`}
                  value={contributionFormat}
                  onChange={(event) =>
                    setContributionFormat(
                      event.target.value as ContributionHistoryFormat,
                    )
                  }
                  className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
                >
                  <option value="cumulative">Total contributed to date</option>
                  <option value="changes">Deposit / withdrawal per row</option>
                </select>
              </div>
              <HistoryTextarea
                id={capitalTextareaId}
                label="Contributed capital history"
                description={
                  contributionFormat === "cumulative"
                    ? `The cumulative amount by each date, net of withdrawals. This replaces ${CAPITAL_KIND_COPY[capitalKind].label.toLowerCase()} history for this account.`
                    : "The amount deposited (positive) or withdrawn (negative) on each row."
                }
                placeholder={
                  contributionFormat === "cumulative"
                    ? "date,value\n2024-01-31,10000\n2024-02-29,10500\n2024-03-31,10300"
                    : "date,value\n2024-01-31,500\n2024-02-29,-200"
                }
                value={capitalFlows}
                onChange={setCapitalFlows}
              />
              <HistoryPreview
                label={contributionFormat === "cumulative" ? "Total" : "Flow"}
                result={capitalResult}
                source={capitalFlows}
                textareaId={capitalTextareaId}
              />
              {contributionFormat === "cumulative" &&
                capitalResult.issues.length === 0 &&
                capitalResult.rows.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Creates {capitalFlowRows.length} deposit/withdrawal{" "}
                    {capitalFlowRows.length === 1 ? "record" : "records"}.
                    Unchanged totals create none.
                  </p>
                )}
            </div>
          </div>
          <div
            data-slot="history-import-actions"
            className="flex shrink-0 flex-col gap-2 border-t bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
          >
            {error && <p className="text-sm text-destructive">{error}</p>}
            <p className="text-xs text-muted-foreground">
              Nothing is saved unless every pasted row is valid.
            </p>
            <div className="flex gap-2">
              <Button
                type="submit"
                className="flex-1 sm:flex-none"
                disabled={submitting || hasIssues || rowCount === 0}
              >
                Import {rowCount > 0 ? `${rowCount} rows` : "history"}
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
