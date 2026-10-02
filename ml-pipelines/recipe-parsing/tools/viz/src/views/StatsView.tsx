import { ArrowRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  loadCanonicalizedPredictions,
  loadExtractionMetrics,
  loadExtractionPredictions,
  loadFinalMetrics,
  loadFinalScores,
  loadGroundTruth,
  loadNormalizationMetrics,
  loadPredictions,
  loadNormalizationScores,
} from "../lib/data";
import { deriveNormalizedRecipe } from "../lib/cooklang";
import {
  aggregateMetrics,
  CANONICALIZATION_SCORING_PROFILE,
  EXTRACTION_SCORING_PROFILE,
  NORMALIZATION_SCORING_PROFILE,
  computeCharErrorRate,
  computeRougeL,
  computeWordErrorRate,
} from "../../../../src/evaluation/metrics.js";
import type {
  GroundTruthEntry as MetricsGroundTruthEntry,
  PredictionEntry as MetricsPredictionEntry,
} from "recipe-parsing/schemas/ground-truth";
import { extractionToRecipe } from "../../../../src/lib/extraction-to-recipe.js";
import { flattenExtractionText } from "../../../../src/lib/extraction-text.js";
import type {
  ExtractionPredictionsDataset,
  GroundTruthDataset,
  PerImageScoreEntry,
  PredictionsDataset,
  StageMetrics,
} from "../types/extraction";
import { formatPercent, scoreBarColor } from "../lib/scores";

interface StatsViewProps {
  onSelectCanonicalizeEntry: (index: number) => void;
}

interface StageHighlightMetric {
  label: string;
  value: number | null;
  kind?: "score" | "error";
  precision?: number;
}

interface ComparisonMetricRow {
  key: string;
  label: string;
  normalization: number | null;
  canonicalization: number | null;
  delta: number | null;
}

interface ToplineComparisonDatum {
  label: string;
  normalization: number;
  canonicalization: number;
}

interface MetricDeltaDatum {
  label: string;
  delta: number;
}

interface WeightedContributionDatum {
  label: string;
  delta: number;
  weightedDelta: number;
  weightLabel: string;
  formulaLabel: string;
}

interface EntryDeltaRow {
  index: number;
  title: string;
  normalizationScore: number;
  canonicalizationScore: number;
  delta: number;
  strongestGainLabel: string;
  strongestGainDelta: number;
  weakestFinalLabel: string;
  weakestFinalScore: number;
}

interface RecipeScoreDatum {
  index: number;
  label: string;
  fullTitle: string;
  finalScore: number;
  normalizationScore: number;
  delta: number;
  weakestMetric: string;
  weakestMetricScore: number;
}

interface RecipeDeltaDatum {
  index: number;
  label: string;
  fullTitle: string;
  finalScore: number;
  delta: number;
}

const MAX_RECIPES_IN_CHART = 12;
const SIGNIFICANT_DELTA = 0.005;
const CANONICALIZATION_WEIGHT_TOTAL =
  (CANONICALIZATION_SCORING_PROFILE.weights.ingredientParsing ?? 0) +
  (CANONICALIZATION_SCORING_PROFILE.weights.equipmentParsing ?? 0) +
  (CANONICALIZATION_SCORING_PROFILE.weights.cuisine ?? 0);
const CANONICALIZATION_INGREDIENT_WEIGHT =
  CANONICALIZATION_WEIGHT_TOTAL > 0
    ? (CANONICALIZATION_SCORING_PROFILE.weights.ingredientParsing ?? 0) /
      CANONICALIZATION_WEIGHT_TOTAL
    : 0;
const CANONICALIZATION_EQUIPMENT_WEIGHT =
  CANONICALIZATION_WEIGHT_TOTAL > 0
    ? (CANONICALIZATION_SCORING_PROFILE.weights.equipmentParsing ?? 0) /
      CANONICALIZATION_WEIGHT_TOTAL
    : 0;
const CANONICALIZATION_CUISINE_WEIGHT =
  CANONICALIZATION_WEIGHT_TOTAL > 0
    ? (CANONICALIZATION_SCORING_PROFILE.weights.cuisine ?? 0) /
      CANONICALIZATION_WEIGHT_TOTAL
    : 0;

function getScalarMetric(
  metrics: StageMetrics | null,
  key: string,
): number | null {
  if (!metrics) return null;
  const metric = metrics.byCategory.scalarFields[key];
  if (!metric) return null;
  if (metric.f1 != null) return metric.f1;
  if (metric.accuracy != null) return metric.accuracy;
  return null;
}

function formatDeltaPoints(delta: number | null): string {
  if (delta == null) return "n/a";
  const points = Math.round(delta * 100);
  return `${points > 0 ? "+" : ""}${points} pts`;
}

function formatDeltaPointsPrecise(
  delta: number | null,
  decimals = 1,
): string {
  if (delta == null) return "n/a";
  const points = delta * 100;
  return `${points > 0 ? "+" : ""}${points.toFixed(decimals)} pts`;
}

function formatMetricPercent(
  value: number | null,
  decimals = 0,
): string {
  if (value == null) return "n/a";
  return `${(value * 100).toFixed(decimals)}%`;
}

function deltaClasses(delta: number | null): string {
  if (delta == null) return "bg-gray-100 text-gray-500";
  if (delta > SIGNIFICANT_DELTA) return "bg-green-100 text-green-700";
  if (delta < -SIGNIFICANT_DELTA) return "bg-red-100 text-red-700";
  return "bg-gray-100 text-gray-700";
}

function deltaTone(
  delta: number | null,
): "positive" | "negative" | "neutral" {
  if ((delta ?? 0) > SIGNIFICANT_DELTA) return "positive";
  if ((delta ?? 0) < -SIGNIFICANT_DELTA) return "negative";
  return "neutral";
}

function scoreFill(score: number): string {
  if (score >= 0.85) return "#16a34a";
  if (score >= 0.7) return "#d97706";
  return "#dc2626";
}

function truncateLabel(value: string, max = 26): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function MetricValue({
  label,
  value,
  kind = "score",
  precision = 0,
}: Readonly<{
  label: string;
  value: number | null;
  kind?: "score" | "error";
  precision?: number;
}>) {
  const normalizedForColor =
    kind === "error"
      ? Math.max(0, Math.min(1, 1 - (value ?? 0)))
      : (value ?? 0);

  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-gray-500">
        {label}
      </div>
      <div className="text-lg font-semibold tabular-nums text-gray-950">
        {formatMetricPercent(value, precision)}
      </div>
      <div className="h-1.5 rounded-full bg-gray-200">
        <div
          className={`h-full rounded-full transition-all ${scoreBarColor(normalizedForColor)}`}
          style={{ width: `${Math.max(0, Math.min(100, normalizedForColor * 100))}%` }}
        />
      </div>
    </div>
  );
}

function ToplineComparisonChart({
  data,
}: Readonly<{
  data: ToplineComparisonDatum[];
}>) {
  return (
    <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h3 className="text-xl font-semibold text-gray-950">
          Before vs After Canonicalization
        </h3>
        <p className="mt-1 text-sm leading-6 text-gray-600">
          Normalization output (before) vs canonicalized output (after), both scored against canonical ground truth.
        </p>
      </div>

      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
            barGap={6}
          >
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: "#6b7280" }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: "#6b7280" }}
              tickFormatter={(value: number) => formatPercent(value)}
              domain={[0, 1]}
            />
            <Tooltip
              formatter={(
                value: string | number | ReadonlyArray<string | number> | undefined,
                name: string | number | undefined,
              ) => [
                formatPercent(
                  Number(Array.isArray(value) ? value[0] ?? 0 : value ?? 0),
                ),
                name === "After" ? "After" : "Before",
              ]}
              labelStyle={{ color: "#111827", fontWeight: 600 }}
              contentStyle={{
                borderRadius: "12px",
                borderColor: "#e5e7eb",
                boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
              }}
            />
            <Bar
              dataKey="normalization"
              name="Before"
              fill="#d97706"
              radius={[6, 6, 0, 0]}
            />
            <Bar
              dataKey="canonicalization"
              name="After"
              fill="#16a34a"
              radius={[6, 6, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function StageOverviewCard({
  eyebrow,
  title,
  summary,
  metrics,
  highlights,
  href,
  delta,
  accentClassName,
}: Readonly<{
  eyebrow: string;
  title: string;
  summary: string;
  metrics: StageMetrics | null;
  highlights: StageHighlightMetric[];
  href: string;
  delta?: number | null;
  accentClassName: string;
}>) {
  return (
    <a
      href={href}
      className={`block rounded-3xl border p-5 shadow-sm transition-colors hover:border-gray-400 ${accentClassName}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500">
            {eyebrow}
          </div>
          <h3 className="mt-2 text-xl font-semibold text-gray-950">{title}</h3>
          <p className="mt-1 text-sm text-gray-600">{summary}</p>
        </div>
        {delta != null && (
          <span
            className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold ${deltaClasses(delta)}`}
          >
            {formatDeltaPoints(delta)}
          </span>
        )}
      </div>

      <div className="mt-4 flex items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">
            Structured Score
          </div>
          <div className="mt-1 text-4xl font-semibold tabular-nums text-gray-950">
            {metrics ? formatPercent(metrics.overall.score) : "n/a"}
          </div>
        </div>
        <div className="text-right text-xs uppercase tracking-[0.16em] text-gray-500">
          {metrics ? `${metrics.entryCount} annotated` : "Loading"}
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {highlights.map((metric) => (
          <MetricValue
            key={metric.label}
            label={metric.label}
            value={metric.value}
            kind={metric.kind}
            precision={metric.precision}
          />
        ))}
      </div>

      <div className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-gray-700">
        Open review
        <ArrowRight className="h-4 w-4" />
      </div>
    </a>
  );
}

function PipelineStageSummary({
  totalEntries,
}: Readonly<{
  totalEntries: number | null;
}>) {
  return (
    <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-500">
          Recipe Parsing Pipeline
        </div>
        <h2 className="mt-2 text-3xl font-semibold text-gray-950">
          Stage performance
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          Track text capture, structured recipe quality, and canonicalization uplift.
        </p>
      </div>

      {totalEntries != null && (
        <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600 shadow-sm">
          <span className="font-semibold tabular-nums text-gray-950">
            {totalEntries}
          </span>{" "}
          recipes in evaluation set
        </div>
      )}
    </section>
  );
}

function PipelineFlow({
  canonicalizationDelta,
}: Readonly<{
  canonicalizationDelta: number | null;
}>) {
  return (
    <section className="rounded-3xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">
            Extraction
          </span>
          <ArrowRight className="h-4 w-4 text-gray-400" />
          <span className="rounded-full bg-amber-100 px-3 py-1 font-medium text-amber-800">
            Normalization
          </span>
          <ArrowRight className="h-4 w-4 text-gray-400" />
          <span className="rounded-full bg-green-100 px-3 py-1 font-medium text-green-800">
            Canonicalization
          </span>
        </div>

        <div className="text-sm text-gray-600">
          Net canonicalization score change{" "}
          <span
            className={`ml-2 inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${deltaClasses(canonicalizationDelta)}`}
          >
            {formatDeltaPoints(canonicalizationDelta)}
          </span>
        </div>
      </div>
    </section>
  );
}

function InsightStat({
  label,
  value,
  tone = "neutral",
}: Readonly<{
  label: string;
  value: string;
  tone?: "positive" | "negative" | "neutral";
}>) {
  const tones = {
    positive: "bg-green-50 border-green-200 text-green-800",
    negative: "bg-red-50 border-red-200 text-red-800",
    neutral: "bg-gray-50 border-gray-200 text-gray-800",
  } as const;

  return (
    <div className={`min-w-0 rounded-2xl border p-4 ${tones[tone]}`}>
      <div className="break-words text-[11px] font-semibold uppercase leading-4 tracking-[0.16em]">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function WeightPill({
  label,
  value,
}: Readonly<{
  label: string;
  value: string;
}>) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-gray-900">{value}</div>
    </div>
  );
}

function ScoreWeightingCard({
  contributions,
}: Readonly<{
  contributions: WeightedContributionDatum[];
}>) {
  return (
    <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h3 className="text-xl font-semibold text-gray-950">
          How Canonicalization Score Is Calculated
        </h3>
        <p className="mt-1 text-sm leading-6 text-gray-600">
          Canonicalization only scores the fields this stage owns: ingredient identity, cookware labels, and cuisine labels.
        </p>
      </div>

      <div className="rounded-2xl border border-gray-200 overflow-hidden">
        <div className="grid grid-cols-3 text-sm font-semibold text-white">
          <div className="bg-amber-600 px-4 py-3">
            Ingredients {(CANONICALIZATION_INGREDIENT_WEIGHT * 100).toFixed(1)}%
          </div>
          <div className="bg-cyan-600 px-4 py-3">
            Equipment {(CANONICALIZATION_EQUIPMENT_WEIGHT * 100).toFixed(1)}%
          </div>
          <div className="bg-slate-600 px-4 py-3">
            Cuisine {(CANONICALIZATION_CUISINE_WEIGHT * 100).toFixed(1)}%
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">
          Excluded From This Stage Score
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <WeightPill label="Title" value="0%" />
          <WeightPill label="Description" value="0%" />
          <WeightPill label="Servings" value="0%" />
          <WeightPill label="Prep Time" value="0%" />
          <WeightPill label="Cook Time" value="0%" />
          <WeightPill label="Instructions" value="0%" />
        </div>
      </div>

      <div className="mt-5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">
          Current Contribution To Canonicalization Score Uplift
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {contributions.map((item) => (
            <div key={item.label} className="rounded-2xl border border-gray-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900">{item.label}</div>
                  <div className="mt-1 text-xs text-gray-500">{item.weightLabel}</div>
                </div>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${deltaClasses(item.weightedDelta)}`}
                >
                  {formatDeltaPointsPrecise(item.weightedDelta)}
                </span>
              </div>
              <div className="mt-3 text-sm text-gray-600">
                {item.formulaLabel}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function MetricDeltaChart({
  data,
}: Readonly<{
  data: MetricDeltaDatum[];
}>) {
  const maxAbsDelta = Math.max(
    0.05,
    ...data.map((item) => Math.abs(item.delta)),
  );
  const domainLimit = Math.ceil(maxAbsDelta * 100 + 2) / 100;

  return (
    <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h3 className="text-xl font-semibold text-gray-950">Metric Deltas</h3>
        <p className="mt-1 text-sm leading-6 text-gray-600">
          Positive values mean canonicalization improved the metric.
        </p>
      </div>

      <div style={{ height: Math.max(120, data.length * 40 + 32) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 8, right: 12, left: 16, bottom: 0 }}
            barSize={18}
          >
            <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="#e5e7eb" />
            <ReferenceLine x={0} stroke="#9ca3af" />
            <XAxis
              type="number"
              domain={[-domainLimit, domainLimit]}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: "#6b7280" }}
              tickFormatter={(value: number) => formatDeltaPoints(value)}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={130}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: "#374151" }}
            />
            <Tooltip
              formatter={(value: string | number | ReadonlyArray<string | number> | undefined) => [
                formatDeltaPoints(
                  Number(Array.isArray(value) ? value[0] ?? 0 : value ?? 0),
                ),
                "Delta",
              ]}
              labelStyle={{ color: "#111827", fontWeight: 600 }}
              contentStyle={{
                borderRadius: "12px",
                borderColor: "#e5e7eb",
                boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
              }}
            />
            <Bar dataKey="delta" radius={6}>
              {data.map((item) => (
                <Cell
                  key={item.label}
                  fill={item.delta >= 0 ? "#16a34a" : "#dc2626"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function RecipeScoreChart({
  data,
}: Readonly<{
  data: RecipeScoreDatum[];
}>) {
  return (
    <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-semibold text-gray-950">
            Lowest Final Scores
          </h3>
          <p className="mt-1 text-sm leading-6 text-gray-600">
            Worst-scoring recipes after canonicalization, capped at the {MAX_RECIPES_IN_CHART} lowest.
          </p>
        </div>
      </div>

      <div className="h-[420px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 8, right: 12, left: 16, bottom: 0 }}
            barSize={18}
          >
            <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              type="number"
              domain={[0, 1]}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: "#6b7280" }}
              tickFormatter={(value: number) => formatPercent(value)}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={180}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: "#374151" }}
            />
            <Tooltip
              formatter={(value: string | number | ReadonlyArray<string | number> | undefined) => [
                formatPercent(Number(Array.isArray(value) ? value[0] ?? 0 : value ?? 0)),
                "Final score",
              ]}
              labelFormatter={(_label, payload) => {
                const item = payload?.[0]?.payload as RecipeScoreDatum | undefined;
                if (!item) return "";
                return item.fullTitle;
              }}
              labelStyle={{ color: "#111827", fontWeight: 600 }}
              contentStyle={{
                borderRadius: "12px",
                borderColor: "#e5e7eb",
                boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
              }}
            />
            <Bar dataKey="finalScore" radius={6}>
              {data.map((item) => (
                <Cell key={item.index} fill={scoreFill(item.finalScore)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function RecipeDeltaChart({
  data,
}: Readonly<{
  data: RecipeDeltaDatum[];
}>) {
  const maxAbsDelta = Math.max(
    0.05,
    ...data.map((item) => Math.abs(item.delta)),
  );
  const domainLimit = Math.ceil(maxAbsDelta * 100 + 2) / 100;

  return (
    <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h3 className="text-xl font-semibold text-gray-950">Largest Recipe Shifts</h3>
        <p className="mt-1 text-sm leading-6 text-gray-600">
          Biggest per-recipe score changes from normalization to canonicalization, capped at {MAX_RECIPES_IN_CHART}.
        </p>
      </div>

      <div className="h-[420px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 8, right: 12, left: 16, bottom: 0 }}
            barSize={18}
          >
            <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="#e5e7eb" />
            <ReferenceLine x={0} stroke="#9ca3af" />
            <XAxis
              type="number"
              domain={[-domainLimit, domainLimit]}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: "#6b7280" }}
              tickFormatter={(value: number) => formatDeltaPoints(value)}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={180}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: "#374151" }}
            />
            <Tooltip
              formatter={(value: string | number | ReadonlyArray<string | number> | undefined) => [
                formatDeltaPoints(
                  Number(Array.isArray(value) ? value[0] ?? 0 : value ?? 0),
                ),
                "Score change",
              ]}
              labelFormatter={(_label, payload) => {
                const item = payload?.[0]?.payload as RecipeDeltaDatum | undefined;
                if (!item) return "";
                return item.fullTitle;
              }}
              labelStyle={{ color: "#111827", fontWeight: 600 }}
              contentStyle={{
                borderRadius: "12px",
                borderColor: "#e5e7eb",
                boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
              }}
            />
            <Bar dataKey="delta" radius={6}>
              {data.map((item) => (
                <Cell
                  key={item.index}
                  fill={item.delta >= 0 ? "#16a34a" : "#dc2626"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
export function StatsView({ onSelectCanonicalizeEntry }: Readonly<StatsViewProps>) {
  const [groundTruth, setGroundTruth] = useState<GroundTruthDataset | null>(null);
  const [extractionPredictions, setExtractionPredictions] = useState<ExtractionPredictionsDataset | null>(null);

  const [normalizedPredictions, setNormalizedPredictions] = useState<PredictionsDataset | null>(null);
  const [canonicalizedPredictions, setCanonicalizedPredictions] = useState<PredictionsDataset | null>(null);
  const [extractionMetrics, setExtractionMetrics] = useState<StageMetrics | { skipped: true } | null>(null);
  const [normalizationMetrics, setNormalizationMetrics] = useState<StageMetrics | { skipped: true } | null>(null);
  const [pipelineFinalMetrics, setPipelineFinalMetrics] = useState<StageMetrics | null>(null);
  const [normalizationScores, setNormalizationScores] = useState<PerImageScoreEntry[]>([]);
  const [pipelineFinalScores, setPipelineFinalScores] = useState<PerImageScoreEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadGroundTruth().then(setGroundTruth).catch(() => {});
    loadExtractionPredictions().then(setExtractionPredictions).catch(() => {});

    loadPredictions().then(setNormalizedPredictions).catch(() => {});
    loadCanonicalizedPredictions().then(setCanonicalizedPredictions).catch(() => {});
    loadExtractionMetrics().then(setExtractionMetrics).catch(() => {});
    loadNormalizationMetrics().then(setNormalizationMetrics).catch(() => {});
    loadFinalMetrics().then(setPipelineFinalMetrics).catch(() => {});
    loadNormalizationScores().then(setNormalizationScores).catch(() => {});
    loadFinalScores().then(setPipelineFinalScores).catch((e) => setError(String(e)));
  }, []);

  // Compute extraction metrics client-side using the same methodology as the
  // pipeline (extractionToRecipe → aggregateMetrics) so scores stay fresh when
  // the user updates ground truth via "Use as Expected".
  const extractionClientMetrics: StageMetrics | null = useMemo(() => {
    if (!groundTruth || !extractionPredictions) return null;
    const predMap = new Map(
      extractionPredictions.entries.map((e) => [e.images.join("\0"), e.extracted]),
    );

    const entriesWithExtraction = groundTruth.entries.filter(
      (gt) => gt.expectedExtraction != null,
    );
    if (entriesWithExtraction.length === 0) return null;

    const predictions = entriesWithExtraction
      .filter((gt) => predMap.has(gt.images.join("\0")))
      .map((gt) => ({
        images: gt.images,
        predicted: extractionToRecipe(predMap.get(gt.images.join("\0"))!),
      }));

    const gtForEval = entriesWithExtraction.map((gt) => ({
      images: gt.images,
      expected: extractionToRecipe(gt.expectedExtraction!),
    }));

    try {
      const { metrics } = aggregateMetrics(
        predictions as MetricsPredictionEntry[],
        gtForEval as MetricsGroundTruthEntry[],
        EXTRACTION_SCORING_PROFILE,
      );

      // Attach text-fidelity diagnostics
      const wordErrorRates: number[] = [];
      const charErrorRates: number[] = [];
      const rougeLScores: { precision: number; recall: number; f1: number }[] = [];
      for (const gt of entriesWithExtraction) {
        const pred = predMap.get(gt.images.join("\0"));
        if (!pred) continue;
        const predictedText = flattenExtractionText(pred);
        const expectedText = flattenExtractionText(gt.expectedExtraction!);
        wordErrorRates.push(computeWordErrorRate(predictedText, expectedText));
        charErrorRates.push(computeCharErrorRate(predictedText, expectedText));
        rougeLScores.push(computeRougeL(predictedText, expectedText));
      }

      const averageValue = (values: number[]) =>
        values.length === 0
          ? 0
          : values.reduce((sum, v) => sum + v, 0) / values.length;

      // AggregateMetrics and StageMetrics are structurally compatible but TS
      // rejects the assignment because ScalarFieldScores lacks an index signature.
      const base = metrics as unknown as StageMetrics;
      return {
        ...base,
        diagnostics:
          rougeLScores.length === 0
            ? undefined
            : {
                extractionText: {
                  wordErrorRate: averageValue(wordErrorRates),
                  charErrorRate: averageValue(charErrorRates),
                  rougeL: {
                    precision: averageValue(rougeLScores.map((m) => m.precision)),
                    recall: averageValue(rougeLScores.map((m) => m.recall)),
                    f1: averageValue(rougeLScores.map((m) => m.f1)),
                  },
                },
              },
      };
    } catch {
      return null;
    }
  }, [groundTruth, extractionPredictions]);

  const normalizationClientMetrics: StageMetrics | null = useMemo(() => {
    if (!groundTruth || !normalizedPredictions) return null;

    // Build ground truth with expected derived from expectedNormalization,
    // matching the pipeline's evaluate-normalization stage.
    const groundTruthForEval: MetricsGroundTruthEntry[] = [];
    for (const gt of groundTruth.entries) {
      if (!gt.expectedNormalization) continue;
      const expDerived = deriveNormalizedRecipe(gt.expectedNormalization).recipe;
      if (!expDerived) continue;
      groundTruthForEval.push({ images: gt.images, expected: expDerived });
    }

    if (groundTruthForEval.length === 0) return null;

    const { metrics } = aggregateMetrics(
      normalizedPredictions.entries as MetricsPredictionEntry[],
      groundTruthForEval,
      NORMALIZATION_SCORING_PROFILE,
    );
    return metrics as unknown as StageMetrics;
  }, [groundTruth, normalizedPredictions]);

  const pipelineNormalizationSkipped =
    normalizationMetrics != null && "skipped" in normalizationMetrics;
  const pipelineNormalizationMetrics: StageMetrics | null =
    normalizationMetrics != null && !("skipped" in normalizationMetrics)
      ? normalizationMetrics
      : null;
  const normalizationMetricsResolved: StageMetrics | null =
    normalizationClientMetrics ?? pipelineNormalizationMetrics;

  const pipelineExtractionSkipped =
    extractionMetrics != null && "skipped" in extractionMetrics;
  const pipelineExtractionMetrics: StageMetrics | null =
    extractionMetrics != null && !("skipped" in extractionMetrics)
      ? extractionMetrics
      : null;
  // Client metrics use the same methodology as the pipeline (extractionToRecipe
  // + aggregateMetrics) so they're always current with the latest ground truth.
  // Fall back to pipeline metrics only before client data has loaded.
  const extractionMetricsResolved: StageMetrics | null =
    extractionClientMetrics ?? pipelineExtractionMetrics;

  const finalClientAggregate = useMemo<{
    metrics: StageMetrics;
    perEntry: PerImageScoreEntry[];
  } | null>(() => {
    if (!groundTruth || !canonicalizedPredictions) return null;
    try {
      const aggregate = aggregateMetrics(
        canonicalizedPredictions.entries as never,
        groundTruth.entries as never,
        CANONICALIZATION_SCORING_PROFILE,
      );
      return {
        metrics: aggregate.metrics as unknown as StageMetrics,
        perEntry: aggregate.perEntry as PerImageScoreEntry[],
      };
    } catch {
      return null;
    }
  }, [canonicalizedPredictions, groundTruth]);

  const canonicalizationBaselineAggregate = useMemo<{
    metrics: StageMetrics;
    perEntry: PerImageScoreEntry[];
  } | null>(() => {
    if (!groundTruth || !normalizedPredictions) return null;
    try {
      const aggregate = aggregateMetrics(
        normalizedPredictions.entries as never,
        groundTruth.entries as never,
        CANONICALIZATION_SCORING_PROFILE,
      );
      return {
        metrics: aggregate.metrics as unknown as StageMetrics,
        perEntry: aggregate.perEntry as PerImageScoreEntry[],
      };
    } catch {
      return null;
    }
  }, [groundTruth, normalizedPredictions]);

  const finalMetricsResolved: StageMetrics | null =
    finalClientAggregate?.metrics ?? pipelineFinalMetrics;
  const finalScoresResolved: PerImageScoreEntry[] =
    finalClientAggregate?.perEntry ?? pipelineFinalScores;
  const canonicalizationBaselineMetricsResolved: StageMetrics | null =
    canonicalizationBaselineAggregate?.metrics ?? normalizationMetricsResolved;
  const canonicalizationBaselineScoresResolved: PerImageScoreEntry[] =
    canonicalizationBaselineAggregate?.perEntry ?? normalizationScores;

  const totalEntries = groundTruth?.entries.length ?? null;

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
  const comparisonRows = useMemo<ComparisonMetricRow[]>(() => {
    if (!canonicalizationBaselineMetricsResolved || !finalMetricsResolved) return [];
    // Only include metrics for fields that canonicalization actually touches:
    // ingredient identity, cookware, and cuisine.
    // Both columns are scored against the same canonical ground truth
    // (groundTruth.entries[].expected) so the delta reflects the true
    // impact of the canonicalization stage.
    const baseline = canonicalizationBaselineMetricsResolved;
    const rows: ComparisonMetricRow[] = [
      {
        key: "overall",
        label: "Overall",
        normalization: baseline.overall.score,
        canonicalization: finalMetricsResolved.overall.score,
        delta:
          finalMetricsResolved.overall.score - baseline.overall.score,
      },
      {
        key: "ingredientParsing",
        label: "Ingredients F1",
        normalization: baseline.byCategory.ingredientParsing.f1,
        canonicalization: finalMetricsResolved.byCategory.ingredientParsing.f1,
        delta:
          finalMetricsResolved.byCategory.ingredientParsing.f1 -
          baseline.byCategory.ingredientParsing.f1,
      },
      {
        key: "equipmentParsing",
        label: "Equipment F1",
        normalization: baseline.byCategory.equipmentParsing?.f1 ?? null,
        canonicalization:
          finalMetricsResolved.byCategory.equipmentParsing?.f1 ?? null,
        delta:
          baseline.byCategory.equipmentParsing?.f1 != null &&
          finalMetricsResolved.byCategory.equipmentParsing?.f1 != null
            ? finalMetricsResolved.byCategory.equipmentParsing.f1 -
              baseline.byCategory.equipmentParsing.f1
            : null,
      },
      {
        key: "ingredientAmount",
        label: "Ingredient amount",
        normalization:
          baseline.byCategory.ingredientParsing.fieldScores?.amount
            ?.accuracy ?? null,
        canonicalization:
          finalMetricsResolved.byCategory.ingredientParsing.fieldScores?.amount
            ?.accuracy ?? null,
        delta:
          baseline.byCategory.ingredientParsing.fieldScores?.amount
            ?.accuracy != null &&
          finalMetricsResolved.byCategory.ingredientParsing.fieldScores?.amount
            ?.accuracy != null
            ? finalMetricsResolved.byCategory.ingredientParsing.fieldScores.amount
                .accuracy -
              baseline.byCategory.ingredientParsing.fieldScores.amount.accuracy
            : null,
      },
      {
        key: "ingredientUnit",
        label: "Ingredient unit",
        normalization:
          baseline.byCategory.ingredientParsing.fieldScores?.unit
            ?.accuracy ?? null,
        canonicalization:
          finalMetricsResolved.byCategory.ingredientParsing.fieldScores?.unit
            ?.accuracy ?? null,
        delta:
          baseline.byCategory.ingredientParsing.fieldScores?.unit
            ?.accuracy != null &&
          finalMetricsResolved.byCategory.ingredientParsing.fieldScores?.unit
            ?.accuracy != null
            ? finalMetricsResolved.byCategory.ingredientParsing.fieldScores.unit
                .accuracy -
              baseline.byCategory.ingredientParsing.fieldScores.unit.accuracy
            : null,
      },
      {
        key: "ingredientPreparation",
        label: "Ingredient preparation",
        normalization:
          baseline.byCategory.ingredientParsing.fieldScores
            ?.preparation?.f1 ?? null,
        canonicalization:
          finalMetricsResolved.byCategory.ingredientParsing.fieldScores
            ?.preparation?.f1 ?? null,
        delta:
          baseline.byCategory.ingredientParsing.fieldScores
            ?.preparation?.f1 != null &&
          finalMetricsResolved.byCategory.ingredientParsing.fieldScores
            ?.preparation?.f1 != null
            ? finalMetricsResolved.byCategory.ingredientParsing.fieldScores
                .preparation.f1 -
              baseline.byCategory.ingredientParsing.fieldScores.preparation.f1
            : null,
      },
      {
        key: "cuisine",
        label: "Cuisine",
        normalization: getScalarMetric(baseline, "cuisine"),
        canonicalization: getScalarMetric(finalMetricsResolved, "cuisine"),
        delta:
          getScalarMetric(baseline, "cuisine") != null &&
          getScalarMetric(finalMetricsResolved, "cuisine") != null
            ? getScalarMetric(finalMetricsResolved, "cuisine")! -
              getScalarMetric(baseline, "cuisine")!
            : null,
      },
    ];

    return rows;
  }, [
    canonicalizationBaselineMetricsResolved,
    finalMetricsResolved,
  ]);

  const toplineComparisonData = useMemo<ToplineComparisonDatum[]>(() => {
    const preferredOrder = [
      "overall",
      "ingredientParsing",
      "equipmentParsing",
      "cuisine",
    ];

    return preferredOrder
      .map((key) => comparisonRows.find((row) => row.key === key))
      .filter(
        (
          row,
        ): row is ComparisonMetricRow & {
          normalization: number;
          canonicalization: number;
        } => row != null && row.normalization != null && row.canonicalization != null,
      )
      .map((row) => ({
        label: row.label,
        normalization: row.normalization,
        canonicalization: row.canonicalization,
      }));
  }, [comparisonRows]);

  const metricDeltaData = useMemo<MetricDeltaDatum[]>(() => {
    return [...comparisonRows]
      .filter(
        (row): row is ComparisonMetricRow & { delta: number } =>
          row.key !== "overall" && row.delta != null,
      )
      .sort((a, b) => b.delta - a.delta)
      .map((row) => ({
        label: row.label,
        delta: row.delta,
      }));
  }, [comparisonRows]);

  const weightedContributionData = useMemo<WeightedContributionDatum[]>(() => {
    const ingredientDelta = comparisonRows.find(
      (row) => row.key === "ingredientParsing",
    )?.delta;
    const equipmentDelta = comparisonRows.find(
      (row) => row.key === "equipmentParsing",
    )?.delta;
    const cuisineDelta = comparisonRows.find((row) => row.key === "cuisine")?.delta;

    return [
      {
        label: "Ingredients",
        delta: ingredientDelta ?? 0,
        weightedDelta:
          (ingredientDelta ?? 0) * CANONICALIZATION_INGREDIENT_WEIGHT,
        weightLabel: `${(CANONICALIZATION_INGREDIENT_WEIGHT * 100).toFixed(1)}% of canonicalization score`,
        formulaLabel: `${formatDeltaPointsPrecise(ingredientDelta ?? 0)} × ${(CANONICALIZATION_INGREDIENT_WEIGHT * 100).toFixed(1)}% = ${formatDeltaPointsPrecise((ingredientDelta ?? 0) * CANONICALIZATION_INGREDIENT_WEIGHT)}`,
      },
      {
        label: "Equipment",
        delta: equipmentDelta ?? 0,
        weightedDelta: (equipmentDelta ?? 0) * CANONICALIZATION_EQUIPMENT_WEIGHT,
        weightLabel: `${(CANONICALIZATION_EQUIPMENT_WEIGHT * 100).toFixed(1)}% of canonicalization score`,
        formulaLabel: `${formatDeltaPointsPrecise(equipmentDelta ?? 0)} × ${(CANONICALIZATION_EQUIPMENT_WEIGHT * 100).toFixed(1)}% = ${formatDeltaPointsPrecise((equipmentDelta ?? 0) * CANONICALIZATION_EQUIPMENT_WEIGHT)}`,
      },
      {
        label: "Cuisine",
        delta: cuisineDelta ?? 0,
        weightedDelta: (cuisineDelta ?? 0) * CANONICALIZATION_CUISINE_WEIGHT,
        weightLabel: `${(CANONICALIZATION_CUISINE_WEIGHT * 100).toFixed(1)}% of canonicalization score`,
        formulaLabel: `${formatDeltaPointsPrecise(cuisineDelta ?? 0)} × ${(CANONICALIZATION_CUISINE_WEIGHT * 100).toFixed(1)}% = ${formatDeltaPointsPrecise((cuisineDelta ?? 0) * CANONICALIZATION_CUISINE_WEIGHT)}`,
      },
    ];
  }, [comparisonRows]);

  const entryDeltaRows = useMemo<EntryDeltaRow[]>(() => {
    if (
      !groundTruth ||
      canonicalizationBaselineScoresResolved.length === 0 ||
      finalScoresResolved.length === 0
    ) {
      return [];
    }

    const normalizationByKey = new Map(
      canonicalizationBaselineScoresResolved.map((entry) => [entry.images.join("\0"), entry]),
    );
    const finalByKey = new Map(
      finalScoresResolved.map((entry) => [entry.images.join("\0"), entry]),
    );

    return groundTruth.entries
      .map((entry, index) => {
        const key = entry.images.join("\0");
        const normalization = normalizationByKey.get(key);
        const canonicalization = finalByKey.get(key);
        if (!normalization || !canonicalization) return null;

        // Only include categories that canonicalization actually touches
        const categoryDiffs = [
          {
            label: "ingredients",
            delta:
              canonicalization.scores.ingredientParsing -
              normalization.scores.ingredientParsing,
            finalScore: canonicalization.scores.ingredientParsing,
          },
          {
            label: "equipment",
            delta:
              (canonicalization.scores.equipmentParsing ?? 0) -
              (normalization.scores.equipmentParsing ?? 0),
            finalScore: canonicalization.scores.equipmentParsing ?? 0,
          },
        ];

        const strongestGain = [...categoryDiffs].sort((a, b) => b.delta - a.delta)[0];
        const weakestFinal = [...categoryDiffs].sort(
          (a, b) => a.finalScore - b.finalScore,
        )[0];

        return {
          index,
          title: entry.expected.title,
          normalizationScore: normalization.scores.overall,
          canonicalizationScore: canonicalization.scores.overall,
          delta:
            canonicalization.scores.overall - normalization.scores.overall,
          strongestGainLabel: strongestGain?.label ?? "overall",
          strongestGainDelta: strongestGain?.delta ?? 0,
          weakestFinalLabel: weakestFinal?.label ?? "overall",
          weakestFinalScore: weakestFinal?.finalScore ?? canonicalization.scores.overall,
        };
      })
      .filter((entry): entry is EntryDeltaRow => entry != null);
  }, [canonicalizationBaselineScoresResolved, finalScoresResolved, groundTruth]);

  const lowestFinalScoreData = useMemo<RecipeScoreDatum[]>(
    () =>
      [...entryDeltaRows]
        .sort((a, b) => a.canonicalizationScore - b.canonicalizationScore)
        .slice(0, MAX_RECIPES_IN_CHART)
        .map((entry) => ({
          index: entry.index,
          label: truncateLabel(entry.title),
          fullTitle: entry.title,
          finalScore: entry.canonicalizationScore,
          normalizationScore: entry.normalizationScore,
          delta: entry.delta,
          weakestMetric: entry.weakestFinalLabel,
          weakestMetricScore: entry.weakestFinalScore,
        })),
    [entryDeltaRows],
  );

  const largestRecipeShiftData = useMemo<RecipeDeltaDatum[]>(
    () =>
      [...entryDeltaRows]
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, MAX_RECIPES_IN_CHART)
        .sort((a, b) => b.delta - a.delta)
        .map((entry) => ({
          index: entry.index,
          label: truncateLabel(entry.title),
          fullTitle: entry.title,
          finalScore: entry.canonicalizationScore,
          delta: entry.delta,
        })),
    [entryDeltaRows],
  );

  const improvedCount = entryDeltaRows.filter((entry) => entry.delta > SIGNIFICANT_DELTA).length;
  const regressedCount = entryDeltaRows.filter((entry) => entry.delta < -SIGNIFICANT_DELTA).length;
  const canonicalizationDelta =
    canonicalizationBaselineMetricsResolved && finalMetricsResolved
      ? finalMetricsResolved.overall.score -
        canonicalizationBaselineMetricsResolved.overall.score
      : null;

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6">
        <p className="text-red-700">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PipelineStageSummary totalEntries={totalEntries} />

      <PipelineFlow canonicalizationDelta={canonicalizationDelta} />

      {(pipelineExtractionSkipped && !extractionClientMetrics) ||
      (pipelineNormalizationSkipped && !normalizationClientMetrics) ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Some pipeline metrics were skipped, so client-side fallbacks are
          filling gaps where possible.
        </div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-3">
        <StageOverviewCard
          eyebrow="Stage 1"
          title="Extraction"
          summary="Image to recipe text"
          metrics={extractionMetricsResolved}
          highlights={[
            {
              label: "ROUGE-L",
              value:
                extractionMetricsResolved?.diagnostics?.extractionText?.rougeL.f1 ??
                null,
              precision: 1,
            },
            {
              label: "WER",
              value:
                extractionMetricsResolved?.diagnostics?.extractionText?.wordErrorRate ??
                null,
              kind: "error",
              precision: 1,
            },
            {
              label: "CER",
              value:
                extractionMetricsResolved?.diagnostics?.extractionText?.charErrorRate ??
                null,
              kind: "error",
              precision: 1,
            },
          ]}
          href="#extraction"
          accentClassName="border-slate-200 bg-gradient-to-br from-white via-slate-50 to-slate-100"
        />

        <StageOverviewCard
          eyebrow="Stage 2"
          title="Normalization"
          summary="Text to parsed recipe"
          metrics={normalizationMetricsResolved}
          highlights={[
            {
              label: "Ingredients",
              value: normalizationMetricsResolved?.byCategory.ingredientParsing.f1 ?? null,
            },
            {
              label: "Cuisine",
              value:
                normalizationMetricsResolved?.byCategory.scalarFields.cuisine.f1 ?? null,
            },
            {
              label: "Equipment",
              value:
                normalizationMetricsResolved?.byCategory.equipmentParsing?.f1 ?? null,
            },
          ]}
          href="#normalization"
          accentClassName="border-amber-200 bg-gradient-to-br from-white via-amber-50 to-amber-100"
        />

        <StageOverviewCard
          eyebrow="Stage 3"
          title="Canonicalization"
          summary="Parsed recipe after canonical cleanup"
          metrics={finalMetricsResolved}
          highlights={[
            {
              label: "Ingredients",
              value: finalMetricsResolved?.byCategory.ingredientParsing.f1 ?? null,
            },
            {
              label: "Cuisine",
              value: finalMetricsResolved?.byCategory.scalarFields.cuisine.f1 ?? null,
            },
            {
              label: "Equipment",
              value: finalMetricsResolved?.byCategory.equipmentParsing?.f1 ?? null,
            },
          ]}
          href="#canonicalize"
          delta={canonicalizationDelta}
          accentClassName="border-green-200 bg-gradient-to-br from-white via-green-50 to-emerald-100"
        />
      </section>

      {comparisonRows.length > 0 && (
        <section className="grid gap-6 xl:grid-cols-[1.45fr_0.85fr]">
          <MetricDeltaChart data={metricDeltaData} />

          <section className="space-y-4">
            {toplineComparisonData.length > 0 && (
              <ToplineComparisonChart data={toplineComparisonData} />
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <InsightStat
                label="Canonicalization uplift"
                value={formatDeltaPoints(canonicalizationDelta)}
                tone={deltaTone(canonicalizationDelta)}
              />
              <InsightStat
                label="Improved"
                value={`${improvedCount}/${entryDeltaRows.length || 0}`}
                tone="positive"
              />
              <InsightStat
                label="Regressed"
                value={`${regressedCount}/${entryDeltaRows.length || 0}`}
                tone={regressedCount > 0 ? "negative" : "neutral"}
              />
            </div>
          </section>
        </section>
      )}

      {weightedContributionData.length > 0 && (
        <ScoreWeightingCard contributions={weightedContributionData} />
      )}

      {lowestFinalScoreData.length > 0 && (
        <section className="grid gap-6 xl:grid-cols-2">
          <RecipeScoreChart data={lowestFinalScoreData} />
          <RecipeDeltaChart data={largestRecipeShiftData} />
        </section>
      )}
    </div>
  );
}
