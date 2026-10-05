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
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
        label="Observed source records"
        value={estimate.lineage.observedRecordIds.length}
      />
      <SummaryCard
        label="User assumptions"
        value={estimate.lineage.assumptionRecordIds.length}
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
