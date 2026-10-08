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
  type SalaryPayFrequency,
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

function normaliseDate(value: string): string {
  const trimmed = value.trim();
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (match == null) return trimmed;
  const [, day = "", month = "", year = ""] = match;
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return parsed.getUTCFullYear() === Number(year) &&
    parsed.getUTCMonth() + 1 === Number(month) &&
    parsed.getUTCDate() === Number(day)
    ? iso
    : trimmed;
}

function displayDate(value: string | undefined): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  return match == null ? value : `${match[3]}/${match[2]}/${match[1]}`;
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

function DateField({
  defaultValue,
  label,
  name,
  required = false,
}: Readonly<{
  defaultValue?: string;
  label: string;
  name: string;
  required?: boolean;
}>) {
  return (
    <label htmlFor={`salary-${name}`} className="space-y-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <Input
        id={`salary-${name}`}
        name={name}
        type="text"
        inputMode="numeric"
        placeholder="DD/MM/YYYY"
        defaultValue={displayDate(defaultValue)}
        required={required}
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

function jobIdentifier(person: string, employer: string): string {
  const slug = `${person}-${employer}`
    .toLocaleLowerCase("en-GB")
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
  return slug || "employment";
}

function employmentKey(
  record: Pick<SalaryHistoryRecord, "person" | "employer">,
): string {
  return `${record.person.trim().toLocaleLowerCase("en-GB")}\0${record.employer.trim().toLocaleLowerCase("en-GB")}`;
}

type SalaryEntryKind = "salary" | "raise" | "bonus";

function salaryFactsFromForm(
  data: FormData,
  record: SalaryHistoryRecord | undefined,
  entryKind: SalaryEntryKind,
): SalaryRecordFacts {
  const effectiveStart = normaliseDate(formText(data, "effectiveStart"));
  const effectiveEndInput = formText(data, "effectiveEnd");
  const effectiveEnd =
    entryKind === "bonus"
      ? effectiveStart
      : effectiveEndInput === ""
        ? undefined
        : normaliseDate(effectiveEndInput);
  const workFractionPercent = optionalNumber(data, "workFraction");
  const person = formText(data, "person");
  const employer = formText(data, "employer");
  const keepsEmployment =
    record != null &&
    employmentKey(record) === employmentKey({ person, employer });
  return {
    person,
    employer,
    employmentId: keepsEmployment
      ? record.employmentId
      : formText(data, "employmentId") || jobIdentifier(person, employer),
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
    grossPay: optionalNumber(data, "grossPay"),
    baseSalary: optionalNumber(data, "baseSalary"),
    variablePay:
      entryKind === "bonus"
        ? optionalNumber(data, "grossPay")
        : optionalNumber(data, "variablePay"),
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
      <DateField
        label="Start date"
        name="effectiveStart"
        defaultValue={record?.effectiveStart}
        required
      />
      <DateField
        label="End date (optional)"
        name="effectiveEnd"
        defaultValue={record?.effectiveEnd}
      />
    </>
  );
}

type KnownPay = "gross" | "take-home";
type PayBasis = "annualSalary" | SalaryPayFrequency;

const payBasisOptions: readonly (readonly [PayBasis, string])[] = [
  ["annualSalary", "Annual salary or annual amount"],
  ["monthly", "One monthly payment"],
  ["weekly", "One weekly payment"],
  ["fortnightly", "One fortnightly payment"],
  ["fourWeekly", "One four-weekly payment"],
  ["quarterly", "One quarterly payment"],
  ["irregular", "An irregular payment"],
];

function PayFields({
  entryKind,
  knownPay,
  onKnownPayChange,
  onPayBasisChange,
  payBasis,
  record,
}: Readonly<{
  entryKind: SalaryEntryKind;
  knownPay: KnownPay;
  onKnownPayChange: (value: KnownPay) => void;
  onPayBasisChange: (value: PayBasis) => void;
  payBasis: PayBasis;
  record?: SalaryHistoryRecord;
}>) {
  if (entryKind === "bonus") {
    return (
      <>
        <input type="hidden" name="amountKind" value="periodPay" />
        <input type="hidden" name="payFrequency" value="irregular" />
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">Bonus figure you know</span>
          <select
            value={knownPay}
            onChange={(event) =>
              onKnownPayChange(event.target.value as KnownPay)
            }
            className="h-10 w-full rounded-md border bg-background px-3"
          >
            <option value="gross">Gross bonus before deductions</option>
            <option value="take-home">Bonus received after deductions</option>
          </select>
        </label>
        {knownPay === "gross" ? (
          <Field
            label="Gross bonus before deductions"
            name="grossPay"
            type="number"
            required
          />
        ) : (
          <Field
            label="Bonus received after deductions"
            name="takeHomePay"
            type="number"
            required
          />
        )}
        <p className="text-xs text-muted-foreground sm:col-span-2">
          {knownPay === "gross"
            ? "This is added once to that employment's gross pay for the tax year. It is not multiplied into a monthly or annual salary."
            : "This is saved once as an observed payment. Tax cannot be reconstructed without the gross bonus."}
        </p>
      </>
    );
  }
  return (
    <>
      <label className="space-y-1.5 text-sm">
        <span className="font-medium">Figure covers</span>
        <select
          value={payBasis}
          onChange={(event) => onPayBasisChange(event.target.value as PayBasis)}
          className="h-10 w-full rounded-md border bg-background px-3"
        >
          {payBasisOptions.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <input
        type="hidden"
        name="amountKind"
        value={payBasis === "annualSalary" ? "annualSalary" : "periodPay"}
      />
      <input
        type="hidden"
        name="payFrequency"
        value={payBasis === "annualSalary" ? "annual" : payBasis}
      />
      <label className="space-y-1.5 text-sm">
        <span className="font-medium">Pay figure you know</span>
        <select
          value={knownPay}
          onChange={(event) => onKnownPayChange(event.target.value as KnownPay)}
          className="h-10 w-full rounded-md border bg-background px-3"
        >
          <option value="gross">Gross pay before tax and pension</option>
          <option value="take-home">Take-home pay after tax and pension</option>
        </select>
      </label>
      {knownPay === "gross" ? (
        <Field
          label={
            entryKind === "raise"
              ? "New gross salary before tax and pension"
              : "Gross pay before tax and pension"
          }
          name="grossPay"
          type="number"
          defaultValue={record?.grossPay}
          required
        />
      ) : (
        <Field
          label="Take-home pay after tax and pension"
          name="takeHomePay"
          type="number"
          defaultValue={record?.takeHomePay}
          required
        />
      )}
    </>
  );
}

function AdditionalPayFields({
  knownPay,
  record,
}: Readonly<{ knownPay: KnownPay; record?: SalaryHistoryRecord }>) {
  const workFraction = record?.workFraction;
  return (
    <>
      <SelectField
        label="Tax jurisdiction"
        name="jurisdiction"
        defaultValue={jurisdictionValue(record?.jurisdiction) || "England"}
        options={jurisdictionOptions}
        required
      />
      <SelectField
        label="Currency"
        name="currency"
        defaultValue={record?.currency ?? "GBP"}
        options={SUPPORTED_CURRENCIES.map((currency) => [currency, currency])}
      />
      <Field
        label="Hours compared with full-time (optional %)"
        name="workFraction"
        type="number"
        defaultValue={workFraction == null ? undefined : workFraction * 100}
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
      {knownPay === "gross" && (
        <Field
          label="Take-home pay after tax and pension (if known)"
          name="takeHomePay"
          type="number"
          defaultValue={record?.takeHomePay}
        />
      )}
    </>
  );
}

function TaxAmountFields({
  record,
}: Readonly<{ record?: SalaryHistoryRecord }>) {
  return (
    <>
      <Field
        label="Income Tax paid (if known)"
        name="observedIncomeTax"
        type="number"
        defaultValue={record?.observedIncomeTax}
      />
      <Field
        label="Employee National Insurance paid (if known)"
        name="observedEmployeeNationalInsurance"
        type="number"
        defaultValue={record?.observedEmployeeNationalInsurance}
      />
      <Field
        label="Other deductions"
        name="otherDeductions"
        type="number"
        defaultValue={record?.otherDeductions ?? 0}
        required
      />
      <Field
        label="Other annual taxable income"
        name="otherTaxableIncome"
        type="number"
        defaultValue={record?.otherTaxableIncome ?? 0}
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
          defaultValue={record?.nationalInsuranceCategory ?? "A"}
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

function ExistingEmploymentFields({
  employmentOptions,
  entryKind,
  onEmploymentChange,
  selectedEmployment,
}: Readonly<{
  employmentOptions: readonly SalaryHistoryRecord[];
  entryKind: "raise" | "bonus";
  onEmploymentChange: (id: string) => void;
  selectedEmployment?: SalaryHistoryRecord;
}>) {
  return (
    <>
      <label className="space-y-1.5 text-sm sm:col-span-2">
        <span className="font-medium">Employment</span>
        <select
          value={selectedEmployment?.id ?? ""}
          onChange={(event) => onEmploymentChange(event.target.value)}
          required
          className="h-10 w-full rounded-md border bg-background px-3"
        >
          {employmentOptions.length === 0 && (
            <option value="">Add a salary period first</option>
          )}
          {employmentOptions.map((employment) => (
            <option key={employment.id} value={employment.id}>
              {employment.person} · {employment.employer}
            </option>
          ))}
        </select>
      </label>
      <input
        type="hidden"
        name="person"
        value={selectedEmployment?.person ?? ""}
      />
      <input
        type="hidden"
        name="employer"
        value={selectedEmployment?.employer ?? ""}
      />
      <input
        type="hidden"
        name="employmentId"
        value={selectedEmployment?.employmentId ?? ""}
      />
      {entryKind === "bonus" && (
        <>
          <input
            type="hidden"
            name="jurisdiction"
            value={
              jurisdictionValue(selectedEmployment?.jurisdiction) || "England"
            }
          />
          <input
            type="hidden"
            name="currency"
            value={selectedEmployment?.currency ?? "GBP"}
          />
        </>
      )}
      <DateField
        label={entryKind === "raise" ? "New rate starts" : "Payment date"}
        name="effectiveStart"
        required
      />
      {entryKind === "raise" && (
        <>
          <DateField label="End date (optional)" name="effectiveEnd" />
          <p className="text-xs text-muted-foreground sm:col-span-2">
            If the previous salary is still open on this date, it will end the
            day before the new rate starts.
          </p>
        </>
      )}
    </>
  );
}

function SalaryFormFields({
  entryKind,
  employmentOptions,
  onEmploymentChange,
  onEntryKindChange,
  record,
  selectedEmployment,
  defaultPerson,
  knownPay,
  onKnownPayChange,
  onPayBasisChange,
  payBasis,
}: Readonly<{
  entryKind: SalaryEntryKind;
  employmentOptions: readonly SalaryHistoryRecord[];
  onEmploymentChange: (id: string) => void;
  onEntryKindChange: (kind: SalaryEntryKind) => void;
  record?: SalaryHistoryRecord;
  selectedEmployment?: SalaryHistoryRecord;
  defaultPerson?: string;
  knownPay: KnownPay;
  onKnownPayChange: (value: KnownPay) => void;
  onPayBasisChange: (value: PayBasis) => void;
  payBasis: PayBasis;
}>) {
  const inherited = record ?? selectedEmployment;
  return (
    <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 sm:grid-cols-2">
      {record == null && (
        <label className="space-y-1.5 text-sm sm:col-span-2">
          <span className="font-medium">What are you recording?</span>
          <select
            value={entryKind}
            onChange={(event) =>
              onEntryKindChange(event.target.value as SalaryEntryKind)
            }
            className="h-10 w-full rounded-md border bg-background px-3"
          >
            <option value="salary">A job or salary period</option>
            <option value="raise">A pay rise or promotion</option>
            <option value="bonus">A one-off bonus</option>
          </select>
        </label>
      )}
      {record != null || entryKind === "salary" ? (
        <EmploymentFields record={record} defaultPerson={defaultPerson} />
      ) : (
        <ExistingEmploymentFields
          employmentOptions={employmentOptions}
          entryKind={entryKind}
          onEmploymentChange={onEmploymentChange}
          selectedEmployment={selectedEmployment}
        />
      )}
      <PayFields
        entryKind={entryKind}
        knownPay={knownPay}
        onKnownPayChange={onKnownPayChange}
        onPayBasisChange={onPayBasisChange}
        payBasis={payBasis}
        record={entryKind === "raise" ? selectedEmployment : record}
      />
      {entryKind !== "bonus" && (
        <details className="rounded-md border p-3 sm:col-span-2">
          <summary className="cursor-pointer text-sm font-medium">
            More details, if you know them
          </summary>
          <p className="mt-2 text-xs text-muted-foreground">
            These fields improve tax and real-terms comparisons. They are not
            needed to save the salary record.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <AdditionalPayFields knownPay={knownPay} record={inherited} />
            <TaxDeductionFields record={inherited} />
            <div className="sm:col-span-2">
              <PensionFields
                label="Employee pension"
                prefix="employee"
                value={inherited?.employeePension}
              />
            </div>
            <div className="sm:col-span-2">
              <PensionFields
                label="Employer pension"
                prefix="employer"
                value={inherited?.employerPension}
              />
            </div>
          </div>
        </details>
      )}
    </div>
  );
}

export function SalaryRecordDrawer({
  record,
}: Readonly<{ record?: SalaryHistoryRecord }>) {
  const { currentSalaryHistory, household, saveSalaryRecord } =
    useAssetTracker();
  const employmentOptions = Array.from(
    new Map(
      [...(currentSalaryHistory ?? [])]
        .filter(({ payFrequency }) => payFrequency !== "irregular")
        .map((salary) => [employmentKey(salary), salary]),
    ).values(),
  ).toSorted((left, right) =>
    right.effectiveStart.localeCompare(left.effectiveStart),
  );
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [entryKind, setEntryKind] = useState<SalaryEntryKind>("salary");
  const [selectedEmploymentId, setSelectedEmploymentId] = useState(
    employmentOptions[0]?.id ?? "",
  );
  const selectedEmployment =
    employmentOptions.find(({ id }) => id === selectedEmploymentId) ??
    employmentOptions[0];
  const [knownPay, setKnownPay] = useState<KnownPay>(
    record?.grossPay == null && record?.takeHomePay != null
      ? "take-home"
      : "gross",
  );
  const [payBasis, setPayBasis] = useState<PayBasis>(
    record?.amountKind === "annualSalary"
      ? "annualSalary"
      : (record?.payFrequency ?? "annualSalary"),
  );
  const title = record == null ? "Add salary record" : "Correct salary record";

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    let facts = salaryFactsFromForm(data, record, entryKind);
    if (
      record == null &&
      selectedEmployment != null &&
      entryKind !== "salary"
    ) {
      const staleEmploymentId = (currentSalaryHistory ?? []).some(
        (candidate) =>
          candidate.id !== selectedEmployment.id &&
          candidate.employmentId === selectedEmployment.employmentId &&
          employmentKey(candidate) !== employmentKey(selectedEmployment),
      );
      if (staleEmploymentId) {
        facts = {
          ...facts,
          employmentId: jobIdentifier(facts.person, facts.employer),
        };
      }
    }
    setSubmitting(true);
    setError(null);
    try {
      await saveSalaryRecord({
        facts,
        correctsId: record?.id,
        ...(record == null && entryKind === "raise"
          ? { replacesRateId: selectedEmployment?.id }
          : {}),
      });
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
            Enter whichever figure you still have, gross pay or take-home pay. A
            correction keeps the prior accepted facts in the audit trail.
          </DrawerDescription>
        </DrawerHeader>
        <form
          key={record?.id ?? "new"}
          aria-label={title}
          onSubmit={handleSubmit}
          className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-hidden"
        >
          <SalaryFormFields
            entryKind={entryKind}
            employmentOptions={employmentOptions}
            onEmploymentChange={setSelectedEmploymentId}
            onEntryKindChange={(kind) => {
              setEntryKind(kind);
              if (kind === "raise") setPayBasis("annualSalary");
              if (kind === "bonus") setKnownPay("gross");
            }}
            record={record}
            selectedEmployment={selectedEmployment}
            defaultPerson={household.members[0]?.displayName}
            knownPay={knownPay}
            onKnownPayChange={(value) => {
              setKnownPay(value);
              if (value === "take-home" && payBasis === "annualSalary") {
                setPayBasis("monthly");
              }
            }}
            payBasis={payBasis}
            onPayBasisChange={setPayBasis}
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
