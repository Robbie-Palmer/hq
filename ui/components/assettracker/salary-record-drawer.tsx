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

function formText(data: FormData, name: string, fallback = ""): string {
  const value = data.get(name);
  return typeof value === "string" ? value : fallback;
}

function optionalNumber(data: FormData, name: string): number | undefined {
  const value = formText(data, name).trim();
  return value === "" ? undefined : Number(value);
}

function optionalBoolean(data: FormData, name: string): boolean | undefined {
  const value = formText(data, name);
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function jurisdictionValue(value: string | undefined): string {
  const normalised = (value ?? "")
    .trim()
    .toLocaleLowerCase("en-GB")
    .replaceAll("&", "and")
    .replace(/\s+/g, " ");
  if (normalised.includes("scotland")) return "Scotland";
  if (normalised === "wales") return "Wales";
  if (normalised.includes("northern ireland")) return "Northern Ireland";
  if (normalised === "england" || normalised === "england and wales") {
    return "England";
  }
  return "";
}

function pensionFromForm(
  data: FormData,
  prefix: "employee" | "employer",
  effectiveStart: string,
  effectiveEnd: string | undefined,
): PensionContribution | undefined {
  const arrangement = formText(data, `${prefix}PensionType`);
  const amount = optionalNumber(data, `${prefix}PensionAmount`);
  const ratePercent = optionalNumber(data, `${prefix}PensionRate`);
  const basis = formText(data, `${prefix}PensionBasis`);
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

function SelectField({
  label,
  name,
  defaultValue,
  options,
  required = false,
}: Readonly<{
  label: string;
  name: string;
  defaultValue?: string;
  options: readonly (readonly [string, string])[];
  required?: boolean;
}>) {
  return (
    <label className="space-y-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        required={required}
        className="h-10 w-full rounded-md border bg-background px-3"
      >
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

const pensionTypeOptions = [
  ["", "Not recorded"],
  ["salarySacrifice", "Salary sacrifice"],
  ["netPay", "Net pay arrangement"],
  ["reliefAtSource", "Relief at source"],
  ["none", "No contribution"],
  ["other", "Other"],
  ["unknown", "Unknown"],
] as const;

const pensionBasisOptions = [
  ["", "Not recorded"],
  ["grossPay", "Gross pay"],
  ["pensionablePay", "Pensionable pay"],
  ["qualifyingEarnings", "Qualifying earnings"],
  ["unknown", "Unknown"],
] as const;

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
        <SelectField
          label="Contribution type"
          name={`${prefix}PensionType`}
          defaultValue={value?.arrangement ?? ""}
          options={pensionTypeOptions}
        />
        <SelectField
          label="Contribution basis"
          name={`${prefix}PensionBasis`}
          defaultValue={value?.basis ?? ""}
          options={pensionBasisOptions}
        />
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

function salaryFactsFromForm(data: FormData): SalaryRecordFacts {
  const effectiveStart = formText(data, "effectiveStart");
  const effectiveEnd = formText(data, "effectiveEnd") || undefined;
  const workFractionPercent = optionalNumber(data, "workFraction");
  return {
    person: formText(data, "person"),
    employer: formText(data, "employer"),
    employmentId: formText(data, "employmentId"),
    currency: formText(
      data,
      "currency",
      "GBP",
    ) as SalaryRecordFacts["currency"],
    jurisdiction: formText(data, "jurisdiction"),
    effectiveStart,
    effectiveEnd,
    payFrequency: formText(
      data,
      "payFrequency",
    ) as SalaryRecordFacts["payFrequency"],
    amountKind: formText(data, "amountKind") as SalaryRecordFacts["amountKind"],
    workFraction:
      workFractionPercent == null ? undefined : workFractionPercent / 100,
    grossPay: Number(formText(data, "grossPay")),
    baseSalary: optionalNumber(data, "baseSalary"),
    variablePay: optionalNumber(data, "variablePay"),
    taxablePay: optionalNumber(data, "taxablePay"),
    takeHomePay: optionalNumber(data, "takeHomePay"),
    observedIncomeTax: optionalNumber(data, "observedIncomeTax"),
    observedEmployeeNationalInsurance: optionalNumber(
      data,
      "observedEmployeeNationalInsurance",
    ),
    otherDeductions: optionalNumber(data, "otherDeductions"),
    otherTaxableIncome: optionalNumber(data, "otherTaxableIncome"),
    taxCode: formText(data, "taxCode") || undefined,
    nationalInsuranceCategory:
      formText(data, "nationalInsuranceCategory") || undefined,
    isCompanyDirector: optionalBoolean(data, "isCompanyDirector"),
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
}

function defaultDirectorValue(record: SalaryHistoryRecord | undefined): string {
  if (record == null) return "false";
  return record.isCompanyDirector == null
    ? ""
    : String(record.isCompanyDirector);
}

const jurisdictionOptions = [
  ["", "Choose jurisdiction"],
  ["England", "England"],
  ["Northern Ireland", "Northern Ireland"],
  ["Scotland", "Scotland"],
  ["Wales", "Wales"],
] as const;

const payFrequencyOptions = [
  ["weekly", "Weekly"],
  ["fortnightly", "Fortnightly"],
  ["fourWeekly", "Every four weeks"],
  ["monthly", "Monthly"],
  ["quarterly", "Quarterly"],
  ["annual", "Annual"],
  ["irregular", "Irregular"],
] as const;

const directorOptions = [
  ["", "Not recorded"],
  ["false", "No"],
  ["true", "Yes"],
] as const;

function EmploymentFields({
  record,
  defaultPerson,
}: Readonly<{ record?: SalaryHistoryRecord; defaultPerson?: string }>) {
  return (
    <>
      <Field
        label="Person"
        name="person"
        defaultValue={record?.person ?? defaultPerson}
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
      <SelectField
        label="Tax jurisdiction"
        name="jurisdiction"
        defaultValue={jurisdictionValue(record?.jurisdiction)}
        options={jurisdictionOptions}
        required
      />
      <SelectField
        label="Currency"
        name="currency"
        defaultValue={record?.currency ?? "GBP"}
        options={SUPPORTED_CURRENCIES.map((currency) => [currency, currency])}
      />
      <SelectField
        label="Pay frequency"
        name="payFrequency"
        defaultValue={record?.payFrequency ?? "monthly"}
        options={payFrequencyOptions}
      />
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
    </>
  );
}

function PayFields({ record }: Readonly<{ record?: SalaryHistoryRecord }>) {
  const workFraction = record?.workFraction;
  return (
    <>
      <SelectField
        label="Amount type"
        name="amountKind"
        defaultValue={record?.amountKind ?? "annualSalary"}
        options={[
          ["annualSalary", "Annual salary rate"],
          ["periodPay", "Actual pay for the period"],
        ]}
      />
      <Field
        label="Work fraction (%)"
        name="workFraction"
        type="number"
        defaultValue={workFraction == null ? undefined : workFraction * 100}
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
    </>
  );
}

function TaxAmountFields({
  record,
}: Readonly<{ record?: SalaryHistoryRecord }>) {
  return (
    <>
      <Field
        label="Observed Income Tax"
        name="observedIncomeTax"
        type="number"
        defaultValue={record?.observedIncomeTax}
      />
      <Field
        label="Observed employee National Insurance"
        name="observedEmployeeNationalInsurance"
        type="number"
        defaultValue={record?.observedEmployeeNationalInsurance}
      />
      <Field
        label="Other deductions"
        name="otherDeductions"
        type="number"
        defaultValue={record == null ? 0 : record.otherDeductions}
        required
      />
      <Field
        label="Other annual taxable income"
        name="otherTaxableIncome"
        type="number"
        defaultValue={record == null ? 0 : record.otherTaxableIncome}
        required
      />
    </>
  );
}

function TaxDeductionFields({
  record,
}: Readonly<{ record?: SalaryHistoryRecord }>) {
  return (
    <fieldset className="space-y-3 rounded-md border p-3 sm:col-span-2">
      <legend className="px-1 text-sm font-medium">
        Tax and deduction facts
      </legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <TaxAmountFields record={record} />
        <Field
          label="Observed tax code"
          name="taxCode"
          defaultValue={record?.taxCode}
        />
        <Field
          label="National Insurance category"
          name="nationalInsuranceCategory"
          defaultValue={record == null ? "A" : record.nationalInsuranceCategory}
          required
        />
        <SelectField
          label="Company director"
          name="isCompanyDirector"
          defaultValue={defaultDirectorValue(record)}
          options={directorOptions}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Use zero when there was no other income or deduction. Leaving a value
        unknown blocks the estimate rather than assuming zero.
      </p>
    </fieldset>
  );
}

function SalaryFormFields({
  record,
  defaultPerson,
}: Readonly<{ record?: SalaryHistoryRecord; defaultPerson?: string }>) {
  return (
    <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 sm:grid-cols-2">
      <EmploymentFields record={record} defaultPerson={defaultPerson} />
      <PayFields record={record} />
      <TaxDeductionFields record={record} />
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
    const facts = salaryFactsFromForm(data);
    setSubmitting(true);
    setError(null);
    try {
      await saveSalaryRecord({ facts, correctsId: record?.id });
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
          <SalaryFormFields
            record={record}
            defaultPerson={household.members[0]?.displayName}
          />
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
