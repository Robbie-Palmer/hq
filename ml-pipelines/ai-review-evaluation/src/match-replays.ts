import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "./artifact-files";
import { parseArgs } from "./cli-arguments";
import { outcomeClass, type OutcomeLabel } from "./corpus-strata";
import {
  EvaluationReplayIndexSchema,
  EvaluationReplaySchema,
  FrozenCohortSchema,
  FrozenMatchingSchema,
  type DatasetEntry,
  type EvaluationReplay,
  type Finding,
  type HistoricalFinding,
  type MatchingPolicy,
  type ReplayOutput,
} from "./schemas";

type MatchingMethod = MatchingPolicy["methods"][number];

export interface FindingMatch {
  status: "matched" | "manual-adjudication-required" | "unmatched";
  method: MatchingMethod | null;
  confidence: number;
  historicalFindingIds: string[];
  label: OutcomeLabel | null;
  outcome?: string | null;
  outcomeVersion?: number | null;
  outcomeSource?: { key: string; sha256: string } | null;
  evidence: {
    candidateFindingId: string | null;
    file: string | null;
    hunkIds: string[];
    line: number | null;
  };
}

export interface ReplayObservation {
  cohort_id: string;
  experiment_id: string;
  dataset_id: string;
  variant_id: string;
  variant_role: "baseline" | "candidate";
  model: string;
  provider: string;
  corpus_id: string;
  pull_request_number: number;
  task_type: string | null;
  originating_agent: string | null;
  risk: string;
  risk_signals: string[];
  change_size: string;
  languages: string[];
  repository_areas: string[];
  outcome_availability: string;
  repetition: number;
  replay_status: string;
  completed: boolean;
  candidate_finding_count: number;
  accepted_finding_count: number;
  rejected_finding_count: number;
  censored_finding_count: number;
  no_response_finding_count: number;
  unmatched_finding_count: number;
  manual_adjudication_count: number;
  historical_adjudicated_count: number;
  historical_matched_count: number;
  total_hunks: number | null;
  reviewed_hunks: number | null;
  coverage_missing: boolean;
  executed: boolean;
  provider_call_count: number;
  provider_failure_count: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  latency_ms: number | null;
  cost_usd: number;
  [key: string]: string | number | boolean | null | string[];
}

function normalizedFile(value: unknown): string {
  return (typeof value === "string" ? value : "").replace(/^\.\//, "").toLowerCase();
}

function hunkIds(finding: Finding): Set<string> {
  return new Set(finding.hunkIds ?? []);
}

function overlap(left: Set<string>, right: Set<string>): boolean {
  for (const value of left) if (right.has(value)) return true;
  return false;
}

function candidatesForMethod(candidate: Finding, labels: HistoricalFinding[], method: MatchingMethod): HistoricalFinding[] {
  if (method === "finding-id") {
    return labels.filter(({ finding }) =>
      candidate.findingId && candidate.findingId === finding.findingId);
  }
  if (method === "file-hunk") {
    const candidateHunks = hunkIds(candidate);
    if (candidateHunks.size === 0) return [];
    return labels.filter(({ finding }) =>
      normalizedFile(candidate.file) === normalizedFile(finding.file) &&
      overlap(candidateHunks, hunkIds(finding)));
  }
  if (method === "file-line") {
    if (!Number.isInteger(candidate.line)) return [];
    return labels.filter(({ finding }) =>
      normalizedFile(candidate.file) === normalizedFile(finding.file) &&
      Number.isInteger(finding.line) && candidate.line === finding.line);
  }
  throw new Error(`unsupported matching method: ${method}`);
}

const CONFIDENCE: Record<MatchingMethod, number> = { "finding-id": 1, "file-hunk": 0.95, "file-line": 0.9 };

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
export function matchFinding(candidate: Finding, labels: HistoricalFinding[], matching: MatchingPolicy): FindingMatch {
  for (const method of matching.methods) {
    const matches = candidatesForMethod(candidate, labels, method);
    if (matches.length === 0) continue;
    const confidence = CONFIDENCE[method];
    if (matches.length > 1 || confidence < matching.manualAdjudicationBelowConfidence) {
      return {
        status: "manual-adjudication-required",
        method,
        confidence,
        historicalFindingIds: matches.map(({ finding }) => finding.findingId)
          .sort((left, right) => left.localeCompare(right)),
        label: null,
        evidence: {
          candidateFindingId: candidate.findingId ?? null,
          file: candidate.file ?? null,
          hunkIds: [...hunkIds(candidate)].sort((left, right) => left.localeCompare(right)),
          line: candidate.line ?? null,
        },
      };
    }
    const matched = matches[0];
    if (!matched) throw new Error("matching invariant violated");
    return {
      status: "matched",
      method,
      confidence,
      historicalFindingIds: [matched.finding.findingId],
      label: outcomeClass(matched.outcome?.outcome),
      outcome: matched.outcome?.outcome ?? null,
      outcomeVersion: matched.outcome?.outcomeVersion ?? null,
      outcomeSource: matched.outcomeSource,
      evidence: {
        candidateFindingId: candidate.findingId ?? null,
        file: candidate.file ?? null,
        hunkIds: [...hunkIds(candidate)].sort((left, right) => left.localeCompare(right)),
        line: candidate.line ?? null,
      },
    };
  }
  return {
    status: "unmatched",
    method: null,
    confidence: 0,
    historicalFindingIds: [],
    label: "missing",
    evidence: {
      candidateFindingId: candidate.findingId ?? null,
      file: candidate.file ?? null,
      hunkIds: [...hunkIds(candidate)].sort((left, right) => left.localeCompare(right)),
      line: candidate.line ?? null,
    },
  };
}

function replayFindings(replay: ReplayOutput): Finding[] {
  if (replay.recordType !== "ai-review-replay-result") return [];
  return Array.isArray(replay.mergedFindings) ? replay.mergedFindings : [];
}

function sum(values: Array<number | undefined>): number {
  return values.reduce<number>((total, value) => total + Number(value ?? 0), 0);
}

function coverageCounts(entry: DatasetEntry, matches: FindingMatch[]): { adjudicated: number; matched: number } {
  const adjudicatedIds = new Set(entry.historicalFindings
    .filter(({ outcome }) => ["accepted", "rejected"].includes(outcomeClass(outcome?.outcome)))
    .map(({ finding }) => finding.findingId));
  const matchedIds = new Set(matches
    .filter((match) => match.status === "matched")
    .flatMap((match) => match.historicalFindingIds)
    .filter((id) => adjudicatedIds.has(id)));
  return { adjudicated: adjudicatedIds.size, matched: matchedIds.size };
}

interface OutcomeCounts {
  accepted: number;
  rejected: number;
  censored: number;
  noResponse: number;
  missing: number;
  manual: number;
}

function countOutcomes(matches: FindingMatch[]): OutcomeCounts {
  const labelCounts: Record<OutcomeLabel, number> = {
    accepted: 0,
    rejected: 0,
    censored: 0,
    "no-response": 0,
    missing: 0,
  };
  let manual = 0;
  for (const match of matches) {
    if (match.status === "manual-adjudication-required") manual += 1;
    else labelCounts[match.label ?? "missing"] += 1;
  }
  return {
    accepted: labelCounts.accepted,
    rejected: labelCounts.rejected,
    censored: labelCounts.censored,
    noResponse: labelCounts["no-response"],
    missing: labelCounts.missing,
    manual,
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
function runObservation(wrapper: EvaluationReplay, entry: DatasetEntry, matches: FindingMatch[]): ReplayObservation {
  const replay = wrapper.replay;
  const findings = replayFindings(replay);
  const modelMetrics = Array.isArray(replay.metrics) ? replay.metrics : [];
  const failedModels = new Set<string>([
    ...(Array.isArray(replay.failures) ? replay.failures : []),
    ...modelMetrics.filter((metric) => metric.ok === false).map((metric) => metric.model),
  ].filter((model): model is string => typeof model === "string"));
  const coverage = coverageCounts(entry, matches);
  const replayCoverage = replay.coverage ?? entry.coverage;
  const totalHunks = Number(replayCoverage?.totalHunks);
  const reviewedHunks = Array.isArray(replayCoverage?.reviewedHunkIds)
    ? replayCoverage.reviewedHunkIds.length
    : Number.NaN;
  const counts = countOutcomes(matches);
  return {
    cohort_id: wrapper.cohortId,
    experiment_id: wrapper.experimentId,
    dataset_id: wrapper.datasetId,
    variant_id: wrapper.variant.id,
    variant_role: wrapper.variant.role,
    model: wrapper.variant.model,
    provider: wrapper.variant.provider,
    corpus_id: wrapper.corpusId,
    pull_request_number: wrapper.pullRequestNumber,
    task_type: entry.strata.taskType,
    originating_agent: entry.strata.originatingAgent,
    risk: entry.strata.risk,
    risk_signals: entry.strata.riskSignals,
    change_size: entry.strata.changeSize,
    languages: entry.strata.languages,
    repository_areas: entry.strata.repositoryAreas,
    outcome_availability: entry.strata.outcomeAvailability,
    repetition: wrapper.repetition,
    replay_status: replay.status ?? (replay.recordType === "ai-review-replay-plan" ? "planned" : "unknown"),
    completed: replay.status === "completed" || replay.status === "partial",
    candidate_finding_count: findings.length,
    accepted_finding_count: counts.accepted,
    rejected_finding_count: counts.rejected,
    censored_finding_count: counts.censored,
    no_response_finding_count: counts.noResponse,
    unmatched_finding_count: counts.missing,
    manual_adjudication_count: counts.manual,
    historical_adjudicated_count: coverage.adjudicated,
    historical_matched_count: coverage.matched,
    total_hunks: Number.isFinite(totalHunks) ? totalHunks : null,
    reviewed_hunks: Number.isFinite(reviewedHunks) ? reviewedHunks : null,
    coverage_missing: !Number.isFinite(totalHunks) || totalHunks === 0 || !Number.isFinite(reviewedHunks),
    executed: replay.recordType === "ai-review-replay-result" && replay.status !== "skipped-total-budget",
    provider_call_count: Math.max(modelMetrics.length, replay.status === "failed" ? 1 : 0),
    provider_failure_count: Math.max(failedModels.size, replay.status === "failed" ? 1 : 0),
    input_tokens: replay.tokens?.input ?? sum(modelMetrics.map((metric) => metric.usage?.inputTokens)),
    output_tokens: replay.tokens?.output ?? sum(modelMetrics.map((metric) => metric.usage?.outputTokens)),
    cached_input_tokens: replay.tokens?.cachedInput ?? sum(modelMetrics.map((metric) => metric.usage?.cachedInputTokens)),
    latency_ms: typeof replay.latencyMs === "number" && Number.isFinite(replay.latencyMs) ? replay.latencyMs : null,
    cost_usd: Number(replay.costUsd ?? 0),
  };
}

interface BuildObservationsOptions {
  cohortFile: string;
  matchingFile: string;
  replaysRoot: string;
  outputRoot: string;
}

export function buildObservations({ cohortFile, matchingFile, replaysRoot, outputRoot }: BuildObservationsOptions): {
  observations: ReplayObservation[];
  matches: FindingMatch[];
} {
  const cohort = FrozenCohortSchema.parse(readJson(cohortFile));
  const frozenMatching = FrozenMatchingSchema.parse(readJson(matchingFile));
  const index = EvaluationReplayIndexSchema.parse(readJson(path.join(replaysRoot, "index.json")));
  if (frozenMatching.cohortId !== cohort.cohortId) {
    throw new Error("matching policy does not belong to the frozen cohort");
  }
  if (index.cohortId !== cohort.cohortId) throw new Error("replays do not belong to the frozen cohort");
  const entries = new Map<string, DatasetEntry>(cohort.entries.map((entry) => [entry.corpusId, entry]));
  const observations: ReplayObservation[] = [];
  const matches: FindingMatch[] = [];
  for (const relativeFile of index.records) {
    const wrapper = EvaluationReplaySchema.parse(readJson(path.join(replaysRoot, relativeFile)));
    if (wrapper.cohortId !== cohort.cohortId || wrapper.experimentId !== index.experimentId) {
      throw new Error(`replay identity mismatch in ${relativeFile}`);
    }
    const entry = entries.get(wrapper.corpusId);
    if (!entry) throw new Error(`replay references a corpus entry outside the cohort: ${wrapper.corpusId}`);
    const findingMatches = replayFindings(wrapper.replay).map((candidate, findingIndex) => ({
      cohortId: cohort.cohortId,
      experimentId: wrapper.experimentId,
      matchingId: frozenMatching.matchingId,
      datasetId: cohort.datasetId,
      variantId: wrapper.variant.id,
      variantRole: wrapper.variant.role,
      corpusId: wrapper.corpusId,
      pullRequestNumber: wrapper.pullRequestNumber,
      repetition: wrapper.repetition,
      candidateIndex: findingIndex,
      candidate,
      ...matchFinding(candidate, entry.historicalFindings, frozenMatching.matching),
    }));
    matches.push(...findingMatches);
    observations.push(runObservation(wrapper, entry, findingMatches));
  }
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(path.join(outputRoot, "observations.jsonl"), `${observations.map((value) => JSON.stringify(value)).join("\n")}\n`);
  fs.writeFileSync(path.join(outputRoot, "matches.jsonl"), matches.length > 0 ? `${matches.map((value) => JSON.stringify(value)).join("\n")}\n` : "");
  writeJson(path.join(outputRoot, "traceability.json"), {
    schemaVersion: 1,
    cohortId: cohort.cohortId,
    experimentId: index.experimentId,
    matchingId: frozenMatching.matchingId,
    datasetId: cohort.datasetId,
    replayRecords: observations.length,
    candidateFindings: matches.length,
    manualAdjudicationsRequired: matches.filter((match) => match.status === "manual-adjudication-required").length,
  });
  return { observations, matches };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2), ["cohort", "matching", "replays", "output"]);
  const result = buildObservations({
    cohortFile: args.cohort,
    matchingFile: args.matching,
    replaysRoot: args.replays,
    outputRoot: args.output,
  });
  process.stdout.write(`Matched ${result.matches.length} findings across ${result.observations.length} replay records\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try { main(); } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
