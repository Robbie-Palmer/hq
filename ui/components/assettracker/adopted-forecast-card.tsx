"use client";

import { type SubmitEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/assettracker";
import type {
  AdoptedDecisionForecastRecord,
  AdoptedForecastVarianceSource,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";

function SourceSnapshot({
  forecast,
}: Readonly<{ forecast: AdoptedDecisionForecastRecord }>) {
  const incomeAssumptions = forecast.assumptionSets.reduce(
    (count, set) => count + set.incomeAssumptionIds.length,
    0,
  );
  const expenditureAssumptions = forecast.assumptionSets.reduce(
    (count, set) => count + set.expenditureAssumptionIds.length,
    0,
  );
  return (
    <details className="rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Frozen forecast sources
      </summary>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Planning cases</dt>
          <dd>
            {forecast.planningCases.map(({ name }) => name).join(", ") ||
              "No named case"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Baseline</dt>
          <dd>
            {forecast.sourceBalances.length} balances and{" "}
            {forecast.commitments.length} commitments
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            Cash-flow assumptions
          </dt>
          <dd>
            {incomeAssumptions} income and {expenditureAssumptions} expenditure
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Reserve preference</dt>
          <dd>
            {forecast.reservePreference.coverageMonths == null
              ? "No warning threshold"
              : `${forecast.reservePreference.coverageMonths} months`}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Rates</dt>
          <dd>{forecast.rates.length} account rate inputs</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Calculation</dt>
          <dd>{forecast.calculationVersion}</dd>
        </div>
      </dl>
    </details>
  );
}

function ActionTimeline({
  forecast,
}: Readonly<{ forecast: AdoptedDecisionForecastRecord }>) {
  return (
    <section>
      <h3 className="text-sm font-semibold">Live actions</h3>
      <ul className="mt-2 divide-y rounded-md border text-sm">
        {forecast.actions.map((action) => (
          <li
            key={action.id}
            className="flex flex-wrap items-center justify-between gap-2 p-3"
          >
            <span>
              {action.date} · {action.kind} · {action.name}
              {action.cadence === "monthly" ? " · monthly" : ""}
            </span>
            <span className="font-mono">
              {formatCurrency(Math.round(action.amount), action.currency)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const varianceLabels: Record<AdoptedForecastVarianceSource["kind"], string> = {
  "changed-amount": "Changed amount",
  "changed-timing": "Changed timing",
  "household-cash-flow": "Household cash flow",
  "market-or-currency": "Market or currency movement",
  "revised-assumption": "Revised assumption",
};

function Reconciliation({
  forecast,
}: Readonly<{ forecast: AdoptedDecisionForecastRecord }>) {
  const { reconcileAdoptedForecast } = useAssetTracker();
  const reconciliation = reconcileAdoptedForecast(forecast);
  const observedActions = reconciliation.actions.filter(
    ({ actualAmount }) => actualAmount != null,
  );
  const observedBalances = reconciliation.balances.filter(
    ({ observedBalance }) => observedBalance != null,
  );
  return (
    <section>
      <h3 className="text-sm font-semibold">Forecast and actuals</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        {observedActions.length} cash-flow actions and {observedBalances.length}{" "}
        balance observations now reconcile with the frozen forecast.
      </p>
      {reconciliation.varianceSources.length === 0 ? (
        <p className="mt-2 rounded-md bg-muted/40 p-3 text-sm">
          No material variance has been observed yet.
        </p>
      ) : (
        <ul className="mt-2 space-y-2 text-sm">
          {reconciliation.varianceSources.map((source, index) => (
            <li
              key={`${source.kind}-${source.label}-${index}`}
              className="rounded-md bg-muted/40 p-3"
            >
              <span className="font-medium">{varianceLabels[source.kind]}</span>
              {`: ${source.label}`}
              {source.amount == null
                ? ""
                : ` (${formatCurrency(Math.round(source.amount), forecast.balanceCheckpoints[0]?.accounts[0]?.currency ?? "GBP")})`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RevisitDecision({
  forecastId,
  decisionId,
  decisionName,
}: Readonly<{
  forecastId: string;
  decisionId: string;
  decisionName: string;
}>) {
  const { revisitAdoptedDecision } = useAssetTracker();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await revisitAdoptedDecision({ forecastId, decisionId, reason });
      setReason("");
    } catch {
      setError("This decision could not be reopened.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="grid gap-2 rounded-md border p-3" onSubmit={submit}>
      <label
        className="text-sm font-medium"
        htmlFor={`${forecastId}-${decisionId}`}
      >
        {decisionName}
      </label>
      <Input
        id={`${forecastId}-${decisionId}`}
        required
        placeholder="What changed?"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      {error != null && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button className="justify-self-start" disabled={saving} size="sm">
        {saving ? "Reopening…" : "Revisit this decision"}
      </Button>
    </form>
  );
}

function Decisions({
  forecast,
}: Readonly<{ forecast: AdoptedDecisionForecastRecord }>) {
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <div>
        <h3 className="text-sm font-semibold">Adopted choices</h3>
        <div className="mt-2 space-y-2">
          {forecast.selectedDecisions.map((decision) => (
            <RevisitDecision
              key={decision.id}
              decisionId={decision.id}
              decisionName={decision.name}
              forecastId={forecast.id}
            />
          ))}
        </div>
      </div>
      <div>
        <h3 className="text-sm font-semibold">Still undecided</h3>
        {forecast.undecidedDecisions.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">None</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {forecast.undecidedDecisions.map((decision) => (
              <li key={decision.id} className="rounded-md border p-3">
                {decision.name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function AdoptedForecastCard({
  forecast,
}: Readonly<{ forecast: AdoptedDecisionForecastRecord }>) {
  return (
    <article className="space-y-4 rounded-lg border p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">{forecast.title}</h2>
          <p className="text-xs text-muted-foreground">
            Adopted {forecast.adoptedAt}
          </p>
        </div>
        <span className="rounded-full bg-muted px-2 py-1 text-xs">
          Live forecast
        </span>
      </div>
      <SourceSnapshot forecast={forecast} />
      <ActionTimeline forecast={forecast} />
      <Reconciliation forecast={forecast} />
      <Decisions forecast={forecast} />
    </article>
  );
}
