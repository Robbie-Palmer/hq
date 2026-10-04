"use client";

import { PencilIcon, PlusIcon } from "lucide-react";
import { type SubmitEvent, useState } from "react";
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
  formatAssetTrackerError,
  type PensionContribution,
  type SalaryHistoryRecord,
  type SalaryRecordFacts,
  SUPPORTED_CURRENCIES,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";

function optionalNumber(data: FormData, name: string): number | undefined {
  const value = String(data.get(name) ?? "").trim();
  return value === "" ? undefined : Number(value);
}

function pensionFromForm(
  data: FormData,
  prefix: "employee" | "employer",
  effectiveStart: string,
  effectiveEnd: string | undefined,
): PensionContribution | undefined {
  const arrangement = String(data.get(`${prefix}PensionType`) ?? "");
  const amount = optionalNumber(data, `${prefix}PensionAmount`);
  const ratePercent = optionalNumber(data, `${prefix}PensionRate`);
  const basis = String(data.get(`${prefix}PensionBasis`) ?? "");
  if (
    arrangement === "" &&
    amount == null &&
    ratePercent == null &&
    basis === ""
  ) {
    return undefined;
  }
  return {
    arrangement: (arrangement ||
      "unknown") as PensionContribution["arrangement"],
    amount,
    rate: ratePercent == null ? undefined : ratePercent / 100,
    basis: (basis || "unknown") as PensionContribution["basis"],
    effectiveStart,
    effectiveEnd,
  };
}

function Field({
  label,
  name,
  defaultValue,
  type = "text",
  required = false,
}: Readonly<{
  label: string;
  name: string;
  defaultValue?: string | number;
  type?: "text" | "date" | "number";
  required?: boolean;
}>) {
  return (
    <label htmlFor={`salary-${name}`} className="space-y-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <Input
        id={`salary-${name}`}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        min={type === "number" ? 0 : undefined}
        step={type === "number" ? "any" : undefined}
      />
    </label>
  );
}

function PensionFields({
  label,
  prefix,
  value,
}: Readonly<{
  label: string;
  prefix: "employee" | "employer";
  value?: PensionContribution;
}>) {
  return (
    <fieldset className="space-y-3 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">{label}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5 text-sm">
          <span>Contribution type</span>
          <select
            name={`${prefix}PensionType`}
            defaultValue={value?.arrangement ?? ""}
            className="h-10 w-full rounded-md border bg-background px-3"
          >
            <option value="">Not recorded</option>
            <option value="salarySacrifice">Salary sacrifice</option>
            <option value="netPay">Net pay arrangement</option>
            <option value="reliefAtSource">Relief at source</option>
            <option value="other">Other</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <label className="space-y-1.5 text-sm">
          <span>Contribution basis</span>
          <select
            name={`${prefix}PensionBasis`}
            defaultValue={value?.basis ?? ""}
            className="h-10 w-full rounded-md border bg-background px-3"
          >
            <option value="">Not recorded</option>
            <option value="grossPay">Gross pay</option>
            <option value="pensionablePay">Pensionable pay</option>
            <option value="qualifyingEarnings">Qualifying earnings</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <Field
          label="Amount"
          name={`${prefix}PensionAmount`}
          type="number"
          defaultValue={value?.amount}
        />
        <Field
          label="Rate (%)"
          name={`${prefix}PensionRate`}
          type="number"
          defaultValue={value?.rate == null ? undefined : value.rate * 100}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Enter an amount or a rate. Leave both empty when the contribution is
        unknown.
      </p>
    </fieldset>
  );
}

export function SalaryRecordDrawer({
  record,
}: Readonly<{ record?: SalaryHistoryRecord }>) {
  const { household, saveSalaryRecord } = useAssetTracker();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const title = record == null ? "Add salary record" : "Correct salary record";

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const effectiveStart = String(data.get("effectiveStart") ?? "");
    const effectiveEnd = String(data.get("effectiveEnd") ?? "") || undefined;
    const facts: SalaryRecordFacts = {
      person: String(data.get("person") ?? ""),
      employer: String(data.get("employer") ?? ""),
      employmentId: String(data.get("employmentId") ?? ""),
      currency: String(
        data.get("currency") ?? "GBP",
      ) as SalaryRecordFacts["currency"],
      jurisdiction: String(data.get("jurisdiction") ?? ""),
      effectiveStart,
      effectiveEnd,
      payFrequency: String(
        data.get("payFrequency"),
      ) as SalaryRecordFacts["payFrequency"],
      amountKind: String(
        data.get("amountKind"),
      ) as SalaryRecordFacts["amountKind"],
      workFraction:
        optionalNumber(data, "workFraction") == null
          ? undefined
          : Number(data.get("workFraction")) / 100,
      grossPay: Number(data.get("grossPay")),
      baseSalary: optionalNumber(data, "baseSalary"),
      variablePay: optionalNumber(data, "variablePay"),
      taxablePay: optionalNumber(data, "taxablePay"),
      takeHomePay: optionalNumber(data, "takeHomePay"),
      employeePension: pensionFromForm(
        data,
        "employee",
        effectiveStart,
        effectiveEnd,
      ),
      employerPension: pensionFromForm(
        data,
        "employer",
        effectiveStart,
        effectiveEnd,
      ),
    };
    setSubmitting(true);
    setError(null);
    try {
      await saveSalaryRecord({ facts, correctsId: record?.id });
      setOpen(false);
    } catch (caught) {
      setError(formatAssetTrackerError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button variant={record == null ? "outline" : "ghost"} size="sm">
          {record == null ? <PlusIcon /> : <PencilIcon />}
          {record == null ? "Add manually" : "Correct"}
        </Button>
      </DrawerTrigger>
      <DrawerContent className="h-[92dvh] max-h-[92dvh] overflow-hidden">
        <DrawerHeader className="mx-auto w-full max-w-3xl shrink-0">
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerDescription>
            Record gross pay before tax, employee pension deductions, and salary
            sacrifice. A correction keeps the prior accepted facts in the audit
            trail.
          </DrawerDescription>
        </DrawerHeader>
        <form
          key={record?.id ?? "new"}
          aria-label={title}
          onSubmit={handleSubmit}
          className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-hidden"
        >
          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 sm:grid-cols-2">
            <Field
              label="Person"
              name="person"
              defaultValue={record?.person ?? household.members[0]?.displayName}
              required
            />
            <Field
              label="Employer"
              name="employer"
              defaultValue={record?.employer}
              required
            />
            <Field
              label="Employment ID"
              name="employmentId"
              defaultValue={record?.employmentId}
              required
            />
            <Field
              label="Jurisdiction"
              name="jurisdiction"
              defaultValue={record?.jurisdiction ?? "UK"}
              required
            />
            <label className="space-y-1.5 text-sm">
              <span className="font-medium">Currency</span>
              <select
                name="currency"
                defaultValue={record?.currency ?? "GBP"}
                className="h-10 w-full rounded-md border bg-background px-3"
              >
                {SUPPORTED_CURRENCIES.map((currency) => (
                  <option key={currency}>{currency}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="font-medium">Pay frequency</span>
              <select
                name="payFrequency"
                defaultValue={record?.payFrequency ?? "monthly"}
                className="h-10 w-full rounded-md border bg-background px-3"
              >
                <option value="weekly">Weekly</option>
                <option value="fortnightly">Fortnightly</option>
                <option value="fourWeekly">Every four weeks</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
                <option value="irregular">Irregular</option>
              </select>
            </label>
            <Field
              label="Effective start"
              name="effectiveStart"
              type="date"
              defaultValue={record?.effectiveStart}
              required
            />
            <Field
              label="Effective end"
              name="effectiveEnd"
              type="date"
              defaultValue={record?.effectiveEnd}
            />
            <label className="space-y-1.5 text-sm">
              <span className="font-medium">Amount type</span>
              <select
                name="amountKind"
                defaultValue={record?.amountKind ?? "annualSalary"}
                className="h-10 w-full rounded-md border bg-background px-3"
              >
                <option value="annualSalary">Annual salary rate</option>
                <option value="periodPay">Actual pay for the period</option>
              </select>
            </label>
            <Field
              label="Work fraction (%)"
              name="workFraction"
              type="number"
              defaultValue={
                record?.workFraction == null
                  ? undefined
                  : record.workFraction * 100
              }
            />
            <Field
              label="Gross pay before pension"
              name="grossPay"
              type="number"
              defaultValue={record?.grossPay}
              required
            />
            <Field
              label="Base salary"
              name="baseSalary"
              type="number"
              defaultValue={record?.baseSalary}
            />
            <Field
              label="Variable pay or bonus"
              name="variablePay"
              type="number"
              defaultValue={record?.variablePay}
            />
            <Field
              label="Observed taxable pay"
              name="taxablePay"
              type="number"
              defaultValue={record?.taxablePay}
            />
            <Field
              label="Observed take-home pay"
              name="takeHomePay"
              type="number"
              defaultValue={record?.takeHomePay}
            />
            <div className="sm:col-span-2">
              <PensionFields
                label="Employee pension"
                prefix="employee"
                value={record?.employeePension}
              />
            </div>
            <div className="sm:col-span-2">
              <PensionFields
                label="Employer pension"
                prefix="employer"
                value={record?.employerPension}
              />
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 border-t p-4">
            <Button type="submit" disabled={submitting}>
              {record == null ? "Save salary record" : "Accept correction"}
            </Button>
            <DrawerClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DrawerClose>
            {error && (
              <p className="w-full text-sm text-destructive">{error}</p>
            )}
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
