"use client";

import { Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  annualisedGrossPay,
  formatAssetTrackerError,
  type PensionContribution,
  type SalaryHistoryRecord,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";
import { SalaryHistoryImportDrawer } from "./salary-history-import-drawer";
import { SalaryRecordDrawer } from "./salary-record-drawer";

function SalaryRecordActions({
  record,
}: Readonly<{ record: SalaryHistoryRecord }>) {
  const { deleteSalaryRecord } = useAssetTracker();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    try {
      await deleteSalaryRecord({ id: record.id });
    } catch (caught) {
      setError(formatAssetTrackerError(caught));
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-end gap-1">
        <SalaryRecordDrawer record={record} />
        {confirming ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={deleting}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              aria-label={`Confirm deletion of salary record for ${record.employer} from ${record.effectiveStart}`}
              disabled={deleting}
              onClick={handleDelete}
            >
              Delete
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete salary record for ${record.employer} from ${record.effectiveStart}`}
            onClick={() => setConfirming(true)}
          >
            <Trash2Icon />
          </Button>
        )}
      </div>
      {error != null && (
        <p
          className="max-w-48 text-right text-xs text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}

function formatMoney(record: SalaryHistoryRecord, amount: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: record.currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function pensionLabel(contribution: PensionContribution | undefined): string {
  if (contribution == null) return "Unknown";
  if (contribution.rate != null) {
    return `${(contribution.rate * 100).toLocaleString("en-GB")}%`;
  }
  if (contribution.amount != null) {
    return contribution.amount.toLocaleString("en-GB");
  }
  return "Details unknown";
}

function sourceLabel(record: SalaryHistoryRecord): string {
  if (record.source.kind === "manual") return "Manual entry";
  return `${record.source.fileName}, row ${record.source.row}`;
}

function moneyOrUnknown(
  record: SalaryHistoryRecord,
  amount: number | undefined,
): string {
  return amount == null ? "Unknown" : formatMoney(record, amount);
}

function EmploymentCell({ record }: Readonly<{ record: SalaryHistoryRecord }>) {
  return (
    <td className="px-3 py-3">
      <span className="block font-medium">{record.person}</span>
      <span className="block text-muted-foreground">{record.employer}</span>
    </td>
  );
}

function grossPayDescription(record: SalaryHistoryRecord): string {
  let description = `Actual ${record.payFrequency} gross pay`;
  if (record.grossPay == null) {
    description = "Take-home after tax and pension";
  } else if (record.amountKind === "annualSalary") {
    description = "Annual gross salary rate";
  } else if (record.payFrequency === "irregular") {
    description = "One-off gross bonus";
  }
  return description;
}

function GrossPayCell({ record }: Readonly<{ record: SalaryHistoryRecord }>) {
  const annualised = annualisedGrossPay(record);
  const description = grossPayDescription(record);
  return (
    <td className="px-3 py-3 tabular-nums">
      <span className="block font-medium">
        {record.grossPay == null
          ? moneyOrUnknown(record, record.takeHomePay)
          : formatMoney(record, record.grossPay)}
      </span>
      <span className="block text-xs text-muted-foreground">{description}</span>
      {record.workFraction != null && (
        <span className="block text-xs text-muted-foreground">
          {(record.workFraction * 100).toLocaleString("en-GB")}% of full-time
        </span>
      )}
      {record.amountKind === "periodPay" && annualised != null && (
        <span className="block text-xs text-muted-foreground">
          {formatMoney(record, annualised)} annualised
        </span>
      )}
    </td>
  );
}

function PayDetailCell({ record }: Readonly<{ record: SalaryHistoryRecord }>) {
  const rows = [
    ["Base", record.baseSalary],
    ["Variable", record.variablePay],
    ["Taxable", record.taxablePay],
    ["Take-home", record.takeHomePay],
    ["Income Tax", record.observedIncomeTax],
    ["Employee NI", record.observedEmployeeNationalInsurance],
    ["Other income", record.otherTaxableIncome],
  ] as const;
  return (
    <td className="px-3 py-3 text-xs">
      {rows.map(([label, amount]) => (
        <span key={label} className="block">
          {label}: {moneyOrUnknown(record, amount)}
        </span>
      ))}
      <span className="block">
        Tax code {record.taxCode ?? "unknown"}, NI category{" "}
        {record.nationalInsuranceCategory ?? "unknown"}
      </span>
    </td>
  );
}

function DesktopSalaryRow({
  record,
  allowCorrection,
}: Readonly<{
  record: SalaryHistoryRecord;
  allowCorrection: boolean;
}>) {
  return (
    <tr className="border-t align-top">
      <EmploymentCell record={record} />
      <td className="px-3 py-3 font-mono text-xs">
        {record.effectiveStart}
        <span className="block text-muted-foreground">
          to {record.effectiveEnd ?? "present"}
        </span>
      </td>
      <GrossPayCell record={record} />
      <PayDetailCell record={record} />
      <td className="px-3 py-3 text-xs">
        <span className="block">
          Employee: {pensionLabel(record.employeePension)}
        </span>
        <span className="block">
          Employer: {pensionLabel(record.employerPension)}
        </span>
      </td>
      <td className="max-w-48 px-3 py-3 text-xs text-muted-foreground">
        {sourceLabel(record)}
      </td>
      {allowCorrection && (
        <td className="px-3 py-2 text-right">
          <SalaryRecordActions record={record} />
        </td>
      )}
    </tr>
  );
}

function SalaryTable({
  records,
  allowCorrection,
}: Readonly<{
  records: readonly SalaryHistoryRecord[];
  allowCorrection: boolean;
}>) {
  return (
    <>
      <div className="space-y-3 sm:hidden">
        {records.map((record) => {
          const annualised = annualisedGrossPay(record);
          return (
            <article
              key={record.id}
              className="space-y-3 rounded-md border p-3 text-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{record.person}</p>
                  <p className="text-muted-foreground">{record.employer}</p>
                </div>
                {allowCorrection && <SalaryRecordActions record={record} />}
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-muted-foreground">Effective</p>
                  <p className="font-mono">{record.effectiveStart}</p>
                  <p className="font-mono">
                    to {record.effectiveEnd ?? "present"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">
                    {record.grossPay == null ? "Take-home pay" : "Gross pay"}
                  </p>
                  <p className="font-medium">
                    {record.grossPay == null
                      ? moneyOrUnknown(record, record.takeHomePay)
                      : formatMoney(record, record.grossPay)}
                  </p>
                  <p>
                    {record.amountKind === "annualSalary"
                      ? "Annual rate"
                      : `${record.payFrequency} pay`}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Pay detail</p>
                  <p>
                    Base:{" "}
                    {record.baseSalary == null
                      ? "Unknown"
                      : formatMoney(record, record.baseSalary)}
                  </p>
                  <p>
                    Variable:{" "}
                    {record.variablePay == null
                      ? "Unknown"
                      : formatMoney(record, record.variablePay)}
                  </p>
                  <p>Tax code: {record.taxCode ?? "Unknown"}</p>
                  <p>
                    NI category: {record.nationalInsuranceCategory ?? "Unknown"}
                  </p>
                  {annualised != null && record.amountKind === "periodPay" && (
                    <p>{formatMoney(record, annualised)} annualised</p>
                  )}
                </div>
                <div>
                  <p className="text-muted-foreground">Pension and source</p>
                  <p>Employee: {pensionLabel(record.employeePension)}</p>
                  <p>Employer: {pensionLabel(record.employerPension)}</p>
                  <p className="mt-1 text-muted-foreground">
                    {sourceLabel(record)}
                  </p>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      <div className="hidden w-full min-w-0 max-w-full overflow-x-auto rounded-md border sm:block">
        <table className="w-full min-w-[58rem] text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Person and employment</th>
              <th className="px-3 py-2 font-medium">Effective dates</th>
              <th className="px-3 py-2 font-medium">Pay</th>
              <th className="px-3 py-2 font-medium">Pay detail</th>
              <th className="px-3 py-2 font-medium">Pension</th>
              <th className="px-3 py-2 font-medium">Source</th>
              {allowCorrection && (
                <th className="px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <DesktopSalaryRow
                key={record.id}
                record={record}
                allowCorrection={allowCorrection}
              />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function SalaryHistoryManager() {
  const { currentSalaryHistory, salaryHistory } = useAssetTracker();
  const currentIds = new Set(currentSalaryHistory.map((record) => record.id));
  const prior = salaryHistory.filter((record) => !currentIds.has(record.id));

  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle>Salary history</CardTitle>
            <CardDescription>
              Add the gross or take-home figures you remember. More detailed tax
              and pension facts are optional.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <SalaryHistoryImportDrawer />
            <SalaryRecordDrawer />
          </div>
        </div>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        {currentSalaryHistory.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
            No salary facts are stored yet. Download the import template or add
            the first record manually.
          </div>
        ) : (
          <SalaryTable records={currentSalaryHistory} allowCorrection />
        )}
        {prior.length > 0 && (
          <details className="rounded-md border p-3">
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              Prior accepted facts
              <Badge variant="outline">{prior.length}</Badge>
            </summary>
            <p className="my-3 text-xs text-muted-foreground">
              Corrections append a new accepted fact. These superseded records
              remain in the local export with their original source and
              acceptance time.
            </p>
            <SalaryTable records={prior} allowCorrection={false} />
          </details>
        )}
      </CardContent>
    </Card>
  );
}
