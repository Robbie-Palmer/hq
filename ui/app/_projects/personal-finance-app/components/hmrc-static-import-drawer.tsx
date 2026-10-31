"use client";

import { FileJsonIcon } from "lucide-react";
import { type ChangeEvent, type SubmitEvent, useMemo, useState } from "react";
import {
  formatAssetTrackerError,
  type HmrcImportFile,
  type HmrcImportFileKind,
  readHmrcImportFile,
  reconcileHmrcDraftRow,
  reviewHmrcImport,
} from "@/app/_projects/personal-finance-app/domain";
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
import { useAssetTracker } from "./asset-tracker-provider";

const ABSENT_HMRC_FIELDS = [
  "employer identity",
  "employment dates",
  "pay frequency",
  "gross-before-pension pay",
  "salary sacrifice",
  "pension contributions",
  "National Insurance",
  "tax code",
  "take-home pay",
  "correction identity",
] as const;

const REVIEW_COLUMNS = [
  "PAYE reference",
  "Observed taxable pay",
  "Observed Income Tax",
  "Manual label",
  "Reconciliation",
] as const;

function currentTaxYear(): string {
  const today = new Date();
  const year = today.getUTCFullYear();
  const startsThisYear =
    today.getUTCMonth() > 3 ||
    (today.getUTCMonth() === 3 && today.getUTCDate() >= 6);
  const start = startsThisYear ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

function taxYearOptions(): string[] {
  const start = Number(currentTaxYear().slice(0, 4));
  return Array.from({ length: 12 }, (_, index) => {
    const year = start - index;
    return `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
  });
}

function formatMoney(value: number | undefined): string {
  return value == null
    ? "Not in this response"
    : new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: "GBP",
      }).format(value);
}

function reconciliationText(
  status: ReturnType<typeof reconcileHmrcDraftRow>,
): string {
  const parts = [
    status.status === "new"
      ? "New HMRC observation"
      : status.status === "unchanged"
        ? "Already accepted"
        : "Revised HMRC value; acceptance will link a correction",
  ];
  if (status.comparedWith.length > 0) {
    parts.push(`Compared with ${status.comparedWith.join(", ")}`);
    if (status.taxablePay === "differs" || status.incomeTax === "differs") {
      parts.push("values differ");
    } else if (
      status.taxablePay === "agrees" ||
      status.incomeTax === "agrees"
    ) {
      parts.push("recorded values agree");
    }
  }
  return parts.join(". ");
}

function useHmrcStaticImport() {
  const {
    acceptHmrcImport,
    hmrcEmploymentObservations,
    household,
    salaryHistory,
  } = useAssetTracker();
  const [open, setOpen] = useState(false);
  const [memberId, setMemberId] = useState(
    household.members[0]?.id ?? "primary",
  );
  const [taxYear, setTaxYear] = useState(currentTaxYear);
  const [income, setIncome] = useState<HmrcImportFile>();
  const [tax, setTax] = useState<HmrcImportFile>();
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const review = useMemo(
    () => reviewHmrcImport({ memberId, taxYear, income, tax }),
    [income, memberId, tax, taxYear],
  );

  async function chooseFile(
    event: ChangeEvent<HTMLInputElement>,
    kind: HmrcImportFileKind,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    try {
      const parsed = await readHmrcImportFile(file, kind);
      if (kind === "income") setIncome(parsed);
      else setTax(parsed);
    } catch (cause) {
      setError(formatAssetTrackerError(cause));
    }
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (review.rows.length === 0 || review.diagnostics.length > 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await acceptHmrcImport({ rows: review.rows, labels });
      setIncome(undefined);
      setTax(undefined);
      setLabels({});
      setOpen(false);
    } catch (cause) {
      setError(formatAssetTrackerError(cause));
    } finally {
      setSubmitting(false);
    }
  }

  function setLabel(payeReference: string, label: string) {
    setLabels((current) => ({ ...current, [payeReference]: label }));
  }

  return {
    error,
    handleSubmit,
    hmrcEmploymentObservations,
    household,
    income,
    labels,
    memberId,
    open,
    review,
    salaryHistory,
    setLabel,
    setMemberId,
    setOpen,
    setTaxYear,
    submitting,
    tax,
    taxYear,
    chooseFile,
  };
}

type ImportState = ReturnType<typeof useHmrcStaticImport>;
type DraftRow = ImportState["review"]["rows"][number];

function LocalFileNotice() {
  return (
    <div className="rounded-md border bg-muted/30 p-3 text-sm">
      <p className="font-medium">Local files only</p>
      <p className="mt-1 text-muted-foreground">
        This importer does not contact HMRC, use credentials, or store a UTR.
        Choose one or both response files. A saved envelope may declare its tax
        year, API, and version; plain response bodies use the selections below.
      </p>
    </div>
  );
}

function PersonSelect({ state }: { state: ImportState }) {
  return (
    <label htmlFor="hmrc-import-person" className="space-y-1.5 text-sm">
      <span className="font-medium">Household person</span>
      <select
        id="hmrc-import-person"
        value={state.memberId}
        onChange={(event) => state.setMemberId(event.target.value)}
        className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-10 w-full rounded-md border px-3 shadow-xs outline-none focus-visible:ring-[3px]"
      >
        {state.household.members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.displayName}
          </option>
        ))}
      </select>
      <span className="block text-xs text-muted-foreground">
        HMRC response bodies do not identify the person.
      </span>
    </label>
  );
}

function TaxYearSelect({ state }: { state: ImportState }) {
  return (
    <label htmlFor="hmrc-import-tax-year" className="space-y-1.5 text-sm">
      <span className="font-medium">Tax year</span>
      <select
        id="hmrc-import-tax-year"
        value={state.taxYear}
        onChange={(event) => state.setTaxYear(event.target.value)}
        className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-10 w-full rounded-md border px-3 shadow-xs outline-none focus-visible:ring-[3px]"
      >
        {taxYearOptions().map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <span className="block text-xs text-muted-foreground">
        Plain response bodies do not include the requested tax year.
      </span>
    </label>
  );
}

function ImportFileField({
  file,
  kind,
  onChange,
}: {
  file: HmrcImportFile | undefined;
  kind: HmrcImportFileKind;
  onChange: ImportState["chooseFile"];
}) {
  const income = kind === "income";
  return (
    <label htmlFor={`hmrc-${kind}-file`} className="space-y-1.5 text-sm">
      <span className="font-medium">
        Individual {income ? "Income 1.2" : "Tax 1.1"} JSON
      </span>
      <Input
        id={`hmrc-${kind}-file`}
        type="file"
        accept=".json,application/json"
        onChange={(event) => void onChange(event, kind)}
      />
      <span className="block text-xs text-muted-foreground">
        {file == null
          ? `Optional if you only have ${income ? "tax" : "income"} data.`
          : `Reviewing ${file.fileName}`}
      </span>
    </label>
  );
}

function ImportConfiguration({ state }: { state: ImportState }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <PersonSelect state={state} />
        <TaxYearSelect state={state} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <ImportFileField
          file={state.income}
          kind="income"
          onChange={state.chooseFile}
        />
        <ImportFileField
          file={state.tax}
          kind="tax"
          onChange={state.chooseFile}
        />
      </div>
    </>
  );
}

function ImportDiagnostics({ state }: { state: ImportState }) {
  if (state.review.diagnostics.length === 0) return null;
  return (
    <section aria-live="polite" className="space-y-2">
      <h3 className="font-semibold">Import diagnostics</h3>
      <ul className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">
        {state.review.diagnostics.map((diagnostic) => (
          <li key={`${diagnostic.file}-${diagnostic.message}`}>
            {diagnostic.message}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReviewRow({ row, state }: { row: DraftRow; state: ImportState }) {
  const reconciliation = reconcileHmrcDraftRow(
    row,
    state.hmrcEmploymentObservations,
    state.salaryHistory,
  );
  return (
    <tr className="border-t align-top">
      <td className="px-3 py-3 font-mono text-xs">{row.payeReference}</td>
      <td className="px-3 py-3 tabular-nums">
        {formatMoney(row.observedTaxablePay)}
      </td>
      <td className="px-3 py-3 tabular-nums">
        {formatMoney(row.observedIncomeTax)}
      </td>
      <td className="px-3 py-3">
        <label className="sr-only" htmlFor={`hmrc-label-${row.payeReference}`}>
          Employer label for {row.payeReference}
        </label>
        <Input
          id={`hmrc-label-${row.payeReference}`}
          value={state.labels[row.payeReference] ?? ""}
          onChange={(event) =>
            state.setLabel(row.payeReference, event.target.value)
          }
          placeholder="Optional employer label"
          maxLength={120}
        />
        <span className="mt-1 block text-xs text-muted-foreground">
          Saved as a separate manual fact.
        </span>
      </td>
      <td className="max-w-72 px-3 py-3 text-xs text-muted-foreground">
        {reconciliationText(reconciliation)}
      </td>
    </tr>
  );
}

function ReviewTable({ state }: { state: ImportState }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[52rem] text-sm">
        <thead className="bg-muted/50 text-left">
          <tr>
            {REVIEW_COLUMNS.map((column) => (
              <th key={column} className="px-3 py-2">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {state.review.rows.map((row) => (
            <ReviewRow key={row.payeReference} row={row} state={state} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ImportReview({ state }: { state: ImportState }) {
  if (state.review.rows.length === 0) return null;
  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-semibold">
          Review {state.review.rows.length} employment observation
          {state.review.rows.length === 1 ? "" : "s"}
        </h3>
        <p className="text-sm text-muted-foreground">
          Rows join only on tax year and PAYE reference. payFromEmployment is
          recorded as observed taxable pay. It is not gross-before-pension
          salary.
        </p>
      </div>
      <ReviewTable state={state} />
    </section>
  );
}

function AbsentHmrcFields({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <section className="rounded-md border p-3">
      <h3 className="text-sm font-semibold">Not present in these APIs</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        The review leaves these unknown. Add any known values through their
        normal manual or document import, not as HMRC-derived facts.
      </p>
      <ul className="mt-2 grid list-disc gap-x-6 gap-y-1 pl-5 text-xs text-muted-foreground sm:grid-cols-2">
        {ABSENT_HMRC_FIELDS.map((field) => (
          <li key={field}>{field}</li>
        ))}
      </ul>
    </section>
  );
}

function EmptyImportMessage({ state }: { state: ImportState }) {
  const visible =
    (state.income != null || state.tax != null) &&
    state.review.diagnostics.length === 0 &&
    state.review.rows.length === 0;
  if (!visible) return null;
  return (
    <p className="rounded-md border p-3 text-sm text-muted-foreground">
      These responses contain no employment income or tax rows to accept.
    </p>
  );
}

function ImportContent({ state }: { state: ImportState }) {
  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
      <LocalFileNotice />
      <ImportConfiguration state={state} />
      <ImportDiagnostics state={state} />
      <EmptyImportMessage state={state} />
      <ImportReview state={state} />
      <AbsentHmrcFields visible={state.review.rows.length > 0} />
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
    </div>
  );
}

function ImportFooter({ state }: { state: ImportState }) {
  const disabled =
    state.submitting ||
    state.review.rows.length === 0 ||
    state.review.diagnostics.length > 0;
  return (
    <div className="flex shrink-0 flex-wrap gap-2 border-t p-4">
      <Button type="submit" disabled={disabled}>
        Accept {state.review.rows.length || "reviewed"} observation
        {state.review.rows.length === 1 ? "" : "s"}
      </Button>
      <DrawerClose asChild>
        <Button type="button" variant="outline">
          Cancel
        </Button>
      </DrawerClose>
    </div>
  );
}

export function HmrcStaticImportDrawer() {
  const state = useHmrcStaticImport();

  return (
    <Drawer open={state.open} onOpenChange={state.setOpen}>
      <DrawerTrigger asChild>
        <Button variant="outline">
          <FileJsonIcon />
          Import saved HMRC responses
        </Button>
      </DrawerTrigger>
      <DrawerContent className="h-[94dvh] max-h-[94dvh] overflow-hidden">
        <DrawerHeader className="mx-auto w-full max-w-5xl shrink-0">
          <DrawerTitle>Import saved HMRC income and tax</DrawerTitle>
          <DrawerDescription>
            Review Individual Income 1.2 and Individual Tax 1.1 JSON response
            bodies. Asset Tracker reads them in this browser and never uploads
            their contents.
          </DrawerDescription>
        </DrawerHeader>
        <form
          aria-label="Import saved HMRC responses"
          onSubmit={state.handleSubmit}
          className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col overflow-hidden"
        >
          <ImportContent state={state} />
          <ImportFooter state={state} />
        </form>
      </DrawerContent>
    </Drawer>
  );
}
