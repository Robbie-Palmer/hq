import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parseArgs } from "node:util";
import { z } from "zod";

type Json = Record<string, unknown>;

interface RunRow {
  runId: string;
  repository: string;
  pullRequestNumber: number;
  promptVersion: string | null;
  publicationPolicyVersion: string | null;
  recordSchemaVersion: number;
  findingIdentityAvailable: boolean;
  taskType: string | null;
  originatingAgent: string | null;
  changeSizeBand: string | null;
  publishedFindingCount: number;
  riskSignals: string[];
  repositoryAreas: string[];
  triggeredAt: Date | null;
  runCostUsd: number;
}

interface FindingRow {
  runId: string;
  repository: string;
  pullRequestNumber: number;
  findingId: string;
  sourceModels: string[];
  promptVersion: string | null;
  outcome: string | null;
  outcomeAt: Date | null;
  accepted: boolean;
  fixed: boolean;
  rejected: boolean;
  noResponse: boolean;
}

interface CallRow {
  runId: string;
  pullRequestNumber: number;
  model: string;
  role: string | null;
  promptVersion: string | null;
  publicationPolicyVersion: string | null;
  findingIdentityAvailable: boolean;
  inputTokens: number;
  cachedInputTokens: number;
  uncachedInputTokens: number;
}

interface Subset {
  runs: RunRow[];
  findings: FindingRow[];
  calls: CallRow[];
}

interface MetricEntry {
  value: number | null;
  sampleSize: number;
  insufficientSampleSize?: boolean;
  unavailable?: string;
}

const ReviewEfficiencyBaselineSchema = z.object({
  modelCallsPerPullRequest: z.number().positive(),
  uncachedInputTokensPerPullRequest: z.number().positive(),
  baselineId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  sample: z.object({
    pullRequests: z.number().int().positive(),
    reviewRuns: z.number().int().positive(),
    modelCalls: z.number().int().positive(),
  }).strict().optional(),
});
type ReviewEfficiencyBaseline = z.infer<typeof ReviewEfficiencyBaselineSchema>;

interface Metrics {
  acceptanceRate: MetricEntry;
  fixThroughRate: MetricEntry;
  noiseRate: MetricEntry;
  noResponseShare: MetricEntry;
  costPerAcceptedFindingUsd: MetricEntry;
  tokenEfficiency: {
    acceptedFindingsPerMillionUncachedTokens: MetricEntry;
    cacheHitRate: MetricEntry;
  };
  reviewEfficiency: {
    modelCallsPerPullRequest: MetricEntry;
    uncachedInputTokensPerPullRequest: MetricEntry;
    baseline: {
      baselineId?: string;
      sample?: { pullRequests: number; reviewRuns: number; modelCalls: number };
      modelCallsPerPullRequest: { value: number; ratio: number | null };
      uncachedInputTokensPerPullRequest: { value: number; ratio: number | null };
    } | null;
  };
  timeToUsefulFinding: {
    basis: "first-review-trigger";
    medianMs: MetricEntry;
    maxMs: MetricEntry;
    pullRequestsWithAcceptedFinding: number;
  };
}

interface SampleSizes {
  reviewRuns: number;
  pullRequests: number;
  modelCalls: number;
  publishedFindings: number;
  adjudicatedFindings: number;
  legacyPublishedFindings: number;
}

interface SliceValue {
  key: string;
  sampleSizes: SampleSizes;
  metrics: Metrics | null;
  mixedCompatibility?: boolean;
  outcomeAttribution?: "available" | "unavailable";
}

const ALL_DIMENSIONS = [
  "model",
  "prompt",
  "repository-area",
  "risk",
  "change-size",
  "task-type",
  "originating-agent",
] as const;
const UNKNOWN = "(unknown)";
const CACHE_ROOT = process.env.AI_REVIEW_SCORECARD_CACHE || path.join(os.homedir(), ".cache", "ai-review");

class UsageError extends Error {}

const USAGE =
  "usage: tsx analytics/report.ts [--marts <dir>] [--output <dir>] [--format json|markdown|both] " +
  "[--slices <list>] [--min-sample-size <n>] [--allow-mixed-compatibility] [--baseline <file>] [--title <text>]";

function fail(message: string): never {
  throw new Error(message);
}

function usageError(message: string): never {
  throw new UsageError(message);
}

function resolveExistingPath(value: string, label: string): string {
  if (value.includes("\u0000")) fail(`${label} contains invalid characters`);
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) fail(`${label} not found: ${resolved}`);
  return resolved;
}

function readRows(martsDir: string, mart: string): Json[] {
  const file = path.join(resolveExistingPath(martsDir, "marts directory"), `${mart}.parquet`);
  if (!fs.existsSync(file)) fail(`missing mart: ${file}`);
  const escaped = file.replaceAll("'", "''");
  const result = spawnSync(
    "duckdb",
    ["-json", "-noheader", "-c", `SET TimeZone='UTC'; SELECT * FROM read_parquet('${escaped}')`],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, shell: false },
  );
  if (result.error || result.status !== 0) {
    fail(`duckdb failed reading ${file}: ${result.stderr?.trim() ?? result.error?.message}`);
  }
  const parsed: unknown = JSON.parse(result.stdout || "[]");
  if (!Array.isArray(parsed)) fail(`unexpected duckdb output for ${file}`);
  return parsed as Json[];
}

function num(value: unknown, fallback: number | null = null): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  if (typeof value === "bigint") return Number(value);
  return fallback;
}

function bool(value: unknown): boolean {
  return value === true || value === "true";
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.trim().startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return [];
    }
  }
  return [];
}

function parseTimestamp(value: unknown): Date | null {
  const text = str(value);
  if (!text) return null;
  const normalized = text
    .replace(" ", "T")
    .replace(/([+-]\d{2})$/, "$1:00")
    .replace(/(\.\d{3})\d+$/, "$1");
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? null : new Date(ms);
}

function sortRows<T>(rows: T[], key: (row: T) => string): T[] {
  return rows.sort((left, right) => key(left).localeCompare(key(right)));
}

function loadSubset(martsDir: string): Subset {
  const runRows = sortRows(readRows(martsDir, "review_run_fact"), (row) =>
    [str(row.repository), num(row.pull_request_number, 0), str(row.run_id)].join("|"),
  ).map(
    (row): RunRow => ({
      runId: String(row.run_id),
      repository: String(row.repository),
      pullRequestNumber: Number(row.pull_request_number),
      promptVersion: str(row.prompt_version),
      publicationPolicyVersion: str(row.publication_policy_version),
      recordSchemaVersion: num(row.record_schema_version, 2) ?? 2,
      findingIdentityAvailable: bool(row.finding_identity_available),
      taskType: str(row.task_type),
      originatingAgent: str(row.originating_agent),
      changeSizeBand: str(row.change_size_band),
      publishedFindingCount: num(row.published_finding_count, 0) ?? 0,
      riskSignals: stringList(row.risk_signals),
      repositoryAreas: stringList(row.repository_areas),
      triggeredAt: parseTimestamp(row.triggered_at),
      runCostUsd: num(row.run_cost_usd, 0) ?? 0,
    }),
  );
  const findingRows = sortRows(readRows(martsDir, "finding_latest"), (row) =>
    [str(row.repository), num(row.pull_request_number, 0), str(row.finding_id)].join("|"),
  ).map(
    (row): FindingRow => ({
      runId: String(row.run_id),
      repository: String(row.repository),
      pullRequestNumber: Number(row.pull_request_number),
      findingId: String(row.finding_id),
      sourceModels: stringList(row.source_models),
      promptVersion: str(row.prompt_version),
      outcome: str(row.outcome),
      outcomeAt: parseTimestamp(row.outcome_at),
      accepted: bool(row.accepted),
      fixed: bool(row.fixed),
      rejected: bool(row.rejected),
      noResponse: bool(row.no_response),
    }),
  );
  const callRows = sortRows(readRows(martsDir, "model_run_fact"), (row) =>
    [str(row.run_id), str(row.model)].join("|"),
  ).map(
    (row): CallRow => ({
      runId: String(row.run_id),
      pullRequestNumber: Number(row.pull_request_number),
      model: String(row.model),
      role: str(row.role),
      promptVersion: str(row.prompt_version),
      publicationPolicyVersion: str(row.publication_policy_version),
      findingIdentityAvailable: bool(row.finding_identity_available),
      inputTokens: num(row.input_tokens, 0) ?? 0,
      cachedInputTokens: num(row.cached_input_tokens, 0) ?? 0,
      uncachedInputTokens: num(row.uncached_input_tokens, 0) ?? 0,
    }),
  );
  return { runs: runRows, findings: findingRows, calls: callRows };
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const low = sorted[middle - 1];
  const high = sorted[middle];
  if (low === undefined || high === undefined) return null;
  return (low + high) / 2;
}

interface MetricOptions {
  minSampleSize: number;
  baseline: ReviewEfficiencyBaseline | null;
}

function entry(
  value: number | null,
  sampleSize: number,
  options: MetricOptions,
  unavailable?: string,
): MetricEntry {
  const metric: MetricEntry = { value: value === null ? null : round6(value), sampleSize };
  if (unavailable) metric.unavailable = unavailable;
  if (value !== null && sampleSize < options.minSampleSize) {
    metric.value = null;
    metric.insufficientSampleSize = true;
  }
  return metric;
}

function prKey(repository: string, pullRequestNumber: number): string {
  return `${repository}#${pullRequestNumber}`;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
function latencyMetricsFor(subset: Subset): number[] {
  const firstTriggerByPullRequest = new Map<string, number>();
  for (const run of subset.runs) {
    if (!run.findingIdentityAvailable || run.triggeredAt === null) continue;
    const key = prKey(run.repository, run.pullRequestNumber);
    const existing = firstTriggerByPullRequest.get(key);
    if (existing === undefined || run.triggeredAt.getTime() < existing) {
      firstTriggerByPullRequest.set(key, run.triggeredAt.getTime());
    }
  }
  const latencyByPullRequest = new Map<string, number>();
  for (const finding of subset.findings) {
    if (!finding.accepted || finding.outcomeAt === null) continue;
    const firstTrigger = firstTriggerByPullRequest.get(prKey(finding.repository, finding.pullRequestNumber));
    if (firstTrigger === undefined) continue;
    const latency = finding.outcomeAt.getTime() - firstTrigger;
    const existing = latencyByPullRequest.get(prKey(finding.repository, finding.pullRequestNumber));
    if (existing === undefined || latency < existing) {
      latencyByPullRequest.set(prKey(finding.repository, finding.pullRequestNumber), latency);
    }
  }
  return [...latencyByPullRequest.values()];
}

function metricsFor(subset: Subset, options: MetricOptions): Metrics {
  const identityRuns = subset.runs.filter((run) => run.findingIdentityAvailable);
  const identityCalls = subset.calls.filter((call) => call.findingIdentityAvailable);
  const published = subset.findings.length;
  const accepted = subset.findings.filter((finding) => finding.accepted).length;
  const fixed = subset.findings.filter((finding) => finding.fixed).length;
  const rejected = subset.findings.filter((finding) => finding.rejected).length;
  const noResponse = subset.findings.filter((finding) => finding.noResponse).length;
  const adjudicated = accepted + rejected;
  const identityCost = identityRuns.reduce((total, run) => total + run.runCostUsd, 0);
  const identityUncached = identityCalls.reduce((total, call) => total + call.uncachedInputTokens, 0);
  const inputTokens = identityCalls.reduce((total, call) => total + call.inputTokens, 0);
  const cachedTokens = identityCalls.reduce((total, call) => total + call.cachedInputTokens, 0);
  const identityPullRequests = new Set(
    identityRuns.map((run) => prKey(run.repository, run.pullRequestNumber)),
  ).size;

  const latencies = latencyMetricsFor(subset);
  const medianLatency = median(latencies);
  const maxLatency = latencies.length > 0 ? Math.max(...latencies) : null;

  const baseline = options.baseline;
  const modelCallsPerPullRequest =
    identityPullRequests > 0 ? identityCalls.length / identityPullRequests : null;
  const uncachedTokensPerPullRequest =
    identityPullRequests > 0 ? identityUncached / identityPullRequests : null;
  const modelCallsSuppressed = identityPullRequests < options.minSampleSize;
  const uncachedSuppressed =
    modelCallsPerPullRequest === null ||
    uncachedTokensPerPullRequest === null ||
    identityPullRequests < options.minSampleSize;
  return {
    acceptanceRate: entry(
      adjudicated > 0 ? accepted / adjudicated : null,
      adjudicated,
      options,
    ),
    fixThroughRate: entry(published > 0 ? fixed / published : null, published, options),
    noiseRate: entry(published > 0 ? rejected / published : null, published, options),
    noResponseShare: entry(published > 0 ? noResponse / published : null, published, options),
    costPerAcceptedFindingUsd: entry(
      accepted > 0 ? identityCost / accepted : null,
      accepted,
      options,
    ),
    tokenEfficiency: {
      acceptedFindingsPerMillionUncachedTokens: entry(
        accepted > 0 && identityUncached > 0 ? (accepted * 1_000_000) / identityUncached : null,
        accepted,
        options,
      ),
      cacheHitRate: entry(
        inputTokens > 0 ? cachedTokens / inputTokens : null,
        identityCalls.length,
        options,
      ),
    },
    reviewEfficiency: {
      modelCallsPerPullRequest: entry(modelCallsPerPullRequest, identityPullRequests, options),
      uncachedInputTokensPerPullRequest: entry(
        uncachedTokensPerPullRequest,
        identityPullRequests,
        options,
      ),
      baseline:
        baseline &&
        !modelCallsSuppressed &&
        !uncachedSuppressed &&
        modelCallsPerPullRequest !== null &&
        uncachedTokensPerPullRequest !== null
          ? {
              baselineId: baseline.baselineId,
              sample: baseline.sample,
              modelCallsPerPullRequest: {
                value: baseline.modelCallsPerPullRequest,
                ratio: round6(modelCallsPerPullRequest / baseline.modelCallsPerPullRequest),
              },
              uncachedInputTokensPerPullRequest: {
                value: baseline.uncachedInputTokensPerPullRequest,
                ratio: round6(
                  uncachedTokensPerPullRequest / baseline.uncachedInputTokensPerPullRequest,
                ),
              },
            }
          : null,
    },
    timeToUsefulFinding: {
      basis: "first-review-trigger",
      medianMs: entry(medianLatency, latencies.length, options),
      maxMs: entry(maxLatency, latencies.length, options),
      pullRequestsWithAcceptedFinding: latencies.length,
    },
  };
}

function sampleSizesFor(subset: Subset): SampleSizes {
  return {
    reviewRuns: subset.runs.length,
    pullRequests: new Set(subset.runs.map((run) => prKey(run.repository, run.pullRequestNumber)))
      .size,
    modelCalls: subset.calls.length,
    publishedFindings: subset.findings.length,
    adjudicatedFindings: subset.findings.filter(
      (finding) => finding.accepted || finding.rejected,
    ).length,
    legacyPublishedFindings: subset.runs
      .filter((run) => !run.findingIdentityAvailable)
      .reduce((total, run) => total + run.publishedFindingCount, 0),
  };
}

function identityRunCount(subset: Subset): number {
  return subset.runs.filter((run) => run.findingIdentityAvailable).length;
}

function compatibilityClasses(subset: Subset): string[] {
  const classes = new Set<string>();
  for (const call of subset.calls) {
    classes.add(
      `${call.role ?? UNKNOWN}\u0000${call.promptVersion ?? UNKNOWN}|${call.publicationPolicyVersion ?? UNKNOWN}`,
    );
  }
  for (const finding of subset.findings) {
    const run = subset.runs.find((candidate) => candidate.runId === finding.runId);
    classes.add(
      `scout\u0000${finding.promptVersion ?? UNKNOWN}|${run?.publicationPolicyVersion ?? UNKNOWN}`,
    );
  }
  return sortStrings([...classes]);
}

function assignRuns(subset: Subset, keyOf: (run: RunRow) => string[]): Map<string, Subset> {
  const buckets = new Map<string, Subset>();
  const bucketFor = (key: string): Subset => bucketIn(buckets, key);
  const runBuckets = new Map<string, string[]>();
  for (const run of subset.runs) {
    const keys = keyOf(run);
    runBuckets.set(run.runId, keys);
    for (const key of keys) bucketFor(key).runs.push(run);
  }
  for (const finding of subset.findings) {
    const keys = runBuckets.get(finding.runId) ?? [UNKNOWN];
    for (const key of keys) bucketFor(key).findings.push(finding);
  }
  for (const call of subset.calls) {
    const run = subset.runs.find((candidate) => candidate.runId === call.runId);
    const keys = run ? (runBuckets.get(run.runId) ?? [UNKNOWN]) : [UNKNOWN];
    for (const key of keys) bucketFor(key).calls.push(call);
  }
  return buckets;
}

function sortedKeys(buckets: Map<string, Subset>): string[] {
  return [...buckets.keys()].sort((left, right) => {
    if (left === UNKNOWN) return 1;
    if (right === UNKNOWN) return -1;
    return left.localeCompare(right);
  });
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sortStrings(values: string[]): string[] {
  return values.sort(compareStrings);
}

function newSubset(): Subset {
  return { runs: [], findings: [], calls: [] };
}

function bucketIn(buckets: Map<string, Subset>, key: string): Subset {
  const existing = buckets.get(key);
  if (existing) return existing;
  const created = newSubset();
  buckets.set(key, created);
  return created;
}

function buildModelBuckets(subset: Subset): Map<string, Subset> {
  const buckets = new Map<string, Subset>();
  for (const call of subset.calls) {
    const bucket = bucketIn(buckets, call.model);
    bucket.calls.push(call);
    const run = subset.runs.find((candidate) => candidate.runId === call.runId);
    if (run && !bucket.runs.some((candidate) => candidate.runId === run.runId)) {
      bucket.runs.push(run);
    }
  }
  for (const finding of subset.findings) {
    for (const model of finding.sourceModels) {
      const bucket = bucketIn(buckets, model);
      bucket.findings.push(finding);
      const run = subset.runs.find((candidate) => candidate.runId === finding.runId);
      if (run && !bucket.runs.some((candidate) => candidate.runId === run.runId)) {
        bucket.runs.push(run);
      }
    }
  }
  return buckets;
}

function runDimensionKeys(dimension: string, run: RunRow): string[] {
  switch (dimension) {
    case "prompt":
      return [run.promptVersion ?? UNKNOWN];
    case "repository-area":
      return run.repositoryAreas.length > 0 ? run.repositoryAreas : [UNKNOWN];
    case "risk":
      return run.riskSignals.length > 0 ? run.riskSignals : [UNKNOWN];
    case "change-size":
      return [run.changeSizeBand ?? UNKNOWN];
    case "task-type":
      return [run.taskType ?? UNKNOWN];
    case "originating-agent":
      return [run.originatingAgent ?? UNKNOWN];
    default:
      fail(`unknown slice dimension: ${dimension}`);
  }
}

function buildSlices(
  subset: Subset,
  dimensions: readonly string[],
  options: MetricOptions,
  allowMixed: boolean,
): Json[] {
  return dimensions.map((dimension) => {
    const buckets =
      dimension === "model"
        ? buildModelBuckets(subset)
        : assignRuns(subset, (run) => runDimensionKeys(dimension, run));
    const values: SliceValue[] = sortedKeys(buckets).map((key) => {
      const bucket = buckets.get(key);
      if (!bucket) fail(`missing slice bucket ${key}`);
      const classes = compatibilityClasses(bucket);
      const mixed = dimension === "model" && classes.length > 1;
      const value: SliceValue = {
        key,
        sampleSizes: sampleSizesFor(bucket),
        metrics: mixed && !allowMixed ? null : metricsFor(bucket, options),
      };
      if (mixed) value.mixedCompatibility = true;
      if (dimension === "model" && identityRunCount(bucket) === 0) {
        value.outcomeAttribution = "unavailable";
      }
      return value;
    });
    return { dimension, values };
  });
}

interface ModelComparisonEntry extends Json {
  model: string;
  role: string | null;
  promptVersion: string | null;
  publicationPolicyVersion: string | null;
  outcomeAttribution: "available" | "unavailable";
  sampleSizes: SampleSizes;
  metrics: Metrics | null;
  compatibilityClassCount?: number;
}

function buildCompatibilityGroups(subset: Subset): {
  groups: Map<string, { model: string; role: string | null; promptVersion: string | null; policy: string | null; subset: Subset }>;
  classesByModel: Map<string, Set<string>>;
} {
  const groups = new Map<string, { model: string; role: string | null; promptVersion: string | null; policy: string | null; subset: Subset }>();
  const groupFor = (model: string, role: string | null, promptVersion: string | null, policy: string | null) => {
    const key = `${model}\u0000${role ?? UNKNOWN}\u0000${promptVersion ?? UNKNOWN}|${policy ?? UNKNOWN}`;
    const existing = groups.get(key);
    if (existing) return existing;
    const created = { model, role, promptVersion, policy, subset: newSubset() };
    groups.set(key, created);
    return created;
  };
  const runByRunId = new Map(subset.runs.map((run) => [run.runId, run]));
  const pushRun = (bucket: Subset, run: RunRow | undefined) => {
    if (run && !bucket.runs.some((candidate) => candidate.runId === run.runId)) bucket.runs.push(run);
  };
  for (const call of subset.calls) {
    const run = runByRunId.get(call.runId);
    const bucket = groupFor(call.model, call.role, call.promptVersion, call.publicationPolicyVersion);
    bucket.subset.calls.push(call);
    pushRun(bucket.subset, run);
  }
  for (const finding of subset.findings) {
    const run = runByRunId.get(finding.runId);
    for (const model of finding.sourceModels) {
      const bucket = groupFor(model, "scout", finding.promptVersion, run?.publicationPolicyVersion ?? null);
      bucket.subset.findings.push(finding);
      pushRun(bucket.subset, run);
    }
  }
  const classesByModel = new Map<string, Set<string>>();
  for (const [key] of groups) {
    const parts = key.split("\u0000");
    const model = parts[0];
    const className = parts.slice(1).join("\u0000");
    if (!model || !className) continue;
    const set = classesByModel.get(model) ?? new Set<string>();
    set.add(className);
    classesByModel.set(model, set);
  }
  return { groups, classesByModel };
}

function mixedAggregateEntry(
  model: string,
  subset: Subset,
  classCount: number,
  options: MetricOptions,
): ModelComparisonEntry {
  const modelFindings = subset.findings.filter((finding) => finding.sourceModels.includes(model));
  const modelCalls = subset.calls.filter((call) => call.model === model);
  const runIds = new Set<string>();
  for (const call of modelCalls) runIds.add(call.runId);
  for (const finding of modelFindings) runIds.add(finding.runId);
  const modelSubset: Subset = {
    runs: subset.runs.filter((run) => runIds.has(run.runId)),
    findings: modelFindings,
    calls: modelCalls,
  };
  return {
    model,
    role: null,
    promptVersion: null,
    publicationPolicyVersion: null,
    outcomeAttribution: identityRunCount(modelSubset) > 0 ? "available" : "unavailable",
    sampleSizes: sampleSizesFor(modelSubset),
    metrics: metricsFor(modelSubset, options),
    compatibilityClassCount: classCount,
  };
}

function buildModelComparison(
  subset: Subset,
  options: MetricOptions,
  allowMixed: boolean,
): { groupByCompatibility: boolean; entries: ModelComparisonEntry[]; mixedCompatibilityEntries: ModelComparisonEntry[] } {
  const { groups, classesByModel } = buildCompatibilityGroups(subset);
  const entries: ModelComparisonEntry[] = [...groups.entries()]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([, group]) => ({
      model: group.model,
      role: group.role,
      promptVersion: group.promptVersion,
      publicationPolicyVersion: group.policy,
      outcomeAttribution: identityRunCount(group.subset) > 0 ? "available" : "unavailable",
      sampleSizes: sampleSizesFor(group.subset),
      metrics: metricsFor(group.subset, options),
    }));
  const mixedEntries: ModelComparisonEntry[] = [];
  if (allowMixed) {
    for (const model of sortStrings([...classesByModel.keys()])) {
      const classes = classesByModel.get(model);
      if (!classes || classes.size < 2) continue;
      mixedEntries.push(mixedAggregateEntry(model, subset, classes.size, options));
    }
  }
  return { groupByCompatibility: true, entries, mixedCompatibilityEntries: mixedEntries };
}

function readManifest(martsDir: string): Json {
  const file = path.join(resolveExistingPath(martsDir, "marts directory"), "scorecard-manifest.json");
  if (!fs.existsSync(file)) fail(`missing manifest: ${file}`);
  const manifest = JSON.parse(fs.readFileSync(file, "utf8")) as Json;
  if (manifest.schemaVersion !== 1) fail(`unsupported manifest schema version: ${String(manifest.schemaVersion)}`);
  return manifest;
}

function formatRate(value: number | null): string {
  return value === null ? "—" : value.toFixed(4);
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  const abs = Math.abs(ms);
  if (abs < 1000) return `${ms} ms`;
  if (abs < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  if (abs < 3_600_000) return `${(ms / 60_000).toFixed(1)} min`;
  return `${(ms / 3_600_000).toFixed(1)} h`;
}

function metricsRows(metrics: Metrics): Array<[string, string, string]> {
  return [
    [
      "Adjudicated acceptance rate",
      formatRate(metrics.acceptanceRate.value),
      String(metrics.acceptanceRate.sampleSize),
    ],
    [
      "Fix-through rate",
      formatRate(metrics.fixThroughRate.value),
      String(metrics.fixThroughRate.sampleSize),
    ],
    ["Noise rate", formatRate(metrics.noiseRate.value), String(metrics.noiseRate.sampleSize)],
    [
      "No-response share",
      formatRate(metrics.noResponseShare.value),
      String(metrics.noResponseShare.sampleSize),
    ],
    [
      "Cost per accepted finding (USD)",
      metrics.costPerAcceptedFindingUsd.value === null
        ? "—"
        : metrics.costPerAcceptedFindingUsd.value.toFixed(6),
      String(metrics.costPerAcceptedFindingUsd.sampleSize),
    ],
    [
      "Accepted findings per million uncached input tokens",
      formatRate(metrics.tokenEfficiency.acceptedFindingsPerMillionUncachedTokens.value),
      String(metrics.tokenEfficiency.acceptedFindingsPerMillionUncachedTokens.sampleSize),
    ],
    [
      "Cache-hit rate",
      formatRate(metrics.tokenEfficiency.cacheHitRate.value),
      String(metrics.tokenEfficiency.cacheHitRate.sampleSize),
    ],
    [
      "Model calls per PR",
      formatRate(metrics.reviewEfficiency.modelCallsPerPullRequest.value),
      String(metrics.reviewEfficiency.modelCallsPerPullRequest.sampleSize),
    ],
    [
      "Uncached input tokens per PR",
      metrics.reviewEfficiency.uncachedInputTokensPerPullRequest.value === null
        ? "—"
        : String(Math.round(metrics.reviewEfficiency.uncachedInputTokensPerPullRequest.value)),
      String(metrics.reviewEfficiency.uncachedInputTokensPerPullRequest.sampleSize),
    ],
    [
      "Time to useful finding (median)",
      formatDuration(metrics.timeToUsefulFinding.medianMs.value),
      String(metrics.timeToUsefulFinding.medianMs.sampleSize),
    ],
    [
      "Time to useful finding (max)",
      formatDuration(metrics.timeToUsefulFinding.maxMs.value),
      String(metrics.timeToUsefulFinding.maxMs.sampleSize),
    ],
  ];
}

function markdownTable(head: string[], rows: string[][]): string {
  const lines = [
    `| ${head.join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ];
  return lines.join("\n");
}

function renderMarkdown(report: Json): string {
  const lines: string[] = [];
  lines.push(`# ${String(report.title)}`, "");
  const source = report.source as Json;
  lines.push(
    `Source: mart version \`${String(source.martVersion)}\`; record schema versions: ${(source.recordSchemaVersions as number[]).join(", ")}.`,
    "",
  );
  const sampleSizes = report.sampleSizes as Json;
  lines.push(
    "## Sample sizes",
    "",
    markdownTable(
      ["Measure", "Value"],
      Object.entries(sampleSizes).map(([key, value]) => [key, String(value)]),
    ),
    "",
  );
  const censored = report.censoredOutcomes as Json;
  lines.push(
    "## Censored outcomes",
    "",
    markdownTable(
      ["Kind", "Count"],
      Object.entries(censored)
        .filter(([, value]) => typeof value === "number")
        .map(([key, value]) => [key, String(value)]),
    ),
    "",
  );
  const metrics = report.metrics as Metrics;
  lines.push("## Scorecard", "", markdownTable(["Metric", "Value", "Sample size"], metricsRows(metrics)), "");
  if (metrics.reviewEfficiency.baseline) {
    const baseline = metrics.reviewEfficiency.baseline;
    const baselineReference = baseline.baselineId ? ` ${baseline.baselineId}` : "";
    lines.push(
      `Review-efficiency baseline${baselineReference}: ${baseline.modelCallsPerPullRequest.value} model calls/PR and ${baseline.uncachedInputTokensPerPullRequest.value} uncached input tokens/PR. Current-to-baseline ratios are ${baseline.modelCallsPerPullRequest.ratio} and ${baseline.uncachedInputTokensPerPullRequest.ratio}.`,
      "",
    );
  }
  const slices = report.slices as Array<{ dimension: string; values: SliceValue[] }>;
  for (const slice of slices) {
    lines.push(
      `### By ${slice.dimension}`,
      "",
      markdownTable(
        ["Key", "Runs", "PRs", "Published", "Adjudicated", "Acceptance", "Fix-through", "Noise", "No-response", "Flags"],
        // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
        slice.values.map((value) => [
          value.key,
          String(value.sampleSizes.reviewRuns),
          String(value.sampleSizes.pullRequests),
          String(value.sampleSizes.publishedFindings),
          String(value.sampleSizes.adjudicatedFindings),
          value.metrics === null ? "mixed" : formatRate(value.metrics.acceptanceRate.value),
          value.metrics === null ? "mixed" : formatRate(value.metrics.fixThroughRate.value),
          value.metrics === null ? "mixed" : formatRate(value.metrics.noiseRate.value),
          value.metrics === null ? "mixed" : formatRate(value.metrics.noResponseShare.value),
          [
            value.mixedCompatibility ? "mixed-compatibility" : null,
            value.outcomeAttribution === "unavailable" ? "outcome-attribution-unavailable" : null,
          ]
            .filter(Boolean)
            .join(", ") || "—",
        ]),
      ),
      "",
    );
  }
  const comparison = report.modelComparison as { entries: ModelComparisonEntry[]; mixedCompatibilityEntries: ModelComparisonEntry[] };
  lines.push(
    "## Model comparison",
    "",
    markdownTable(
      ["Model", "Role", "Prompt", "Publication policy", "Calls", "Published", "Adjudicated", "Token efficiency", "Outcome attribution"],
      comparison.entries.map((entryItem) => [
        entryItem.model,
        entryItem.role ?? UNKNOWN,
        entryItem.promptVersion ?? UNKNOWN,
        entryItem.publicationPolicyVersion ?? UNKNOWN,
        String(entryItem.sampleSizes.modelCalls),
        String(entryItem.sampleSizes.publishedFindings),
        String(entryItem.sampleSizes.adjudicatedFindings),
        entryItem.metrics === null
          ? "—"
          : formatRate(entryItem.metrics.tokenEfficiency.acceptedFindingsPerMillionUncachedTokens.value),
        entryItem.outcomeAttribution,
      ]),
    ),
    "",
  );
  if (comparison.mixedCompatibilityEntries.length > 0) {
    lines.push(
      "### Mixed-compatibility aggregates (opt-in)",
      "",
      markdownTable(
        ["Model", "Classes", "Published", "Acceptance", "Token efficiency"],
        comparison.mixedCompatibilityEntries.map((entryItem) => [
          `${entryItem.model} (all roles)`,
          String(entryItem.compatibilityClassCount ?? 1),
          String(entryItem.sampleSizes.publishedFindings),
          entryItem.metrics === null ? "—" : formatRate(entryItem.metrics.acceptanceRate.value),
          entryItem.metrics === null
            ? "—"
            : formatRate(entryItem.metrics.tokenEfficiency.acceptedFindingsPerMillionUncachedTokens.value),
        ]),
      ),
      "",
    );
  }
  lines.push("## Notes", "");
  for (const note of report.notes as string[]) lines.push(`- ${note}`);
  lines.push("");
  return lines.join("\n");
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
function main(): void {
  const args = parseArgs({
    options: {
      marts: { type: "string", default: path.join(CACHE_ROOT, "marts", "v1") },
      output: { type: "string", default: path.join(CACHE_ROOT, "report") },
      format: { type: "string", default: "both" },
      slices: { type: "string", default: ALL_DIMENSIONS.join(",") },
      "min-sample-size": { type: "string", default: "1" },
      "allow-mixed-compatibility": { type: "boolean", default: false },
      baseline: { type: "string" },
      title: { type: "string", default: "AI review scorecard report" },
    },
  });
  const { values } = args;
  if (!values.marts) usageError("--marts is required");
  if (!values.output) usageError("--output is required");
  if (!fs.existsSync(values.marts)) {
    fail(
      `marts not found at ${values.marts}; build them with ` +
        "mise run //ai-review:scorecard:build (after mise run //ai-review:scorecard:pull) or pass --marts",
    );
  }
  if (!["json", "markdown", "both"].includes(values.format ?? "both")) {
    usageError(`unsupported format: ${values.format}`);
  }
  const minSampleSize = Number(values["min-sample-size"]);
  if (!Number.isInteger(minSampleSize) || minSampleSize < 1) {
    usageError("--min-sample-size must be a positive integer");
  }
  const dimensions = (values.slices ?? "")
    .split(",")
    .map((slice) => slice.trim())
    .filter(Boolean);
  for (const dimension of dimensions) {
    if (!(ALL_DIMENSIONS as readonly string[]).includes(dimension)) {
      usageError(`unknown slice dimension: ${dimension}`);
    }
  }
  let baseline: ReviewEfficiencyBaseline | null = null;
  if (values.baseline) {
    const parsed = JSON.parse(fs.readFileSync(values.baseline, "utf8")) as Json;
    const result = ReviewEfficiencyBaselineSchema.safeParse(parsed);
    if (!result.success) {
      fail("baseline file must contain positive modelCallsPerPullRequest and uncachedInputTokensPerPullRequest values");
    }
    baseline = result.data;
  }

  const martsDir = values.marts;
  const manifest = readManifest(martsDir);
  const subset = loadSubset(martsDir);
  const options: MetricOptions = { minSampleSize, baseline };
  const allowMixed = values["allow-mixed-compatibility"] === true;

  const legacyRuns = subset.runs.filter((run) => !run.findingIdentityAvailable);
  const superseded = subset.findings.filter((finding) => finding.outcome === "superseded").length;
  const incomplete = subset.findings.filter((finding) => finding.outcome === null).length;
  const recordSchemaVersions = [
    ...new Set(subset.runs.map((run) => run.recordSchemaVersion)),
  ].sort((left, right) => left - right);
  const martsManifest = manifest.marts as Record<string, Json>;

  const modelComparison = buildModelComparison(subset, options, allowMixed);

  const report: Json = {
    schemaVersion: 1,
    reportType: "ai-review-scorecard-report",
    reportVersion: 1,
    title: values.title,
    source: {
      martVersion: manifest.martVersion,
      marts: Object.fromEntries(
        Object.entries(martsManifest).map(([name, meta]) => [
          name,
          { sha256: meta.sha256, rows: meta.rows },
        ]),
      ),
      recordSchemaVersions,
    },
    compatibility: {
      key: "role + promptVersion + publicationPolicyVersion",
      uniformByDefault: true,
      mixedCompatibilityAllowed: allowMixed,
    },
    sampleSizes: sampleSizesFor(subset),
    censoredOutcomes: {
      superseded,
      incompleteOutcomes: incomplete,
      legacyFindingsWithoutIdentity: legacyRuns.reduce(
        (total, run) => total + run.publishedFindingCount,
        0,
      ),
    },
    metrics: metricsFor(subset, options),
    slices: buildSlices(subset, dimensions, options, allowMixed),
    modelComparison,
    notes: [
      "Outcome-derived metrics (acceptance, fix-through, noise, no-response share, cost per accepted finding) use only findings with durable finding identities from schema-v2 records; schema-v1 runs contribute spend, token, and call metrics with published-finding counts retained.",
      "The no-response share includes findings labeled no-observable-response and findings whose outcome is still incomplete; superseded findings are censored and excluded from the adjudicated-acceptance denominator, while fix-through and noise keep all published findings as their denominator.",
      "Time to useful finding is measured from the PR's first recorded review trigger because PR-ready timestamps are not recorded; it is reported for PRs with at least one accepted finding.",
      "Model comparisons group by role, prompt version, and publication policy version; the merger is reported separately from scouts because source-model attribution credits scouts only, and pass --allow-mixed-compatibility to aggregate a model across incompatible classes.",
      "Cost per accepted finding counts spend from runs whose findings carry durable identities only, so legacy spend never enters an outcome denominator.",
    ],
  };

  const outputDir = values.output;
  fs.mkdirSync(outputDir, { recursive: true });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = renderMarkdown(report);
  if (values.format === "json" || values.format === "both") {
    fs.writeFileSync(path.join(outputDir, "scorecard-report.json"), json);
  }
  if (values.format === "markdown" || values.format === "both") {
    fs.writeFileSync(path.join(outputDir, "scorecard-report.md"), markdown);
  }
  console.log(`Wrote scorecard report to ${outputDir}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (error instanceof UsageError) console.error(USAGE);
  process.exit(error instanceof UsageError ? 2 : 1);
}
