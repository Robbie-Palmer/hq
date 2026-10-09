"use client";

import type {
  HouseholdTaxEstimate,
  PersonTaxEstimate,
} from "finance-tax-rules/household-tax";
import { DownloadIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  annualisedGrossPay,
  defaultTaxProfile,
  formatAssetTrackerError,
  type Household,
  type SalaryHistoryRecord,
  type TaxProfileSetup,
} from "@/lib/domain/assettracker";
import { formatMinorCurrency } from "@/lib/generic/money";
import { useAssetTracker } from "./asset-tracker-provider";
import {
  AnnualAllowanceUsageChart,
  TaxBandConsumptionChart,
} from "./tax-band-consumption-chart";

const componentLabels = {
  incomeTax: "Income Tax",
  savingsTax: "Savings interest tax",
  dividendTax: "Dividend tax",
  nationalInsurance: "Employee National Insurance",
  capitalGainsTax: "Capital Gains Tax",
} as const;

type TaxSetupRow = TaxProfileSetup & { annualTaxableIncome: string };
type AssetTracker = ReturnType<typeof useAssetTracker>;
type TaxSetupUpdate = <K extends keyof TaxSetupRow>(
  memberId: string,
  key: K,
  value: TaxSetupRow[K],
) => void;

function suggestedIncome(
  member: Household["members"][number],
  members: Household["members"],
  salaryHistory: SalaryHistoryRecord[],
  recurringIncomePence: number | null,
): string {
  if (recurringIncomePence != null) {
    return String(Math.round(recurringIncomePence / 100));
  }
  const named = salaryHistory.filter(
    ({ person }) => person.toLowerCase() === member.displayName.toLowerCase(),
  );
  const candidates = (
    named.length > 0 || members.length > 1 ? named : salaryHistory
  )
    .filter(({ effectiveEnd }) => effectiveEnd == null)
    .toReversed();
  const annual = candidates
    .map(annualisedGrossPay)
    .find((amount) => amount != null);
  return annual == null ? "" : String(Math.round(annual));
}

function TaxSetupSelectors({
  row,
  update,
}: Readonly<{ row: TaxSetupRow; update: TaxSetupUpdate }>) {
  return (
    <>
      <label className="space-y-1.5 text-xs font-medium">
        <span>Tax jurisdiction</span>
        <select
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          value={row.jurisdiction}
          onChange={(event) =>
            update(
              row.memberId,
              "jurisdiction",
              event.target.value as TaxSetupRow["jurisdiction"],
            )
          }
        >
          <option value="england-and-northern-ireland">
            England or Northern Ireland
          </option>
          <option value="scotland">Scotland</option>
          <option value="wales">Wales</option>
        </select>
      </label>
      <label className="space-y-1.5 text-xs font-medium">
        <span>UK residence</span>
        <select
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          value={row.residence}
          onChange={(event) =>
            update(
              row.memberId,
              "residence",
              event.target.value as TaxSetupRow["residence"],
            )
          }
        >
          <option value="full-year-uk">Full tax year</option>
          <option value="partial-year">Part of the tax year</option>
          <option value="non-uk">Not UK resident</option>
        </select>
      </label>
    </>
  );
}

function TaxSetupIncomeFields({
  row,
  update,
}: Readonly<{ row: TaxSetupRow; update: TaxSetupUpdate }>) {
  return (
    <>
      <label
        className="space-y-1.5 text-xs font-medium"
        htmlFor={`tax-ni-category-${row.memberId}`}
      >
        NI category
        <Input
          id={`tax-ni-category-${row.memberId}`}
          value={row.nationalInsuranceCategory}
          onChange={(event) =>
            update(
              row.memberId,
              "nationalInsuranceCategory",
              event.target.value,
            )
          }
        />
      </label>
      <div className="space-y-1.5">
        <label
          className="block text-xs font-medium"
          htmlFor={`tax-income-${row.memberId}`}
        >
          Projected taxable employment income (£)
        </label>
        <Input
          id={`tax-income-${row.memberId}`}
          type="number"
          min="0"
          step="1"
          required
          value={row.annualTaxableIncome}
          onChange={(event) =>
            update(row.memberId, "annualTaxableIncome", event.target.value)
          }
        />
        <span className="block text-xs font-normal text-muted-foreground">
          Prefilled from current recurring gross pay after salary sacrifice. An
          open-ended salary record is used only when no current flow exists.
        </span>
      </div>
    </>
  );
}

const taxSetupOptions = [
  ["hasTaxableBenefits", "Taxable benefits"],
  ["isCompanyDirector", "Company director"],
  ["flexiblyAccessedPension", "Flexibly accessed pension"],
] as const;

function TaxSetupOptions({
  row,
  update,
}: Readonly<{ row: TaxSetupRow; update: TaxSetupUpdate }>) {
  return (
    <div className="flex flex-wrap gap-4 text-sm">
      {taxSetupOptions.map(([key, label]) => (
        <label key={key} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={row[key]}
            onChange={(event) =>
              update(row.memberId, key, event.target.checked)
            }
          />
          {label}
        </label>
      ))}
    </div>
  );
}

function TaxSetupMember({
  displayName,
  row,
  update,
}: Readonly<{
  displayName: string;
  row: TaxSetupRow;
  update: TaxSetupUpdate;
}>) {
  return (
    <fieldset className="space-y-4 rounded-lg border p-4">
      <legend className="px-1 text-sm font-medium">{displayName}</legend>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TaxSetupSelectors row={row} update={update} />
        <TaxSetupIncomeFields row={row} update={update} />
      </div>
      <TaxSetupOptions row={row} update={update} />
    </fieldset>
  );
}

function useTaxSetupForm(tracker: AssetTracker) {
  const configured = new Set(
    tracker.taxPosition?.profiles.map(({ memberId }) => memberId) ?? [],
  );
  const missingMembers = tracker.household.members.filter(
    ({ id }) => !configured.has(id),
  );
  const [rows, setRows] = useState<TaxSetupRow[]>(() =>
    missingMembers.map((member) => ({
      ...defaultTaxProfile(member.id),
      annualTaxableIncome: suggestedIncome(
        member,
        tracker.household.members,
        tracker.currentSalaryHistory ?? [],
        tracker.taxSetupIncomeSuggestions?.[member.id] ?? null,
      ),
    })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update: TaxSetupUpdate = (memberId, key, value) =>
    setRows((current) =>
      current.map((row) =>
        row.memberId === memberId ? { ...row, [key]: value } : row,
      ),
    );
  async function save() {
    setSaving(true);
    setError(null);
    try {
      await tracker.saveTaxSetup({
        taxYear: tracker.taxEstimate.taxYear,
        people: rows.map(({ annualTaxableIncome, ...profile }) => ({
          ...profile,
          annualTaxableIncomePence: Math.round(
            Number(annualTaxableIncome) * 100,
          ),
        })),
      });
    } catch (cause) {
      setError(formatAssetTrackerError(cause));
    } finally {
      setSaving(false);
    }
  }
  return {
    error,
    missingMembers,
    rows,
    save,
    saving,
    taxYear: tracker.taxEstimate.taxYear,
    update,
  };
}

function TaxSetupFormFields({ tracker }: Readonly<{ tracker: AssetTracker }>) {
  const form = useTaxSetupForm(tracker);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Review tax assumptions</CardTitle>
        <CardDescription>
          The current estimate uses the standard UK profile and income inferred
          from your saved salary or recurring gross pay. Review and save these
          assumptions for {form.taxYear}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {form.rows.map((row) => (
          <TaxSetupMember
            key={row.memberId}
            row={row}
            update={form.update}
            displayName={
              form.missingMembers.find(({ id }) => id === row.memberId)
                ?.displayName ?? row.memberId
            }
          />
        ))}
        <Button
          type="button"
          disabled={
            form.saving ||
            form.rows.some(
              ({ annualTaxableIncome }) => annualTaxableIncome === "",
            )
          }
          onClick={() => void form.save()}
        >
          Save tax assumptions
        </Button>
        {form.error != null && (
          <p className="text-sm text-destructive">{form.error}</p>
        )}
      </CardContent>
    </Card>
  );
}

function TaxSetupForm() {
  const tracker = useAssetTracker();
  const configured = new Set(
    tracker.taxPosition?.profiles.map(({ memberId }) => memberId) ?? [],
  );
  const missingMemberIds = tracker.household.members
    .filter(({ id }) => !configured.has(id))
    .map(({ id }) => id);
  if (missingMemberIds.length === 0) return null;
  return (
    <TaxSetupFormFields key={missingMemberIds.join(":")} tracker={tracker} />
  );
}

function UnsupportedNotice({
  cases,
}: Readonly<{ cases: PersonTaxEstimate["unsupported"] }>) {
  return (
    <section
      aria-labelledby="tax-position-blocked"
      className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-5"
    >
      <h2 id="tax-position-blocked" className="font-semibold">
        No total shown
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        These cases need a rule or input that this release does not have.
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
        {cases.map(({ code, detail }, index) => (
          <li key={`${code}-${index}`}>{detail}</li>
        ))}
      </ul>
    </section>
  );
}

function SummaryCard({
  label,
  value,
}: Readonly<{ label: string; value: string | number }>) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle>{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function TaxSummary({
  estimate,
  estimateLabel,
  totalPence,
}: Readonly<{
  estimate: HouseholdTaxEstimate;
  estimateLabel: string;
  totalPence: number | null;
}>) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <SummaryCard
        label="Tax year"
        value={estimate.taxYear.replace("-", "/")}
      />
      <SummaryCard
        label={estimateLabel}
        value={
          totalPence == null ? "Unavailable" : formatMinorCurrency(totalPence)
        }
      />
      <SummaryCard
        label="Imported records"
        value={estimate.lineage.observedRecordIds.length}
      />
    </div>
  );
}

function TaxComponentGrid({
  person,
  showExplanations,
}: Readonly<{
  person: PersonTaxEstimate;
  showExplanations: boolean;
}>) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {Object.entries(componentLabels).map(([key, label]) => {
        const component = person[key as keyof typeof componentLabels];
        return (
          <div key={key} className="rounded-lg border p-4">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">
              {person.available
                ? formatMinorCurrency(component.amountPence)
                : "Unavailable"}
            </dd>
            {showExplanations && (
              <dd className="mt-2 text-xs text-muted-foreground">
                {component.explanation}
              </dd>
            )}
          </div>
        );
      })}
    </dl>
  );
}

function allowanceItems(person: PersonTaxEstimate) {
  const { allowances } = person;
  return [
    ["Personal Allowance used", allowances.personalAllowancePence],
    ["Starting-rate savings used", allowances.startingRateForSavingsPence],
    ["Personal Savings Allowance", allowances.personalSavingsAllowancePence],
    ["Dividend Allowance", allowances.dividendAllowancePence],
    ["Capital gains exemption", allowances.capitalGainsAnnualExemptAmountPence],
    [
      "ISA subscriptions",
      `${formatMinorCurrency(allowances.isaContributionsPence)} of ${formatMinorCurrency(allowances.isaAllowancePence)}`,
    ],
    [
      "Pension input amount",
      `${formatMinorCurrency(allowances.pensionContributionsPence)} of ${formatMinorCurrency(allowances.pensionAllowancePence)}`,
    ],
    [
      "Tax-free wrapper records excluded",
      person.excludedWrapperRecordIds.length,
    ],
  ] as const;
}

function AllowanceSummary({ person }: Readonly<{ person: PersonTaxEstimate }>) {
  return (
    <div>
      <h3 className="font-semibold">Allowances and wrappers</h3>
      <dl className="mt-3 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
        {allowanceItems(person).map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 border-b pb-2">
            <dt>{label}</dt>
            <dd className="tabular-nums">
              {typeof value === "number" &&
              label !== "Tax-free wrapper records excluded"
                ? formatMinorCurrency(value)
                : value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function PersonTaxCard({
  person,
  showExplanations,
}: Readonly<{
  person: PersonTaxEstimate;
  showExplanations: boolean;
}>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{person.displayName}</CardTitle>
        <CardDescription>
          {person.totalTaxPence == null
            ? "Estimate blocked by unsupported inputs"
            : `${formatMinorCurrency(person.totalTaxPence)} estimated tax and employee NI`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <TaxComponentGrid person={person} showExplanations={showExplanations} />
        <TaxBandConsumptionChart
          displayName={person.displayName}
          observed={person.bandConsumption.observed}
          projected={person.bandConsumption.projected}
          showExplanations={showExplanations}
        />
        <AnnualAllowanceUsageChart
          allowances={person.allowances}
          showExplanations={showExplanations}
        />
        <AllowanceSummary person={person} />
      </CardContent>
    </Card>
  );
}

function CalculationLineage({
  estimate,
}: Readonly<{ estimate: HouseholdTaxEstimate }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Calculation lineage</CardTitle>
        <CardDescription>
          Rule data {estimate.lineage.ruleDatasetVersion}, calculation version{" "}
          {estimate.calculationVersion}. {estimate.lineage.rounding}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm">
          Rules: {estimate.lineage.ruleIds.join(", ") || "none resolved"}
        </p>
        <ul className="mt-3 space-y-2 text-sm">
          {estimate.lineage.sources.map(({ id, title, url }) => (
            <li key={id}>
              <a
                href={url}
                className="text-primary underline underline-offset-4"
                target="_blank"
                rel="noreferrer"
              >
                {title}
              </a>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function TaxPositionHeader({
  onExport,
  onToggleExplanations,
  showExplanations,
}: Readonly<{
  onExport: () => void;
  onToggleExplanations: () => void;
  showExplanations: boolean;
}>) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="mb-2 text-3xl font-bold sm:text-4xl">UK tax position</h1>
        <p className="max-w-3xl text-lg text-muted-foreground">
          An annual estimate from the tax records saved in this browser. It is
          not a tax return or professional advice.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          aria-pressed={showExplanations}
          onClick={onToggleExplanations}
        >
          {showExplanations ? "Hide explanations" : "Show explanations"}
        </Button>
        <Button type="button" variant="outline" onClick={onExport}>
          <DownloadIcon aria-hidden="true" />
          Export calculation
        </Button>
      </div>
    </div>
  );
}

export function TaxPositionRoute() {
  const { exportTaxEstimate, household, taxEstimate } = useAssetTracker();
  const [showExplanations, setShowExplanations] = useState(false);
  const activeScope = household.activeScope;
  const visiblePeople =
    activeScope.kind === "member"
      ? taxEstimate.people.filter(
          ({ memberId }) => memberId === activeScope.memberId,
        )
      : taxEstimate.people;
  const scopedTotalPence =
    activeScope.kind === "member"
      ? (visiblePeople[0]?.totalTaxPence ?? null)
      : taxEstimate.totalTaxPence;
  const scopedUnsupported =
    activeScope.kind === "member"
      ? visiblePeople.flatMap(({ unsupported }) => unsupported)
      : taxEstimate.unsupported;
  const scopedAvailable =
    activeScope.kind === "member"
      ? visiblePeople.length > 0 &&
        visiblePeople.every(({ available }) => available)
      : taxEstimate.available;
  const scopedEstimateLabel =
    activeScope.kind === "member"
      ? `${visiblePeople[0]?.displayName ?? "Member"} projected estimate`
      : "Projected household estimate";

  return (
    <div className="space-y-8">
      <TaxPositionHeader
        onExport={exportTaxEstimate}
        onToggleExplanations={() => setShowExplanations((current) => !current)}
        showExplanations={showExplanations}
      />
      {!scopedAvailable && <UnsupportedNotice cases={scopedUnsupported} />}
      <TaxSetupForm />
      <TaxSummary
        estimate={taxEstimate}
        estimateLabel={scopedEstimateLabel}
        totalPence={scopedTotalPence}
      />
      <div className="space-y-6">
        {visiblePeople.map((person) => (
          <PersonTaxCard
            key={person.memberId}
            person={person}
            showExplanations={showExplanations}
          />
        ))}
      </div>
      <CalculationLineage estimate={taxEstimate} />
    </div>
  );
}
