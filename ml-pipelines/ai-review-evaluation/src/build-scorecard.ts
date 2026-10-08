import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { readJson, sha256, writeJson } from "./artifact-files";
import { parseArgs } from "./cli-arguments";
import {
  FrozenCohortSchema,
  FrozenDecisionSchema,
  type FrozenCohort,
  type FrozenDecision,
  type PrimaryMetric,
} from "./schemas";

const NullableNumberSchema = z.number().nullable();
const ScoreSummarySchema = z.object({
  variant_id: z.string().min(1),
  variant_role: z.enum(["baseline", "candidate"]),
  model: z.string(),
  provider: z.string(),
  replay_records: z.number().int().nonnegative(),
  executed_replays: z.number().int().nonnegative(),
  completed_replays: z.number().int().nonnegative(),
  incomplete_replays: z.number().int().nonnegative(),
  completed_pull_requests: z.number().int().nonnegative(),
  planned_replays: z.number().int().nonnegative(),
  candidate_findings: NullableNumberSchema,
  accepted_findings: NullableNumberSchema,
  rejected_findings: NullableNumberSchema,
  censored_findings: NullableNumberSchema,
  no_response_findings: NullableNumberSchema,
  unmatched_findings: NullableNumberSchema,
  manual_adjudications_required: NullableNumberSchema,
  historical_adjudicated_findings: NullableNumberSchema,
  historical_matched_findings: NullableNumberSchema,
  accepted_findings_per_replay: NullableNumberSchema,
  acceptance_rate: NullableNumberSchema,
  noise_rate: NullableNumberSchema,
  historical_coverage_rate: NullableNumberSchema,
  provider_failure_rate: NullableNumberSchema,
  input_tokens: NullableNumberSchema,
  output_tokens: NullableNumberSchema,
  cached_input_tokens: NullableNumberSchema,
  cost_usd: NullableNumberSchema,
  mean_cost_usd_per_replay: NullableNumberSchema,
  mean_latency_ms: NullableNumberSchema,
  missing_coverage_replays: z.number().int().nonnegative(),
  accepted_findings_repetition_stddev_mean: NullableNumberSchema,
  noise_rate_repetition_stddev_mean: NullableNumberSchema,
  historical_coverage_rate_repetition_stddev_mean: NullableNumberSchema,
  latency_ms_repetition_stddev_mean: NullableNumberSchema,
  cost_usd_repetition_stddev_mean: NullableNumberSchema,
  corpus_items_with_accepted_findings_repetition_variance: z.number().int().nonnegative(),
  accepted_findings_between_pull_request_stddev: NullableNumberSchema,
}).strict();

export type ScoreSummary = z.infer<typeof ScoreSummarySchema>;
type Recommendation = "adopt" | "reject" | "gather-more-evidence";
type SampleUnit = FrozenDecision["decision"]["sampleUnit"];

export interface EvaluationDecision {
  schemaVersion: 1;
  recordType: "ai-review-evaluation-decision";
  cohortId: string;
  decisionId: string;
  datasetId: string;
  recommendation: Recommendation;
  productionConfigurationChanged: false;
  primaryMetric: PrimaryMetric;
  baseline: { id: string; value: number | null; sampleSize: number };
  candidate: { id: string; value: number | null; sampleSize: number };
  comparison: {
    absoluteChange: number | null;
    relativeChange: number | null;
    directionalImprovement: number | null;
    directionalRelativeImprovement: number | null;
    noiseRateIncrease: number | null;
    historicalCoverageRateDrop: number | null;
  };
  thresholds: FrozenDecision["decision"];
  reasons: string[];
}

interface BuildScorecardOptions {
  cohortFile: string;
  decisionFile: string;
  observationsFile: string;
  outputRoot: string;
  sqlFile: string;
}

function sqlPath(file: string): string {
  const resolved = path.resolve(file);
  if (resolved.includes("'") || resolved.includes("\\")) throw new Error(`unsupported SQL path: ${resolved}`);
  return resolved;
}

function countValues(values: string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function cohortStrata(cohort: FrozenCohort) {
  const entries = cohort.entries;
  return {
    risk: countValues(entries.map((entry) => entry.strata.risk)),
    changeSize: countValues(entries.map((entry) => entry.strata.changeSize)),
    languages: countValues(entries.flatMap((entry) => entry.strata.languages)),
    repositoryAreas: countValues(entries.flatMap((entry) => entry.strata.repositoryAreas)),
    taskType: countValues(entries.map((entry) => entry.strata.taskType ?? "(unknown)")),
    originatingAgent: countValues(entries.map((entry) => entry.strata.originatingAgent ?? "(unknown)")),
    outcomeAvailability: countValues(entries.map((entry) => entry.strata.outcomeAvailability)),
  };
}

const METRIC_KEYS = {
  acceptedFindingsPerReplay: "accepted_findings_per_replay",
  acceptanceRate: "acceptance_rate",
  noiseRate: "noise_rate",
  historicalCoverageRate: "historical_coverage_rate",
  providerFailureRate: "provider_failure_rate",
  meanLatencyMs: "mean_latency_ms",
  costUsd: "mean_cost_usd_per_replay",
} as const satisfies Record<PrimaryMetric, keyof ScoreSummary>;

const METRIC_DIRECTION = {
  acceptedFindingsPerReplay: 1,
  acceptanceRate: 1,
  noiseRate: -1,
  historicalCoverageRate: 1,
  providerFailureRate: -1,
  meanLatencyMs: -1,
  costUsd: -1,
} as const satisfies Record<PrimaryMetric, 1 | -1>;

function metricValue(summary: ScoreSummary, metric: PrimaryMetric): number | null {
  return summary[METRIC_KEYS[metric]];
}

function sampleSize(summary: ScoreSummary, unit: SampleUnit): number {
  if (unit === "pull-requests") return summary.completed_pull_requests;
  if (unit === "adjudicated-findings") {
    return Number(summary.accepted_findings ?? 0) + Number(summary.rejected_findings ?? 0);
  }
  return summary.completed_replays;
}

function ratioDelta(candidate: number | null, baseline: number | null): number | null {
  if (candidate === null || baseline === null) return null;
  if (baseline === 0) return candidate === 0 ? 0 : null;
  return (candidate - baseline) / Math.abs(baseline);
}

interface RecommendationResult {
  recommendation: Recommendation;
  reasons: string[];
}

function insufficientSampleReason(
  minimum: number,
  baselineSample: number,
  candidateSample: number,
): string | null {
  if (baselineSample >= minimum && candidateSample >= minimum) return null;
  return `minimum sample size is ${minimum}; baseline has ${baselineSample} and candidate has ${candidateSample}`;
}

function passesImprovementThreshold(
  directionalImprovement: number | null,
  directionalRelativeImprovement: number | null,
  criteria: FrozenDecision["decision"],
): boolean {
  if (directionalRelativeImprovement !== null) {
    return directionalRelativeImprovement >= criteria.minimumRelativeImprovement;
  }
  return directionalImprovement !== null
    && directionalImprovement >= criteria.minimumAbsoluteImprovementWhenBaselineZero;
}

function thresholdRecommendation({
  criteria,
  directionalImprovement,
  directionalRelativeImprovement,
  noiseIncrease,
  coverageDrop,
  failuresTooHigh,
}: {
  criteria: FrozenDecision["decision"];
  directionalImprovement: number | null;
  directionalRelativeImprovement: number | null;
  noiseIncrease: number | null;
  coverageDrop: number | null;
  failuresTooHigh: boolean;
}): RecommendationResult {
  if (failuresTooHigh) {
    return { recommendation: "reject", reasons: ["candidate provider failure rate exceeds the fixed ceiling"] };
  }
  const improvementPasses = passesImprovementThreshold(
    directionalImprovement,
    directionalRelativeImprovement,
    criteria,
  );
  const declineFails = directionalRelativeImprovement !== null
    && directionalRelativeImprovement <= -criteria.rejectRelativeDecline;
  const noisePasses = noiseIncrease !== null && noiseIncrease <= criteria.maximumNoiseRateIncrease;
  const coveragePasses = coverageDrop !== null && coverageDrop <= criteria.maximumCoverageRateDrop;
  if (improvementPasses && noisePasses && coveragePasses) {
    return {
      recommendation: "adopt",
      reasons: ["candidate passes the fixed improvement, noise, and coverage thresholds"],
    };
  }
  if (declineFails) {
    return { recommendation: "reject", reasons: ["candidate crosses the fixed decline threshold"] };
  }
  if (noiseIncrease !== null && noiseIncrease > criteria.maximumNoiseRateIncrease) {
    return { recommendation: "reject", reasons: ["candidate crosses the fixed noise threshold"] };
  }
  return {
    recommendation: "gather-more-evidence",
    reasons: ["candidate does not cross the fixed adopt or reject threshold"],
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
function decide(
  cohort: FrozenCohort,
  frozenDecision: FrozenDecision,
  summaries: ScoreSummary[],
): EvaluationDecision {
  const baseline = summaries.find((summary) => summary.variant_role === "baseline");
  const candidate = summaries.find((summary) => summary.variant_role === "candidate");
  if (!baseline || !candidate) throw new Error("scorecard requires one baseline and one candidate");
  if (frozenDecision.cohortId !== cohort.cohortId) {
    throw new Error("decision policy does not belong to the frozen cohort");
  }
  const criteria = frozenDecision.decision;
  const primaryMetric = criteria.primaryMetrics[0];
  if (!primaryMetric) throw new Error("decision policy requires a primary metric");
  const direction = METRIC_DIRECTION[primaryMetric];
  const baselineValue = metricValue(baseline, primaryMetric);
  const candidateValue = metricValue(candidate, primaryMetric);
  const absoluteChange = baselineValue === null || candidateValue === null ? null : candidateValue - baselineValue;
  const relativeChange = ratioDelta(candidateValue, baselineValue);
  const directionalImprovement = absoluteChange === null ? null : absoluteChange * direction;
  const directionalRelativeImprovement = relativeChange === null ? null : relativeChange * direction;
  const baselineSample = sampleSize(baseline, criteria.sampleUnit);
  const candidateSample = sampleSize(candidate, criteria.sampleUnit);
  const noiseIncrease = candidate.noise_rate === null || baseline.noise_rate === null
    ? null
    : candidate.noise_rate - baseline.noise_rate;
  const coverageDrop = candidate.historical_coverage_rate === null || baseline.historical_coverage_rate === null
    ? null
    : baseline.historical_coverage_rate - candidate.historical_coverage_rate;
  const failuresTooHigh = candidate.provider_failure_rate !== null &&
    candidate.provider_failure_rate > criteria.maximumProviderFailureRate;
  const insufficientReason = insufficientSampleReason(
    criteria.minimumSampleSize,
    baselineSample,
    candidateSample,
  );
  let result: RecommendationResult;
  if (insufficientReason) {
    result = { recommendation: "gather-more-evidence", reasons: [insufficientReason] };
  } else if (baselineValue === null || candidateValue === null) {
    result = {
      recommendation: "gather-more-evidence",
      reasons: [`primary metric ${primaryMetric} is unavailable`],
    };
  } else {
    result = thresholdRecommendation({
      criteria,
      directionalImprovement,
      directionalRelativeImprovement,
      noiseIncrease,
      coverageDrop,
      failuresTooHigh,
    });
  }
  const manualAdjudications = Number(baseline.manual_adjudications_required ?? 0) +
    Number(candidate.manual_adjudications_required ?? 0);
  if (manualAdjudications > 0) {
    result.recommendation = "gather-more-evidence";
    result.reasons.push(`${manualAdjudications} matches need manual adjudication`);
  }
  return {
    schemaVersion: 1,
    recordType: "ai-review-evaluation-decision",
    cohortId: cohort.cohortId,
    decisionId: frozenDecision.decisionId,
    datasetId: cohort.datasetId,
    recommendation: result.recommendation,
    productionConfigurationChanged: false,
    primaryMetric,
    baseline: { id: baseline.variant_id, value: baselineValue, sampleSize: baselineSample },
    candidate: { id: candidate.variant_id, value: candidateValue, sampleSize: candidateSample },
    comparison: {
      absoluteChange,
      relativeChange,
      directionalImprovement,
      directionalRelativeImprovement,
      noiseRateIncrease: noiseIncrease,
      historicalCoverageRateDrop: coverageDrop,
    },
    thresholds: criteria,
    reasons: result.reasons,
  };
}

function markdown(decision: EvaluationDecision, summaries: ScoreSummary[]): string {
  const format = (value: number | null): string => value === null ? "missing" : value.toFixed(4);
  const lines = [
    `# AI review evaluation ${decision.cohortId}`,
    "",
    `Recommendation: **${decision.recommendation}**. Production configuration was not changed.`,
    "",
    `Dataset: \`${decision.datasetId}\``,
    "",
    "| Variant | Completed | Accepted | Rejected | Unknown or censored | Coverage | Failures | Cost USD |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const summary of summaries) {
    const unknown = Number(summary.censored_findings ?? 0) + Number(summary.no_response_findings ?? 0) +
      Number(summary.unmatched_findings ?? 0) + Number(summary.manual_adjudications_required ?? 0);
    lines.push(`| ${summary.variant_id} | ${summary.completed_replays} | ${summary.accepted_findings ?? 0} | ${summary.rejected_findings ?? 0} | ${unknown} | ${format(summary.historical_coverage_rate)} | ${format(summary.provider_failure_rate)} | ${format(summary.cost_usd)} |`);
  }
  lines.push("", "Mean within-snapshot variance across repeated runs", "");
  for (const summary of summaries) {
    lines.push(`- ${summary.variant_id}: ${summary.corpus_items_with_accepted_findings_repetition_variance} snapshots with accepted-finding repeatability estimates; accepted findings SD ${format(summary.accepted_findings_repetition_stddev_mean)}, noise SD ${format(summary.noise_rate_repetition_stddev_mean)}, coverage SD ${format(summary.historical_coverage_rate_repetition_stddev_mean)}, latency SD ${format(summary.latency_ms_repetition_stddev_mean)}, cost SD ${format(summary.cost_usd_repetition_stddev_mean)}. Between-PR accepted-findings SD: ${format(summary.accepted_findings_between_pull_request_stddev)}.`);
  }
  lines.push("", "Decision reasons", "", ...decision.reasons.map((reason) => `- ${reason}.`), "");
  return lines.join("\n");
}

export function buildScorecard({
  cohortFile,
  decisionFile,
  observationsFile,
  outputRoot,
  sqlFile,
}: BuildScorecardOptions): { summaries: ScoreSummary[]; decision: EvaluationDecision } {
  const cohort = FrozenCohortSchema.parse(readJson(cohortFile));
  const frozenDecision = FrozenDecisionSchema.parse(readJson(decisionFile));
  fs.mkdirSync(outputRoot, { recursive: true });
  const parquet = path.join(outputRoot, "replay-scorecard.parquet");
  const summaryFile = path.join(outputRoot, "summary.json");
  fs.rmSync(parquet, { force: true });
  fs.rmSync(summaryFile, { force: true });
  const sql = fs.readFileSync(sqlFile, "utf8")
    .replace("__OBSERVATIONS__", sqlPath(observationsFile))
    .replace("__PARQUET__", sqlPath(parquet))
    .replace("__SUMMARY__", sqlPath(summaryFile));
  const duckdb = spawnSync("duckdb", [":memory:"], { input: sql, encoding: "utf8" });
  if (duckdb.error) throw duckdb.error;
  if (duckdb.status !== 0) throw new Error(`DuckDB scorecard failed: ${(duckdb.stderr ?? "").trim()}`);
  const summaries = z.array(ScoreSummarySchema).min(2).parse(readJson(summaryFile));
  const decision = decide(cohort, frozenDecision, summaries);
  const metrics = {
    schemaVersion: 1,
    cohortId: cohort.cohortId,
    decisionId: frozenDecision.decisionId,
    datasetId: cohort.datasetId,
    cohortEntries: cohort.entries.length,
    cohort: {
      pullRequests: cohort.selection.selectedPullRequestCount,
      replaySnapshots: cohort.selection.selectedSnapshotCount,
      strata: cohortStrata(cohort),
    },
    variants: Object.fromEntries(summaries.map((summary) => [summary.variant_id, summary])),
    decision: {
      recommendation: decision.recommendation,
      primaryMetric: decision.primaryMetric,
      absoluteChange: decision.comparison.absoluteChange,
      relativeChange: decision.comparison.relativeChange,
      directionalImprovement: decision.comparison.directionalImprovement,
      directionalRelativeImprovement: decision.comparison.directionalRelativeImprovement,
    },
  };
  writeJson(path.join(outputRoot, "decision.json"), decision);
  fs.writeFileSync(path.join(outputRoot, "decision.md"), markdown(decision, summaries));
  writeJson(path.join(outputRoot, "metrics.json"), metrics);
  const manifest = {
    schemaVersion: 1,
    recordType: "ai-review-evaluation-scorecard",
    cohortId: cohort.cohortId,
    decisionId: frozenDecision.decisionId,
    datasetId: cohort.datasetId,
    artifacts: {
      replayScorecard: { path: "replay-scorecard.parquet", sha256: sha256(fs.readFileSync(parquet)) },
      summary: { path: "summary.json", sha256: sha256(fs.readFileSync(summaryFile)) },
      decision: { path: "decision.json", sha256: sha256(fs.readFileSync(path.join(outputRoot, "decision.json"))) },
    },
  };
  writeJson(path.join(outputRoot, "scorecard-manifest.json"), manifest);
  return { summaries, decision };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2), ["cohort", "decision", "observations", "output", "sql"]);
  const result = buildScorecard({
    cohortFile: args.cohort,
    decisionFile: args.decision,
    observationsFile: args.observations,
    outputRoot: args.output,
    sqlFile: args.sql,
  });
  process.stdout.write(`Built scorecard with recommendation: ${result.decision.recommendation}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try { main(); } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
