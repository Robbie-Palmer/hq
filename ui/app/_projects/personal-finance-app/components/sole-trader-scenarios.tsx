"use client";

import {
  CalendarClockIcon,
  CirclePoundSterlingIcon,
  ReceiptTextIcon,
  ShieldCheckIcon,
  WalletCardsIcon,
} from "lucide-react";
import { useState } from "react";
import { formatMinorCurrency } from "ts-base/money";
import {
  evaluateHouseholdSoleTraderScenario,
  type HouseholdSoleTraderScenarioView,
} from "@/app/_projects/personal-finance-app/domain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAssetTracker } from "./asset-tracker-provider";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function formatDate(value: string): string {
  return dateFormatter.format(new Date(`${value}T00:00:00Z`));
}

function sentenceCase(value: string): string {
  const normalized = value.replaceAll("-", " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function ScenarioMetric({
  label,
  value,
}: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-lg border bg-background p-4">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function ScenarioSelector({
  activeId,
  onSelect,
  scenarios,
}: Readonly<{
  activeId: string;
  onSelect: (id: string) => void;
  scenarios: HouseholdSoleTraderScenarioView[];
}>) {
  const { household } = useAssetTracker(({ household }) => ({ household }));
  return (
    <fieldset className="grid gap-3 lg:grid-cols-3">
      <legend className="sr-only">Sole-trader demo cases</legend>
      {scenarios.map((scenario) => {
        const active = scenario.id === activeId;
        const member = household.members.find(
          ({ id }) => id === scenario.memberId,
        );
        return (
          <Button
            key={scenario.id}
            aria-label={`${member?.displayName ?? scenario.memberId}: ${scenario.name}`}
            aria-controls="sole-trader-scenario-panel"
            aria-pressed={active}
            className="h-auto min-h-20 items-start justify-start gap-3 whitespace-normal p-4 text-left"
            id={`sole-trader-scenario-${scenario.id}`}
            variant={active ? "default" : "outline"}
            onClick={() => onSelect(scenario.id)}
          >
            <span className="min-w-0">
              <span className="block text-xs opacity-75">
                {member?.displayName ?? scenario.memberId}
              </span>
              <span className="mt-1 block font-semibold">{scenario.name}</span>
            </span>
          </Button>
        );
      })}
    </fieldset>
  );
}

function ReservePosition({
  scenario,
}: Readonly<{ scenario: HouseholdSoleTraderScenarioView }>) {
  const { reserve } = scenario.result;
  const covered =
    reserve.firstDeadlineCashNeedPence === 0
      ? 100
      : Math.min(
          100,
          Math.round(
            (reserve.currentReservePence / reserve.firstDeadlineCashNeedPence) *
              100,
          ),
        );
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheckIcon aria-hidden="true" className="size-5" />
            <h3 className="font-semibold">Tax reserve</h3>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Cash needed for the first filing deadline, including the first
            payment on account.
          </p>
        </div>
        <Badge
          variant={
            reserve.firstDeadlineReserveGapPence > 0 ? "outline" : "secondary"
          }
        >
          {covered}% funded
        </Badge>
      </div>
      <dl className="mt-5 grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">First deadline need</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">
            {formatMinorCurrency(reserve.firstDeadlineCashNeedPence)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Already reserved</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">
            {formatMinorCurrency(reserve.currentReservePence)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Reserve gap</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">
            {formatMinorCurrency(reserve.firstDeadlineReserveGapPence)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function CashPosition({
  scenario,
}: Readonly<{ scenario: HouseholdSoleTraderScenarioView }>) {
  const { totals } = scenario.result.cashFlow;
  const rows = [
    ["Cash received", totals.cashReceivedPence],
    ["Unpaid invoices", totals.unpaidInvoicesPence],
    ["Costs paid", totals.costsPaidPence],
    ["Personal withdrawals", totals.personalWithdrawalsPence],
    ["Available business cash", totals.availableCashPence],
  ] as const;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <WalletCardsIcon aria-hidden="true" className="size-5" />
          <CardTitle>Cash is not profit</CardTitle>
        </div>
        <CardDescription>
          Invoices, payments, withdrawals and the reserve stay separate.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="space-y-3 text-sm">
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="flex items-center justify-between gap-4 border-b pb-3 last:border-0 last:pb-0"
            >
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium tabular-nums">
                {formatMinorCurrency(value)}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function Obligations({
  scenario,
}: Readonly<{ scenario: HouseholdSoleTraderScenarioView }>) {
  const { obligations } = scenario.result;
  const rows = [
    {
      label: "Self Assessment registration",
      status: obligations.selfAssessmentRegistration.status,
      detail:
        obligations.selfAssessmentRegistration.dueOn == null
          ? "No registration deadline"
          : `Register by ${formatDate(obligations.selfAssessmentRegistration.dueOn)}`,
    },
    {
      label: "VAT registration",
      status: obligations.vatRegistration.status,
      detail:
        obligations.vatRegistration.status === "optional"
          ? "Voluntary registration remains available"
          : "Based on rolling taxable turnover",
    },
    {
      label: "Making Tax Digital",
      status: obligations.makingTaxDigital.status,
      detail: "Uses the released qualifying-income rule",
    },
  ];
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ReceiptTextIcon aria-hidden="true" className="size-5" />
          <CardTitle>Registration and reporting</CardTitle>
        </div>
        <CardDescription>
          Obligations are evaluated separately from the annual tax bill.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.map(({ detail, label, status }) => (
          <div key={label} className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium">{label}</p>
              <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
            </div>
            <Badge variant="outline">{sentenceCase(status)}</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function PaymentSchedule({
  scenario,
}: Readonly<{ scenario: HouseholdSoleTraderScenarioView }>) {
  const schedule = scenario.result.obligations.paymentsOnAccount.schedule;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CalendarClockIcon aria-hidden="true" className="size-5" />
          <CardTitle>Payment timing</CardTitle>
        </div>
        <CardDescription>
          Annual liability and cash deadlines are shown separately.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {schedule.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No Self Assessment payments are generated for this case.
          </p>
        ) : (
          <ol className="space-y-3">
            {schedule.map((payment) => (
              <li
                key={`${payment.kind}-${payment.dueOn}`}
                className="flex items-start justify-between gap-4 border-b pb-3 last:border-0 last:pb-0"
              >
                <div>
                  <p className="text-sm font-medium">
                    {sentenceCase(payment.kind)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Due {formatDate(payment.dueOn)}
                    {payment.creditsNextTaxYear
                      ? " · credits the next tax year"
                      : ""}
                  </p>
                </div>
                <span className="font-medium tabular-nums">
                  {formatMinorCurrency(payment.amountPence)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function ScenarioSummaryHeader({
  scenario,
}: Readonly<{ scenario: HouseholdSoleTraderScenarioView }>) {
  const { household } = useAssetTracker(({ household }) => ({ household }));
  const member = household.members.find(({ id }) => id === scenario.memberId);
  const { result } = scenario;
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xl font-semibold">{scenario.name}</h3>
            <Badge variant="secondary">
              {member?.displayName ?? scenario.memberId}
            </Badge>
            <Badge variant="outline">{result.taxYear.replace("-", "/")}</Badge>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            {scenario.description}
          </p>
        </div>
        <Badge variant={result.available ? "secondary" : "destructive"}>
          {result.available ? "Calculated" : "Needs review"}
        </Badge>
      </div>

      {result.issues.length > 0 && (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-destructive">
          {result.issues.map((issue) => (
            <li key={`${issue.code}-${issue.detail}`}>{issue.detail}</li>
          ))}
        </ul>
      )}
    </>
  );
}

function ScenarioHeadlineMetrics({
  scenario,
}: Readonly<{ scenario: HouseholdSoleTraderScenarioView }>) {
  const { result } = scenario;
  return (
    <>
      <dl className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ScenarioMetric
          label="Gross sales"
          value={formatMinorCurrency(result.profit.grossRevenuePence)}
        />
        <ScenarioMetric
          label="Taxable profit"
          value={formatMinorCurrency(result.profit.taxableProfitPence)}
        />
        <ScenarioMetric
          label="Extra tax and loans"
          value={
            result.household.incrementalTaxAndLoanPence == null
              ? "Unavailable"
              : formatMinorCurrency(result.household.incrementalTaxAndLoanPence)
          }
        />
        <ScenarioMetric
          label="Net household benefit"
          value={
            result.household.netBenefitPence == null
              ? "Unavailable"
              : formatMinorCurrency(result.household.netBenefitPence)
          }
        />
      </dl>
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
        <span>Deduction: {sentenceCase(result.profit.deductionMethod)}</span>
        <span>Ruleset: {result.rulesetVersion}</span>
        <span>Calculation: v{result.calculationVersion}</span>
      </div>
    </>
  );
}

function ScenarioSummary({
  scenario,
}: Readonly<{ scenario: HouseholdSoleTraderScenarioView }>) {
  return (
    <div className="rounded-xl border bg-muted/30 p-5 sm:p-6">
      <ScenarioSummaryHeader scenario={scenario} />
      <ScenarioHeadlineMetrics scenario={scenario} />
    </div>
  );
}

function ScenarioPanel({
  scenario,
}: Readonly<{ scenario: HouseholdSoleTraderScenarioView }>) {
  return (
    <section
      aria-label={`${scenario.name} scenario details`}
      className="space-y-5"
      id="sole-trader-scenario-panel"
    >
      <ScenarioSummary scenario={scenario} />

      <ReservePosition scenario={scenario} />

      <div className="grid gap-5 xl:grid-cols-3">
        <CashPosition scenario={scenario} />
        <Obligations scenario={scenario} />
        <PaymentSchedule scenario={scenario} />
      </div>
    </section>
  );
}

export function SoleTraderScenarios() {
  const { household, soleTraderScenarios = [] } = useAssetTracker(
    ({ household, soleTraderScenarios }) => ({
      household,
      soleTraderScenarios,
    }),
  );
  const visibleScenarios = soleTraderScenarios
    .filter(
      ({ memberId }) =>
        household.activeScope.kind === "household" ||
        memberId === household.activeScope.memberId,
    )
    .map(evaluateHouseholdSoleTraderScenario);
  const [activeId, setActiveId] = useState(() => visibleScenarios[0]?.id ?? "");
  const selected =
    visibleScenarios.find(({ id }) => id === activeId) ?? visibleScenarios[0];
  if (selected == null) return null;

  return (
    <section
      aria-labelledby="sole-trader-scenarios-title"
      className="space-y-5"
    >
      <div className="flex items-start gap-3">
        <CirclePoundSterlingIcon
          aria-hidden="true"
          className="mt-1 size-6 shrink-0"
        />
        <div>
          <h2
            id="sole-trader-scenarios-title"
            className="text-2xl font-semibold"
          >
            Sole-trader side income
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Compare fictional household cases using released UK rules. Profit,
            cash, reserves and payment dates remain distinct.
          </p>
        </div>
      </div>
      <ScenarioSelector
        activeId={selected.id}
        scenarios={visibleScenarios}
        onSelect={setActiveId}
      />
      <ScenarioPanel scenario={selected} />
    </section>
  );
}
