import { z } from "zod";
import { ReplayProviderSchema } from "./replay";
import { ReviewCoverageManifestSchema } from "./coverage-manifest";
import { ReviewRulePreviewSchema } from "./rule-resolution";

export const FindingOutcomeValueSchema = z.enum([
  "confirmed-fixed",
  "acknowledged",
  "rejected",
  "superseded",
  "no-observable-response",
]);
export type FindingOutcomeValue = z.infer<typeof FindingOutcomeValueSchema>;

export const ReviewFindingSchema = z.looseObject({
  findingId: z.string().min(1),
  file: z.string().optional(),
  line: z.number().int().positive().nullable().optional(),
  hunkIds: z.array(z.string()).optional(),
  title: z.string().optional(),
});
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;

export const ReviewHunkSchema = z.object({
  hunkId: z.string(),
  fingerprint: z.string(),
  file: z.string(),
  oldStart: z.number().int(),
  oldLines: z.number().int().nonnegative(),
  newStart: z.number().int(),
  newLines: z.number().int().nonnegative(),
}).strict();
export type ReviewHunk = z.infer<typeof ReviewHunkSchema>;

export const ChangeProfileSchema = z.object({
  diffCharacters: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  changedFiles: z.number().int().nonnegative(),
  reviewableFiles: z.number().int().nonnegative(),
  omittedFiles: z.number().int().nonnegative(),
  hunks: z.number().int().nonnegative(),
  languages: z.array(z.string()),
  repositoryAreas: z.array(z.string()),
  riskSignals: z.array(z.string()),
}).strict();
export type ChangeProfile = z.infer<typeof ChangeProfileSchema>;

export const ReviewCoverageModeSchema = z.enum(["full", "incremental", "skipped"]);
export type ReviewCoverageMode = z.infer<typeof ReviewCoverageModeSchema>;

export const ReviewCoverageSchema = z.object({
  mode: ReviewCoverageModeSchema,
  reason: z.string(),
  baselineHeadSha: z.string().optional(),
  totalHunks: z.number().int().nonnegative(),
  reviewedHunkIds: z.array(z.string()),
  unchangedHunkIds: z.array(z.string()),
  skippedHunkIds: z.array(z.string()),
  affectedFindingIds: z.array(z.string()),
  paths: z.array(z.string()),
  skippedPaths: z.array(z.string()),
}).strict();
export type ReviewCoverage = z.infer<typeof ReviewCoverageSchema>;

export const PartialReviewCoverageSchema = ReviewCoverageSchema.partial().loose();

export const PullRequestTaskTypeSchema = z.enum([
  "bug",
  "dependency",
  "documentation",
  "feature",
]);
export type PullRequestTaskType = z.infer<typeof PullRequestTaskTypeSchema>;

export const OriginatingAgentSchema = z.enum([
  "claude",
  "codex",
  "opencode",
  "t3-code",
]);
export type OriginatingAgent = z.infer<typeof OriginatingAgentSchema>;

export const PullRequestMetadataSchema = z.object({
  author: z.string().min(1),
  authorAssociation: z.string().optional(),
  title: z.string().optional(),
  labels: z.array(z.string()),
  headRef: z.string().optional(),
  taskType: PullRequestTaskTypeSchema.optional(),
  originatingAgent: OriginatingAgentSchema.optional(),
  reviewers: z.array(z.string().min(1)).optional(),
}).strict();
export type PullRequestMetadata = z.infer<typeof PullRequestMetadataSchema>;

export const OpenFindingBaselineSchema = z.looseObject({
  findingId: z.string(),
  file: z.string(),
  title: z.string(),
  hunkIds: z.array(z.string()),
  severity: z.string().optional(),
  line: z.number().int().positive().nullable().optional(),
  evidence: z.string().optional(),
  recommendation: z.string().optional(),
});
export type OpenFindingBaseline = z.infer<typeof OpenFindingBaselineSchema>;

export const ReplayInputSnapshotSchema = z.looseObject({
  schemaVersion: z.literal(1),
  recordType: z.literal("ai-review-replay-input"),
  repository: z.string().min(1),
  pullRequestNumber: z.number().int().positive(),
  productionRunId: z.string().min(1),
  pullRequest: PullRequestMetadataSchema.optional(),
  git: z.looseObject({ baseSha: z.string().min(1), headSha: z.string().min(1) }),
  input: z.looseObject({
    fullDiff: z.string(),
    reviewedDiff: z.string(),
    boundedFileContext: z.string(),
    repositoryGuidelines: z.string(),
    effectiveReviewRules: z.string().optional(),
    reviewThreads: z.string(),
    priorOpenFindings: z.array(OpenFindingBaselineSchema),
    affectedOpenFindings: z.array(OpenFindingBaselineSchema),
  }),
  decision: z.looseObject({
    changeProfile: ChangeProfileSchema.optional(),
    coverage: ReviewCoverageSchema.optional(),
    coverageManifest: ReviewCoverageManifestSchema.optional(),
    rulePreview: ReviewRulePreviewSchema.optional(),
    paths: z.array(z.string()),
    omittedPaths: z.array(z.string()),
    reviewedHunks: z.array(ReviewHunkSchema).optional(),
  }),
  prompt: z.looseObject({
    version: z.string().min(1),
    scoutSystem: z.string(),
    scoutSchema: z.unknown(),
    mergerSystem: z.string(),
    mergerSchema: z.unknown(),
  }),
  policy: z.record(z.string(), z.unknown()),
  modelRequest: z.looseObject({
    openRouterScouts: z.array(z.string()),
    openCodeScouts: z.array(z.string()),
    merger: z.string(),
    requireZeroDataRetention: z.boolean(),
    scoutMaxTokens: z.number().int().positive(),
    mergerMaxTokens: z.number().int().positive(),
  }),
  provenance: z.looseObject({
    diffFingerprint: z.string().optional(),
    configFingerprint: z.string().optional(),
    capturedAt: z.iso.datetime(),
    liveCredentialsIncluded: z.literal(false),
  }),
});
export type ReplayInputSnapshot = z.infer<typeof ReplayInputSnapshotSchema>;

export const ReviewTerminalRecordSchema = z.looseObject({
  schemaVersion: z.literal(2),
  recordType: z.literal("review-run-terminal"),
  repository: z.string().min(1),
  pullRequestNumber: z.number().int().positive(),
  status: z.enum(["published", "skipped", "denied", "failed"]),
  workflow: z.looseObject({ instanceId: z.string().min(1) }),
  pullRequest: PullRequestMetadataSchema.optional(),
  change: ChangeProfileSchema.partial().optional(),
  coverage: PartialReviewCoverageSchema.optional(),
  coverageManifest: ReviewCoverageManifestSchema.optional(),
  rulePreview: ReviewRulePreviewSchema.optional(),
  findings: z.looseObject({ published: z.array(ReviewFindingSchema).optional() }).optional(),
});
export type ReviewTerminalRecord = z.infer<typeof ReviewTerminalRecordSchema>;

export const FindingOutcomeRecordSchema = z.looseObject({
  schemaVersion: z.literal(2),
  recordType: z.literal("finding-outcome"),
  outcomeVersion: z.number().int().positive(),
  repository: z.string().min(1),
  pullRequestNumber: z.number().int().positive(),
  findingId: z.string().min(1),
  outcome: FindingOutcomeValueSchema,
  outcomeKind: z.enum(["adjudicated", "censored", "workflow"]),
  basis: z.enum(["explicit-disposition", "later-reviewed-head", "pull-request-finalization", "outcome-window"]),
  confidence: z.number().min(0).max(1),
  evaluatorVersion: z.string().min(1),
  manualOverride: z.looseObject({ actor: z.string(), deliveryId: z.string(), reason: z.string() }).nullable(),
  sourceId: z.string(),
  evidence: z.record(z.string(), z.unknown()),
  occurredAt: z.iso.datetime(),
  recordedAt: z.iso.datetime(),
});
export type FindingOutcomeRecord = z.infer<typeof FindingOutcomeRecordSchema>;

export const ModelUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
}).strict();
export type ModelUsage = z.infer<typeof ModelUsageSchema>;

export const ModelMetricSchema = z.object({
  model: z.string(),
  provider: ReplayProviderSchema,
  role: z.enum(["scout", "merger"]),
  ok: z.boolean(),
  latencyMs: z.number().nonnegative(),
  costUsd: z.number().nonnegative(),
  usage: ModelUsageSchema.optional(),
  error: z.string().optional(),
  skipped: z.boolean().optional(),
  consecutiveFailures: z.number().int().nonnegative().optional(),
  cooldownUntil: z.string().optional(),
}).strict();
export type ModelMetric = z.infer<typeof ModelMetricSchema>;
