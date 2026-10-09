"use client";

import { DownloadIcon, FileSpreadsheetIcon } from "lucide-react";
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
  annualisedGrossPay,
  formatAssetTrackerError,
  parseSalaryImport,
  REQUIRED_SALARY_IMPORT_FIELDS,
  readSalaryImportFile,
  SALARY_HISTORY_TEMPLATE_CSV,
  SALARY_IMPORT_FIELD_LABELS,
  SALARY_IMPORT_FIELDS,
  type SalaryColumnMapping,
  type SalaryImportField,
  type SalaryImportSheet,
  suggestSalaryColumnMapping,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";

const MAX_FILE_BYTES = 5_000_000;

function downloadTemplate() {
  const url = URL.createObjectURL(
    new Blob([SALARY_HISTORY_TEMPLATE_CSV], { type: "text/csv" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "salary-history-template.csv";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function MappingSelect({
  field,
  sheet,
  mapping,
  onChange,
}: Readonly<{
  field: SalaryImportField;
  sheet: SalaryImportSheet;
  mapping: SalaryColumnMapping;
  onChange(field: SalaryImportField, column?: number): void;
}>) {
  const required = REQUIRED_SALARY_IMPORT_FIELDS.includes(field);
  return (
    <label className="space-y-1 text-sm">
      <span className="font-medium">
        {SALARY_IMPORT_FIELD_LABELS[field]}
        {required ? " *" : ""}
      </span>
      <select
        value={mapping[field] ?? ""}
        onChange={(event) =>
          onChange(
            field,
            event.target.value === "" ? undefined : Number(event.target.value),
          )
        }
        className="h-10 w-full rounded-md border bg-background px-3"
      >
        <option value="">Not mapped</option>
        {sheet.headers.map((header, index) => (
          <option key={`${header}-${index}`} value={index}>
            {header || `Column ${index + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}

function importButtonLabel(recordCount: number): string {
  if (recordCount === 0) return "salary history";
  const noun = recordCount === 1 ? "record" : "records";
  return `${recordCount} ${noun}`;
}

function formatGrossPay(grossPay: number | undefined): string {
  return grossPay?.toLocaleString("en-GB") ?? "Not provided";
}

export function SalaryHistoryImportDrawer() {
  const { importSalaryHistory } = useAssetTracker();
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<SalaryImportSheet | null>(null);
  const [mapping, setMapping] = useState<SalaryColumnMapping>({});
  const [acceptedAt, setAcceptedAt] = useState(() => new Date().toISOString());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const result = useMemo(
    () =>
      sheet == null
        ? { records: [], diagnostics: [] }
        : parseSalaryImport(sheet, mapping, acceptedAt),
    [acceptedAt, mapping, sheet],
  );
  const blocking = result.diagnostics.some(
    (diagnostic) => diagnostic.severity === "error",
  );

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file == null) return;
    setError(null);
    setSheet(null);
    if (file.size > MAX_FILE_BYTES) {
      setError("Choose a file smaller than 5 MB.");
      return;
    }
    try {
      const nextSheet = await readSalaryImportFile(file);
      setSheet(nextSheet);
      setMapping(suggestSalaryColumnMapping(nextSheet.headers));
      setAcceptedAt(new Date().toISOString());
    } catch (error_) {
      setError(formatAssetTrackerError(error_));
    }
  }

  function updateMapping(field: SalaryImportField, column?: number) {
    setMapping((current) => {
      const next = { ...current };
      if (column == null) delete next[field];
      else next[field] = column;
      return next;
    });
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (result.records.length === 0 || blocking) return;
    setSubmitting(true);
    setError(null);
    try {
      await importSalaryHistory({ records: result.records });
      setSheet(null);
      setMapping({});
      setOpen(false);
    } catch (error_) {
      setError(formatAssetTrackerError(error_));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button variant="outline" size="sm">
          <FileSpreadsheetIcon />
          Import salary file
        </Button>
      </DrawerTrigger>
      <DrawerContent className="h-[94dvh] max-h-[94dvh] overflow-hidden">
        <DrawerHeader className="mx-auto w-full max-w-4xl shrink-0">
          <DrawerTitle>Import salary history</DrawerTitle>
          <DrawerDescription>
            Map and review CSV, TSV, or Excel .xlsx rows in this browser. The
            file and salary values are never uploaded.
          </DrawerDescription>
        </DrawerHeader>
        <form
          aria-label="Import salary history"
          onSubmit={handleSubmit}
          className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col overflow-hidden"
        >
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
            <div className="flex flex-wrap items-end gap-3 rounded-md border bg-muted/30 p-3">
              <label
                htmlFor="salary-history-file"
                className="min-w-64 flex-1 space-y-1.5 text-sm"
              >
                <span className="font-medium">CSV, TSV, or Excel file</span>
                <Input
                  id="salary-history-file"
                  type="file"
                  accept=".csv,.tsv,.xlsx,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={handleFile}
                />
              </label>
              <Button type="button" variant="ghost" onClick={downloadTemplate}>
                <DownloadIcon />
                Download template
              </Button>
              {sheet && (
                <p className="w-full text-xs text-muted-foreground">
                  Reviewing {sheet.fileName}. Re-importing the same file will
                  not duplicate accepted rows.
                </p>
              )}
            </div>

            {sheet && (
              <>
                <section className="space-y-3">
                  <div>
                    <h3 className="font-semibold">Map columns</h3>
                    <p className="text-sm text-muted-foreground">
                      Gross pay means pay before tax, employee pension
                      deductions, and salary sacrifice. Do not map a bank
                      deposit or taxable-pay column as gross pay.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {REQUIRED_SALARY_IMPORT_FIELDS.map((field) => (
                      <MappingSelect
                        key={field}
                        field={field}
                        sheet={sheet}
                        mapping={mapping}
                        onChange={updateMapping}
                      />
                    ))}
                  </div>
                  <details className="rounded-md border p-3">
                    <summary className="cursor-pointer text-sm font-medium">
                      Map optional salary and pension fields
                    </summary>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {SALARY_IMPORT_FIELDS.filter(
                        (field) =>
                          !REQUIRED_SALARY_IMPORT_FIELDS.includes(field),
                      ).map((field) => (
                        <MappingSelect
                          key={field}
                          field={field}
                          sheet={sheet}
                          mapping={mapping}
                          onChange={updateMapping}
                        />
                      ))}
                    </div>
                  </details>
                </section>

                {result.diagnostics.length > 0 && (
                  <section aria-live="polite" className="space-y-2">
                    <h3 className="font-semibold">Import diagnostics</h3>
                    <ul className="max-h-44 space-y-1 overflow-y-auto rounded-md border p-3 text-sm">
                      {result.diagnostics.map((diagnostic, index) => (
                        <li
                          key={`${diagnostic.row ?? 0}-${diagnostic.message}-${index}`}
                          className={
                            diagnostic.severity === "error"
                              ? "text-destructive"
                              : "text-amber-700 dark:text-amber-300"
                          }
                        >
                          {diagnostic.row == null
                            ? "File"
                            : `Row ${diagnostic.row}`}
                          : {diagnostic.message}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {result.records.length > 0 && (
                  <section className="space-y-2">
                    <h3 className="font-semibold">
                      Review {result.records.length}{" "}
                      {result.records.length === 1 ? "record" : "records"}
                    </h3>
                    <div className="overflow-x-auto rounded-md border">
                      <table className="w-full min-w-[48rem] text-sm">
                        <thead className="bg-muted/50 text-left">
                          <tr>
                            <th className="px-3 py-2">Person and employer</th>
                            <th className="px-3 py-2">Dates</th>
                            <th className="px-3 py-2">Recorded gross</th>
                            <th className="px-3 py-2">Annualised gross</th>
                            <th className="px-3 py-2">Pension</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.records.slice(0, 10).map((record) => {
                            const annualised = annualisedGrossPay(record);
                            return (
                              <tr key={record.id} className="border-t">
                                <td className="px-3 py-2">
                                  <span className="block font-medium">
                                    {record.person}
                                  </span>
                                  <span className="text-muted-foreground">
                                    {record.employer}
                                  </span>
                                </td>
                                <td className="px-3 py-2 font-mono text-xs">
                                  {record.effectiveStart} to{" "}
                                  {record.effectiveEnd ?? "open"}
                                </td>
                                <td className="px-3 py-2 tabular-nums">
                                  {record.currency}{" "}
                                  {formatGrossPay(record.grossPay)}
                                </td>
                                <td className="px-3 py-2 tabular-nums">
                                  {annualised == null
                                    ? "Not available"
                                    : `${record.currency} ${annualised.toLocaleString("en-GB")}`}
                                </td>
                                <td className="px-3 py-2 text-muted-foreground">
                                  {record.employeePension == null &&
                                  record.employerPension == null
                                    ? "Unknown"
                                    : "Recorded"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {result.records.length > 10 && (
                      <p className="text-xs text-muted-foreground">
                        Showing 10 rows. All {result.records.length} rows will
                        be imported.
                      </p>
                    )}
                  </section>
                )}
              </>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 border-t p-4">
            <Button
              type="submit"
              disabled={submitting || blocking || result.records.length === 0}
            >
              Import {importButtonLabel(result.records.length)}
            </Button>
            <DrawerClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DrawerClose>
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
