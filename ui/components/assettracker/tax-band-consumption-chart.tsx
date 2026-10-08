import type {
  PersonTaxEstimate,
  TaxBandConsumption,
  TaxBandScenario,
} from "finance-tax-rules/household-tax";
import { Fragment } from "react";
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

function AllowanceTaper({
  taper,
}: Readonly<{ taper: TaxBandScenario["allowanceTaper"] }>) {
  if (taper == null) return null;
  const width = taper.endsAtPence - taper.startsAtPence;
  const beforeStart = Math.max(
    taper.startsAtPence - taper.adjustedNetIncomePence,
    0,
  );
  const pastEnd = taper.adjustedNetIncomePence >= taper.endsAtPence;
  const status =
    beforeStart > 0
      ? `${formatMinorCurrency(beforeStart)} below the start`
      : pastEnd
        ? "Personal Allowance fully withdrawn"
        : `${formatMinorCurrency(taper.usedPence)} into the range`;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div>
          <span className="text-sm font-medium">Personal Allowance taper</span>{" "}
          <span className="text-xs text-muted-foreground">
            effective {taper.effectiveMarginalRateBasisPoints / 100}% Income Tax
          </span>
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">
          {status}
        </span>
      </div>
      <div
        className="h-4 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`Personal Allowance taper from ${formatMinorCurrency(taper.startsAtPence)} to ${formatMinorCurrency(taper.endsAtPence)}: ${formatMinorCurrency(taper.usedPence)} of ${formatMinorCurrency(width)} used`}
      >
        <div
          className="h-full bg-amber-500"
          style={{
            width: `${Math.min(100, (taper.usedPence / width) * 100)}%`,
          }}
        />
      </div>
    </div>
  );
}

function capBandAtTaper(
  band: TaxBandConsumption,
  scenario: TaxBandScenario,
  bandIndex: number,
): TaxBandConsumption {
  const taper = scenario.allowanceTaper;
  if (taper == null) return band;
  const priorWidth = scenario.bands
    .slice(0, bandIndex)
    .reduce((total, item) => total + (item.widthPence ?? 0), 0);
  const widthPence = Math.max(
    0,
    taper.startsAtPence - taper.standardPersonalAllowancePence - priorWidth,
  );
  let remaining = widthPence;
  const cappedAmounts = Object.fromEntries(
    categories.map(({ key }) => {
      const amount = Math.min(band[key], remaining);
      remaining -= amount;
      return [key, amount];
    }),
  ) as Pick<
    TaxBandConsumption,
    "employmentPence" | "savingsPence" | "dividendsPence" | "capitalGainsPence"
  >;
  return {
    ...band,
    ...cappedAmounts,
    label: `${band.label} before taper`,
    widthPence,
    usedPence: Math.min(band.usedPence, widthPence),
  };
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
      <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Adjusted net income</dt>
          <dd className="mt-0.5 font-medium tabular-nums">
            {formatMinorCurrency(
              scenario.allowanceTaper?.adjustedNetIncomePence ??
                scenario.taxableIncomePence,
            )}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Personal Allowance</dt>
          <dd className="mt-0.5 font-medium tabular-nums">
            {formatMinorCurrency(scenario.personalAllowancePence)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">After Personal Allowance</dt>
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
        {scenario.bands.map((band, index) => {
          const taperBandIndex = scenario.bands.length - 2;
          if (index !== taperBandIndex || scenario.allowanceTaper == null) {
            return <BandBar key={band.id} band={band} />;
          }
          return (
            <Fragment key={band.id}>
              <BandBar band={capBandAtTaper(band, scenario, taperBandIndex)} />
              <AllowanceTaper taper={scenario.allowanceTaper} />
            </Fragment>
          );
        })}
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
        aria-label={`${label}: ${formatMinorCurrency(observedPence)} to date and ${formatMinorCurrency(forecastPence)} forecast of ${formatMinorCurrency(allowancePence)}`}
      >
        {observedPence > 0 && (
          <span
            title={`To date: ${formatMinorCurrency(observedPence)}`}
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
        ["To date", "var(--chart-1)"],
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
              To-date contributions and forecast additions share each bar.
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
          title="To date"
          description="Uses imported records and estimates from recurring flows."
          scenario={observed}
          showExplanations={showExplanations}
        />
        <ScenarioPlot
          title="Year-end projection to 5 April"
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
