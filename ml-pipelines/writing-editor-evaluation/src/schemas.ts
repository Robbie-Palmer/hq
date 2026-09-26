import { z } from "zod";

import { FindingIdSchema, FindingSchema } from "writing-editor-domain/findings";
import { ProposalIdSchema, ProposalSchema } from "writing-editor-domain/proposals";
import {
  ContentHashSchema,
  ProducerSchema,
  SourceReferenceSchema,
  SuggestionIdSchema,
  SuggestionSchema,
} from "writing-editor-domain/suggestions";

export const ArtifactTypeSchema = z.enum(["adr", "project-page"]);
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;

export const SplitSchema = z.enum(["train", "validation", "holdout"]);
export type Split = z.infer<typeof SplitSchema>;

const ArtifactIdSchema = z.string().regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  "must be a lowercase path-safe ID",
);
const GitCommitSchema = z.string().regex(/^[a-f0-9]{40}$/, "must be a full Git commit hash");
const RepositoryPathSchema = z.string().min(1).superRefine((value, context) => {
  const segments = value.split("/");
  if (
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes(":") ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    context.addIssue({ code: "custom", message: "must be a safe repository-relative path" });
  }
});

const SourceEntrySchema = z.object({
  artifactId: ArtifactIdSchema,
  artifactType: ArtifactTypeSchema,
  path: RepositoryPathSchema,
  sourcePath: RepositoryPathSchema.optional(),
  publishedPath: RepositoryPathSchema.optional(),
  sourceRevision: GitCommitSchema,
  publishedRevision: GitCommitSchema,
  outcomeStatus: z.literal("unrecorded"),
}).strict().superRefine((entry, context) => {
  if (entry.sourceRevision === entry.publishedRevision) {
    context.addIssue({
      code: "custom",
      message: "sourceRevision and publishedRevision must differ",
      path: ["publishedRevision"],
    });
  }
});

export const CorpusSourceManifestSchema = z.object({
  schemaVersion: z.literal(1),
  recordType: z.literal("writing-editor-corpus-source-manifest"),
  entries: z.array(SourceEntrySchema).min(1),
}).strict().superRefine((manifest, context) => {
  const ids = manifest.entries.map(({ artifactId }) => artifactId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", message: "artifact IDs must be unique", path: ["entries"] });
  }
});
export type CorpusSourceManifest = z.infer<typeof CorpusSourceManifestSchema>;

export const ExtractedRevisionSchema = z.object({
  revision: GitCommitSchema,
  committedAt: z.iso.datetime({ offset: true }),
  contentHash: ContentHashSchema,
  bytes: z.number().int().nonnegative(),
  file: RepositoryPathSchema,
}).strict();

export const DatasetEntrySchema = z.object({
  artifactId: ArtifactIdSchema,
  artifactType: ArtifactTypeSchema,
  path: RepositoryPathSchema,
  outcomeStatus: z.literal("unrecorded"),
  source: ExtractedRevisionSchema,
  published: ExtractedRevisionSchema,
}).strict();
export type DatasetEntry = z.infer<typeof DatasetEntrySchema>;

export const DatasetManifestSchema = z.object({
  schemaVersion: z.literal(1),
  recordType: z.literal("writing-editor-dataset"),
  datasetId: z.string().regex(/^dataset:v1:[a-f0-9]{64}$/),
  sourceManifestHash: ContentHashSchema,
  entries: z.array(DatasetEntrySchema).min(1),
}).strict();
export type DatasetManifest = z.infer<typeof DatasetManifestSchema>;

const SplitRatiosSchema = z.object({
  train: z.number().positive().lt(1),
  validation: z.number().positive().lt(1),
  holdout: z.number().positive().lt(1),
}).strict().superRefine((ratios, context) => {
  const sum = ratios.train + ratios.validation + ratios.holdout;
  if (Math.abs(sum - 1) > Number.EPSILON * 10) {
    context.addIssue({ code: "custom", message: "split ratios must sum to 1" });
  }
});

export const PipelineParamsSchema = z.object({
  cohort: z.object({
    frozenAt: z.iso.datetime(),
    seed: z.string().trim().min(1),
    split: SplitRatiosSchema,
    requiredArtifactTypes: z.array(ArtifactTypeSchema).min(1).refine(
      (types) => new Set(types).size === types.length,
      "required artifact types must be unique",
    ),
  }).strict(),
  producers: z.object({
    gector: z.object({
      batchSize: z.number().int().positive(),
      iterations: z.number().int().positive(),
      maxTokens: z.number().int().positive().max(100),
      minTokens: z.number().int().positive(),
      minErrorProbability: z.number().min(0).max(1),
      minTokenProbability: z.number().min(0).max(1),
      additionalConfidence: z.number().min(0).max(1),
    }).strict(),
    vale: z.object({
      binaryVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
      timeoutMs: z.number().int().positive(),
    }).strict(),
  }).strict(),
  matching: z.object({
    characterDiff: z.object({
      maxEditLength: z.number().int().positive(),
    }).strict(),
  }).strict(),
}).strict();
export type PipelineParams = z.infer<typeof PipelineParamsSchema>;

export const FrozenEntrySchema = DatasetEntrySchema.extend({
  split: SplitSchema,
}).strict();
export type FrozenEntry = z.infer<typeof FrozenEntrySchema>;

export const FrozenCohortSchema = z.object({
  schemaVersion: z.literal(1),
  recordType: z.literal("writing-editor-frozen-cohort"),
  cohortId: z.string().regex(/^cohort:v1:[a-f0-9]{64}$/),
  datasetId: z.string().regex(/^dataset:v1:[a-f0-9]{64}$/),
  frozenAt: z.iso.datetime(),
  seed: z.string().min(1),
  splitRatios: SplitRatiosSchema,
  entries: z.array(FrozenEntrySchema).min(1),
}).strict();
export type FrozenCohort = z.infer<typeof FrozenCohortSchema>;

const ArtifactCountsSchema = z.object({
  adr: z.number().int().nonnegative(),
  "project-page": z.number().int().nonnegative(),
}).strict();

export const ReadinessSchema = z.object({
  schemaVersion: z.literal(1),
  recordType: z.literal("writing-editor-cohort-readiness"),
  cohortId: z.string().regex(/^cohort:v1:[a-f0-9]{64}$/),
  ready: z.boolean(),
  revisions: z.object({
    complete: z.boolean(),
    extractedPairs: z.number().int().nonnegative(),
    missingArtifactIds: z.array(ArtifactIdSchema),
  }).strict(),
  outcomes: z.object({
    complete: z.boolean(),
    recorded: z.number().int().nonnegative(),
    missingArtifactIds: z.array(ArtifactIdSchema),
  }).strict(),
  coverage: z.object({
    total: z.number().int().nonnegative(),
    requiredArtifactTypesPresent: z.boolean(),
    byArtifactType: ArtifactCountsSchema,
    bySplit: z.object({
      train: ArtifactCountsSchema,
      validation: ArtifactCountsSchema,
      holdout: ArtifactCountsSchema,
    }).strict(),
  }).strict(),
}).strict();
export type Readiness = z.infer<typeof ReadinessSchema>;

export const ValeSeveritySchema = z.enum(["error", "warning", "suggestion"]);
export type ValeSeverity = z.infer<typeof ValeSeveritySchema>;

export const ValeFindingRecordSchema = z.object({
  severity: ValeSeveritySchema,
  valeMatch: z.string().min(1),
  location: z.object({
    line: z.number().int().positive(),
    startColumn: z.number().int().positive(),
    endColumn: z.number().int().positive(),
  }).strict(),
  finding: FindingSchema,
}).strict();
export type ValeFindingRecord = z.infer<typeof ValeFindingRecordSchema>;

const ValeArtifactResultSchema = z.object({
  artifactId: ArtifactIdSchema,
  artifactType: ArtifactTypeSchema,
  split: SplitSchema,
  source: SourceReferenceSchema,
  findingIds: z.array(FindingIdSchema),
  findings: z.array(ValeFindingRecordSchema),
}).strict().superRefine((artifact, context) => {
  for (const [index, { finding }] of artifact.findings.entries()) {
    if (
      finding.source.documentId !== artifact.source.documentId ||
      finding.source.revision !== artifact.source.revision ||
      finding.source.contentHash !== artifact.source.contentHash
    ) {
      context.addIssue({
        code: "custom",
        message: "each finding source must match the containing artifact source",
        path: ["findings", index, "finding", "source"],
      });
    }
  }
  const expectedIds = artifact.findings.map(({ finding }) => finding.findingId);
  if (
    artifact.findingIds.length !== expectedIds.length ||
    artifact.findingIds.some((id, index) => id !== expectedIds[index])
  ) {
    context.addIssue({
      code: "custom",
      message: "findingIds must match findings in output order",
      path: ["findingIds"],
    });
  }
  if (new Set(expectedIds).size !== expectedIds.length) {
    context.addIssue({
      code: "custom",
      message: "an artifact cannot contain duplicate findings",
      path: ["findings"],
    });
  }
});

const FindingCountSchema = z.object({
  check: z.string().min(1),
  count: z.number().int().positive(),
}).strict();

const ValeSummarySchema = z.object({
  artifacts: z.number().int().positive(),
  artifactsWithFindings: z.number().int().nonnegative(),
  findings: z.number().int().nonnegative(),
  bySeverity: z.object({
    error: z.number().int().nonnegative(),
    warning: z.number().int().nonnegative(),
    suggestion: z.number().int().nonnegative(),
  }).strict(),
  byCheck: z.array(FindingCountSchema),
}).strict();
type ValeSummary = z.infer<typeof ValeSummarySchema>;

export function summarizeValeArtifacts(
  artifacts: z.infer<typeof ValeArtifactResultSchema>[],
): ValeSummary {
  const findings = artifacts.flatMap((artifact) => artifact.findings);
  const bySeverity = { error: 0, warning: 0, suggestion: 0 };
  const checks = new Map<string, number>();
  for (const record of findings) {
    bySeverity[record.severity] += 1;
    const provenance = record.finding.producer.provenance;
    if (provenance.kind !== "rule") {
      throw new Error("Vale finding has non-rule provenance");
    }
    checks.set(provenance.ruleId, (checks.get(provenance.ruleId) ?? 0) + 1);
  }
  return {
    artifacts: artifacts.length,
    artifactsWithFindings: artifacts.filter(({ findings: records }) => records.length > 0).length,
    findings: findings.length,
    bySeverity,
    byCheck: [...checks.entries()]
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([check, count]) => ({ check, count })),
  };
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

const ValeProducerRunBaseSchema = z.object({
  schemaVersion: z.literal(1),
  recordType: z.literal("writing-editor-vale-producer-run"),
  runId: z.string().regex(/^producer-run:v1:[a-f0-9]{64}$/),
  cohortId: z.string().regex(/^cohort:v1:[a-f0-9]{64}$/),
  producer: ProducerSchema,
  vale: z.object({
    binaryVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    ruleSetHash: ContentHashSchema,
  }).strict(),
  artifacts: z.array(ValeArtifactResultSchema).min(1),
  summary: ValeSummarySchema,
}).strict();
type ValeProducerRunInput = z.infer<typeof ValeProducerRunBaseSchema>;

function validateProducerArtifactIds(
  run: ValeProducerRunInput,
  context: z.RefinementCtx,
): void {
  const artifactIds = run.artifacts.map(({ artifactId }) => artifactId);
  if (new Set(artifactIds).size !== artifactIds.length) {
    context.addIssue({
      code: "custom",
      message: "producer artifact IDs must be unique",
      path: ["artifacts"],
    });
  }
}

function validateFindingProducers(
  run: ValeProducerRunInput,
  context: z.RefinementCtx,
): void {
  for (const [artifactIndex, artifact] of run.artifacts.entries()) {
    for (const [findingIndex, { finding }] of artifact.findings.entries()) {
      if (
        finding.producer.id !== run.producer.id ||
        finding.producer.version !== run.producer.version
      ) {
        context.addIssue({
          code: "custom",
          message: "each finding producer must match the containing producer run",
          path: ["artifacts", artifactIndex, "findings", findingIndex, "finding", "producer"],
        });
      }
    }
  }
}

function validateValeSummary(
  run: ValeProducerRunInput,
  context: z.RefinementCtx,
): void {
  let expectedSummary: ValeSummary;
  try {
    expectedSummary = summarizeValeArtifacts(run.artifacts);
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : String(error),
      path: ["artifacts"],
    });
    return;
  }
  for (const field of ["artifacts", "artifactsWithFindings", "findings"] as const) {
    if (run.summary[field] !== expectedSummary[field]) {
      context.addIssue({
        code: "custom",
        message: `summary ${field} must equal ${expectedSummary[field]}`,
        path: ["summary", field],
      });
    }
  }
  for (const severity of ["error", "warning", "suggestion"] as const) {
    if (run.summary.bySeverity[severity] !== expectedSummary.bySeverity[severity]) {
      context.addIssue({
        code: "custom",
        message: `summary ${severity} count must equal ${expectedSummary.bySeverity[severity]}`,
        path: ["summary", "bySeverity", severity],
      });
    }
  }
  if (
    run.summary.byCheck.length !== expectedSummary.byCheck.length ||
    run.summary.byCheck.some(({ check, count }, index) =>
      check !== expectedSummary.byCheck[index]?.check ||
      count !== expectedSummary.byCheck[index]?.count
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "summary byCheck must match deterministic artifact counts",
      path: ["summary", "byCheck"],
    });
  }
}

export const ValeProducerRunSchema = ValeProducerRunBaseSchema.superRefine((run, context) => {
  validateProducerArtifactIds(run, context);
  validateFindingProducers(run, context);
  validateValeSummary(run, context);
});
export type ValeProducerRun = z.infer<typeof ValeProducerRunSchema>;

const GectorGeneratedSchema = z.object({
  file: RepositoryPathSchema,
  contentHash: ContentHashSchema,
  correctedLines: z.array(z.number().int().positive()),
  iterationUpdates: z.number().int().nonnegative(),
}).strict().superRefine((generated, context) => {
  if (new Set(generated.correctedLines).size !== generated.correctedLines.length) {
    context.addIssue({
      code: "custom",
      message: "corrected line numbers must be unique",
      path: ["correctedLines"],
    });
  }
});

const GectorArtifactResultSchema = z.object({
  artifactId: ArtifactIdSchema,
  artifactType: ArtifactTypeSchema,
  split: SplitSchema,
  source: SourceReferenceSchema,
  generated: GectorGeneratedSchema,
  suggestionIds: z.array(SuggestionIdSchema),
  suggestions: z.array(SuggestionSchema),
  proposalIds: z.array(ProposalIdSchema),
  proposals: z.array(ProposalSchema),
}).strict().superRefine((artifact, context) => {
  const suggestionIds = artifact.suggestions.map(({ suggestionId }) => suggestionId);
  if (
    artifact.suggestionIds.length !== suggestionIds.length ||
    artifact.suggestionIds.some((id, index) => id !== suggestionIds[index])
  ) {
    context.addIssue({
      code: "custom",
      message: "suggestionIds must match suggestions in output order",
      path: ["suggestionIds"],
    });
  }
  const proposalIds = artifact.proposals.map(({ proposalId }) => proposalId);
  if (
    artifact.proposalIds.length !== proposalIds.length ||
    artifact.proposalIds.some((id, index) => id !== proposalIds[index])
  ) {
    context.addIssue({
      code: "custom",
      message: "proposalIds must match proposals in output order",
      path: ["proposalIds"],
    });
  }
  const proposalSuggestionIds = artifact.proposals.flatMap(({ suggestionIds: ids }) => ids);
  if (
    proposalSuggestionIds.length !== suggestionIds.length ||
    new Set(proposalSuggestionIds).size !== suggestionIds.length ||
    suggestionIds.some((id) => !proposalSuggestionIds.includes(id))
  ) {
    context.addIssue({
      code: "custom",
      message: "proposals must contain every suggestion exactly once",
      path: ["proposals"],
    });
  }
  const suggestionsById = new Map(
    artifact.suggestions.map((suggestion) => [suggestion.suggestionId, suggestion]),
  );
  for (const [proposalIndex, proposal] of artifact.proposals.entries()) {
    for (const [suggestionIndex, suggestion] of proposal.suggestions.entries()) {
      const expected = suggestionsById.get(suggestion.suggestionId);
      if (expected === undefined || JSON.stringify(expected) !== JSON.stringify(suggestion)) {
        context.addIssue({
          code: "custom",
          message: "proposal suggestions must match the top-level suggestion records",
          path: ["proposals", proposalIndex, "suggestions", suggestionIndex],
        });
      }
    }
  }
  for (const [index, suggestion] of artifact.suggestions.entries()) {
    if (
      suggestion.source.documentId !== artifact.source.documentId ||
      suggestion.source.revision !== artifact.source.revision ||
      suggestion.source.contentHash !== artifact.source.contentHash
    ) {
      context.addIssue({
        code: "custom",
        message: "each suggestion source must match the containing artifact source",
        path: ["suggestions", index, "source"],
      });
    }
  }
});

const GectorSummarySchema = z.object({
  artifacts: z.number().int().positive(),
  artifactsWithSuggestions: z.number().int().nonnegative(),
  suggestions: z.number().int().nonnegative(),
  proposals: z.number().int().nonnegative(),
}).strict();

export const GectorProducerRunSchema = z.object({
  schemaVersion: z.literal(1),
  recordType: z.literal("writing-editor-gector-producer-run"),
  runId: z.string().regex(/^producer-run:v1:[a-f0-9]{64}$/),
  cohortId: z.string().regex(/^cohort:v1:[a-f0-9]{64}$/),
  producer: ProducerSchema,
  model: z.object({
    checkpointContentHash: ContentHashSchema,
    manifestContentHash: ContentHashSchema,
  }).strict(),
  runtime: z.object({
    pythonVersion: z.literal("3.12.12"),
    torchVersion: z.literal("2.11.0+cu128"),
    transformersVersion: z.literal("5.17.0"),
    cudaVersion: z.literal("12.8"),
    device: z.literal("cuda"),
    computeCapability: z.string().regex(/^\d+\.\d+$/),
    lockContentHash: ContentHashSchema,
    adapterRevision: z.literal(1),
  }).strict(),
  parameters: PipelineParamsSchema.shape.producers.shape.gector,
  artifacts: z.array(GectorArtifactResultSchema).min(1),
  summary: GectorSummarySchema,
}).strict().superRefine((run, context) => {
  const artifactIds = run.artifacts.map(({ artifactId }) => artifactId);
  if (new Set(artifactIds).size !== artifactIds.length) {
    context.addIssue({ code: "custom", message: "producer artifact IDs must be unique" });
  }
  const suggestions = run.artifacts.flatMap((artifact) => artifact.suggestions);
  if (suggestions.some((suggestion) =>
    suggestion.producer.id !== run.producer.id ||
    suggestion.producer.version !== run.producer.version
  )) {
    context.addIssue({ code: "custom", message: "suggestion producer must match the run" });
  }
  const expected = {
    artifacts: run.artifacts.length,
    artifactsWithSuggestions: run.artifacts.filter(({ suggestions: records }) => records.length > 0)
      .length,
    suggestions: suggestions.length,
    proposals: run.artifacts.reduce((total, artifact) => total + artifact.proposals.length, 0),
  };
  if (JSON.stringify(run.summary) !== JSON.stringify(expected)) {
    context.addIssue({ code: "custom", message: "summary must match artifact counts" });
  }
});
export type GectorProducerRun = z.infer<typeof GectorProducerRunSchema>;

export const EditHunkIdSchema = z.string().regex(/^edit-hunk:v1:[a-f0-9]{64}$/);

const ObservedSpanSchema = z.object({
  startByte: z.number().int().nonnegative(),
  endByte: z.number().int().nonnegative(),
  text: z.string(),
}).strict().superRefine((span, context) => {
  if (span.endByte < span.startByte) {
    context.addIssue({
      code: "custom",
      message: "span end must be greater than or equal to its start",
      path: ["endByte"],
    });
  }
  if (Buffer.byteLength(span.text, "utf8") !== span.endByte - span.startByte) {
    context.addIssue({
      code: "custom",
      message: "span text must occupy the declared UTF-8 byte range",
      path: ["text"],
    });
  }
});

export const EditHunkSchema = z.object({
  hunkId: EditHunkIdSchema,
  source: ObservedSpanSchema,
  published: ObservedSpanSchema,
}).strict().superRefine((hunk, context) => {
  if (
    hunk.source.startByte === hunk.source.endByte &&
    hunk.published.startByte === hunk.published.endByte
  ) {
    context.addIssue({ code: "custom", message: "an edit hunk must change content" });
  }
});
export type EditHunk = z.infer<typeof EditHunkSchema>;

export const FindingEditMatchStatusSchema = z.enum([
  "changed",
  "unchanged",
  "manual-adjudication-required",
]);
export type FindingEditMatchStatus = z.infer<typeof FindingEditMatchStatusSchema>;

export const FindingEditMatchSchema = z.object({
  findingId: FindingIdSchema,
  status: FindingEditMatchStatusSchema,
  hunkIds: z.array(EditHunkIdSchema),
  publishedSpan: ObservedSpanSchema.nullable(),
  reason: z.enum([
    "edit-crosses-finding-boundary",
    "edit-touches-finding-boundary",
  ]).nullable(),
}).strict().superRefine((match, context) => {
  if (match.status === "unchanged" && match.hunkIds.length > 0) {
    context.addIssue({
      code: "custom",
      message: "an unchanged finding cannot reference edit hunks",
      path: ["hunkIds"],
    });
  }
  if (match.status !== "unchanged" && match.hunkIds.length === 0) {
    context.addIssue({
      code: "custom",
      message: "a changed or ambiguous finding must reference an edit hunk",
      path: ["hunkIds"],
    });
  }
  if (match.status === "manual-adjudication-required") {
    if (match.publishedSpan !== null) {
      context.addIssue({
        code: "custom",
        message: "an ambiguous match cannot claim an exact published span",
        path: ["publishedSpan"],
      });
    }
    if (match.reason === null) {
      context.addIssue({
        code: "custom",
        message: "an ambiguous match needs a reason",
        path: ["reason"],
      });
    }
  } else {
    if (match.publishedSpan === null) {
      context.addIssue({
        code: "custom",
        message: "an unambiguous match needs an exact published span",
        path: ["publishedSpan"],
      });
    }
    if (match.reason !== null) {
      context.addIssue({
        code: "custom",
        message: "only ambiguous matches can have a reason",
        path: ["reason"],
      });
    }
  }
});
export type FindingEditMatch = z.infer<typeof FindingEditMatchSchema>;

const EditMatchArtifactSchema = z.object({
  artifactId: ArtifactIdSchema,
  artifactType: ArtifactTypeSchema,
  split: SplitSchema,
  source: SourceReferenceSchema,
  published: SourceReferenceSchema,
  hunkIds: z.array(EditHunkIdSchema),
  hunks: z.array(EditHunkSchema),
  findingIds: z.array(FindingIdSchema),
  matches: z.array(FindingEditMatchSchema),
}).strict().superRefine((artifact, context) => {
  const hunkIds = artifact.hunks.map(({ hunkId }) => hunkId);
  if (
    artifact.hunkIds.length !== hunkIds.length ||
    artifact.hunkIds.some((id, index) => id !== hunkIds[index])
  ) {
    context.addIssue({
      code: "custom",
      message: "hunkIds must match hunks in output order",
      path: ["hunkIds"],
    });
  }
  if (new Set(hunkIds).size !== hunkIds.length) {
    context.addIssue({
      code: "custom",
      message: "an artifact cannot contain duplicate edit hunks",
      path: ["hunks"],
    });
  }

  const findingIds = artifact.matches.map(({ findingId }) => findingId);
  if (
    artifact.findingIds.length !== findingIds.length ||
    artifact.findingIds.some((id, index) => id !== findingIds[index])
  ) {
    context.addIssue({
      code: "custom",
      message: "findingIds must match edit matches in output order",
      path: ["findingIds"],
    });
  }
  if (new Set(findingIds).size !== findingIds.length) {
    context.addIssue({
      code: "custom",
      message: "an artifact cannot contain duplicate finding matches",
      path: ["matches"],
    });
  }

  const knownHunks = new Set(hunkIds);
  for (const [matchIndex, match] of artifact.matches.entries()) {
    for (const [hunkIndex, hunkId] of match.hunkIds.entries()) {
      if (!knownHunks.has(hunkId)) {
        context.addIssue({
          code: "custom",
          message: "a match cannot reference an unknown edit hunk",
          path: ["matches", matchIndex, "hunkIds", hunkIndex],
        });
      }
    }
  }
});

const MatchStatusCountsSchema = z.object({
  changed: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  "manual-adjudication-required": z.number().int().nonnegative(),
}).strict();

export const EditMatchRunSchema = z.object({
  schemaVersion: z.literal(1),
  recordType: z.literal("writing-editor-edit-match-run"),
  runId: z.string().regex(/^edit-match-run:v1:[a-f0-9]{64}$/),
  cohortId: z.string().regex(/^cohort:v1:[a-f0-9]{64}$/),
  producerRunId: z.string().regex(/^producer-run:v1:[a-f0-9]{64}$/),
  algorithm: z.object({
    id: z.literal("jsdiff-character-overlap"),
    version: z.string().regex(/^jsdiff@\d+\.\d+\.\d+\+matcher\.\d+$/),
    maxEditLength: z.number().int().positive(),
  }).strict(),
  artifacts: z.array(EditMatchArtifactSchema).min(1),
  summary: z.object({
    artifacts: z.number().int().positive(),
    findings: z.number().int().nonnegative(),
    editHunks: z.number().int().nonnegative(),
    byStatus: MatchStatusCountsSchema,
  }).strict(),
}).strict();
export type EditMatchRun = z.infer<typeof EditMatchRunSchema>;
