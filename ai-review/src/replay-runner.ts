import {
  MERGER_MAX_TOKENS,
  OPENROUTER_SCOUT_MAX_PRICES,
} from "./reviewer";
import type { Env, ReviewWorkflowParams } from "./env";
import {
  identifyReviewArtifacts,
  identifyDiffHunks,
  estimateMergeCostCeilingUsd,
  mergeFindings,
  runScouts,
  type IdentifiedReviewArtifacts,
  type MergedRun,
  type PreparedReview,
  type ScoutRun,
} from "./review-engine";
import {
  assertReplaySchemaCompatible,
  stableJson,
} from "./replay-input";
import {
  MAX_REPLAY_TIMEOUT_MS,
  ReplayExperimentSchema,
  ReplayLimitsSchema,
  type ReplayExperiment,
  type ReplayLimits,
  type ReplayProvider as Provider,
} from "ai-review-domain/replay";
import {
  ReplayInputSnapshotSchema,
  type ReplayInputSnapshot,
} from "ai-review-domain/records";
import { sha256Hex as sha256 } from "ts-base/crypto";

type JsonObject = Record<string, unknown>;
const REPLAY_CLAIM_GRACE_MS = 60_000;
export type { ReplayExperiment, ReplayLimits } from "ai-review-domain/replay";
export type { ReplayInputSnapshot } from "ai-review-domain/records";

export interface ReplayStore {
  get(key: string): Promise<string | null>;
  claim(key: string, staleAfterMs: number): Promise<boolean>;
  put(key: string, value: string): Promise<void>;
}

export interface ReplayCorpusStore extends ReplayStore {
  loadSnapshot(corpusId: string): Promise<string | null>;
}

export interface ReplayBoundaryAdapter {
  estimateScoutCostUsd(
    prepared: PreparedReview,
    experiment: ReplayExperiment,
  ): Promise<number | undefined> | number | undefined;
  runScouts(
    prepared: PreparedReview,
    providers: Provider[],
    experiment: ReplayExperiment,
  ): Promise<ScoutRun>;
  estimateMergerCostUsd(
    prepared: PreparedReview,
    scouts: ScoutRun,
    experiment: ReplayExperiment,
  ): Promise<number> | number;
  mergeFindings(
    prepared: PreparedReview,
    scouts: ScoutRun,
    experiment: ReplayExperiment,
  ): Promise<MergedRun>;
  identifyFindings(
    prepared: PreparedReview,
    scouts: ScoutRun,
    merged: MergedRun,
  ): Promise<IdentifiedReviewArtifacts>;
}

export interface ReplayRequest {
  corpusId: string;
  snapshot: unknown;
  experiment: ReplayExperiment;
  limits: ReplayLimits;
  repetition?: number;
  dryRun?: boolean;
}

export interface ReplayDifference {
  variable: ReplayExperiment["kind"];
  production: unknown;
  replay: unknown;
}

export interface ReplayPlan {
  schemaVersion: 1;
  recordType: "ai-review-replay-plan";
  corpusId: string;
  configurationId: string;
  repetition: number;
  resultKey: string;
  differences: ReplayDifference[];
  limits: ReplayLimits;
  paidInferenceAllowed: false;
}

function validateLimits(limits: ReplayLimits): void {
  const result = ReplayLimitsSchema.safeParse(limits);
  if (!result.success) throw new Error(`invalid replay limits: ${zodMessage(result.error)}`);
}

function zodMessage(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`).join("; ");
}

function productionValue(
  snapshot: ReplayInputSnapshot,
  experiment: ReplayExperiment,
): unknown {
  switch (experiment.kind) {
    case "scout-model":
      return [
        ...snapshot.modelRequest.openRouterScouts.map((model) => ({ model, provider: "openrouter" })),
        ...snapshot.modelRequest.openCodeScouts.map((model) => ({ model, provider: "opencode" })),
      ];
    case "merger-model":
      return snapshot.modelRequest.merger;
    case "prompt-version":
      return {
        version: snapshot.prompt.version,
        scoutSystem: snapshot.prompt.scoutSystem,
        mergerSystem: snapshot.prompt.mergerSystem,
      };
    case "coverage-policy":
      return snapshot.policy.coverage ?? null;
  }
}

function replayValue(experiment: ReplayExperiment): unknown {
  if (experiment.kind === "scout-model") return experiment.models;
  if (experiment.kind === "merger-model") return experiment.model;
  if (experiment.kind === "prompt-version") return experiment.prompt;
  return experiment.policy;
}

function validateScoutExperiment(
  experiment: Extract<ReplayExperiment, { kind: "scout-model" }>,
  limits: ReplayLimits,
): void {
  if (experiment.models.length > limits.maxModels) {
    throw new Error(`scout model count must be between 1 and ${limits.maxModels}`);
  }
  for (const { provider } of experiment.models) {
    if (!limits.allowedProviders.includes(provider)) {
      throw new Error(`provider ${provider} is not allowed`);
    }
  }
}

function validateExperimentValue(experiment: ReplayExperiment, limits: ReplayLimits): void {
  const result = ReplayExperimentSchema.safeParse(experiment);
  if (!result.success) throw new Error(`invalid replay experiment: ${zodMessage(result.error)}`);
  if (experiment.kind === "scout-model") validateScoutExperiment(experiment, limits);
}

function recordedProviders(snapshot: ReplayInputSnapshot): Provider[] {
  const providers: Provider[] = [];
  if (snapshot.modelRequest.openRouterScouts.length > 0) providers.push("openrouter");
  if (snapshot.modelRequest.openCodeScouts.length > 0) providers.push("opencode");
  return providers;
}

function validateExperiment(
  snapshot: ReplayInputSnapshot,
  experiment: ReplayExperiment,
  limits: ReplayLimits,
): ReplayDifference[] {
  const allowedKeys: Record<ReplayExperiment["kind"], string[]> = {
    "scout-model": ["kind", "models"],
    "merger-model": ["kind", "model"],
    "prompt-version": ["kind", "prompt"],
    "coverage-policy": ["kind", "policy"],
  };
  if (!allowedKeys[experiment.kind]) throw new Error("unsupported experimental variable");
  const unexpected = Object.keys(experiment).filter(
    (key) => !allowedKeys[experiment.kind].includes(key),
  );
  if (unexpected.length > 0) {
    throw new Error(`replay must declare exactly one experimental variable; unexpected: ${unexpected.join(", ")}`);
  }
  validateExperimentValue(experiment, limits);
  const configuredModelCount = experiment.kind === "scout-model"
    ? experiment.models.length
    : snapshot.modelRequest.openRouterScouts.length + snapshot.modelRequest.openCodeScouts.length;
  if (configuredModelCount > limits.maxModels) {
    throw new Error(`configured scout model count exceeds ${limits.maxModels}`);
  }
  if (!limits.allowedProviders.includes("openrouter")) {
    throw new Error("openrouter must be allowed for the merger boundary");
  }
  if (experiment.kind !== "scout-model") {
    const unauthorized = recordedProviders(snapshot).find(
      (provider) => !limits.allowedProviders.includes(provider),
    );
    if (unauthorized) throw new Error(`recorded provider ${unauthorized} is not allowed`);
  }
  if (snapshot.modelRequest.scoutMaxTokens > limits.maxScoutTokens) {
    throw new Error("recorded scout token limit exceeds replay limit");
  }
  if (snapshot.modelRequest.mergerMaxTokens > limits.maxMergerTokens) {
    throw new Error("recorded merger token limit exceeds replay limit");
  }
  if (
    limits.requireZeroDataRetention &&
    !snapshot.modelRequest.requireZeroDataRetention
  ) {
    throw new Error("replay privacy policy requires zero data retention");
  }
  return [{
    variable: experiment.kind,
    production: productionValue(snapshot, experiment),
    replay: replayValue(experiment),
  }];
}

function replayProviders(snapshot: ReplayInputSnapshot, experiment: ReplayExperiment): Provider[] {
  if (experiment.kind !== "scout-model") return recordedProviders(snapshot);
  return [...new Set(experiment.models.map(({ provider }) => provider))];
}

function replayStatus(scouts: ScoutRun, costUsd: number, maxCostUsd: number): string {
  if (Object.keys(scouts.candidates).length === 0) return "failed";
  if (costUsd > maxCostUsd) return "budget-exceeded";
  return "completed";
}

async function preparedReview(
  snapshot: ReplayInputSnapshot,
  experiment: ReplayExperiment,
): Promise<PreparedReview> {
  const prepared: PreparedReview = {
    baseSha: snapshot.git.baseSha,
    headSha: snapshot.git.headSha,
    diffFingerprint: snapshot.provenance.diffFingerprint,
    configFingerprint: snapshot.provenance.configFingerprint,
    diff: snapshot.input.reviewedDiff,
    fullDiff: snapshot.input.fullDiff,
    context: snapshot.input.boundedFileContext,
    guidelines: snapshot.input.repositoryGuidelines,
    threads: snapshot.input.reviewThreads,
    paths: snapshot.decision.paths,
    omitted: snapshot.decision.omittedPaths,
    hunks: snapshot.decision.reviewedHunks,
    coverage: snapshot.decision.coverage,
    changeProfile: snapshot.decision.changeProfile,
    priorOpenFindings: snapshot.input.priorOpenFindings,
    replayFindings: snapshot.input.affectedOpenFindings,
  };
  if (experiment.kind === "coverage-policy" && experiment.policy.mode === "full") {
    prepared.diff = snapshot.input.fullDiff;
    prepared.paths = [
      ...new Set(
        [...snapshot.input.fullDiff.matchAll(/^diff --git a\/.* b\/(.+)$/gm)]
          .map((match) => match[1])
          .filter((path): path is string => Boolean(path)),
      ),
    ];
    if (prepared.paths.length === 0) prepared.paths = snapshot.decision.paths;
    prepared.hunks = await identifyDiffHunks(snapshot.input.fullDiff);
    prepared.allHunks = prepared.hunks;
    if (prepared.coverage) {
      prepared.coverage = {
        ...prepared.coverage,
        reason: `experimental coverage policy ${experiment.policy.version}`,
        mode: "full",
        totalHunks: prepared.hunks.length,
        reviewedHunkIds: prepared.hunks.map(({ hunkId }) => hunkId),
        unchangedHunkIds: [],
        skippedHunkIds: [],
        paths: prepared.paths,
        skippedPaths: [],
      };
    }
  }
  return prepared;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function replayClaimMaxAgeMs(timeoutMs: number): number {
  return Math.min(timeoutMs, MAX_REPLAY_TIMEOUT_MS) * 3 + REPLAY_CLAIM_GRACE_MS;
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`replay timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function planControlledReplay(request: ReplayRequest): Promise<ReplayPlan> {
  assertReplaySchemaCompatible(request.snapshot);
  const snapshot = ReplayInputSnapshotSchema.parse(request.snapshot);
  validateLimits(request.limits);
  const repetition = request.repetition ?? 0;
  if (!Number.isInteger(repetition) || repetition < 0 || repetition >= request.limits.maxRepetitions) {
    throw new Error(`repetition must be between 0 and ${request.limits.maxRepetitions - 1}`);
  }
  const differences = validateExperiment(snapshot, request.experiment, request.limits);
  const configurationId = await sha256(stableJson({
    corpusId: request.corpusId,
    experiment: request.experiment,
    limits: request.limits,
  }));
  const resultKey = [
    "replays",
    "v1",
    request.corpusId,
    configurationId,
    `repetition-${repetition}.json`,
  ].join("/");
  return {
    schemaVersion: 1,
    recordType: "ai-review-replay-plan",
    corpusId: request.corpusId,
    configurationId,
    repetition,
    resultKey,
    differences,
    limits: request.limits,
    paidInferenceAllowed: false,
  };
}

export async function executeControlledReplay(
  request: ReplayRequest,
  adapter: ReplayBoundaryAdapter,
  store: ReplayStore,
): Promise<JsonObject> {
  const plan = await planControlledReplay(request);
  if (request.dryRun !== false) return plan as unknown as JsonObject;
  const existing = await store.get(plan.resultKey);
  if (existing) return JSON.parse(existing) as JsonObject;
  if (!await store.claim(plan.resultKey, replayClaimMaxAgeMs(request.limits.timeoutMs))) {
    const claimedResult = await store.get(plan.resultKey);
    if (claimedResult) return JSON.parse(claimedResult) as JsonObject;
    throw new Error("replay is already in progress; retry after the active claim expires");
  }
  const snapshot = ReplayInputSnapshotSchema.parse(request.snapshot);
  const prepared = await preparedReview(snapshot, request.experiment);
  const providers = replayProviders(snapshot, request.experiment);
  const started = Date.now();
  let scouts: ScoutRun;
  let merged: MergedRun;
  let artifacts: IdentifiedReviewArtifacts;
  try {
    const scoutCostCeilingUsd = await adapter.estimateScoutCostUsd(
      prepared,
      request.experiment,
    );
    const mergerReservationUsd = await adapter.estimateMergerCostUsd(
      prepared,
      {
        models: [],
        candidates: {},
        candidateCounts: {},
        invalidCounts: {},
        outOfScopeCounts: {},
        failed: [],
        costs: {},
        metrics: [],
      },
      request.experiment,
    );
    if (
      scoutCostCeilingUsd === undefined ||
      scoutCostCeilingUsd + mergerReservationUsd >= request.limits.maxCostUsd
    ) {
      const denied = {
        ...plan,
        recordType: "ai-review-replay-result",
        status: "budget-denied",
        paidInferenceAllowed: false,
        corpusProvenance: snapshot.provenance,
        coverage: prepared.coverage,
        scoutCostCeilingUsd,
        mergerCostCeilingUsd: mergerReservationUsd,
      };
      await store.put(plan.resultKey, stableJson(denied));
      return denied;
    }
    scouts = await withTimeout(
      adapter.runScouts(prepared, providers, request.experiment),
      request.limits.timeoutMs,
    );
    const scoutCostUsd = round6(
      Object.values(scouts.costs).reduce((sum, cost) => sum + cost, 0),
    );
    const mergerCostCeilingUsd = round6(await adapter.estimateMergerCostUsd(
      prepared,
      scouts,
      request.experiment,
    ));
    if (scoutCostUsd + mergerCostCeilingUsd > request.limits.maxCostUsd) {
      const denied = {
        ...plan,
        recordType: "ai-review-replay-result",
        status: "budget-denied",
        paidInferenceAllowed: true,
        corpusProvenance: snapshot.provenance,
        coverage: prepared.coverage,
        scouts,
        costUsd: scoutCostUsd,
        mergerCostCeilingUsd,
      };
      await store.put(plan.resultKey, stableJson(denied));
      return denied;
    }
    merged = await withTimeout(
      adapter.mergeFindings(prepared, scouts, request.experiment),
      request.limits.timeoutMs,
    );
    artifacts = await adapter.identifyFindings(prepared, scouts, merged);
  } catch (error) {
    const failed = {
      ...plan,
      recordType: "ai-review-replay-result",
      status: "failed",
      paidInferenceAllowed: true,
      corpusProvenance: snapshot.provenance,
      coverage: prepared.coverage,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
    await store.put(plan.resultKey, stableJson(failed));
    return failed;
  }
  const modelMetrics = [...scouts.metrics, ...(merged.metric ? [merged.metric] : [])];
  const costUsd = round6(
    Object.values(scouts.costs).reduce((sum, cost) => sum + cost, merged.cost),
  );
  const result = {
    ...plan,
    recordType: "ai-review-replay-result",
    status: replayStatus(scouts, costUsd, request.limits.maxCostUsd),
    paidInferenceAllowed: true,
    productionRunId: snapshot.productionRunId,
    corpusProvenance: snapshot.provenance,
    coverage: prepared.coverage,
    configuration: { experiment: request.experiment, limits: request.limits },
    candidates: artifacts.candidates,
    mergedFindings: artifacts.publishedFindings,
    failures: scouts.failed,
    partialCoverage: scouts.failed.length > 0 && Object.keys(scouts.candidates).length > 0,
    metrics: modelMetrics,
    tokens: modelMetrics.reduce(
      (totals, metric) => ({
        input: totals.input + (metric.usage?.inputTokens ?? 0),
        output: totals.output + (metric.usage?.outputTokens ?? 0),
        cachedInput: totals.cachedInput + (metric.usage?.cachedInputTokens ?? 0),
      }),
      { input: 0, output: 0, cachedInput: 0 },
    ),
    latencyMs: Date.now() - started,
    costUsd,
  };
  await store.put(plan.resultKey, stableJson(result));
  return result;
}

export async function loadReplaySnapshot(
  corpusId: string,
  store: ReplayCorpusStore,
): Promise<ReplayInputSnapshot> {
  const stored = await store.loadSnapshot(corpusId);
  if (!stored) throw new Error(`replay corpus entry not found: ${corpusId}`);
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(stored);
  } catch {
    throw new Error(`replay corpus entry is not valid JSON: ${corpusId}`);
  }
  assertReplaySchemaCompatible(snapshot);
  return ReplayInputSnapshotSchema.parse(snapshot);
}

export async function runControlledReplay(
  request: Omit<ReplayRequest, "snapshot">,
  adapter: ReplayBoundaryAdapter,
  store: ReplayCorpusStore,
): Promise<JsonObject> {
  const snapshot = await loadReplaySnapshot(request.corpusId, store);
  return executeControlledReplay({ ...request, snapshot }, adapter, store);
}

export function createProductionReplayAdapter(options: {
  env: Env;
  params: ReviewWorkflowParams;
  limits: ReplayLimits;
}): ReplayBoundaryAdapter {
  const replayEnv = (experiment: ReplayExperiment): Env => {
    const env = { ...options.env };
    if (options.limits.requireZeroDataRetention) env.AI_REVIEW_ZDR = "true";
    if (experiment.kind === "scout-model") {
      env.AI_REVIEW_MODELS = experiment.models
        .filter(({ provider }) => provider === "openrouter")
        .map(({ model }) => model)
        .join(",");
      env.AI_REVIEW_OPENCODE_MODELS = experiment.models
        .filter(({ provider }) => provider === "opencode")
        .map(({ model }) => model)
        .join(",");
    }
    if (experiment.kind === "merger-model") {
      env.AI_REVIEW_MERGER_MODEL = experiment.model;
    }
    return env;
  };
  return {
    estimateScoutCostUsd: (prepared, experiment) => {
      const env = replayEnv(experiment);
      const settings = experiment.kind === "scout-model"
        ? experiment.models
        : [
            ...(env.AI_REVIEW_MODELS ?? "").split(",").filter(Boolean).map((model) => ({ model, provider: "openrouter" as const })),
            ...(env.AI_REVIEW_OPENCODE_MODELS ?? "").split(",").filter(Boolean).map((model) => ({ model, provider: "opencode" as const })),
          ];
      const promptTokenCeiling = new TextEncoder().encode(JSON.stringify(prepared)).length + 50_000;
      return settings.reduce<number | undefined>((total, { model, provider }) => {
        if (total === undefined || provider !== "openrouter") return undefined;
        const prices = OPENROUTER_SCOUT_MAX_PRICES[model];
        if (!prices) return undefined;
        return total + (
          promptTokenCeiling * prices.prompt +
          Math.min(options.limits.maxScoutTokens, 8_000) * prices.completion
        ) / 1_000_000;
      }, 0);
    },
    estimateMergerCostUsd: (prepared, scouts, experiment) => {
      const env = replayEnv(experiment);
      const systemPrompt = experiment.kind === "prompt-version"
        ? experiment.prompt.mergerSystem
        : undefined;
      return estimateMergeCostCeilingUsd(env, options.params, prepared, scouts, {
        isolated: true,
        systemPrompt,
        maxTokens: Math.min(options.limits.maxMergerTokens, MERGER_MAX_TOKENS),
        timeoutMs: options.limits.timeoutMs,
      }) ?? options.limits.maxCostUsd;
    },
    runScouts: (prepared, providers, experiment) => {
      const systemPrompt = experiment.kind === "prompt-version"
        ? experiment.prompt.scoutSystem
        : undefined;
      return runScouts(replayEnv(experiment), options.params, prepared, {
        providers,
        isolated: true,
        systemPrompt,
        maxTokens: Math.min(options.limits.maxScoutTokens, 8_000),
        timeoutMs: options.limits.timeoutMs,
      });
    },
    mergeFindings: (prepared, scouts, experiment) => {
      const systemPrompt = experiment.kind === "prompt-version"
        ? experiment.prompt.mergerSystem
        : undefined;
      return mergeFindings(replayEnv(experiment), options.params, prepared, scouts, {
        isolated: true,
        systemPrompt,
        maxTokens: Math.min(options.limits.maxMergerTokens, MERGER_MAX_TOKENS),
        timeoutMs: options.limits.timeoutMs,
      });
    },
    identifyFindings: identifyReviewArtifacts,
  };
}
