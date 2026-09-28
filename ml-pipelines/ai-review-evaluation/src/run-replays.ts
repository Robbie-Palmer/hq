import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  expandHome,
  readJson,
  resetDirectory,
  sha256,
  stableJson,
  writeJson,
} from "./artifact-files";
import { parseArgs } from "./cli-arguments";
import { buildEvaluationReadiness } from "./freeze-cohort";
import {
  EvaluationReplayIndexSchema,
  EvaluationReadinessSchema,
  EvaluationReplaySchema,
  FrozenCohortSchema,
  FrozenExperimentSchema,
  PipelineParamsSchema,
  ReplayOutputSchema,
  type DatasetEntry,
  type EvaluationReplayIndex,
  type FrozenExperiment,
  type ReplayOutput,
} from "./schemas";
import type { ReplayExperiment, ReplayProvider } from "ai-review-domain/replay";

const RUNNER_FILES = [
  "analytics/corpus-replay.ts",
  "analytics/replay-claim.ts",
  "src/env.ts",
  "src/finding-lifecycle.ts",
  "src/github-app.ts",
  "src/replay-input.ts",
  "src/replay-runner.ts",
  "src/review-engine.ts",
  "src/reviewer.ts",
  "../packages/ai-review-domain/src/finding-outcomes.ts",
  "../packages/ai-review-domain/src/guardrails.ts",
  "../packages/ai-review-domain/src/reviewer.ts",
  "../packages/ai-review-domain/src/records.ts",
  "../packages/ai-review-domain/src/pull-request-metadata.ts",
  "../packages/ai-review-domain/src/replay.ts",
  "../packages/github-client/src/index.ts",
  "../packages/openrouter-client/src/index.ts",
  "../packages/ts-base/src/http.ts",
  "../packages/ts-base/src/numbers.ts",
  "../packages/ts-base/src/strings.ts",
];

function runnerDigest(aiReviewRoot: string): string {
  const content = RUNNER_FILES.map((relative) => {
    const file = path.resolve(aiReviewRoot, relative);
    return `${relative}\0${fs.readFileSync(file)}`;
  }).join("\0");
  return sha256(content);
}

function lastJsonLine(stdout: string): ReplayOutput {
  const lines = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line) continue;
    try { return ReplayOutputSchema.parse(JSON.parse(line)); } catch { /* Keep looking. */ }
  }
  throw new Error("corpus replay runner produced no JSON result");
}

interface RunLimits {
  allowedProviders: ReplayProvider[];
  maxModels: number;
  maxCostUsdPerReplay: number;
  maxScoutTokens: number;
  maxMergerTokens: number;
  maxRepetitions: number;
  timeoutMs: number;
  requireZeroDataRetention: boolean;
}

interface RunOneOptions {
  aiReviewRoot: string;
  snapshot: string;
  corpusId: string;
  output: string;
  experimentFile: string;
  variantId: string;
  limits: RunLimits;
  repetition: number;
  execute: boolean;
}

function runOne({ aiReviewRoot, snapshot, corpusId, output, experimentFile, variantId, limits, repetition, execute }: RunOneOptions): ReplayOutput {
  const args: string[] = [
    "exec", "tsx", "analytics/corpus-replay.ts",
    "--snapshot", snapshot,
    "--corpus-id", corpusId,
    "--output", output,
    "--experiment", experimentFile,
    "--allowed-providers", limits.allowedProviders.join(","),
    "--max-models", String(limits.maxModels),
    "--max-cost-usd", String(limits.maxCostUsdPerReplay),
    "--max-scout-tokens", String(limits.maxScoutTokens),
    "--max-merger-tokens", String(limits.maxMergerTokens),
    "--max-repetitions", String(limits.maxRepetitions),
    "--timeout-ms", String(limits.timeoutMs),
    "--repetition", String(repetition),
  ];
  if (limits.requireZeroDataRetention) args.push("--require-zero-data-retention");
  if (execute) args.push("--execute");
  const result = spawnSync("pnpm", args, {
    cwd: aiReviewRoot,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`corpus replay failed for ${variantId}/${corpusId}/${repetition}: ${(result.stderr ?? "").trim()}`);
  }
  return lastJsonLine(result.stdout ?? "");
}

interface RunReplaysOptions {
  cohortFile: string;
  experimentFile: string;
  readinessFile: string;
  corpusRoot: string;
  output: string;
  paramsFile: string;
  aiReviewRoot: string;
  cacheRoot?: string;
}

type FrozenVariant = FrozenExperiment["experiment"]["baseline"] & {
  role: "baseline" | "candidate";
};

export function resolveReplayCacheRoot(cacheRoot?: string): string {
  return path.resolve(expandHome(
    cacheRoot ?? path.join(process.env.HOME ?? ".", ".cache/ai-review/evaluation-replays"),
  ));
}

function variantMetadata(experiment: ReplayExperiment): { model: string; provider: string } {
  switch (experiment.kind) {
    case "scout-model":
      return {
        model: experiment.models.map(({ model }) => model).join(","),
        provider: [...new Set(experiment.models.map(({ provider }) => provider))].join(","),
      };
    case "merger-model":
      return { model: experiment.model, provider: "recorded" };
    case "prompt-version":
      return { model: experiment.prompt.version, provider: "recorded" };
    case "coverage-policy":
      return { model: experiment.policy.version, provider: "recorded" };
  }
}

function validatedSnapshots(entries: DatasetEntry[], corpusRoot: string): Map<string, string> {
  return new Map(entries.map((entry) => {
    const snapshot = path.resolve(corpusRoot, entry.snapshotPath);
    const content = fs.readFileSync(snapshot, "utf8");
    if (entry.corpusId !== sha256(content)) {
      throw new Error(`snapshot digest changed after cohort freeze: ${entry.corpusId}`);
    }
    return [entry.corpusId, snapshot];
  }));
}

function skippedBudgetReplay(corpusId: string, repetition: number): ReplayOutput {
  return {
    schemaVersion: 1,
    recordType: "ai-review-replay-result",
    corpusId,
    repetition,
    status: "skipped-total-budget",
    paidInferenceAllowed: false,
    costUsd: 0,
  };
}

function executeReplay({
  entry,
  variant,
  repetition,
  execute,
  spentUsd,
  frozenExperiment,
  aiReviewRoot,
  snapshot,
  storeRoot,
  experimentFile,
}: {
  entry: DatasetEntry;
  variant: FrozenVariant;
  repetition: number;
  execute: boolean;
  spentUsd: number;
  frozenExperiment: FrozenExperiment;
  aiReviewRoot: string;
  snapshot: string;
  storeRoot: string;
  experimentFile: string;
}): ReplayOutput {
  const totalBudget = frozenExperiment.limits.maxTotalCostUsd;
  if (execute && spentUsd >= totalBudget) {
    return skippedBudgetReplay(entry.corpusId, repetition);
  }
  return runOne({
    aiReviewRoot,
    snapshot,
    corpusId: entry.corpusId,
    output: storeRoot,
    experimentFile,
    variantId: variant.id,
    limits: {
      ...frozenExperiment.limits,
      maxCostUsdPerReplay: Math.min(
        frozenExperiment.limits.maxCostUsdPerReplay,
        totalBudget - spentUsd,
      ),
      maxRepetitions: frozenExperiment.experiment.repetitions,
    },
    repetition,
    execute,
  });
}

export function validatedReplayCostUsd(
  replay: ReplayOutput,
  execute: boolean,
  replayIdentity: string,
): number {
  if (replay.costUsd === undefined) {
    if (execute) {
      throw new Error(`executed replay did not report a cost for ${replayIdentity}`);
    }
    return 0;
  }
  if (!Number.isFinite(replay.costUsd) || replay.costUsd < 0) {
    throw new Error(`replay returned an invalid cost for ${replayIdentity}`);
  }
  return replay.costUsd;
}

export function runReplays({ cohortFile, experimentFile, readinessFile, corpusRoot, output, paramsFile, aiReviewRoot, cacheRoot }: RunReplaysOptions): EvaluationReplayIndex {
  const cohort = FrozenCohortSchema.parse(readJson(cohortFile));
  const frozenExperiment = FrozenExperimentSchema.parse(readJson(experimentFile));
  const readiness = EvaluationReadinessSchema.parse(readJson(readinessFile));
  const params = PipelineParamsSchema.parse(readJson(paramsFile));
  if (frozenExperiment.cohortId !== cohort.cohortId) {
    throw new Error("experiment does not belong to the frozen cohort");
  }
  if (readiness.cohortId !== cohort.cohortId || readiness.datasetId !== cohort.datasetId) {
    throw new Error("readiness report does not belong to the frozen cohort");
  }
  const expectedReadiness = buildEvaluationReadiness(cohort, params);
  if (stableJson(readiness) !== stableJson(expectedReadiness)) {
    throw new Error("readiness report does not match the frozen cohort and pipeline parameters");
  }
  const mode = params.replay.mode;
  const execute = mode === "execute";
  if (execute && !readiness.sample.ready && !params.replay.allowUnderpoweredPilot) {
    throw new Error(
      `paid replay blocked: maximum available ${readiness.sample.unit} is ${readiness.sample.maximumAvailable}; ` +
      `the frozen decision requires ${readiness.sample.minimum}. Set replay.allowUnderpoweredPilot=true only for a pipeline pilot`,
    );
  }
  const outputRoot = path.resolve(output);
  resetDirectory(outputRoot);
  const resolvedAiReviewRoot = path.resolve(aiReviewRoot);
  const codeDigest = runnerDigest(resolvedAiReviewRoot);
  const cacheBase = resolveReplayCacheRoot(cacheRoot);
  const storeRoot = path.join(cacheBase, codeDigest);
  fs.mkdirSync(storeRoot, { recursive: true });
  const variants = [
    { ...frozenExperiment.experiment.baseline, role: "baseline" as const },
    { ...frozenExperiment.experiment.candidate, role: "candidate" as const },
  ] satisfies FrozenVariant[];
  const experimentFiles = new Map<string, string>();
  for (const variant of variants) {
    const file = path.join(outputRoot, "_experiments", `${variant.id}.json`);
    writeJson(file, variant.experiment, true);
    experimentFiles.set(variant.id, file);
  }
  const records: string[] = [];
  let spentUsd = 0;
  const snapshots = validatedSnapshots(cohort.entries, corpusRoot);
  const runs = cohort.entries.flatMap((entry) => variants.flatMap((variant) =>
    Array.from({ length: frozenExperiment.experiment.repetitions }, (_, repetition) => ({
      entry,
      variant,
      repetition,
    }))));

  for (const { entry, variant, repetition } of runs) {
    const snapshot = snapshots.get(entry.corpusId);
    const experimentFile = experimentFiles.get(variant.id);
    if (!snapshot || !experimentFile) throw new Error(`missing frozen replay input for ${variant.id}/${entry.corpusId}`);
    const replay = executeReplay({
      entry,
      variant,
      repetition,
      execute,
      spentUsd,
      frozenExperiment,
      aiReviewRoot: resolvedAiReviewRoot,
      snapshot,
      storeRoot,
      experimentFile,
    });
    const replayCostUsd = validatedReplayCostUsd(
      replay,
      execute,
      `${variant.id}/${entry.corpusId}/${repetition}`,
    );
    spentUsd += replayCostUsd;
    if (spentUsd > frozenExperiment.limits.maxTotalCostUsd) {
      throw new Error(`replay results exceeded the fixed total budget of $${frozenExperiment.limits.maxTotalCostUsd}`);
    }
    const metadata = variantMetadata(variant.experiment);
    const wrapper = EvaluationReplaySchema.parse({
      schemaVersion: 1,
      recordType: "ai-review-evaluation-replay",
      cohortId: cohort.cohortId,
      experimentId: frozenExperiment.experimentId,
      runnerDigest: codeDigest,
      datasetId: cohort.datasetId,
      variant: {
        id: variant.id,
        role: variant.role,
        ...metadata,
        experiment: variant.experiment,
      },
      corpusId: entry.corpusId,
      pullRequestNumber: entry.pullRequestNumber,
      repetition,
      replay,
    });
    const file = path.join(outputRoot, "records", variant.id, entry.corpusId, `repetition-${repetition}.json`);
    writeJson(file, wrapper, true);
    records.push(path.relative(outputRoot, file).split(path.sep).join("/"));
  }
  const index = EvaluationReplayIndexSchema.parse({
    schemaVersion: 1,
    recordType: "ai-review-evaluation-replay-index",
    cohortId: cohort.cohortId,
    experimentId: frozenExperiment.experimentId,
    runnerDigest: codeDigest,
    mode,
    spentUsd: Math.round(spentUsd * 1e6) / 1e6,
    records,
  });
  writeJson(path.join(outputRoot, "index.json"), index, true);
  return index;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2), ["cohort", "experiment", "readiness", "corpus", "output", "params", "ai-review-root"]);
  const index = runReplays({
    cohortFile: args.cohort,
    experimentFile: args.experiment,
    readinessFile: args.readiness,
    corpusRoot: args.corpus,
    output: args.output,
    paramsFile: args.params,
    aiReviewRoot: args["ai-review-root"],
    cacheRoot: args.cache,
  });
  process.stdout.write(`${index.mode === "execute" ? "Executed" : "Planned"} ${index.records.length} replay runs\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try { main(); } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
