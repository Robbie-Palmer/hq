"use client";

import { HOUSING_CURRENCY } from "finance-housing-indices/browser";
import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import type {
  PropertyValueHistoryView,
  SetPropertyValueSelectionInput,
} from "@/app/_projects/personal-finance-app/domain";
import {
  formatAccountCurrency,
  formatAxisTick,
} from "@/app/_projects/personal-finance-app/lib";
import { Badge } from "@/components/ui/badge";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { HousingValueDisclosure } from "./housing-value-disclosure";

type SavePropertyValue = (
  anchorValuationId: string,
  valueSelection: PropertyValueHistoryView["selection"],
) => Promise<void>;

function AutomaticEstimateToggle({
  automatic,
  disabled,
  onChange,
}: Readonly<{
  automatic: boolean;
  disabled: boolean;
  onChange: (automatic: boolean) => void;
}>) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <input
        type="checkbox"
        checked={automatic}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>Automatic estimate</span>
    </label>
  );
}

function RecordedValueSelect({
  ariaLabel,
  disabled,
  label,
  onChange,
  value,
  values,
}: Readonly<{
  ariaLabel: string;
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  value: string;
  values: PropertyValueHistoryView["recordedValues"];
}>) {
  return (
    <label className="space-y-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <select
        aria-label={ariaLabel}
        className="min-h-11 w-full rounded-md border bg-background px-3 text-foreground"
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {values.map((recordedValue) => (
          <option key={recordedValue.id} value={recordedValue.id}>
            {recordedValue.asOf} ·{" "}
            {formatAccountCurrency(
              recordedValue.amount,
              recordedValue.currency,
            )}
          </option>
        ))}
      </select>
    </label>
  );
}

function PropertyValueControlFields({
  error,
  save,
  saving,
  view,
}: Readonly<{
  error: string | null;
  save: SavePropertyValue;
  saving: boolean;
  view: PropertyValueHistoryView;
}>) {
  return (
    <section
      className="rounded-lg border p-3"
      aria-label="Property value choice"
    >
      <PropertyValueControlHeader save={save} saving={saving} view={view} />
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <RecordedValueSelect
          ariaLabel="Property estimate anchor"
          disabled={saving}
          label="Estimate anchor"
          onChange={(value) => void save(value, view.selection)}
          value={view.anchorValuationId}
          values={view.recordedValues}
        />
        <RecordedValueSelect
          ariaLabel="Recorded property value"
          disabled={saving || view.selection.mode === "automatic-index"}
          label="Recorded value when automatic estimates are off"
          onChange={(valuationId) =>
            void save(view.anchorValuationId, {
              mode: "recorded-value",
              valuationId,
            })
          }
          value={
            view.selection.mode === "recorded-value"
              ? view.selection.valuationId
              : view.anchorValuationId
          }
          values={view.recordedValues}
        />
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </section>
  );
}

function PropertyValueControlHeader({
  save,
  saving,
  view,
}: Readonly<{
  save: SavePropertyValue;
  saving: boolean;
  view: PropertyValueHistoryView;
}>) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <h3 className="text-sm font-medium">Value used in net worth</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {view.selectionExplanation}
        </p>
      </div>
      <AutomaticEstimateToggle
        automatic={view.selection.mode === "automatic-index"}
        disabled={saving}
        onChange={(automatic) =>
          void save(
            view.anchorValuationId,
            automatic
              ? { mode: "automatic-index" }
              : {
                  mode: "recorded-value",
                  valuationId: view.anchorValuationId,
                },
          )
        }
      />
    </div>
  );
}

function PropertyValueControls({
  onSelectionChange,
  view,
}: Readonly<{
  onSelectionChange: (input: SetPropertyValueSelectionInput) => Promise<void>;
  view: PropertyValueHistoryView;
}>) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(
    anchorValuationId: string,
    valueSelection: PropertyValueHistoryView["selection"],
  ) {
    setSaving(true);
    setError(null);
    try {
      await onSelectionChange({
        accountId: view.accountId,
        anchorValuationId,
        valueSelection,
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The property value choice could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <PropertyValueControlFields
      error={error}
      save={save}
      saving={saving}
      view={view}
    />
  );
}

const chartConfig = {
  estimate: {
    label: "Index estimate",
    color: "hsl(220, 70%, 50%)",
  },
  recorded: {
    label: "Recorded valuation",
    color: "hsl(150, 55%, 42%)",
  },
} satisfies ChartConfig;

type ChartPoint = {
  date: string;
  estimate?: number;
  recorded?: number;
};

type ReadyPropertyValueHistoryView = Extract<
  PropertyValueHistoryView,
  { status: "ready" }
>;

function chartPoints(view: ReadyPropertyValueHistoryView): ChartPoint[] {
  const byDate = new Map<string, ChartPoint>();
  for (const estimate of view.history.estimates) {
    const point = byDate.get(estimate.date) ?? { date: estimate.date };
    if (estimate.kind === "index-estimate") point.estimate = estimate.value;
    byDate.set(estimate.date, point);
  }
  for (const valuation of view.history.recordedValuations) {
    const point = byDate.get(valuation.date) ?? { date: valuation.date };
    point.recorded = valuation.value;
    byDate.set(valuation.date, point);
  }
  return Array.from(byDate.values()).toSorted((left, right) =>
    left.date.localeCompare(right.date),
  );
}

function UnavailablePropertyValueHistory({
  view,
}: Readonly<{ view: PropertyValueHistoryView }>) {
  if (view.status !== "unavailable") return null;
  return (
    <section className="rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium">Indexed property history</h3>
        <Badge variant="outline">Unavailable</Badge>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{view.message}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Dataset {view.datasetVersion}
      </p>
    </section>
  );
}

function PropertyHistoryHeader({ fallback }: Readonly<{ fallback: boolean }>) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">Indexed property history</h3>
        <Badge variant="secondary">Estimate</Badge>
        {fallback && <Badge variant="outline">Fallback series</Badge>}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Purchase prices and valuations stay recorded separately from the index
        estimate.
      </p>
    </>
  );
}

function PropertyHistoryLineChart({
  points,
}: Readonly<{ points: ChartPoint[] }>) {
  return (
    <ChartContainer
      config={chartConfig}
      className="mt-3 aspect-auto w-full"
      role="img"
      aria-label="Recorded and UK HPI indexed property values"
    >
      <ResponsiveContainer width="100%" height={200}>
        <LineChart
          data={points}
          margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="date" className="text-xs" hide />
          <YAxis
            className="text-xs"
            width={52}
            tickFormatter={formatAxisTick}
          />
          <ChartTooltip
            content={<ChartTooltipContent />}
            formatter={(value) =>
              formatAccountCurrency(value as number, HOUSING_CURRENCY)
            }
          />
          <Line
            type="monotone"
            dataKey="estimate"
            stroke="hsl(220, 70%, 50%)"
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={false}
            connectNulls
          />
          <Line
            type="linear"
            dataKey="recorded"
            stroke="hsl(150, 55%, 42%)"
            strokeWidth={0}
            dot={{ r: 4, fill: "hsl(150, 55%, 42%)" }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

function AccessiblePropertyHistory({
  points,
}: Readonly<{ points: ChartPoint[] }>) {
  return (
    <div className="sr-only">
      <table>
        <caption>Recorded and indexed property values</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>Index estimate</th>
            <th>Recorded valuation</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.date}>
              <td>{point.date}</td>
              <td>
                {point.estimate == null
                  ? "Unavailable"
                  : formatAccountCurrency(point.estimate, HOUSING_CURRENCY)}
              </td>
              <td>
                {point.recorded == null
                  ? "No recorded valuation"
                  : formatAccountCurrency(point.recorded, HOUSING_CURRENCY)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecordedHousingValues({
  values,
}: Readonly<{
  values: ReadyPropertyValueHistoryView["history"]["housingValues"];
}>) {
  return (
    <div>
      <p className="text-xs font-medium">Recorded valuations</p>
      <div className="mt-2 grid gap-2">
        {values.map((value) => (
          <HousingValueDisclosure key={value.id} value={value} compact />
        ))}
      </div>
    </div>
  );
}

function SelectedIndexSeries({
  history,
}: Readonly<{ history: ReadyPropertyValueHistoryView["history"] }>) {
  const { dataset, series } = history.calculation;
  return (
    <div>
      <p className="text-xs font-medium">Selected index series</p>
      <p className="mt-1 text-xs text-muted-foreground">{series.label}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {dataset.provider} · release {dataset.releasePeriod} · dataset{" "}
        {dataset.versionId}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Published {dataset.publishedAt} · retrieved{" "}
        {dataset.retrievedAt.slice(0, 10)} · geography {series.geographyName}
      </p>
    </div>
  );
}

function PropertyHistoryCalculation({
  calculation,
}: Readonly<{
  calculation: ReadyPropertyValueHistoryView["history"]["calculation"];
}>) {
  return (
    <details className="mt-3 border-t pt-3 text-xs text-muted-foreground">
      <summary className="cursor-pointer font-medium text-foreground">
        Calculation details
      </summary>
      <p className="mt-2 font-mono">{calculation.formula}</p>
      <p className="mt-1">
        Anchor {calculation.anchor.date} ·{" "}
        {formatAccountCurrency(
          calculation.anchor.value,
          calculation.anchor.currency,
        )}{" "}
        · index {calculation.anchor.indexLevel}
      </p>
    </details>
  );
}

function ReadyPropertyValueHistory({
  view,
}: Readonly<{ view: ReadyPropertyValueHistoryView }>) {
  const { history } = view;
  const points = chartPoints(view);
  const latestEstimate = history.estimates
    .filter((estimate) => estimate.kind === "index-estimate")
    .at(-1);
  const latestHousingValue = history.housingValues.find(
    ({ id }) => id === `index-estimate:${latestEstimate?.date}`,
  );
  const recordedHousingValues = history.housingValues.filter(
    ({ kind }) =>
      kind === "recorded-purchase" ||
      kind === "recorded-valuation" ||
      kind === "manual-override",
  );
  const unavailablePeriods = history.estimates
    .filter((estimate) => estimate.kind === "index-unavailable")
    .map(({ period }) => period);

  return (
    <section className="rounded-lg border p-3">
      <PropertyHistoryHeader fallback={history.calculation.series.fallback} />
      {latestHousingValue && (
        <div className="mt-3">
          <p className="mb-2 text-xs font-medium">Latest index estimate</p>
          <HousingValueDisclosure value={latestHousingValue} compact />
        </div>
      )}
      <PropertyHistoryLineChart points={points} />
      <AccessiblePropertyHistory points={points} />
      <div className="mt-3 grid gap-3">
        <RecordedHousingValues values={recordedHousingValues} />
        <SelectedIndexSeries history={history} />
      </div>
      {unavailablePeriods.length !== 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          No index observation for {unavailablePeriods.join(", ")}.
        </p>
      )}
      <PropertyHistoryCalculation calculation={history.calculation} />
    </section>
  );
}

export function PropertyValueHistory({
  onSelectionChange,
  view,
}: Readonly<{
  onSelectionChange: (input: SetPropertyValueSelectionInput) => Promise<void>;
  view: PropertyValueHistoryView;
}>) {
  return (
    <div className="space-y-3">
      <PropertyValueControls
        onSelectionChange={onSelectionChange}
        view={view}
      />
      {view.status === "unavailable" ? (
        <UnavailablePropertyValueHistory view={view} />
      ) : (
        <ReadyPropertyValueHistory view={view} />
      )}
    </div>
  );
}
