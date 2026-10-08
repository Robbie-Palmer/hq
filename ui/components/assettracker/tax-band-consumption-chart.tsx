import type {
  PersonTaxEstimate,
  TaxBandConsumption,
  TaxBandScenario,
} from "finance-tax-rules/household-tax";
import { formatMinorCurrency } from "@/lib/generic/money";

const categories = [
  {
    key: "employmentPence",
    label: "Employment",
    color: "var(--chart-1)",
  },
  {
    key: "savingsPence",
    label: "Savings interest",
    color: "var(--chart-2)",
  },
  {
    key: "dividendsPence",
    label: "Dividends",
    color: "var(--chart-4)",
  },
  {
    key: "capitalGainsPence",
    label: "Capital gains",
    color: "var(--chart-5)",
  },
] as const;

function rateLabel(rateBasisPoints: number): string {
  return `${rateBasisPoints / 100}% employment rate`;
}

function BandBar({
  band,
  rateText = rateLabel(band.rateBasisPoints),
}: Readonly<{ band: TaxBandConsumption; rateText?: string }>) {
  const capacity = band.widthPence ?? band.usedPence;
  const denominator = Math.max(1, capacity);
  const usageLabel =
    band.widthPence == null
      ? `${formatMinorCurrency(band.usedPence)} used, no upper limit`
      : `${formatMinorCurrency(band.usedPence)} of ${formatMinorCurrency(band.widthPence)} used`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div>
          <span className="text-sm font-medium">{band.label}</span>{" "}
          <span className="text-xs text-muted-foreground">{rateText}</span>
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">
          {usageLabel}
        </span>
      </div>
      <div
        className="flex h-4 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${band.label}: ${usageLabel}`}
      >
        {categories.map(({ color, key, label }) => {
          const amount = band[key];
          if (amount <= 0) return null;
          return (
            <span
              key={key}
              title={`${label}: ${formatMinorCurrency(amount)}`}
              className="h-full min-w-px"
              style={{
                backgroundColor: color,
                width: `${Math.min(100, (amount / denominator) * 100)}%`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function ScenarioPlot({
  description,
  scenario,
  showExplanations,
  title,
}: Readonly<{
  description: string;
  scenario: TaxBandScenario;
  showExplanations: boolean;
  title: string;
}>) {
  return (
    <section className="rounded-lg border p-4" aria-label={title}>
      <h4 className="font-semibold">{title}</h4>
      {showExplanations && (
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      )}
      <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <div>
          <dt className="text-muted-foreground">Personal Allowance</dt>
          <dd className="mt-0.5 font-medium tabular-nums">
            {formatMinorCurrency(scenario.personalAllowancePence)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Taxable income</dt>
          <dd className="mt-0.5 font-medium tabular-nums">
            {formatMinorCurrency(scenario.taxableIncomePence)}
          </dd>
        </div>
      </dl>
      <div className="mt-4 space-y-4">
        <BandBar
          rateText="0% allowance"
          band={{
            id: "personal-allowance",
            label: "Personal Allowance",
            rateBasisPoints: 0,
            widthPence: scenario.personalAllowancePence,
            usedPence: scenario.personalAllowanceUsedPence,
            ...scenario.personalAllowanceByIncome,
            capitalGainsPence: 0,
          }}
        />
        {scenario.bands.map((band) => (
          <BandBar key={band.id} band={band} />
        ))}
      </div>
    </section>
  );
}

function AnnualAllowanceBar({
  allowancePence,
  label,
  observedPence,
  projectedPence,
}: Readonly<{
  allowancePence: number;
  label: string;
  observedPence: number;
  projectedPence: number;
}>) {
  const denominator = Math.max(1, allowancePence);
  const forecastPence = Math.max(0, projectedPence - observedPence);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {formatMinorCurrency(projectedPence)} of{" "}
          {formatMinorCurrency(allowancePence)} used
        </span>
      </div>
      <div
        className="flex h-4 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${label}: ${formatMinorCurrency(observedPence)} recorded and ${formatMinorCurrency(forecastPence)} forecast of ${formatMinorCurrency(allowancePence)}`}
      >
        {observedPence > 0 && (
          <span
            title={`Recorded: ${formatMinorCurrency(observedPence)}`}
            className="h-full min-w-px"
            style={{
              backgroundColor: "var(--chart-1)",
              width: `${Math.min(100, (observedPence / denominator) * 100)}%`,
            }}
          />
        )}
        {forecastPence > 0 && (
          <span
            title={`Forecast: ${formatMinorCurrency(forecastPence)}`}
            className="h-full min-w-px"
            style={{
              backgroundColor: "var(--chart-4)",
              width: `${Math.min(
                Math.max(0, 100 - (observedPence / denominator) * 100),
                (forecastPence / denominator) * 100,
              )}%`,
            }}
          />
        )}
      </div>
    </div>
  );
}

function AnnualAllowanceLegend() {
  return (
    <div className="flex gap-4 text-xs text-muted-foreground">
      {[
        ["Recorded", "var(--chart-1)"],
        ["Forecast", "var(--chart-4)"],
      ].map(([label, color]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2 rounded-sm"
            style={{ backgroundColor: color }}
          />
          <span>{label}</span>
        </span>
      ))}
    </div>
  );
}

export function AnnualAllowanceUsageChart({
  allowances,
  showExplanations,
}: Readonly<{
  allowances: PersonTaxEstimate["allowances"];
  showExplanations: boolean;
}>) {
  return (
    <section aria-label="Annual allowance usage">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="font-semibold">Annual allowance usage</h3>
          {showExplanations && (
            <p className="mt-1 text-sm text-muted-foreground">
              Recorded contributions and forecast additions share each bar.
            </p>
          )}
        </div>
        <AnnualAllowanceLegend />
      </div>
      <div className="mt-4 space-y-4 rounded-lg border p-4">
        <AnnualAllowanceBar
          label="Pension annual allowance"
          allowancePence={allowances.pensionAllowancePence}
          observedPence={allowances.pensionObservedContributionsPence}
          projectedPence={allowances.pensionContributionsPence}
        />
        <AnnualAllowanceBar
          label="ISA annual allowance"
          allowancePence={allowances.isaAllowancePence}
          observedPence={allowances.isaObservedContributionsPence}
          projectedPence={allowances.isaContributionsPence}
        />
      </div>
      {showExplanations && (
        <p className="mt-2 text-xs text-muted-foreground">
          The pension limit includes tapering and the money purchase annual
          allowance where they apply. It does not include carry forward or the
          earnings limit for tax relief.
        </p>
      )}
    </section>
  );
}

function TaxBandHeader() {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="font-semibold">Tax bands consumed</h3>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
        {categories.map(({ color, key, label }) => (
          <span key={key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2 rounded-sm"
              style={{ backgroundColor: color }}
            />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function ForecastIncrease({
  gainPence,
  incomePence,
}: Readonly<{ gainPence: number; incomePence: number }>) {
  if (incomePence <= 0 && gainPence <= 0) return null;
  return (
    <p className="mt-3 text-sm text-muted-foreground">
      The forecast adds{" "}
      <span className="font-medium text-foreground tabular-nums">
        {formatMinorCurrency(incomePence)}
      </span>{" "}
      of taxable income
      {gainPence > 0
        ? ` and ${formatMinorCurrency(gainPence)} of taxable gains`
        : ""}
      .
    </p>
  );
}

export function TaxBandConsumptionChart({
  displayName,
  observed,
  projected,
  showExplanations,
}: Readonly<{
  displayName: string;
  observed: TaxBandScenario;
  projected: TaxBandScenario;
  showExplanations: boolean;
}>) {
  const projectedIncomeIncrease = Math.max(
    0,
    projected.taxableIncomePence - observed.taxableIncomePence,
  );
  const projectedGainIncrease = Math.max(
    0,
    projected.taxableGainPence - observed.taxableGainPence,
  );

  return (
    <section aria-label={`${displayName} tax-band consumption`}>
      <TaxBandHeader />
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <ScenarioPlot
          title="Recorded to date"
          description="Uses observed income and disposal records only."
          scenario={observed}
          showExplanations={showExplanations}
        />
        <ScenarioPlot
          title="Year-end projection"
          description="Adds income and disposals saved as forecast assumptions."
          scenario={projected}
          showExplanations={showExplanations}
        />
      </div>
      {showExplanations && (
        <ForecastIncrease
          gainPence={projectedGainIncrease}
          incomePence={projectedIncomeIncrease}
        />
      )}
    </section>
  );
}
