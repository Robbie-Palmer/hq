import {
  DurableObject,
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowStepConfig,
} from "cloudflare:workers";
import { sha256Hex } from "ts-base/crypto";
import { isRecord } from "ts-base/records";
import type {
  Env,
  FindingInteractionEvent,
  FindingOutcome,
  PullRequestFinalizationEvent,
  ReviewWorkflowParams,
} from "./env";
import {
  buildFindingOutcomeRecord,
  DEFAULT_FINDING_OUTCOME_EVALUATOR_VERSION,
  evaluateFinalizedFinding,
  type FindingOutcomeBasis,
  type FindingOutcomeManualOverride,
  summarizeFindingInteractions,
} from "./finding-outcomes";
import { guardrailPolicy } from "./guardrails";
import { githubApiClient } from "./github-app";
import type { FindingPublication } from "./finding-lifecycle";
import {
  claimReview,
  combineScoutRuns,
  completeReview,
  failReview,
  identifyReviewArtifacts,
  mergeFindings,
  modelFailureCostUsd,
  prepareReview,
  publishReview,
  publishSkippedReview,
  recordReview,
  recordReviewTerminal,
  runScouts,
  type IdentifiedMergedFinding,
  type IdentifiedReviewArtifacts,
  type FindingResolution,
  type MergedRun,
  type PreparedReview,
  type ReviewHunk,
  type ScoutRun,
} from "./review-engine";
import {
  findingEvidenceKey,
  findingOutcomeKey,
  isCanonicalRepository,
} from "./r2-keys";
import { stableJson } from "./replay-input";
import {
  parseFindingInteraction,
  parsePullRequestFinalization,
  parseReviewEvent,
  verifyGitHubSignature,
} from "./webhook";
import { runMigrations } from "./schema";

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};
const OUTCOME_FLUSH_CONCURRENCY = 20;
const OUTCOME_FLUSH_LIMIT = 100;
const OUTCOME_FLUSH_RETRY_DELAY_MS = 60_000;
const OUTCOME_FLUSH_RETRY_KEY = "pending-finding-outcome-flush";
const PENDING_OUTCOME_EVALUATION_KEY = "pending-outcome-evaluation";
const DEFAULT_OUTCOME_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
const MINIMUM_OUTCOME_WINDOW_MS = 1_000;
const MAXIMUM_OUTCOME_WINDOW_MS = 90 * 24 * 60 * 60 * 1_000;
const MAX_REVIEW_COMPLETION_ITEMS = 10_000;
type FindingOutcomeFlushRetry = {
  kind: "finding-outcomes";
  repository: string;
  pullRequestNumber: number;
};
type ControlledReplayEvidence = {
  runId: string;
  headSha: string;
  verdict: FindingResolution["verdict"];
  evidence: string;
  validatedByFullReviewRunId?: string;
};
type FindingConfirmation = {
  controlledReplay?: ControlledReplayEvidence;
  unconfirmedReason?: "no-fixed-replay" | "stale-fixed-replay";
};
type PendingOutcomeEvaluation = {
  kind: "finding-outcome-evaluation";
  dueAt: number;
  event: PullRequestFinalizationEvent;
};
const DEFAULT_DEBOUNCE_DELAY_MS = 120_000;
const MINIMUM_DEBOUNCE_DELAY_MS = 1_000;
const MAXIMUM_DEBOUNCE_DELAY_MS = 3_600_000;

interface ModelAvailabilityMetric {
  model: string;
  provider: "openrouter" | "opencode";
  ok: boolean;
  error?: string;
}

interface ModelDescriptor {
  model: string;
  provider: "openrouter" | "opencode";
}

interface ModelAvailabilityPlan {
  models: ModelDescriptor[];
}

interface ModelAvailabilityObservation {
  observationId: string;
  policy: {
    version: string;
    consecutiveFailureThreshold: number;
    cooldownSeconds: number;
  };
  metrics: ModelAvailabilityMetric[];
}

interface ReviewClaim {
  runId: string;
  headSha: string;
  diffFingerprint: string;
  configFingerprint: string;
  force: boolean;
  maxRuns: number;
  maxCostUsd: number;
}

interface ReviewBaselineRequest {
  headSha: string;
}

interface ReviewCompletion {
  repository: string;
  pullRequestNumber: number;
  runId: string;
  headSha: string;
  costUsd: number;
  commentId?: number;
  hunks: ReviewHunk[];
  currentHunks?: ReviewHunk[];
  findings: IdentifiedMergedFinding[];
  findingPublications?: FindingPublication[];
  findingResolutions?: FindingResolution[];
}

interface ReviewFailure {
  runId: string;
  error: string;
  costUsd: number;
}

type StoredModelHealth = {
  consecutive_failures: number;
  total_failures: number;
  total_successes: number;
};

function nextModelHealth(
  current: StoredModelHealth | undefined,
  candidate: ModelAvailabilityMetric,
  failureThreshold: number,
  observedAtMs: number,
  cooldownMs: number,
) {
  const totalFailures = Number(current?.total_failures ?? 0);
  const totalSuccesses = Number(current?.total_successes ?? 0);
  if (candidate.ok) {
    return {
      consecutiveFailures: 0,
      totalFailures,
      totalSuccesses: totalSuccesses + 1,
      cooldownUntil: null,
      lastError: null,
    };
  }
  const consecutiveFailures =
    Number(current?.consecutive_failures ?? 0) + 1;
  return {
    consecutiveFailures,
    totalFailures: totalFailures + 1,
    totalSuccesses,
    cooldownUntil:
      consecutiveFailures >= failureThreshold
        ? observedAtMs + cooldownMs
        : null,
    lastError: candidate.error ?? "model call failed",
  };
}
const COORDINATOR_TIMEOUT_MS = 10_000;
const MAXIMUM_WEBHOOK_BODY_BYTES = 2 * 1024 * 1024;
const REVIEW_RUN_LEASE_MS = 30 * 60 * 1_000;
const TERMINAL_WORKFLOW_STATUSES = new Set([
  "complete",
  "errored",
  "terminated",
]);
const PENDING_EVENT_KEY = "latest-pending-event";
const MODEL_STEP_CONFIG = {
  // This is one configured application attempt. Paid and free providers use
  // separate steps so recovery from a stalled free call cannot replay a
  // completed OpenRouter ensemble.
  retries: {
    limit: 1,
    delay: 0,
    backoff: "constant",
  },
  timeout: "10 minutes",
} satisfies WorkflowStepConfig;
const textEncoder = new TextEncoder();

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: JSON_HEADERS });
}

function errorResponse(message: string, status = 400): Response {
  return json({ error: message }, status);
}

async function readValidatedJson<T>(
  request: Request,
  guard: (value: unknown) => value is T,
  invalidMessage: string,
): Promise<T | Response> {
  const value = await request.json().catch(() => null);
  return guard(value) ? value : errorResponse(invalidMessage);
}

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function completionReplayStatus(
  existing:
    | { head_sha: string; status: string; completion_hash: string | null }
    | undefined,
  headSha: string,
  completionHash: string,
): "conflict" | "duplicate" | "missing" {
  if (
    existing?.head_sha !== headSha ||
    existing?.status !== "completed"
  ) {
    return "missing";
  }
  return existing.completion_hash === null ||
    existing.completion_hash === completionHash
    ? "duplicate"
    : "conflict";
}

function coordinatorName(
  event: Pick<ReviewWorkflowParams, "repository" | "pullRequestNumber">,
): string {
  return `${event.repository}#${event.pullRequestNumber}`;
}

function isReviewWorkflowParams(value: unknown): value is ReviewWorkflowParams {
  if (!value || typeof value !== "object") {
    return false;
  }
  const event = value as Partial<ReviewWorkflowParams>;
  return (
    typeof event.deliveryId === "string" &&
    event.deliveryId.length > 0 &&
    typeof event.eventName === "string" &&
    event.eventName.length > 0 &&
    typeof event.action === "string" &&
    event.action.length > 0 &&
    typeof event.repository === "string" &&
    event.repository.length > 0 &&
    typeof event.pullRequestNumber === "number" &&
    Number.isSafeInteger(event.pullRequestNumber) &&
    event.pullRequestNumber > 0 &&
    typeof event.force === "boolean" &&
    (event.headSha === undefined ||
      (typeof event.headSha === "string" && event.headSha.length > 0))
  );
}

function isModelDescriptor(value: unknown): value is ModelDescriptor {
  return (
    isRecord(value) &&
    typeof value.model === "string" &&
    value.model.length > 0 &&
    value.model.length <= 200 &&
    (value.provider === "openrouter" || value.provider === "opencode")
  );
}

function isModelAvailabilityPlan(
  value: unknown,
): value is ModelAvailabilityPlan {
  return (
    isRecord(value) &&
    Array.isArray(value.models) &&
    value.models.length <= 50 &&
    value.models.every(isModelDescriptor)
  );
}

function isModelAvailabilityMetric(
  value: unknown,
): value is ModelAvailabilityMetric {
  return (
    isRecord(value) &&
    typeof value.model === "string" &&
    value.model.length > 0 &&
    value.model.length <= 200 &&
    (value.provider === "openrouter" || value.provider === "opencode") &&
    typeof value.ok === "boolean" &&
    (value.error === undefined ||
      (typeof value.error === "string" && value.error.length <= 500))
  );
}

function isModelAvailabilityObservation(
  value: unknown,
): value is ModelAvailabilityObservation {
  if (!isRecord(value) || !isRecord(value.policy)) return false;
  const policy = value.policy;
  return (
    typeof value.observationId === "string" &&
    value.observationId.length > 0 &&
    value.observationId.length <= 255 &&
    typeof policy.version === "string" &&
    policy.version.trim().length > 0 &&
    policy.version.trim() === policy.version &&
    typeof policy.consecutiveFailureThreshold === "number" &&
    Number.isSafeInteger(policy.consecutiveFailureThreshold) &&
    policy.consecutiveFailureThreshold >= 1 &&
    policy.consecutiveFailureThreshold <= 20 &&
    typeof policy.cooldownSeconds === "number" &&
    Number.isSafeInteger(policy.cooldownSeconds) &&
    policy.cooldownSeconds >= 1 &&
    policy.cooldownSeconds <= 7 * 24 * 60 * 60 &&
    Array.isArray(value.metrics) &&
    value.metrics.length <= 50 &&
    value.metrics.every(isModelAvailabilityMetric)
  );
}

function isReviewClaim(value: unknown): value is ReviewClaim {
  return (
    isRecord(value) &&
    typeof value.runId === "string" &&
    value.runId.length > 0 &&
    value.runId.length <= 255 &&
    typeof value.headSha === "string" &&
    value.headSha.length > 0 &&
    value.headSha.length <= 64 &&
    typeof value.diffFingerprint === "string" &&
    value.diffFingerprint.length > 0 &&
    value.diffFingerprint.length <= 64 &&
    typeof value.configFingerprint === "string" &&
    value.configFingerprint.length > 0 &&
    value.configFingerprint.length <= 64 &&
    typeof value.force === "boolean" &&
    typeof value.maxRuns === "number" &&
    Number.isSafeInteger(value.maxRuns) &&
    value.maxRuns >= 0 &&
    typeof value.maxCostUsd === "number" &&
    Number.isFinite(value.maxCostUsd) &&
    value.maxCostUsd >= 0
  );
}

function isReviewBaselineRequest(
  value: unknown,
): value is ReviewBaselineRequest {
  return (
    isRecord(value) &&
    typeof value.headSha === "string" &&
    value.headSha.length > 0 &&
    value.headSha.length <= 64
  );
}

function isReviewCompletion(value: unknown): value is ReviewCompletion {
  return (
    isRecord(value) &&
    isCanonicalRepository(value.repository) &&
    typeof value.pullRequestNumber === "number" &&
    Number.isSafeInteger(value.pullRequestNumber) &&
    value.pullRequestNumber > 0 &&
    typeof value.runId === "string" &&
    value.runId.length > 0 &&
    value.runId.length <= 255 &&
    typeof value.headSha === "string" &&
    value.headSha.length > 0 &&
    value.headSha.length <= 64 &&
    typeof value.costUsd === "number" &&
    Number.isFinite(value.costUsd) &&
    value.costUsd >= 0 &&
    (value.commentId === undefined ||
      (typeof value.commentId === "number" &&
        Number.isSafeInteger(value.commentId) &&
        value.commentId > 0)) &&
    Array.isArray(value.hunks) &&
    value.hunks.length <= MAX_REVIEW_COMPLETION_ITEMS &&
    value.hunks.every(isReviewHunk) &&
    (value.currentHunks === undefined ||
      (Array.isArray(value.currentHunks) &&
        value.currentHunks.length <= MAX_REVIEW_COMPLETION_ITEMS &&
        value.currentHunks.every(isReviewHunk))) &&
    Array.isArray(value.findings) &&
    value.findings.length <= MAX_REVIEW_COMPLETION_ITEMS &&
    value.findings.every(isIdentifiedFinding) &&
    (value.findingResolutions === undefined ||
      (Array.isArray(value.findingResolutions) &&
        value.findingResolutions.length <= MAX_REVIEW_COMPLETION_ITEMS &&
        value.findingResolutions.every(isFindingResolution))) &&
    (value.findingPublications === undefined ||
      (Array.isArray(value.findingPublications) &&
        value.findingPublications.length <= MAX_REVIEW_COMPLETION_ITEMS &&
        value.findingPublications.every(isFindingPublication)))
  );
}

function isReviewFailure(value: unknown): value is ReviewFailure {
  return (
    isRecord(value) &&
    typeof value.runId === "string" &&
    value.runId.length > 0 &&
    value.runId.length <= 255 &&
    typeof value.error === "string" &&
    value.error.length > 0 &&
    value.error.length <= 4_000 &&
    typeof value.costUsd === "number" &&
    Number.isFinite(value.costUsd) &&
    value.costUsd >= 0
  );
}

function debounceDelayMs(rawSeconds: string): number {
  const seconds = Number(rawSeconds);
  if (!Number.isFinite(seconds)) {
    return DEFAULT_DEBOUNCE_DELAY_MS;
  }
  return Math.min(
    MAXIMUM_DEBOUNCE_DELAY_MS,
    Math.max(MINIMUM_DEBOUNCE_DELAY_MS, seconds * 1_000),
  );
}

function outcomeWindowMs(rawSeconds: string | undefined): number {
  if (rawSeconds === undefined || rawSeconds.trim() === "") {
    return DEFAULT_OUTCOME_WINDOW_MS;
  }
  const seconds = Number(rawSeconds);
  if (!Number.isFinite(seconds)) return DEFAULT_OUTCOME_WINDOW_MS;
  return Math.min(
    MAXIMUM_OUTCOME_WINDOW_MS,
    Math.max(MINIMUM_OUTCOME_WINDOW_MS, seconds * 1_000),
  );
}

function outcomeEvaluatorVersion(env: Env): string {
  const configured = env.AI_REVIEW_OUTCOME_EVALUATOR_VERSION?.trim();
  return configured || DEFAULT_FINDING_OUTCOME_EVALUATOR_VERSION;
}

function isPendingOutcomeEvaluation(
  value: unknown,
): value is PendingOutcomeEvaluation {
  if (!isRecord(value) || value.kind !== "finding-outcome-evaluation") {
    return false;
  }
  return (
    typeof value.dueAt === "number" &&
    Number.isFinite(value.dueAt) &&
    value.dueAt > 0 &&
    isPullRequestFinalizationEvent(value.event)
  );
}

function bindingHealth(env: Env) {
  return {
    durableObject: env.PR_STATE !== undefined,
    r2: env.REVIEW_DATA !== undefined,
    workflow: env.REVIEW_WORKFLOW !== undefined,
  };
}

function isReviewHunk(value: unknown): value is ReviewHunk {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const hunk = value as Partial<ReviewHunk>;
  return (
    typeof hunk.hunkId === "string" &&
    /^h_[a-f0-9]{24}$/.test(hunk.hunkId) &&
    typeof hunk.fingerprint === "string" &&
    /^[a-f0-9]{64}$/.test(hunk.fingerprint) &&
    typeof hunk.file === "string" &&
    hunk.file.length > 0 &&
    typeof hunk.oldStart === "number" &&
    Number.isSafeInteger(hunk.oldStart) &&
    hunk.oldStart >= 0 &&
    typeof hunk.oldLines === "number" &&
    Number.isSafeInteger(hunk.oldLines) &&
    hunk.oldLines >= 0 &&
    typeof hunk.newStart === "number" &&
    Number.isSafeInteger(hunk.newStart) &&
    hunk.newStart >= 0 &&
    typeof hunk.newLines === "number" &&
    Number.isSafeInteger(hunk.newLines) &&
    hunk.newLines >= 0
  );
}

function sameReviewHunk(left: ReviewHunk, right: ReviewHunk): boolean {
  return (
    left.hunkId === right.hunkId &&
    left.fingerprint === right.fingerprint &&
    left.file === right.file &&
    left.oldStart === right.oldStart &&
    left.oldLines === right.oldLines &&
    left.newStart === right.newStart &&
    left.newLines === right.newLines
  );
}

function isIdentifiedFinding(value: unknown): value is IdentifiedMergedFinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const finding = value as Partial<IdentifiedMergedFinding>;
  return (
    typeof finding.findingId === "string" &&
    /^f_[a-f0-9]{24}$/.test(finding.findingId) &&
    typeof finding.file === "string" &&
    finding.file.length > 0 &&
    (finding.line === null ||
      (typeof finding.line === "number" &&
        Number.isSafeInteger(finding.line) &&
        finding.line > 0)) &&
    typeof finding.title === "string" &&
    finding.title.length > 0 &&
    typeof finding.evidence === "string" &&
    typeof finding.recommendation === "string" &&
    typeof finding.confidence === "number" &&
    Number.isFinite(finding.confidence) &&
    finding.confidence >= 0 &&
    finding.confidence <= 1 &&
    (finding.severity === "critical" ||
      finding.severity === "high" ||
      finding.severity === "medium" ||
      finding.severity === "low") &&
    Array.isArray(finding.source_models) &&
    finding.source_models.every(
      (model) => typeof model === "string" && model.length > 0,
    ) &&
    (finding.status === "open" || finding.status === "resolved") &&
    typeof finding.resolution_note === "string" &&
    Array.isArray(finding.hunkIds) &&
    finding.hunkIds.every(
      (hunkId) => typeof hunkId === "string" && /^h_[a-f0-9]{24}$/.test(hunkId),
    )
  );
}

function isFindingPublication(value: unknown): value is FindingPublication {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const publication = value as Partial<FindingPublication>;
  const commentIdIsValid =
    typeof publication.commentId === "number" &&
    Number.isSafeInteger(publication.commentId) &&
    publication.commentId > 0;
  const lineIsPositive =
    typeof publication.line === "number" &&
    Number.isSafeInteger(publication.line) &&
    publication.line > 0;
  const deliveryIsConsistent =
    publication.delivery === "line"
      ? commentIdIsValid
      : publication.delivery === "fallback" && publication.commentId === undefined;
  return (
    typeof publication.findingId === "string" &&
    /^f_[a-f0-9]{24}$/.test(publication.findingId) &&
    deliveryIsConsistent &&
    typeof publication.reconciled === "boolean" &&
    typeof publication.path === "string" &&
    publication.path.length > 0 &&
    (publication.line === null || lineIsPositive)
  );
}

function isFindingResolution(value: unknown): value is FindingResolution {
  if (!isRecord(value)) return false;
  return (
    typeof value.findingId === "string" &&
    /^f_[a-f0-9]{24}$/.test(value.findingId) &&
    ["fixed", "still-present", "uncertain"].includes(
      String(value.verdict),
    ) &&
    typeof value.evidence === "string" &&
    value.evidence.trim().length > 0 &&
    value.evidence.length <= 2_000
  );
}

function storedFindingContext(
  findingsJson: string | null | undefined,
  findingId: string,
): {
  severity?: string;
  line?: number | null;
  evidence?: string;
  recommendation?: string;
} {
  if (!findingsJson) return {};
  try {
    const parsed = JSON.parse(findingsJson) as unknown;
    if (!Array.isArray(parsed)) return {};
    const original = parsed.find(
      (candidate) => isRecord(candidate) && candidate.findingId === findingId,
    );
    if (!isRecord(original)) return {};
    return {
      severity:
        typeof original.severity === "string" ? original.severity : undefined,
      line:
        typeof original.line === "number" || original.line === null
          ? original.line
          : undefined,
      evidence:
        typeof original.evidence === "string" ? original.evidence : undefined,
      recommendation:
        typeof original.recommendation === "string"
          ? original.recommendation
          : undefined,
    };
  } catch {
    return {};
  }
}

function storedFindingResolution(
  resolutionsJson: string | null | undefined,
  findingId: string,
): FindingResolution | undefined {
  if (!resolutionsJson) return undefined;
  try {
    const parsed = JSON.parse(resolutionsJson) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    return parsed.find(
      (candidate): candidate is FindingResolution =>
        isFindingResolution(candidate) && candidate.findingId === findingId,
    );
  } catch {
    return undefined;
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
function isFindingInteractionEvent(
  value: unknown,
): value is FindingInteractionEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Partial<FindingInteractionEvent>;
  return (
    typeof event.deliveryId === "string" &&
    event.deliveryId.length > 0 &&
    event.deliveryId.length <= 255 &&
    typeof event.eventName === "string" &&
    typeof event.action === "string" &&
    typeof event.repository === "string" &&
    typeof event.pullRequestNumber === "number" &&
    Number.isSafeInteger(event.pullRequestNumber) &&
    event.pullRequestNumber > 0 &&
    (event.headSha === undefined ||
      (typeof event.headSha === "string" &&
        event.headSha.length > 0 &&
        event.headSha.length <= 64)) &&
    (event.interactionType === "reply" ||
      event.interactionType === "thread" ||
      event.interactionType === "disposition") &&
    typeof event.actor === "string" &&
    event.actor.length > 0 &&
    (event.threadId === undefined ||
      (typeof event.threadId === "string" && event.threadId.length <= 255)) &&
    (event.body === undefined ||
      (typeof event.body === "string" && event.body.length <= 4_000)) &&
    (event.reason === undefined ||
      (typeof event.reason === "string" &&
        event.reason.trim().length > 0 &&
        event.reason.length <= 1_000)) &&
    (event.findingId === undefined || /^f_[a-f0-9]{24}$/.test(event.findingId)) &&
    (event.rootCommentId === undefined ||
      (Number.isSafeInteger(event.rootCommentId) && event.rootCommentId > 0)) &&
    (event.interactionType !== "disposition" ||
      ((event.findingId !== undefined || event.rootCommentId !== undefined) &&
        (event.disposition === "acknowledged" ||
          event.disposition === "confirmed-fixed" ||
          event.disposition === "rejected"))) &&
    (event.disposition !== "confirmed-fixed" || event.headSha !== undefined) &&
    (event.interactionType === "disposition" || event.rootCommentId !== undefined)
  );
}

async function currentPullRequestHead(
  env: Env,
  event: FindingInteractionEvent,
): Promise<string | undefined> {
  const [owner, repository, ...extra] = event.repository.split("/");
  if (!owner || !repository || extra.length > 0) return undefined;
  const client = await githubApiClient(env, { retries: 1 });
  const pullRequest = await client.request<{ head?: { sha?: unknown } }>(
    "GET",
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/pulls/${event.pullRequestNumber}`,
  );
  return typeof pullRequest?.head?.sha === "string" &&
      pullRequest.head.sha.length > 0
    ? pullRequest.head.sha
    : undefined;
}

async function acknowledgeDispositionReply(
  env: Env,
  event: FindingInteractionEvent,
): Promise<boolean> {
  if (!event.commentId) return false;
  const [owner, repository, ...extra] = event.repository.split("/");
  if (!owner || !repository || extra.length > 0) return false;
  try {
    const client = await githubApiClient(env, { retries: 1 });
    await client.request(
      "POST",
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/pulls/comments/${event.commentId}/reactions`,
      { body: { content: "+1" } },
    );
    return true;
  } catch (error) {
    console.error("Could not acknowledge AI review disposition reply", {
      type: errorType(error),
    });
    return false;
  }
}

function isPullRequestFinalizationEvent(
  value: unknown,
): value is PullRequestFinalizationEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Partial<PullRequestFinalizationEvent>;
  return (
    typeof event.deliveryId === "string" &&
    event.deliveryId.length > 0 &&
    event.deliveryId.length <= 255 &&
    event.eventName === "pull_request" &&
    event.action === "closed" &&
    typeof event.repository === "string" &&
    event.repository.length > 0 &&
    typeof event.pullRequestNumber === "number" &&
    Number.isSafeInteger(event.pullRequestNumber) &&
    event.pullRequestNumber > 0 &&
    typeof event.headSha === "string" &&
    event.headSha.length > 0 &&
    event.headSha.length <= 64 &&
    (event.finalState === "merged" || event.finalState === "closed") &&
    (event.occurredAt === undefined ||
      (typeof event.occurredAt === "string" &&
        event.occurredAt.length <= 64 &&
        !Number.isNaN(Date.parse(event.occurredAt))))
  );
}

function healthResponse(env: Env): Response {
  const bindings = bindingHealth(env);
  const ok = Object.values(bindings).every(Boolean);
  return json(
    {
      ok,
      service: "ai-review",
      enabled: env.AI_REVIEW_ENABLED === "true",
      bindings,
    },
    ok ? 200 : 503,
  );
}

async function readWebhookBody(
  request: Request,
): Promise<{ body: string } | { response: Response }> {
  const declaredBodyBytes = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(declaredBodyBytes) &&
    declaredBodyBytes > MAXIMUM_WEBHOOK_BODY_BYTES
  ) {
    return { response: errorResponse("Webhook payload is too large", 413) };
  }

  const body = await request.text();
  if (textEncoder.encode(body).byteLength > MAXIMUM_WEBHOOK_BODY_BYTES) {
    return { response: errorResponse("Webhook payload is too large", 413) };
  }
  return { body };
}

async function forwardToCoordinator(
  event:
    | ReviewWorkflowParams
    | FindingInteractionEvent
    | PullRequestFinalizationEvent,
  env: Env,
  path = "/events",
): Promise<Response> {
  const id = env.PR_STATE.idFromName(coordinatorName(event));
  try {
    // This fixed URL is the standard Durable Object stub-fetch target; the
    // validated event body contains all provenance the coordinator needs.
    const response = await env.PR_STATE.get(id).fetch(
      `https://coordinator.internal${path}`,
      {
        method: "POST",
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(COORDINATOR_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      console.error("Coordinator rejected a validated webhook", {
        status: response.status,
      });
      if (response.status >= 400 && response.status < 500) {
        return errorResponse("Invalid coordinator request");
      }
      return errorResponse("Coordinator unavailable", 503);
    }
    return response;
  } catch (error) {
    console.error(
      "Coordinator request failed",
      error instanceof Error ? { name: error.name } : { type: typeof error },
    );
    return errorResponse("Coordinator unavailable", 503);
  }
}

export class PullRequestCoordinator extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    runMigrations(this.ctx.storage);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    const path = new URL(request.url).pathname;
    if (path === "/events") return this.receiveEvent(request);
    if (path === "/interactions") return this.receiveInteraction(request);
    if (path === "/finalizations") return this.receiveFinalization(request);
    if (path === "/reviews/claim") return this.claimReview(request);
    if (path === "/reviews/baseline") return this.reviewBaseline(request);
    if (path === "/reviews/complete") return this.completeReview(request);
    if (path === "/reviews/fail") return this.failReview(request);
    if (path === "/models/plan") return this.planModelAvailability(request);
    if (path === "/models/record") return this.recordModelAvailability(request);
    return new Response("Not found", { status: 404 });
  }

  private async planModelAvailability(request: Request): Promise<Response> {
    const body = await readValidatedJson(
      request,
      isModelAvailabilityPlan,
      "Invalid model availability plan",
    );
    if (body instanceof Response) return body;
    const now = Date.now();
    const skipped = body.models.flatMap((model) => {
      const health = this.ctx.storage.sql
        .exec<{
          consecutive_failures: number;
          cooldown_until_ms: number | null;
        }>(
          `SELECT consecutive_failures, cooldown_until_ms
           FROM review_model_health WHERE provider = ? AND model = ?`,
          model.provider,
          model.model,
        )
        .toArray()[0];
      const cooldownUntil = Number(health?.cooldown_until_ms ?? 0);
      if (!health || cooldownUntil <= now) return [];
      return [{
        model: model.model,
        provider: model.provider,
        consecutiveFailures: Number(health.consecutive_failures),
        cooldownUntil: new Date(cooldownUntil).toISOString(),
      }];
    });
    return json({ skipped });
  }

  private async recordModelAvailability(request: Request): Promise<Response> {
    const body = await readValidatedJson(
      request,
      isModelAvailabilityObservation,
      "Invalid model availability observation",
    );
    if (body instanceof Response) return body;
    const policy = body.policy;

    const observedAt = new Date();
    const observedAtIso = observedAt.toISOString();
    const failureThreshold = policy.consecutiveFailureThreshold;
    const cooldownMs = policy.cooldownSeconds * 1_000;
    let recorded = 0;
    this.ctx.storage.transactionSync(() => {
      for (const candidate of body.metrics) {
        const existing = this.ctx.storage.sql
          .exec<{ observation_id: string }>(
            `SELECT observation_id FROM review_model_health_observations
             WHERE observation_id = ? AND provider = ? AND model = ?`,
            body.observationId,
            candidate.provider,
            candidate.model,
          )
          .toArray()[0];
        if (existing) continue;
        const current = this.ctx.storage.sql
          .exec<StoredModelHealth>(
            `SELECT consecutive_failures, total_failures, total_successes
             FROM review_model_health WHERE provider = ? AND model = ?`,
            candidate.provider,
            candidate.model,
          )
          .toArray()[0];
        const next = nextModelHealth(
          current,
          candidate,
          failureThreshold,
          observedAt.getTime(),
          cooldownMs,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO review_model_health
           (model, provider, consecutive_failures, total_failures,
            total_successes, cooldown_until_ms, last_error, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(provider, model) DO UPDATE SET
             consecutive_failures = excluded.consecutive_failures,
             total_failures = excluded.total_failures,
             total_successes = excluded.total_successes,
             cooldown_until_ms = excluded.cooldown_until_ms,
             last_error = excluded.last_error,
             updated_at = excluded.updated_at`,
          candidate.model,
          candidate.provider,
          next.consecutiveFailures,
          next.totalFailures,
          next.totalSuccesses,
          next.cooldownUntil,
          next.lastError,
          observedAtIso,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO review_model_health_observations
           (observation_id, model, provider, ok, error, observed_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          body.observationId as string,
          candidate.model,
          candidate.provider,
          candidate.ok ? 1 : 0,
          candidate.error ?? null,
          observedAtIso,
        );
        recorded += 1;
      }
    });
    return json({ recorded });
  }

  private appendFindingOutcome(options: {
    repository: string;
    pullRequestNumber: number;
    findingId: string;
    outcome: FindingOutcome;
    basis: FindingOutcomeBasis;
    confidence: number;
    evaluatorVersion: string;
    manualOverride?: FindingOutcomeManualOverride;
    sourceId: string;
    occurredAt: string;
    recordedAt: string;
    evidence: Record<string, unknown>;
  }): boolean {
    const existing = this.ctx.storage.sql
      .exec<{ source_id: string }>(
        "SELECT source_id FROM review_finding_outcomes WHERE source_id = ?",
        options.sourceId,
      )
      .toArray()[0];
    if (existing) return false;

    const latest = this.ctx.storage.sql
      .exec<{ outcome_version: number }>(
        `SELECT outcome_version FROM review_finding_outcomes
         WHERE finding_id = ? ORDER BY outcome_version DESC LIMIT 1`,
        options.findingId,
      )
      .toArray()[0];
    const outcomeVersion = Number(latest?.outcome_version ?? 0) + 1;
    const payload = buildFindingOutcomeRecord({
      repository: options.repository,
      pullRequestNumber: options.pullRequestNumber,
      findingId: options.findingId,
      outcome: options.outcome,
      basis: options.basis,
      confidence: options.confidence,
      evaluatorVersion: options.evaluatorVersion,
      manualOverride: options.manualOverride,
      sourceId: options.sourceId,
      outcomeVersion,
      evidence: options.evidence,
      occurredAt: options.occurredAt,
      recordedAt: options.recordedAt,
    });
    const inserted = this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO review_finding_outcomes
       (finding_id, outcome_version, outcome, basis, confidence,
        evaluator_version, manual_override, source_id, payload_json,
        occurred_at, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      options.findingId,
      outcomeVersion,
      options.outcome,
      options.basis,
      options.confidence,
      options.evaluatorVersion,
      options.manualOverride ? 1 : 0,
      options.sourceId,
      JSON.stringify(payload),
      options.occurredAt,
      options.recordedAt,
    );
    return inserted.rowsWritten > 0;
  }

  private async flushFindingOutcomes(
    repository: string,
    pullRequestNumber: number,
  ): Promise<void> {
    const pending = this.ctx.storage.sql
      .exec<{
        finding_id: string;
        outcome_version: number;
        payload_json: string;
      }>(
        `SELECT finding_id, outcome_version, payload_json
         FROM review_finding_outcomes WHERE r2_recorded = 0
         ORDER BY finding_id, outcome_version LIMIT ?`,
        OUTCOME_FLUSH_LIMIT,
      )
      .toArray();
    let recorded = 0;
    for (
      let index = 0;
      index < pending.length;
      index += OUTCOME_FLUSH_CONCURRENCY
    ) {
      const batch = pending.slice(index, index + OUTCOME_FLUSH_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (outcome) => {
          const key = findingOutcomeKey({
            repository,
            pullRequestNumber,
            findingId: outcome.finding_id,
            outcomeVersion: outcome.outcome_version,
          });
          try {
            await this.env.REVIEW_DATA.put(key, outcome.payload_json, {
              httpMetadata: { contentType: "application/json" },
            });
          } catch (error) {
            console.error("Could not publish a finding outcome", {
              type: errorType(error),
            });
            return false;
          }
          this.ctx.storage.sql.exec(
            `UPDATE review_finding_outcomes SET r2_recorded = 1
             WHERE finding_id = ? AND outcome_version = ?`,
            outcome.finding_id,
            outcome.outcome_version,
          );
          return true;
        }),
      );
      recorded += results.filter(Boolean).length;
    }
    const failed = pending.length - recorded;
    if (failed > 0) {
      this.ctx.storage.kv.put(OUTCOME_FLUSH_RETRY_KEY, {
        kind: "finding-outcomes",
        repository,
        pullRequestNumber,
      } satisfies FindingOutcomeFlushRetry);
      const now = Date.now();
      const retryAt = now + OUTCOME_FLUSH_RETRY_DELAY_MS;
      const scheduledAlarm = await this.ctx.storage.getAlarm();
      if (
        scheduledAlarm === null ||
        scheduledAlarm <= now ||
        scheduledAlarm > retryAt
      ) {
        await this.ctx.storage.setAlarm(retryAt);
      }
    } else if (pending.length < OUTCOME_FLUSH_LIMIT) {
      await this.ctx.storage.delete(OUTCOME_FLUSH_RETRY_KEY);
    }
    if (pending.length === OUTCOME_FLUSH_LIMIT && recorded > 0) {
      this.ctx.waitUntil(
        this.flushFindingOutcomes(repository, pullRequestNumber),
      );
    }
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
  private evaluateFinalizedFindings(options: {
    event: PullRequestFinalizationEvent;
    evaluatedAt: string;
    outcomeWindowElapsed: boolean;
    trigger: "pull-request-finalization" | "outcome-window";
  }): { outcomes: number; pending: number; manualRequired: number } {
    const { event } = options;
    const evaluatorVersion = outcomeEvaluatorVersion(this.env);
    const completed = this.ctx.storage.sql
      .exec<{
        run_id: string;
        head_sha: string;
        finding_resolutions_json: string | null;
      }>(
        `SELECT run_id, head_sha, finding_resolutions_json FROM review_runs
         WHERE status = 'completed'
         ORDER BY completed_at DESC, run_id DESC LIMIT 1`,
      )
      .toArray()[0];
    const currentHunkIds = new Set(
      completed
        ? this.ctx.storage.sql
            .exec<{ hunk_id: string }>(
              "SELECT hunk_id FROM review_run_hunks WHERE run_id = ?",
              completed.run_id,
            )
            .toArray()
            .map(({ hunk_id }) => hunk_id)
        : [],
    );
    const finalHeadWasReviewed = completed?.head_sha === event.headSha;
    const findings = this.ctx.storage.sql
      .exec<{
        finding_id: string;
        disposition: string | null;
        disposition_reason: string | null;
        first_seen_head_sha: string;
        last_seen_head_sha: string;
        first_seen_run_id: string;
        last_seen_run_id: string;
      }>(
        `SELECT finding_id, disposition, disposition_reason,
                first_seen_head_sha, last_seen_head_sha,
                first_seen_run_id, last_seen_run_id
         FROM review_findings ORDER BY finding_id`,
      )
      .toArray();
    let outcomes = 0;
    let pending = 0;
    let manualRequired = 0;
    for (const finding of findings) {
      const latestOutcome = this.ctx.storage.sql
        .exec<{ outcome: FindingOutcome; manual_override: number }>(
          `SELECT outcome, manual_override FROM review_finding_outcomes
           WHERE finding_id = ? ORDER BY outcome_version DESC LIMIT 1`,
          finding.finding_id,
        )
        .toArray()[0];
      if (latestOutcome) continue;

      const findingHunkIds = this.ctx.storage.sql
        .exec<{ hunk_id: string }>(
          `SELECT hunk_id FROM review_finding_hunks
           WHERE finding_id = ?`,
          finding.finding_id,
        )
        .toArray()
        .map(({ hunk_id }) => hunk_id);
      const affectedCodeRemains =
        findingHunkIds.length === 0 ||
        findingHunkIds.some((hunkId) => currentHunkIds.has(hunkId));
      const interactions = summarizeFindingInteractions(
        this.ctx.storage.sql
          .exec<{ delivery_id: string; payload_json: string }>(
            `SELECT delivery_id, payload_json FROM review_finding_events
             WHERE finding_id = ? ORDER BY occurred_at, delivery_id`,
            finding.finding_id,
          )
          .toArray(),
      );
      const laterResolution = storedFindingResolution(
        finalHeadWasReviewed ? completed?.finding_resolutions_json : undefined,
        finding.finding_id,
      );
      const evaluation = evaluateFinalizedFinding({
        disposition: finding.disposition,
        finalHeadWasReviewed,
        affectedCodeRemains,
        outcomeWindowElapsed: options.outcomeWindowElapsed,
        interactions,
        laterResolutionVerdict: laterResolution?.verdict,
      });
      const evidence = {
        ...evaluation.evidence,
        finalState: event.finalState,
        finalHeadSha: event.headSha,
        latestReviewedHeadSha: completed?.head_sha,
        dispositionReason: finding.disposition_reason,
        firstSeenHeadSha: finding.first_seen_head_sha,
        lastSeenHeadSha: finding.last_seen_head_sha,
        firstSeenRunId: finding.first_seen_run_id,
        lastSeenRunId: finding.last_seen_run_id,
        laterResolution,
      };
      const evaluationId = [
        "evaluation",
        event.deliveryId,
        options.trigger,
        finding.finding_id,
      ].join(":");
      this.ctx.storage.sql.exec(
        `INSERT OR IGNORE INTO review_finding_evaluations
         (evaluation_id, finding_id, trigger_type, status,
          evaluator_version, evidence_json, evaluated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        evaluationId,
        finding.finding_id,
        options.trigger,
        evaluation.status,
        evaluatorVersion,
        JSON.stringify(evidence),
        options.evaluatedAt,
      );
      if (evaluation.status === "manual-adjudication-required") {
        manualRequired += 1;
        continue;
      }
      if (evaluation.status === "incomplete") {
        pending += 1;
        continue;
      }
      const inserted = this.appendFindingOutcome({
        repository: event.repository,
        pullRequestNumber: event.pullRequestNumber,
        findingId: finding.finding_id,
        outcome: evaluation.outcome,
        basis: evaluation.basis,
        confidence: evaluation.confidence,
        evaluatorVersion,
        sourceId: evaluationId,
        occurredAt:
          options.trigger === "outcome-window"
            ? options.evaluatedAt
            : (event.occurredAt ?? options.evaluatedAt),
        recordedAt: options.evaluatedAt,
        evidence,
      });
      if (inserted) {
        outcomes += 1;
      }
    }
    return { outcomes, pending, manualRequired };
  }

  private async scheduleAlarmNoLaterThan(timestamp: number): Promise<void> {
    const now = Date.now();
    const target = Math.max(now + MINIMUM_OUTCOME_WINDOW_MS, timestamp);
    const scheduled = await this.ctx.storage.getAlarm();
    if (scheduled === null || scheduled <= now || scheduled > target) {
      await this.ctx.storage.setAlarm(target);
    }
  }

  private async schedulePendingOutcomeEvaluation(
    pending: PendingOutcomeEvaluation,
  ): Promise<void> {
    const existing = await this.ctx.storage.get<unknown>(
      PENDING_OUTCOME_EVALUATION_KEY,
    );
    if (
      isPendingOutcomeEvaluation(existing) &&
      existing.dueAt <= pending.dueAt
    ) {
      await this.scheduleAlarmNoLaterThan(existing.dueAt);
      return;
    }
    this.ctx.storage.kv.put(PENDING_OUTCOME_EVALUATION_KEY, pending);
    await this.scheduleAlarmNoLaterThan(pending.dueAt);
  }

  private async terminateExpiredReview(
    completedAt: string,
    leaseCutoff: string,
  ): Promise<void> {
    const expiredRunId = this.ctx.storage.transactionSync(() => {
      const expired = this.ctx.storage.sql
        .exec<{ run_id: string }>(
          `SELECT run_id FROM review_runs
           WHERE status = 'running' AND started_at < ?
           LIMIT 1`,
          leaseCutoff,
        )
        .toArray()[0];
      if (!expired) return undefined;
      const claimed = this.ctx.storage.sql.exec(
        `UPDATE review_runs
         SET status = 'terminating',
             error = 'review lease expired; terminating Workflow'
         WHERE run_id = ? AND status = 'running'`,
        expired.run_id,
      );
      return claimed.rowsWritten > 0 ? expired.run_id : undefined;
    });
    if (!expiredRunId) return;

    try {
      const instance = await this.env.REVIEW_WORKFLOW.get(expiredRunId);
      const { status } = await instance.status();
      if (!TERMINAL_WORKFLOW_STATUSES.has(status)) {
        await instance.terminate();
      }
    } catch (error) {
      this.ctx.storage.sql.exec(
        `UPDATE review_runs
         SET status = 'running',
             error = 'could not terminate expired Workflow'
         WHERE run_id = ? AND status = 'terminating'`,
        expiredRunId,
      );
      throw error;
    }

    this.ctx.storage.sql.exec(
      `UPDATE review_runs
       SET status = 'failed', completed_at = ?,
           error = 'review lease expired; Workflow terminated before replacement'
       WHERE run_id = ? AND status = 'terminating'`,
      completedAt,
      expiredRunId,
    );
  }

  private async receiveEvent(request: Request): Promise<Response> {
    const event = await readValidatedJson(
      request,
      isReviewWorkflowParams,
      "Invalid coordinator event",
    );
    if (event instanceof Response) return event;
    const pending =
      await this.ctx.storage.get<ReviewWorkflowParams>(PENDING_EVENT_KEY);
    const coalesced = pending?.force ? { ...event, force: true } : event;
    const inserted = this.ctx.storage.transactionSync(() => {
      const existing = this.ctx.storage.sql
        .exec<{ delivery_id: string }>(
          "SELECT delivery_id FROM webhook_deliveries WHERE delivery_id = ?",
          event.deliveryId,
        )
        .toArray();
      if (existing.length > 0) {
        return false;
      }

      this.ctx.storage.sql.exec(
        `INSERT INTO webhook_deliveries
        (delivery_id, event_name, action, repository, pull_request_number, head_sha, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
        event.deliveryId,
        event.eventName,
        event.action,
        event.repository,
        event.pullRequestNumber,
        event.headSha ?? null,
        new Date().toISOString(),
      );
      // The coordinator reviews current PR state, so rapid deliveries deliberately
      // coalesce to the latest trigger rather than enqueueing redundant runs.
      this.ctx.storage.kv.put(PENDING_EVENT_KEY, coalesced);
      return true;
    });

    if (this.env.AI_REVIEW_ENABLED === "true" && inserted) {
      const delayMs = debounceDelayMs(this.env.AI_REVIEW_DEBOUNCE_SECONDS);
      // Resetting the alarm creates the ADR's trailing-edge quiet period.
      await this.ctx.storage.setAlarm(Date.now() + delayMs);
    }
    if (!inserted) {
      // A retry after a failed alarm write must restore the alarm, but a
      // duplicate must not extend an alarm that is already scheduled.
      if (
        this.env.AI_REVIEW_ENABLED === "true" &&
        (await this.ctx.storage.getAlarm()) === null
      ) {
        const delayMs = debounceDelayMs(this.env.AI_REVIEW_DEBOUNCE_SECONDS);
        await this.ctx.storage.setAlarm(Date.now() + delayMs);
      }
      return json({ accepted: true, duplicate: true });
    }

    return json({
      accepted: true,
      enabled: this.env.AI_REVIEW_ENABLED === "true",
    });
  }

  private findingConfirmation(
    event: FindingInteractionEvent,
    findingId: string,
  ): FindingConfirmation {
    if (event.disposition !== "confirmed-fixed") return {};
    const latestReplay = this.ctx.storage.sql
      .exec<{
        run_id: string;
        head_sha: string;
        finding_resolutions_json: string;
      }>(
        `SELECT run_id, head_sha, finding_resolutions_json
         FROM review_runs
         WHERE status = 'completed'
           AND finding_resolutions_json IS NOT NULL
         ORDER BY completed_at DESC, run_id DESC LIMIT 100`,
      )
      .toArray()
      .map((run) => {
        const resolution = storedFindingResolution(
          run.finding_resolutions_json,
          findingId,
        );
        return resolution
          ? {
              runId: run.run_id,
              headSha: run.head_sha,
              verdict: resolution.verdict,
              evidence: resolution.evidence,
            }
          : undefined;
      })
      .find((resolution) => resolution !== undefined);
    const currentHeadFullReview = event.headSha
      ? this.ctx.storage.sql
          .exec<{
            run_id: string;
            head_sha: string;
            finding_resolutions_json: string | null;
          }>(
            `SELECT run_id, head_sha, finding_resolutions_json
             FROM review_runs
             WHERE status = 'completed' AND head_sha = ? AND force_run = 1
             ORDER BY completed_at DESC, run_id DESC LIMIT 1`,
            event.headSha,
          )
          .toArray()[0]
      : undefined;
    const currentHeadResolution = currentHeadFullReview
      ? storedFindingResolution(
          currentHeadFullReview.finding_resolutions_json,
          findingId,
        )
      : undefined;
    const authoritativeReplay = currentHeadResolution && currentHeadFullReview
      ? {
          runId: currentHeadFullReview.run_id,
          headSha: currentHeadFullReview.head_sha,
          verdict: currentHeadResolution.verdict,
          evidence: currentHeadResolution.evidence,
        }
      : latestReplay;
    const replayIsCurrent =
      authoritativeReplay?.headSha === event.headSha ||
      (currentHeadFullReview !== undefined && currentHeadResolution === undefined);
    if (
      authoritativeReplay?.verdict !== "fixed" ||
      !event.headSha ||
      !replayIsCurrent
    ) {
      return {
        unconfirmedReason:
          authoritativeReplay?.verdict === "fixed" && event.headSha
            ? "stale-fixed-replay"
            : "no-fixed-replay",
      };
    }
    return {
      controlledReplay: currentHeadFullReview
        ? {
            ...authoritativeReplay,
            validatedByFullReviewRunId: currentHeadFullReview.run_id,
          }
        : authoritativeReplay,
    };
  }

  private async receiveInteraction(request: Request): Promise<Response> {
    const event = await readValidatedJson(
      request,
      isFindingInteractionEvent,
      "Invalid finding interaction",
    );
    if (event instanceof Response) return event;

    const recordedAt = new Date().toISOString();
    const result = this.ctx.storage.transactionSync(() => {
      const existing = this.ctx.storage.sql
        .exec<{
          finding_id: string;
          payload_json: string;
          r2_recorded: number;
        }>(
          `SELECT finding_id, payload_json, r2_recorded
           FROM review_finding_events WHERE delivery_id = ?`,
          event.deliveryId,
        )
        .toArray()[0];
      if (existing) {
        return {
          duplicate: true,
          findingId: existing.finding_id,
          evidence: JSON.parse(existing.payload_json) as unknown,
          r2Recorded: existing.r2_recorded === 1,
        };
      }

      const findingId =
        event.findingId ??
        this.ctx.storage.sql
          .exec<{ finding_id: string }>(
            `SELECT finding_id FROM review_finding_comments
             WHERE comment_id = ?`,
            event.rootCommentId ?? null,
          )
          .toArray()[0]?.finding_id;
      if (!findingId) return { unknownFinding: true };
      const finding = this.ctx.storage.sql
        .exec<{ finding_id: string }>(
          "SELECT finding_id FROM review_findings WHERE finding_id = ?",
          findingId,
        )
        .toArray()[0];
      if (!finding) return { unknownFinding: true };

      const occurredAt = event.occurredAt ?? recordedAt;
      const confirmation = this.findingConfirmation(event, findingId);
      if (confirmation.unconfirmedReason) {
        return {
          unconfirmedFix: true,
          reason: confirmation.unconfirmedReason,
        };
      }
      const { controlledReplay } = confirmation;
      const evidence = {
        schemaVersion: 2,
        recordType: "finding-interaction-evidence",
        evidenceVersion: 1,
        repository: event.repository,
        pullRequestNumber: event.pullRequestNumber,
        currentHeadSha: event.headSha,
        findingId,
        deliveryId: event.deliveryId,
        eventName: event.eventName,
        action: event.action,
        interactionType: event.interactionType,
        actor: event.actor,
        actorAssociation: event.actorAssociation,
        rootCommentId: event.rootCommentId,
        commentId: event.commentId,
        threadId: event.threadId,
        body: event.body,
        reactions: event.reactions,
        disposition: event.disposition,
        reason: event.reason,
        controlledReplay,
        occurredAt,
        recordedAt,
      };
      const payloadJson = JSON.stringify(evidence);
      this.ctx.storage.sql.exec(
        `INSERT INTO webhook_deliveries
         (delivery_id, event_name, action, repository, pull_request_number,
          head_sha, received_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?)`,
        event.deliveryId,
        event.eventName,
        event.action,
        event.repository,
        event.pullRequestNumber,
        recordedAt,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO review_finding_events
         (delivery_id, schema_version, evidence_version, finding_id,
          event_type, action, actor, payload_json, occurred_at, recorded_at)
         VALUES (?, 2, 1, ?, ?, ?, ?, ?, ?, ?)`,
        event.deliveryId,
        findingId,
        event.interactionType,
        event.action,
        event.actor,
        payloadJson,
        occurredAt,
        recordedAt,
      );
      if (event.disposition) {
        const dispositionReason =
          event.reason?.trim() || "Trusted manual disposition";
        this.ctx.storage.sql.exec(
          `UPDATE review_findings
           SET disposition = ?, disposition_reason = ?
           WHERE finding_id = ?`,
          event.disposition,
          dispositionReason,
          findingId,
        );
        this.appendFindingOutcome({
          repository: event.repository,
          pullRequestNumber: event.pullRequestNumber,
          findingId,
          outcome: event.disposition,
          basis: "explicit-disposition",
          confidence: 1,
          evaluatorVersion: outcomeEvaluatorVersion(this.env),
          manualOverride: {
            actor: event.actor,
            deliveryId: event.deliveryId,
            reason: dispositionReason,
          },
          sourceId: `delivery:${event.deliveryId}`,
          occurredAt,
          recordedAt,
          evidence: {
            deliveryId: event.deliveryId,
            actor: event.actor,
            actorAssociation: event.actorAssociation,
            reason: dispositionReason,
            currentHeadSha: event.headSha,
            controlledReplay,
          },
        });
      }
      return {
        duplicate: false,
        findingId,
        evidence,
        r2Recorded: false,
      };
    });

    if ("unknownFinding" in result) {
      return json({ accepted: false, reason: "unknown-finding" }, 202);
    }
    if ("unconfirmedFix" in result) {
      return json({ accepted: false, reason: result.reason }, 202);
    }
    if (!result.r2Recorded) {
      const key = findingEvidenceKey({
        repository: event.repository,
        pullRequestNumber: event.pullRequestNumber,
        findingId: result.findingId,
        deliveryId: event.deliveryId,
      });
      await this.env.REVIEW_DATA.put(key, JSON.stringify(result.evidence), {
        httpMetadata: { contentType: "application/json" },
      });
      this.ctx.storage.sql.exec(
        `UPDATE review_finding_events SET r2_recorded = 1
         WHERE delivery_id = ?`,
        event.deliveryId,
      );
    }
    await this.flushFindingOutcomes(
      event.repository,
      event.pullRequestNumber,
    );
    return json({
      accepted: true,
      duplicate: result.duplicate,
      findingId: result.findingId,
    });
  }

  private async receiveFinalization(request: Request): Promise<Response> {
    const event = await readValidatedJson(
      request,
      isPullRequestFinalizationEvent,
      "Invalid pull request finalization",
    );
    if (event instanceof Response) return event;

    const recordedAt = new Date().toISOString();
    const occurredAtMs = Date.parse(event.occurredAt ?? recordedAt);
    const dueAt =
      (Number.isFinite(occurredAtMs) ? occurredAtMs : Date.now()) +
      outcomeWindowMs(this.env.AI_REVIEW_OUTCOME_WINDOW_SECONDS);
    const outcomeWindowElapsed = dueAt <= Date.now();
    const result = this.ctx.storage.transactionSync(() => {
      const existing = this.ctx.storage.sql
        .exec<{ delivery_id: string }>(
          "SELECT delivery_id FROM webhook_deliveries WHERE delivery_id = ?",
          event.deliveryId,
        )
        .toArray()[0];
      if (existing) return { duplicate: true, outcomes: 0 } as const;

      this.ctx.storage.sql.exec(
        `INSERT INTO webhook_deliveries
         (delivery_id, event_name, action, repository, pull_request_number,
          head_sha, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        event.deliveryId,
        event.eventName,
        event.action,
        event.repository,
        event.pullRequestNumber,
        event.headSha,
        recordedAt,
      );
      return {
        duplicate: false,
        ...this.evaluateFinalizedFindings({
          event,
          evaluatedAt: recordedAt,
          outcomeWindowElapsed,
          trigger: outcomeWindowElapsed
            ? "outcome-window"
            : "pull-request-finalization",
        }),
      } as const;
    });

    if (!result.duplicate && "pending" in result && result.pending > 0) {
      const pending = {
        kind: "finding-outcome-evaluation",
        dueAt,
        event,
      } satisfies PendingOutcomeEvaluation;
      await this.schedulePendingOutcomeEvaluation(pending);
    } else if (result.duplicate) {
      const outstanding = this.ctx.storage.sql
        .exec<{ pending: number }>(
          `SELECT COUNT(*) AS pending FROM review_findings finding
           WHERE NOT EXISTS (
             SELECT 1 FROM review_finding_outcomes outcome
             WHERE outcome.finding_id = finding.finding_id
           ) AND NOT EXISTS (
             SELECT 1 FROM review_finding_evaluations evaluation
             WHERE evaluation.finding_id = finding.finding_id
               AND evaluation.status = 'manual-adjudication-required'
           )`,
        )
        .toArray()[0]?.pending;
      if (Number(outstanding ?? 0) > 0) {
        const existing = await this.ctx.storage.get<unknown>(
          PENDING_OUTCOME_EVALUATION_KEY,
        );
        if (isPendingOutcomeEvaluation(existing)) {
          await this.scheduleAlarmNoLaterThan(existing.dueAt);
        } else {
          await this.schedulePendingOutcomeEvaluation({
            kind: "finding-outcome-evaluation",
            dueAt,
            event,
          });
        }
      }
    }

    await this.flushFindingOutcomes(
      event.repository,
      event.pullRequestNumber,
    );
    return json({ accepted: true, ...result });
  }

  private async claimReview(request: Request): Promise<Response> {
    const body = await readValidatedJson(
      request,
      isReviewClaim,
      "Invalid review claim",
    );
    if (body instanceof Response) return body;
    const maxRuns = body.maxRuns;
    const maxCostUsd = body.maxCostUsd;

    const now = new Date();
    const nowIso = now.toISOString();
    const leaseCutoff = new Date(
      now.getTime() - REVIEW_RUN_LEASE_MS,
    ).toISOString();
    try {
      await this.terminateExpiredReview(nowIso, leaseCutoff);
    } catch (error) {
      console.error(
        "Could not terminate an expired review Workflow",
        error instanceof Error ? { name: error.name } : { type: typeof error },
      );
      return errorResponse("Expired review Workflow is still active", 503);
    }

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
    const result = this.ctx.storage.transactionSync(() => {
      const aggregate = this.ctx.storage.sql
        .exec<{ attempts: number; runs: number; total_cost: number }>(
          `SELECT COUNT(*) AS attempts,
                  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS runs,
                  COALESCE(SUM(cost_usd), 0) AS total_cost
           FROM review_runs`,
        )
        .toArray()[0] ?? { attempts: 0, runs: 0, total_cost: 0 };
      const previousState = {
        runs: Number(aggregate.runs),
        total_usd: Number(aggregate.total_cost),
      };
      const existingRun = this.ctx.storage.sql
        .exec<{ status: string }>(
          "SELECT status FROM review_runs WHERE run_id = ?",
          body.runId,
        )
        .toArray()[0];
      if (existingRun) {
        const claimed = existingRun.status === "running";
        let reason: string | undefined;
        if (!claimed) {
          reason =
            existingRun.status === "completed"
              ? "workflow instance already completed"
              : `workflow instance is ${existingRun.status}`;
        }
        return {
          claimed,
          reason,
          previousState,
        };
      }
      const active = this.ctx.storage.sql
        .exec<{ run_id: string }>(
          `SELECT run_id FROM review_runs
           WHERE status IN ('running', 'terminating')
           LIMIT 1`,
        )
        .toArray()[0];
      if (active) {
        return {
          claimed: false,
          reason: "another review is already running",
          previousState,
        };
      }
      if (!body.force) {
        const completed = this.ctx.storage.sql
          .exec<{ run_id: string }>(
            `SELECT run_id FROM review_runs
             WHERE diff_fingerprint = ? AND config_fingerprint = ?
               AND status = 'completed'
             LIMIT 1`,
            body.diffFingerprint,
            body.configFingerprint,
          )
          .toArray()[0];
        if (completed) {
          return {
            claimed: false,
            reason: "this content and reviewer configuration were already reviewed",
            previousState,
          };
        }
      }
      if (Number(aggregate.attempts) >= maxRuns) {
        return {
          claimed: false,
          reason: "per-PR review-run budget reached",
          previousState,
        };
      }
      if (previousState.total_usd >= maxCostUsd) {
        return {
          claimed: false,
          reason: "per-PR cost budget reached",
          previousState,
        };
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO review_runs
         (run_id, head_sha, diff_fingerprint, config_fingerprint, status,
          force_run, started_at)
         VALUES (?, ?, ?, ?, 'running', ?, ?)`,
        body.runId,
        body.headSha,
        body.diffFingerprint,
        body.configFingerprint,
        body.force ? 1 : 0,
        nowIso,
      );
      return { claimed: true, previousState };
    });
    return json(result);
  }

  private async reviewBaseline(request: Request): Promise<Response> {
    const body = await readValidatedJson(
      request,
      isReviewBaselineRequest,
      "Invalid review baseline",
    );
    if (body instanceof Response) return body;
    const completed = this.ctx.storage.sql
      .exec<{ run_id: string; head_sha: string }>(
        `SELECT run_id, head_sha FROM review_runs
         WHERE status = 'completed'
         ORDER BY completed_at DESC, run_id DESC LIMIT 1`,
      )
      .toArray()[0];
    if (!completed) {
      return json({ hunkIds: [], openFindings: [] });
    }
    const hunkIds = this.ctx.storage.sql
      .exec<{ hunk_id: string }>(
        "SELECT hunk_id FROM review_run_hunks WHERE run_id = ? ORDER BY hunk_id",
        completed.run_id,
      )
      .toArray()
      .map(({ hunk_id }) => hunk_id);
    const findings = this.ctx.storage.sql
      .exec<{
        finding_id: string;
        file_path: string;
        title: string;
        first_seen_run_id: string;
        findings_json: string | null;
      }>(
        `SELECT finding.finding_id, finding.file_path, finding.title,
                finding.first_seen_run_id, run.findings_json
         FROM review_findings finding
         LEFT JOIN review_runs run ON run.run_id = finding.first_seen_run_id
         WHERE NOT EXISTS (
           SELECT 1 FROM review_finding_outcomes outcome
           WHERE outcome.finding_id = finding.finding_id
             AND outcome.outcome = 'confirmed-fixed'
             AND json_extract(
               outcome.payload_json, '$.evidence.currentHeadSha'
             ) = ?
         )
         ORDER BY finding.finding_id LIMIT 100`,
        body.headSha,
      )
      .toArray();
    const openFindings = findings.map((finding) => ({
      ...storedFindingContext(
        finding.findings_json,
        finding.finding_id,
      ),
      findingId: finding.finding_id,
      file: finding.file_path,
      title: finding.title,
      hunkIds: this.ctx.storage.sql
        .exec<{ hunk_id: string }>(
          `SELECT hunk_id FROM review_finding_hunks
           WHERE finding_id = ? ORDER BY hunk_id`,
          finding.finding_id,
        )
        .toArray()
        .map(({ hunk_id }) => hunk_id),
    }));
    return json({ headSha: completed.head_sha, hunkIds, openFindings });
  }

  private async completeReview(request: Request): Promise<Response> {
    const body = await readValidatedJson(
      request,
      isReviewCompletion,
      "Invalid review completion",
    );
    if (body instanceof Response) return body;
    const reviewedHunks = body.hunks;
    const currentHunks = body.currentHunks ?? body.hunks;
    const completionRepository = body.repository;
    const completionPullRequestNumber = body.pullRequestNumber;
    const completionHeadSha = body.headSha;
    const completionHunkIds = new Set(
      reviewedHunks.map(({ hunkId }) => hunkId),
    );
    const currentHunksById = new Map(
      currentHunks.map((hunk) => [hunk.hunkId, hunk]),
    );
    const completionFindings = body.findings;
    const completionFindingsById = new Map(
      completionFindings.map((finding) => [finding.findingId, finding]),
    );
    const findingPublications = body.findingPublications ?? [];
    const findingPublicationsById = new Map(
      findingPublications.map((publication) => [
        publication.findingId,
        publication,
      ]),
    );
    const findingResolutions = body.findingResolutions ?? [];
    const findingResolutionsById = new Map(
      findingResolutions.map((resolution) => [resolution.findingId, resolution]),
    );
    if (
      completionHunkIds.size !== reviewedHunks.length ||
      currentHunksById.size !== currentHunks.length ||
      completionFindingsById.size !== completionFindings.length ||
      findingPublicationsById.size !== findingPublications.length ||
      findingResolutionsById.size !== findingResolutions.length ||
      reviewedHunks.some((hunk) => {
        const current = currentHunksById.get(hunk.hunkId);
        return !current || !sameReviewHunk(hunk, current);
      }) ||
      completionFindings.some((finding) =>
        finding.hunkIds.some((hunkId) => !completionHunkIds.has(hunkId)),
      ) ||
      findingPublications.some((publication) => {
        const finding = completionFindingsById.get(publication.findingId);
        return (
          !finding ||
          publication.path !== finding.file ||
          publication.line !== finding.line
        );
      })
    ) {
      return errorResponse("Invalid review completion");
    }
    const completionHash = await sha256Hex(
      stableJson({
        headSha: body.headSha,
        costUsd: body.costUsd,
        commentId: body.commentId ?? null,
        hunks: reviewedHunks,
        currentHunks,
        findings: body.findings,
        findingPublications,
        findingResolutions,
      }),
    );
    const completedAt = new Date().toISOString();
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
    const completion = this.ctx.storage.transactionSync(() => {
      const update = this.ctx.storage.sql.exec(
        `UPDATE review_runs
         SET status = 'completed', completed_at = ?, cost_usd = ?,
             comment_id = ?, findings_json = ?, finding_resolutions_json = ?,
             completion_hash = ?, error = NULL
         WHERE run_id = ? AND head_sha = ? AND status = 'running'`,
        completedAt,
        body.costUsd,
        body.commentId ?? null,
        JSON.stringify(body.findings),
        JSON.stringify(findingResolutions),
        completionHash,
        body.runId,
        body.headSha,
      );
      if (update.rowsWritten === 0) {
        const existing = this.ctx.storage.sql
          .exec<{ head_sha: string; status: string; completion_hash: string | null }>(
            `SELECT head_sha, status, completion_hash
             FROM review_runs WHERE run_id = ?`,
            body.runId,
          )
          .toArray()[0];
        return completionReplayStatus(
          existing,
          completionHeadSha,
          completionHash,
        );
      }
      for (const hunk of currentHunks) {
        this.ctx.storage.sql.exec(
          `INSERT INTO review_hunks
           (hunk_id, fingerprint, file_path, first_seen_head_sha,
            last_seen_head_sha, first_seen_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(hunk_id) DO UPDATE SET
             last_seen_head_sha = excluded.last_seen_head_sha,
             last_seen_at = excluded.last_seen_at`,
          hunk.hunkId,
          hunk.fingerprint,
          hunk.file,
          body.headSha,
          body.headSha,
          completedAt,
          completedAt,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO review_run_hunks (run_id, hunk_id, reviewed)
           VALUES (?, ?, ?)`,
          body.runId,
          hunk.hunkId,
          completionHunkIds.has(hunk.hunkId) ? 1 : 0,
        );
      }
      for (const finding of body.findings as IdentifiedMergedFinding[]) {
        this.ctx.storage.sql.exec(
          `INSERT INTO review_findings
           (finding_id, file_path, title, status, first_seen_head_sha,
            last_seen_head_sha, first_seen_run_id, last_seen_run_id,
            first_seen_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(finding_id) DO UPDATE SET
             file_path = excluded.file_path,
             title = excluded.title,
             status = excluded.status,
             last_seen_head_sha = excluded.last_seen_head_sha,
             last_seen_run_id = excluded.last_seen_run_id,
             last_seen_at = excluded.last_seen_at`,
          finding.findingId,
          finding.file,
          finding.title,
          finding.status,
          body.headSha,
          body.headSha,
          body.runId,
          body.runId,
          completedAt,
          completedAt,
        );
        for (const hunkId of finding.hunkIds) {
          this.ctx.storage.sql.exec(
            `INSERT OR IGNORE INTO review_finding_hunks (finding_id, hunk_id)
             VALUES (?, ?)`,
            finding.findingId,
            hunkId,
          );
        }
      }
      for (const publication of findingPublications) {
        if (publication.delivery !== "line" || publication.commentId === undefined) {
          continue;
        }
        this.ctx.storage.sql.exec(
          `INSERT INTO review_finding_comments
           (comment_id, finding_id, head_sha, file_path, line, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(finding_id) DO UPDATE SET
             comment_id = excluded.comment_id,
             head_sha = excluded.head_sha,
             file_path = excluded.file_path,
             line = excluded.line,
             updated_at = excluded.updated_at`,
          publication.commentId,
          publication.findingId,
          body.headSha,
          publication.path,
          publication.line,
          completedAt,
          completedAt,
        );
      }
      return "completed";
    });
    if (completion === "missing") {
      return errorResponse("No matching review run to complete", 409);
    }
    if (completion === "conflict") {
      return errorResponse("Review completion payload does not match", 409);
    }
    await this.flushFindingOutcomes(
      completionRepository,
      completionPullRequestNumber,
    );
    return json(
      completion === "duplicate"
        ? { completed: true, duplicate: true }
        : { completed: true },
    );
  }

  private async failReview(request: Request): Promise<Response> {
    const body = await readValidatedJson(
      request,
      isReviewFailure,
      "Invalid review failure",
    );
    if (body instanceof Response) return body;
    this.ctx.storage.sql.exec(
      `UPDATE review_runs
       SET status = 'failed', completed_at = ?, error = ?, cost_usd = ?
       WHERE run_id = ? AND status = 'running'`,
      new Date().toISOString(),
      body.error.slice(0, 500),
      body.costUsd,
      body.runId,
    );
    return json({ failed: true });
  }

  override async alarm(): Promise<void> {
    const outcomeRetry =
      await this.ctx.storage.get<FindingOutcomeFlushRetry>(
        OUTCOME_FLUSH_RETRY_KEY,
      );
    if (
      outcomeRetry?.kind === "finding-outcomes" &&
      typeof outcomeRetry.repository === "string" &&
      Number.isSafeInteger(outcomeRetry.pullRequestNumber) &&
      outcomeRetry.pullRequestNumber > 0
    ) {
      await this.flushFindingOutcomes(
        outcomeRetry.repository,
        outcomeRetry.pullRequestNumber,
      );
    }

    const pendingEvaluation = await this.ctx.storage.get<unknown>(
      PENDING_OUTCOME_EVALUATION_KEY,
    );
    if (isPendingOutcomeEvaluation(pendingEvaluation)) {
      if (pendingEvaluation.dueAt <= Date.now()) {
        const evaluatedAt = new Date().toISOString();
        this.ctx.storage.transactionSync(() =>
          this.evaluateFinalizedFindings({
            event: pendingEvaluation.event,
            evaluatedAt,
            outcomeWindowElapsed: true,
            trigger: "outcome-window",
          }),
        );
        await this.ctx.storage.delete(PENDING_OUTCOME_EVALUATION_KEY);
        await this.flushFindingOutcomes(
          pendingEvaluation.event.repository,
          pendingEvaluation.event.pullRequestNumber,
        );
      } else {
        await this.scheduleAlarmNoLaterThan(pendingEvaluation.dueAt);
      }
    } else if (pendingEvaluation !== undefined) {
      await this.ctx.storage.delete(PENDING_OUTCOME_EVALUATION_KEY);
    }

    const event =
      await this.ctx.storage.get<ReviewWorkflowParams>(PENDING_EVENT_KEY);
    if (
      !event ||
      !isReviewWorkflowParams(event) ||
      this.env.AI_REVIEW_ENABLED !== "true"
    ) {
      return;
    }

    const instanceId = `review-${event.deliveryId}`;
    await this.env.REVIEW_WORKFLOW.createBatch([
      {
        id: instanceId,
        params: event,
      },
    ]);
    // Delete only after Workflow confirms creation. If creation throws, the
    // platform retries the alarm and the delivery-derived ID is idempotent.
    await this.ctx.storage.delete(PENDING_EVENT_KEY);
  }
}

export class ReviewWorkflow extends WorkflowEntrypoint<
  Env,
  ReviewWorkflowParams
> {
  override async run(
    event: WorkflowEvent<ReviewWorkflowParams>,
    step: WorkflowStep,
  ): Promise<void> {
    const workflowStep = step;
    let incurredCostUsd = 0;
    let failedPhase = "prepare-review";
    let prepared: PreparedReview | undefined;
    let scouts: ScoutRun | undefined;
    let merged: MergedRun | undefined;
    let artifacts: IdentifiedReviewArtifacts | undefined;
    try {
      prepared = await workflowStep.do("prepare-review", () =>
        prepareReview(this.env, event.payload),
      );
      if (prepared.skipReason) {
        console.log("Skipping stateful AI review", {
          repository: event.payload.repository,
          pullRequestNumber: event.payload.pullRequestNumber,
          reason: prepared.skipReason,
        });
        if (prepared.coverage?.mode !== "skipped") {
          await workflowStep.do("record-skipped-review", () =>
            recordReviewTerminal({
              env: this.env,
              params: event.payload,
              instanceId: event.instanceId,
              status: "skipped",
              reason: prepared?.skipReason,
              prepared,
              timestamp: event.timestamp,
            }),
          );
          return;
        }
        failedPhase = "claim-skipped-review";
        const claim = await workflowStep.do("claim-skipped-review", () =>
          claimReview(this.env, event.payload, event.instanceId, prepared!),
        );
        if (!claim.claimed) {
          await workflowStep.do("record-denied-skipped-review", () =>
            recordReviewTerminal({
              env: this.env,
              params: event.payload,
              instanceId: event.instanceId,
              status: "denied",
              reason: claim.reason,
              prepared,
              timestamp: event.timestamp,
            }),
          );
          return;
        }
        failedPhase = "publish-skipped-coverage";
        const skippedPublication = await workflowStep.do(
          "publish-skipped-coverage",
          () => publishSkippedReview(this.env, event.payload, prepared!),
        );
        await workflowStep.do("record-skipped-review", () =>
          recordReviewTerminal({
            env: this.env,
            params: event.payload,
            instanceId: event.instanceId,
            status: "skipped",
            reason: prepared?.skipReason,
            prepared,
            publication: skippedPublication,
            timestamp: event.timestamp,
          }),
        );
        failedPhase = "complete-skipped-review-state";
        await workflowStep.do("complete-skipped-review-state", () =>
          completeReview(
            this.env,
            event.payload,
            event.instanceId,
            prepared!,
            { result: { finding_resolutions: [] }, cost: 0 },
            { hunks: [], candidates: {}, publishedFindings: [] },
            skippedPublication,
          ),
        );
        return;
      }
      failedPhase = "claim-review";
      const claim = await workflowStep.do("claim-review", () =>
        claimReview(this.env, event.payload, event.instanceId, prepared!),
      );
      if (!claim.claimed) {
        console.log("Skipping duplicate or over-budget AI review", {
          repository: event.payload.repository,
          pullRequestNumber: event.payload.pullRequestNumber,
          reason: claim.reason,
        });
        await workflowStep.do("record-denied-review", () =>
          recordReviewTerminal({
            env: this.env,
            params: event.payload,
            instanceId: event.instanceId,
            status: "denied",
            reason: claim.reason,
            prepared,
            timestamp: event.timestamp,
          }),
        );
        return;
      }

      if (prepared.diff?.trim()) {
        failedPhase = "run-openrouter-scouts";
        const openRouterScouts = await workflowStep.do(
          "run-openrouter-scouts",
          MODEL_STEP_CONFIG,
          () =>
            runScouts(this.env, event.payload, prepared!, {
              providers: ["openrouter"],
              observationId: `${event.instanceId}:openrouter`,
            }),
        );
        incurredCostUsd = Object.values(openRouterScouts.costs).reduce(
          (total, cost) => total + cost,
          0,
        );
        failedPhase = "run-opencode-scouts";
        const openCodeScouts = await workflowStep.do(
          "run-opencode-scouts",
          MODEL_STEP_CONFIG,
          () =>
            runScouts(this.env, event.payload, prepared!, {
              providers: ["opencode"],
              observationId: `${event.instanceId}:opencode`,
            }),
        );
        scouts = combineScoutRuns(openRouterScouts, openCodeScouts);
        failedPhase = "merge-current-scout-findings";
        merged = await workflowStep.do(
          "merge-current-scout-findings",
          MODEL_STEP_CONFIG,
          async () => {
            try {
              return await mergeFindings(
                this.env,
                event.payload,
                prepared!,
                scouts!,
                { observationId: `${event.instanceId}:merger` },
              );
            } catch (error) {
              incurredCostUsd += modelFailureCostUsd(error);
              throw error;
            }
          },
        );
        incurredCostUsd += merged.cost;
      } else {
        scouts = {
          models: [],
          candidates: {},
          failed: [],
          candidateCounts: {},
          invalidCounts: {},
          outOfScopeCounts: {},
          costs: {},
          metrics: [],
        };
        merged = {
          result: {
            summary: "No reviewable text changes found.",
            findings: [],
          },
          cost: 0,
        };
      }
      failedPhase = "identify-review-artifacts";
      artifacts = await workflowStep.do("identify-review-artifacts", () =>
        identifyReviewArtifacts(
          prepared!,
          scouts!,
          merged!,
          guardrailPolicy(this.env).publication,
        ),
      );
      failedPhase = "publish-rolling-comment";
      const publication = await workflowStep.do("publish-rolling-comment", () =>
        publishReview(
          this.env,
          event.payload,
          prepared!,
          scouts!,
          merged!,
          artifacts!,
          claim.previousState,
        ),
      );
      failedPhase = "record-versioned-review";
      await workflowStep.do("record-versioned-review", () =>
        recordReview({
          env: this.env,
          params: event.payload,
          instanceId: event.instanceId,
          prepared: prepared!,
          scouts: scouts!,
          merged: merged!,
          artifacts: artifacts!,
          publication,
          timestamp: event.timestamp,
        }),
      );
      failedPhase = "complete-review-state";
      await workflowStep.do("complete-review-state", () =>
        completeReview(
          this.env,
          event.payload,
          event.instanceId,
          prepared!,
          merged!,
          artifacts!,
          publication,
        ),
      );
    } catch (error) {
      try {
        await failReview(
          this.env,
          event.payload,
          event.instanceId,
          error,
          incurredCostUsd,
        );
      } catch (stateError) {
        console.error("Could not record failed review state", {
          type: errorType(stateError),
        });
      }
      try {
        await workflowStep.do("record-failed-review", () =>
          recordReviewTerminal({
            env: this.env,
            params: event.payload,
            instanceId: event.instanceId,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
            failedPhase,
            incurredCostUsd,
            prepared,
            scouts,
            merged,
            artifacts,
            timestamp: event.timestamp,
          }),
        );
      } catch (recordError) {
        console.error(
          "Could not record failed review analytics",
          { type: errorType(recordError) },
        );
      }
      throw error;
    }
  }
}

function acceptedWebhookEvent(
  review: ReturnType<typeof parseReviewEvent>,
  interaction: ReturnType<typeof parseFindingInteraction> | undefined,
  finalization: ReturnType<typeof parsePullRequestFinalization> | undefined,
):
  | ReviewWorkflowParams
  | FindingInteractionEvent
  | PullRequestFinalizationEvent
  | undefined {
  if (review.kind === "accepted") return review.event;
  if (interaction?.kind === "accepted") return interaction.event;
  if (finalization?.kind === "accepted") return finalization.event;
  return undefined;
}

function coordinatorPathForEvent(
  event:
    | ReviewWorkflowParams
    | FindingInteractionEvent
    | PullRequestFinalizationEvent,
): "/events" | "/interactions" | "/finalizations" {
  if ("interactionType" in event) return "/interactions";
  if ("finalState" in event) return "/finalizations";
  return "/events";
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
async function handleGitHubWebhook(request: Request, env: Env): Promise<Response> {
  const bodyResult = await readWebhookBody(request);
  if ("response" in bodyResult) return bodyResult.response;
  const { body } = bodyResult;
  const eventName = request.headers.get("x-github-event");
  const deliveryId = request.headers.get("x-github-delivery");
  const verified = await verifyGitHubSignature(
    body,
    request.headers.get("x-hub-signature-256"),
    env.AI_REVIEW_WEBHOOK_SECRET,
  );
  if (!verified) return errorResponse("Invalid webhook signature", 401);
  if (!eventName || !deliveryId) {
    return errorResponse("Missing GitHub webhook headers");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body) as unknown;
  } catch {
    return errorResponse("Malformed JSON payload");
  }

  const parsedReview = parseReviewEvent(eventName, deliveryId, payload);
  const parsedInteraction =
    parsedReview.kind === "ignored"
      ? parseFindingInteraction(eventName, deliveryId, payload)
      : undefined;
  const parsedFinalization =
    parsedReview.kind === "ignored" && parsedInteraction?.kind === "ignored"
      ? parsePullRequestFinalization(eventName, deliveryId, payload)
      : undefined;
  if (
    parsedReview.kind === "invalid" ||
    parsedInteraction?.kind === "invalid" ||
    parsedFinalization?.kind === "invalid"
  ) {
    return errorResponse("Malformed webhook payload");
  }
  const event = acceptedWebhookEvent(
    parsedReview,
    parsedInteraction,
    parsedFinalization,
  );
  if (!event) return json({ ignored: true, reason: "unsupported-event" }, 202);

  const allowedRepository = env.AI_REVIEW_REPOSITORY?.trim().toLowerCase();
  if (!allowedRepository || event.repository.trim().toLowerCase() !== allowedRepository) {
    return errorResponse("Repository is not allowed", 403);
  }
  let forwardedEvent = event;
  if (
    "interactionType" in event &&
    event.disposition === "confirmed-fixed"
  ) {
    let headSha: string | undefined;
    try {
      headSha = await currentPullRequestHead(env, event);
    } catch (error) {
      console.error("Could not load the authoritative pull request head", {
        type: errorType(error),
      });
    }
    if (!headSha) {
      return errorResponse("Could not verify current pull request head", 503);
    }
    forwardedEvent = { ...event, headSha };
  }
  const coordinatorResponse = await forwardToCoordinator(
    forwardedEvent,
    env,
    coordinatorPathForEvent(forwardedEvent),
  );
  if (
    "interactionType" in forwardedEvent &&
    forwardedEvent.eventName === "pull_request_review_comment" &&
    forwardedEvent.disposition &&
    forwardedEvent.rootCommentId &&
    coordinatorResponse.ok
  ) {
    const result = (await coordinatorResponse.clone().json().catch(() => null)) as
      | { accepted?: unknown }
      | null;
    if (result?.accepted === true) {
      if (!(await acknowledgeDispositionReply(env, forwardedEvent))) {
        return errorResponse("Could not acknowledge disposition reply", 503);
      }
    }
  }
  return coordinatorResponse;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return healthResponse(env);
    }
    if (request.method !== "POST" || url.pathname !== "/webhooks/github") {
      return new Response("Not found", { status: 404 });
    }
    return handleGitHubWebhook(request, env);
  },
} satisfies ExportedHandler<Env>;
