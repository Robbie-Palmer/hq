import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { canonicalJson } from "writing-editor-domain/canonical-json";
import { DecisionSchema } from "writing-editor-domain/decisions";
import { ReviewReceiptSchema } from "writing-editor-domain/review-receipt";
import {
  applyDecisions,
  prepareReviewRecords,
  ReviewRecordsSchema,
  validateRecordedDecisions,
} from "writing-editor-domain/review";
import { sha256 } from "writing-editor-domain/suggestions";
import { z } from "zod";

import { readJson, resolveContainedFile, writeJson } from "./files";
import {
  EditMatchRunSchema,
  FrozenCohortSchema,
  GectorProducerRunSchema,
  ValeProducerRunSchema,
  type GectorProducerRun,
} from "./schemas";

const EvidencePathSchema = z.string().min(1).refine(
  (value) => !path.isAbsolute(value) && !value.split("/").includes(".."),
  "must be relative to the evidence root",
);
const QualityRatingSchema = z.enum(["pass", "fail", "not-assessed"]);
const EvidenceGovernanceSchema = z.object({
  dataClassification: z.enum(["public", "private"]),
  consentBasis: z.string().trim().min(1),
  consentRecordedAt: z.iso.datetime({ offset: true }),
  retentionPolicy: z.string().trim().min(1),
  deletionStatus: z.enum(["active", "deletion-requested"]),
  deletionRequestedAt: z.iso.datetime({ offset: true }).optional(),
}).strict().superRefine((governance, context) => {
  if (governance.deletionStatus === "deletion-requested" && !governance.deletionRequestedAt) {
    context.addIssue({
      code: "custom",
      message: "deletionRequestedAt is required when deletion is requested",
      path: ["deletionRequestedAt"],
    });
  }
  if (governance.deletionStatus === "active" && governance.deletionRequestedAt) {
    context.addIssue({
      code: "custom",
      message: "deletionRequestedAt is only valid when deletion is requested",
      path: ["deletionRequestedAt"],
    });
  }
});

const ReviewEvidenceEntrySchema = z.object({
  artifactId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  artifactType: z.enum(["adr", "project-page"]),
  split: z.enum(["train", "validation", "holdout"]),
  recordsFile: EvidencePathSchema,
  decisionsFile: EvidencePathSchema,
  receiptFile: EvidencePathSchema,
  sourceBeforeFile: EvidencePathSchema.optional(),
  sourceAfterFile: EvidencePathSchema.optional(),
  provenance: z.object({
    scope: z.enum(["seed", "customer", "developer"]),
    sourceDatasetId: z.string().trim().min(1),
    sourceRevision: z.string().trim().min(1),
    producerRunId: z.string().trim().min(1),
    reviewMethod: z.string().trim().min(1),
    reviewTiming: z.enum(["measured", "not-measured"]),
  }).strict().optional(),
  governance: EvidenceGovernanceSchema.optional(),
  quality: z.object({
    factualPreservation: QualityRatingSchema,
    terminologyPreservation: QualityRatingSchema,
    voicePreservation: QualityRatingSchema,
    regression: z.enum(["none", "present", "not-assessed"]),
  }).strict(),
}).strict().superRefine((entry, context) => {
  if (entry.provenance && entry.sourceBeforeFile === undefined) {
    context.addIssue({
      code: "custom",
      message: "current evidence entries must include source snapshots",
      path: ["sourceBeforeFile"],
    });
  }
  if ((entry.sourceBeforeFile === undefined) !== (entry.sourceAfterFile === undefined)) {
    context.addIssue({
      code: "custom",
      message: "sourceBeforeFile and sourceAfterFile must be provided together",
      path: ["sourceBeforeFile"],
    });
  }
});

const EvidenceDeletionSchema = z.object({
  artifactId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  requestedAt: z.iso.datetime({ offset: true }),
  deletedAt: z.iso.datetime({ offset: true }),
}).strict();

export const ReviewEvidenceManifestSchema = z.object({
  schemaVersion: z.literal(1),
  recordType: z.literal("writing-review-evidence-manifest"),
  cohortId: z.string().trim().min(1),
  governance: EvidenceGovernanceSchema,
  entries: z.array(ReviewEvidenceEntrySchema).min(1),
  deletions: z.array(EvidenceDeletionSchema).optional(),
}).strict().superRefine((manifest, context) => {
  const ids = manifest.entries.map(({ artifactId }) => artifactId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", message: "artifact IDs must be unique", path: ["entries"] });
  }
  const deletedIds = manifest.deletions?.map(({ artifactId }) => artifactId) ?? [];
  if (new Set(deletedIds).size !== deletedIds.length) {
    context.addIssue({ code: "custom", message: "deleted artifact IDs must be unique", path: ["deletions"] });
  }
  if (deletedIds.some((artifactId) => ids.includes(artifactId))) {
    context.addIssue({ code: "custom", message: "deleted artifacts cannot retain evidence entries", path: ["deletions"] });
  }
});

export const ReviewEvaluationParamsSchema = z.object({
  sampleSize: z.object({
    minimumArtifacts: z.number().int().positive(),
    minimumActionableProposals: z.number().int().positive(),
    requiredArtifactTypes: z.array(z.enum(["adr", "project-page"])).min(1),
  }).strict(),
  thresholds: z.object({
    adopt: z.object({
      minimumUsefulYield: z.number().min(0).max(1),
      maximumRegressionRate: z.number().min(0).max(1),
      maximumMedianReviewSeconds: z.number().nonnegative(),
    }).strict(),
    reject: z.object({
      maximumUsefulYield: z.number().min(0).max(1),
      minimumRegressionRate: z.number().min(0).max(1),
      minimumMedianReviewSeconds: z.number().nonnegative(),
    }).strict(),
  }).strict(),
  requireAssessedQuality: z.boolean(),
  decisionLogic: z.object({
    adopt: z.literal("sample-size-met-and-all-adoption-gates-pass"),
    reject: z.literal("sample-size-met-and-any-rejection-gate-fails"),
    gatherMoreEvidence: z.literal("otherwise"),
  }).strict(),
}).strict().superRefine((params, context) => {
  if (new Set(params.sampleSize.requiredArtifactTypes).size !==
    params.sampleSize.requiredArtifactTypes.length) {
    context.addIssue({
      code: "custom",
      message: "required artifact types must be unique",
      path: ["sampleSize", "requiredArtifactTypes"],
    });
  }
  if (params.thresholds.reject.maximumUsefulYield >=
    params.thresholds.adopt.minimumUsefulYield) {
    context.addIssue({
      code: "custom",
      message: "useful-yield rejection and adoption thresholds must leave an evidence gap",
      path: ["thresholds"],
    });
  }
  if (params.thresholds.reject.minimumRegressionRate <=
    params.thresholds.adopt.maximumRegressionRate) {
    context.addIssue({
      code: "custom",
      message: "regression rejection and adoption thresholds must leave an evidence gap",
      path: ["thresholds"],
    });
  }
  if (params.thresholds.reject.minimumMedianReviewSeconds <=
    params.thresholds.adopt.maximumMedianReviewSeconds) {
    context.addIssue({
      code: "custom",
      message: "review-time rejection and adoption thresholds must leave an evidence gap",
      path: ["thresholds"],
    });
  }
});

const MetricCountSchema = z.object({
  pass: z.number().int().nonnegative(),
  fail: z.number().int().nonnegative(),
  notAssessed: z.number().int().nonnegative(),
}).strict();

export const ReviewScorecardSchema = z.object({
  schemaVersion: z.literal(2),
  recordType: z.literal("writing-review-scorecard"),
  scorecardId: z.string().regex(/^scorecard:v2:[a-f0-9]{64}$/),
  cohortId: z.string().trim().min(1),
  evidenceManifestHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  pipelineInputs: z.object({
    cohortId: z.string(),
    datasetId: z.string(),
    valeProducerRunId: z.string(),
    editMatchRunId: z.string(),
    rewriteProducerRunIds: z.array(z.string()),
  }).strict().optional(),
  governance: ReviewEvidenceManifestSchema.shape.governance,
  detectionCoverage: z.object({
    artifacts: z.number().int().positive(),
    findings: z.number().int().nonnegative(),
    observedEdits: z.object({
      changed: z.number().int().nonnegative(),
      unchanged: z.number().int().nonnegative(),
      manualAdjudicationRequired: z.number().int().nonnegative(),
    }).strict().nullable(),
  }).strict(),
  proposalOutcomes: z.object({
    proposals: z.number().int().nonnegative(),
    accepted: z.number().int().nonnegative(),
    changed: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    usefulYield: z.number().min(0).max(1),
  }).strict(),
  quality: z.object({
    factualPreservation: MetricCountSchema,
    terminologyPreservation: MetricCountSchema,
    voicePreservation: MetricCountSchema,
    regressions: z.object({
      none: z.number().int().nonnegative(),
      present: z.number().int().nonnegative(),
      notAssessed: z.number().int().nonnegative(),
      rate: z.number().min(0).max(1),
    }).strict(),
  }).strict(),
  review: z.object({
    totalSeconds: z.number().nonnegative(),
    medianSeconds: z.number().nonnegative(),
    measuredArtifacts: z.number().int().nonnegative(),
    unmeasuredArtifacts: z.number().int().nonnegative(),
  }).strict(),
  artifacts: z.array(z.object({
    artifactId: z.string(),
    artifactType: z.enum(["adr", "project-page"]),
    split: z.enum(["train", "validation", "holdout"]),
    documentId: z.string(),
    revision: z.string(),
    sourceBeforeHash: z.string(),
    sourceAfterHash: z.string(),
    recordsHash: z.string(),
    decisionsHash: z.string(),
    evidence: z.object({
      manifestEntryHash: z.string(),
      receiptHash: z.string(),
      recordsHash: z.string(),
      decisionsHash: z.string(),
    }).strict(),
    producers: z.array(z.object({
      id: z.string().min(1),
      version: z.string().min(1),
    }).strict()),
    findingEvidence: z.array(z.object({
      findingId: z.string(),
      producer: z.object({ id: z.string(), version: z.string() }).strict(),
      observedEdit: z.object({
        status: z.enum(["changed", "unchanged", "manual-adjudication-required"]),
        hunkIds: z.array(z.string()),
      }).strict().nullable(),
    }).strict()),
    proposalEvidence: z.array(z.object({
      proposalId: z.string(),
      suggestionIds: z.array(z.string()),
      producers: z.array(z.object({ id: z.string(), version: z.string() }).strict()),
      outcome: z.enum(["accepted", "changed", "rejected"]),
    }).strict()),
    quality: z.object({
      factualPreservation: QualityRatingSchema,
      terminologyPreservation: QualityRatingSchema,
      voicePreservation: QualityRatingSchema,
      regression: z.enum(["none", "present", "not-assessed"]),
    }).strict(),
    findings: z.number().int().nonnegative(),
    proposals: z.number().int().nonnegative(),
    accepted: z.number().int().nonnegative(),
    changed: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    usefulEditYield: z.number().min(0).max(1),
    reviewSeconds: z.number().nonnegative(),
  }).strict()),
  gates: z.object({
    sampleSize: z.object({
      artifacts: z.boolean(),
      actionableVolume: z.boolean(),
      artifactTypes: z.boolean(),
    }).strict(),
    adoption: z.object({
      usefulYield: z.boolean(),
      regressionRate: z.boolean(),
      reviewTime: z.boolean(),
      qualityAssessed: z.boolean(),
      qualityPreserved: z.boolean(),
      deletionClear: z.boolean(),
    }).strict(),
    rejection: z.object({
      usefulYield: z.boolean(),
      regressionRate: z.boolean(),
      reviewTime: z.boolean(),
      qualityFailed: z.boolean(),
    }).strict(),
  }).strict(),
  recommendation: z.enum(["adopt", "reject", "gather-more-evidence"]),
}).strict();
export type ReviewScorecard = z.infer<typeof ReviewScorecardSchema>;

function readOptionalEvidence(
  evidenceRoot: string,
  file: string | undefined,
  label: string,
): string | undefined {
  if (file === undefined) return undefined;
  return fs.readFileSync(resolveContainedFile(evidenceRoot, file, label), "utf8");
}

interface PipelineEvidenceOptions {
  cohortFile: string;
  valeRunFile: string;
  editMatchRunFile: string;
  rewriteProducerRunFiles: string[];
}

function loadPipelineEvidence(options: PipelineEvidenceOptions) {
  const cohort = FrozenCohortSchema.parse(readJson(options.cohortFile));
  const valeRun = ValeProducerRunSchema.parse(readJson(options.valeRunFile));
  const editMatchRun = EditMatchRunSchema.parse(readJson(options.editMatchRunFile));
  const rewriteRuns = options.rewriteProducerRunFiles.map((file) =>
    GectorProducerRunSchema.parse(readJson(file))
  );
  if (valeRun.cohortId !== cohort.cohortId || editMatchRun.cohortId !== cohort.cohortId) {
    throw new Error("Vale detection inputs do not match the frozen cohort");
  }
  if (editMatchRun.producerRunId !== valeRun.runId) {
    throw new Error("observed edit matches do not reference the declared Vale producer run");
  }
  const runIds = rewriteRuns.map(({ runId }) => runId);
  if (new Set(runIds).size !== runIds.length) {
    throw new Error("rewrite producer run IDs must be unique");
  }
  return {
    cohort,
    valeRun,
    editMatchRun,
    rewriteRuns: new Map(rewriteRuns.map((run) => [run.runId, run])),
  };
}

function findRewriteArtifact(
  run: GectorProducerRun,
  records: z.infer<typeof ReviewRecordsSchema>,
  sourceContentHash: string,
) {
  const artifact = run.artifacts.find(({ source: candidate }) =>
    candidate.documentId === records.documentId &&
    candidate.revision === records.revision &&
    candidate.contentHash === sourceContentHash
  );
  if (!artifact) throw new Error(`${records.documentId} is absent from its declared producer run`);
  const recordedProposalIds = records.proposals.map(({ proposalId }) => proposalId);
  if (
    recordedProposalIds.length !== artifact.proposalIds.length ||
    recordedProposalIds.some((proposalId, index) => proposalId !== artifact.proposalIds[index])
  ) {
    throw new Error(`${records.documentId} proposals do not match its declared producer run`);
  }
  return artifact;
}

function pipelineTraceForEntry(options: {
  entry: z.infer<typeof ReviewEvidenceEntrySchema>;
  records: z.infer<typeof ReviewRecordsSchema>;
  receipt: z.infer<typeof ReviewReceiptSchema>;
  pipeline: ReturnType<typeof loadPipelineEvidence> | undefined;
}) {
  const { entry, records, receipt, pipeline } = options;
  if (!pipeline) return { producers: [], findings: [] };
  if (!entry.provenance) throw new Error(`${entry.artifactId} lacks pipeline provenance`);
  const rewriteRun = pipeline.rewriteRuns.get(entry.provenance.producerRunId);
  if (!rewriteRun) {
    throw new Error(`${entry.artifactId} references an undeclared rewrite producer run`);
  }
  findRewriteArtifact(rewriteRun, records, receipt.sourceBeforeHash);
  if (entry.provenance.sourceRevision !== records.revision) {
    throw new Error(`${entry.artifactId} source revision does not match its review records`);
  }
  if (entry.provenance.scope !== "seed") {
    return { producers: [rewriteRun.producer], findings: [] };
  }

  const cohortArtifactId = entry.artifactId.slice("seed-".length);
  const cohortEntry = pipeline.cohort.entries.find(({ artifactId }) =>
    artifactId === cohortArtifactId
  );
  if (
    !cohortEntry ||
    entry.provenance.sourceDatasetId !== pipeline.cohort.datasetId ||
    entry.artifactType !== cohortEntry.artifactType ||
    entry.split !== cohortEntry.split ||
    receipt.documentId !== cohortEntry.path ||
    receipt.revision !== cohortEntry.source.revision ||
    receipt.sourceBeforeHash !== cohortEntry.source.contentHash
  ) {
    throw new Error(`${entry.artifactId} does not match the frozen cohort`);
  }
  const valeArtifact = pipeline.valeRun.artifacts.find(({ artifactId }) =>
    artifactId === cohortArtifactId
  );
  const matchArtifact = pipeline.editMatchRun.artifacts.find(({ artifactId }) =>
    artifactId === cohortArtifactId
  );
  if (!valeArtifact || !matchArtifact) {
    throw new Error(`${entry.artifactId} lacks Vale detection or edit-match evidence`);
  }
  const matches = new Map(matchArtifact.matches.map((match) => [match.findingId, match]));
  const findings = valeArtifact.findings.map(({ finding }) => {
    const match = matches.get(finding.findingId);
    if (!match) throw new Error(`${finding.findingId} lacks observed edit evidence`);
    return {
      findingId: finding.findingId,
      producer: { id: finding.producer.id, version: finding.producer.version },
      observedEdit: { status: match.status, hunkIds: match.hunkIds },
    };
  });
  return { producers: [rewriteRun.producer, pipeline.valeRun.producer], findings };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Receipt, source, producer, and decision invariants form one validation pass.
function evaluateReviewEntry(
  entry: z.infer<typeof ReviewEvidenceEntrySchema>,
  evidenceRoot: string,
  pipeline: ReturnType<typeof loadPipelineEvidence> | undefined,
) {
    const records = ReviewRecordsSchema.parse(readJson(resolveContainedFile(
      evidenceRoot,
      entry.recordsFile,
      `${entry.artifactId} producer records`,
    )));
    const decisionsText = fs.readFileSync(resolveContainedFile(
      evidenceRoot,
      entry.decisionsFile,
      `${entry.artifactId} decisions`,
    ), "utf8");
    const decisions = decisionsText.split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => DecisionSchema.parse(JSON.parse(line)));
    const sourceBefore = readOptionalEvidence(
      evidenceRoot,
      entry.sourceBeforeFile,
      `${entry.artifactId} source before review`,
    );
    const sourceAfter = readOptionalEvidence(
      evidenceRoot,
      entry.sourceAfterFile,
      `${entry.artifactId} source after review`,
    );
    if (sourceBefore !== undefined) prepareReviewRecords(records, sourceBefore);
    validateRecordedDecisions(decisions, records.proposals);
    if (decisions.length !== records.proposals.length) {
      throw new Error(`${entry.artifactId} has unadjudicated proposals`);
    }
    const receipt = ReviewReceiptSchema.parse(readJson(resolveContainedFile(
      evidenceRoot,
      entry.receiptFile,
      `${entry.artifactId} review receipt`,
    )));
    if (receipt.recordsHash !== sha256(canonicalJson(records))) {
      throw new Error(`${entry.artifactId} receipt does not match its producer records`);
    }
    if (receipt.decisionsHash !== sha256(canonicalJson(decisions))) {
      throw new Error(`${entry.artifactId} receipt does not match its decisions`);
    }
    if (sourceBefore !== undefined && receipt.sourceBeforeHash !== sha256(sourceBefore)) {
      throw new Error(`${entry.artifactId} receipt does not match source-before bytes`);
    }
    if (sourceBefore !== undefined && sourceAfter !== undefined) {
      const applied = applyDecisions(sourceBefore, decisions);
      if (sourceAfter !== applied || receipt.sourceAfterHash !== sha256(sourceAfter)) {
        throw new Error(`${entry.artifactId} source-after bytes do not match its decisions`);
      }
    }
    const recordSources = [
      ...records.findings.map(({ source }) => source),
      ...records.proposals.flatMap(({ suggestions }) =>
        suggestions.map(({ source }) => source)
      ),
    ];
    if (receipt.documentId !== records.documentId ||
      receipt.revision !== records.revision ||
      recordSources.some((source) =>
        source.documentId !== records.documentId ||
        source.revision !== records.revision ||
        source.contentHash !== receipt.sourceBeforeHash
      )) {
      throw new Error(`${entry.artifactId} receipt does not match its source`);
    }
    const reviewMilliseconds = decisions.reduce((total, decision) => total + Math.max(
      0,
      Date.parse(decision.decidedAt) - Date.parse(decision.reviewStartedAt),
    ), 0);
    if (receipt.summary.reviewMilliseconds !== reviewMilliseconds) {
      throw new Error(`${entry.artifactId} receipt review time does not match its decisions`);
    }
    const sourceChanged = receipt.sourceBeforeHash !== receipt.sourceAfterHash;
    if (receipt.sourceChanged !== sourceChanged) {
      throw new Error(`${entry.artifactId} receipt source-change flag does not match its hashes`);
    }
    const count = (outcome: "accepted" | "changed" | "rejected") =>
      decisions.filter((decision) => decision.outcome === outcome).length;
    const expectedSummary = {
      findings: records.findings.length,
      proposals: records.proposals.length,
      accepted: count("accepted"),
      rejected: count("rejected"),
      changed: count("changed"),
      reviewMilliseconds,
    };
    if (canonicalJson(receipt.summary) !== canonicalJson(expectedSummary)) {
      throw new Error(`${entry.artifactId} receipt summary does not match its evidence`);
    }
    const pipelineTrace = pipelineTraceForEntry({ entry, records, receipt, pipeline });
    const decisionsByProposal = new Map(
      decisions.map((decision) => [decision.proposalId, decision]),
    );
    const producers = uniqueProducers([
      ...pipelineTrace.producers,
      ...records.findings.map(({ producer }) => producer),
      ...records.proposals.flatMap(({ suggestions }) =>
        suggestions.map(({ producer }) => producer)
      ),
    ]);
    const accepted = count("accepted");
    const changed = count("changed");
    const rejected = count("rejected");
    const usefulEditYield = records.proposals.length === 0
      ? 0
      : (accepted + changed) / records.proposals.length;
    const findingEvidence = [...new Map([
      ...records.findings.map(({ findingId, producer }) => ({
        findingId,
        producer: { id: producer.id, version: producer.version },
        observedEdit: null,
      })),
      ...pipelineTrace.findings,
    ].map((finding) => [finding.findingId, finding])).values()];
    return {
      artifactId: entry.artifactId,
      artifactType: entry.artifactType,
      split: entry.split,
      documentId: records.documentId,
      revision: records.revision,
      sourceBeforeHash: receipt.sourceBeforeHash,
      sourceAfterHash: receipt.sourceAfterHash,
      recordsHash: receipt.recordsHash,
      decisionsHash: receipt.decisionsHash,
      evidence: {
        manifestEntryHash: sha256(canonicalJson(entry)),
        receiptHash: sha256(canonicalJson(receipt)),
        recordsHash: receipt.recordsHash,
        decisionsHash: receipt.decisionsHash,
      },
      producers,
      findingEvidence,
      proposalEvidence: records.proposals.map((proposal) => {
        const decision = decisionsByProposal.get(proposal.proposalId);
        if (!decision) throw new Error(`${entry.artifactId} has an unadjudicated proposal`);
        return {
          proposalId: proposal.proposalId,
          suggestionIds: proposal.suggestionIds,
          producers: uniqueProducers(proposal.suggestions.map(({ producer }) => producer)),
          outcome: decision.outcome,
        };
      }),
      quality: entry.quality,
      findings: findingEvidence.length,
      proposals: records.proposals.length,
      accepted,
      changed,
      rejected,
      usefulEditYield,
      reviewSeconds: receipt.summary.reviewMilliseconds / 1_000,
      reviewTiming: entry.provenance?.reviewTiming ?? "measured" as const,
    };
}

type EvaluatedArtifact = ReturnType<typeof evaluateReviewEntry>;

function aggregateArtifacts(artifacts: EvaluatedArtifact[]) {
  const proposals = sum(artifacts.map(({ proposals: count }) => count));
  const accepted = sum(artifacts.map(({ accepted: count }) => count));
  const changed = sum(artifacts.map(({ changed: count }) => count));
  const rejected = sum(artifacts.map(({ rejected: count }) => count));
  const factualPreservation = qualityCounts(
    artifacts.map(({ quality }) => quality.factualPreservation),
  );
  const terminologyPreservation = qualityCounts(
    artifacts.map(({ quality }) => quality.terminologyPreservation),
  );
  const voicePreservation = qualityCounts(
    artifacts.map(({ quality }) => quality.voicePreservation),
  );
  const regressions = {
    none: artifacts.filter(({ quality }) => quality.regression === "none").length,
    present: artifacts.filter(({ quality }) => quality.regression === "present").length,
    notAssessed: artifacts.filter(({ quality }) => quality.regression === "not-assessed").length,
  };
  const assessedRegressions = regressions.none + regressions.present;
  const measuredReviewTimes = artifacts
    .filter(({ reviewTiming }) => reviewTiming === "measured")
    .map(({ reviewSeconds }) => reviewSeconds)
    .sort((a, b) => a - b);
  const qualityMetrics = [factualPreservation, terminologyPreservation, voicePreservation];
  return {
    proposals,
    accepted,
    changed,
    rejected,
    usefulYield: proposals === 0 ? 0 : (accepted + changed) / proposals,
    factualPreservation,
    terminologyPreservation,
    voicePreservation,
    regressions,
    regressionRate: assessedRegressions === 0 ? 0 : regressions.present / assessedRegressions,
    measuredReviewTimes,
    medianSeconds: median(measuredReviewTimes),
    qualityAssessed: qualityMetrics.every(({ notAssessed }) => notAssessed === 0) &&
      regressions.notAssessed === 0,
    qualityPreserved: qualityMetrics.every(({ fail }) => fail === 0) && regressions.present === 0,
    reviewTimeAssessed: measuredReviewTimes.length === artifacts.length,
    regressionsAssessed: assessedRegressions === artifacts.length,
  };
}

function buildGates(options: {
  artifacts: EvaluatedArtifact[];
  aggregate: ReturnType<typeof aggregateArtifacts>;
  manifest: z.infer<typeof ReviewEvidenceManifestSchema>;
  params: z.infer<typeof ReviewEvaluationParamsSchema>;
}): ReviewScorecard["gates"] {
  const { artifacts, aggregate, manifest, params } = options;
  const presentArtifactTypes = new Set(artifacts.map(({ artifactType }) => artifactType));
  const deletionClear = manifest.governance.deletionStatus === "active" &&
    manifest.entries.every(({ governance }) => governance?.deletionStatus !== "deletion-requested");
  return {
    sampleSize: {
      artifacts: artifacts.length >= params.sampleSize.minimumArtifacts,
      actionableVolume: aggregate.proposals >= params.sampleSize.minimumActionableProposals,
      artifactTypes: params.sampleSize.requiredArtifactTypes.every((type) =>
        presentArtifactTypes.has(type)
      ),
    },
    adoption: {
      usefulYield: aggregate.usefulYield >= params.thresholds.adopt.minimumUsefulYield,
      regressionRate: aggregate.regressionsAssessed &&
        aggregate.regressionRate <= params.thresholds.adopt.maximumRegressionRate,
      reviewTime: aggregate.reviewTimeAssessed &&
        aggregate.medianSeconds <= params.thresholds.adopt.maximumMedianReviewSeconds,
      qualityAssessed: !params.requireAssessedQuality || aggregate.qualityAssessed,
      qualityPreserved: aggregate.qualityPreserved,
      deletionClear,
    },
    rejection: {
      usefulYield: aggregate.usefulYield <= params.thresholds.reject.maximumUsefulYield,
      regressionRate: aggregate.regressionsAssessed &&
        aggregate.regressionRate >= params.thresholds.reject.minimumRegressionRate,
      reviewTime: aggregate.reviewTimeAssessed &&
        aggregate.medianSeconds >= params.thresholds.reject.minimumMedianReviewSeconds,
      qualityFailed: !aggregate.qualityPreserved,
    },
  };
}

function recommendationFor(gates: ReviewScorecard["gates"]): ReviewScorecard["recommendation"] {
  if (!Object.values(gates.sampleSize).every(Boolean)) return "gather-more-evidence";
  if (Object.values(gates.rejection).some(Boolean)) return "reject";
  if (Object.values(gates.adoption).every(Boolean)) return "adopt";
  return "gather-more-evidence";
}

export function evaluateReviews(options: {
  manifestFile: string;
  evidenceRoot: string;
  paramsFile: string;
  outputFile?: string;
  pipelineEvidence?: PipelineEvidenceOptions;
}): ReviewScorecard {
  const manifest = ReviewEvidenceManifestSchema.parse(readJson(options.manifestFile));
  const params = ReviewEvaluationParamsSchema.parse(readJson(options.paramsFile));
  const pipeline = options.pipelineEvidence
    ? loadPipelineEvidence(options.pipelineEvidence)
    : undefined;
  const artifacts = manifest.entries.map((entry) =>
    evaluateReviewEntry(entry, options.evidenceRoot, pipeline)
  );
  const aggregate = aggregateArtifacts(artifacts);
  const gates = buildGates({ artifacts, aggregate, manifest, params });
  const recommendation = recommendationFor(gates);
  const detectionCoverage = pipeline
    ? {
      artifacts: pipeline.valeRun.summary.artifacts,
      findings: pipeline.valeRun.summary.findings,
      observedEdits: {
        changed: pipeline.editMatchRun.summary.byStatus.changed,
        unchanged: pipeline.editMatchRun.summary.byStatus.unchanged,
        manualAdjudicationRequired:
          pipeline.editMatchRun.summary.byStatus["manual-adjudication-required"],
      },
    }
    : {
      artifacts: artifacts.length,
      findings: sum(artifacts.map(({ findings }) => findings)),
      observedEdits: null,
    };
  const body = {
    schemaVersion: 2 as const,
    recordType: "writing-review-scorecard" as const,
    cohortId: manifest.cohortId,
    evidenceManifestHash: sha256(canonicalJson(manifest)),
    ...(pipeline
      ? { pipelineInputs: {
        cohortId: pipeline.cohort.cohortId,
        datasetId: pipeline.cohort.datasetId,
        valeProducerRunId: pipeline.valeRun.runId,
        editMatchRunId: pipeline.editMatchRun.runId,
        rewriteProducerRunIds: [...pipeline.rewriteRuns.keys()].sort((left, right) =>
          left.localeCompare(right)
        ),
      } }
      : {}),
    governance: manifest.governance,
    detectionCoverage,
    proposalOutcomes: {
      proposals: aggregate.proposals,
      accepted: aggregate.accepted,
      changed: aggregate.changed,
      rejected: aggregate.rejected,
      usefulYield: aggregate.usefulYield,
    },
    quality: {
      factualPreservation: aggregate.factualPreservation,
      terminologyPreservation: aggregate.terminologyPreservation,
      voicePreservation: aggregate.voicePreservation,
      regressions: { ...aggregate.regressions, rate: aggregate.regressionRate },
    },
    review: {
      totalSeconds: sum(aggregate.measuredReviewTimes),
      medianSeconds: aggregate.medianSeconds,
      measuredArtifacts: aggregate.measuredReviewTimes.length,
      unmeasuredArtifacts: artifacts.length - aggregate.measuredReviewTimes.length,
    },
    artifacts: artifacts.map(({ reviewTiming: _reviewTiming, ...artifact }) => artifact),
    gates,
    recommendation,
  };
  const scorecardDigest = sha256(canonicalJson(body)).slice("sha256:".length);
  const scorecard = ReviewScorecardSchema.parse({
    ...body,
    scorecardId: `scorecard:v2:${scorecardDigest}`,
  });
  if (options.outputFile) writeJson(options.outputFile, scorecard);
  return scorecard;
}

function qualityCounts(values: z.infer<typeof QualityRatingSchema>[]) {
  return {
    pass: values.filter((value) => value === "pass").length,
    fail: values.filter((value) => value === "fail").length,
    notAssessed: values.filter((value) => value === "not-assessed").length,
  };
}

function uniqueProducers(
  values: readonly { id: string; version: string }[],
): { id: string; version: string }[] {
  return [...new Map(values.map(({ id, version }) => [
    `${id}\0${version}`,
    { id, version },
  ])).values()].sort((left, right) =>
    left.id.localeCompare(right.id) || left.version.localeCompare(right.version)
  );
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 1
    ? values[middle] ?? 0
    : ((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2;
}

/* v8 ignore start -- exercised by the mise and DVC command wrappers */
function main(): void {
  const { values } = parseArgs({ options: {
    manifest: { type: "string" },
    evidence: { type: "string" },
    params: { type: "string" },
    output: { type: "string" },
    cohort: { type: "string" },
    vale: { type: "string" },
    matches: { type: "string" },
    "producer-run": { type: "string", multiple: true },
  } });
  const args = z.object({
    manifest: z.string().min(1),
    evidence: z.string().min(1),
    params: z.string().min(1),
    output: z.string().min(1),
    cohort: z.string().min(1).optional(),
    vale: z.string().min(1).optional(),
    matches: z.string().min(1).optional(),
    "producer-run": z.array(z.string().min(1)).min(1).optional(),
  }).strict().superRefine((candidate, context) => {
    const pipelineFields = [
      candidate.cohort,
      candidate.vale,
      candidate.matches,
      candidate["producer-run"],
    ];
    if (pipelineFields.some((value) => value !== undefined) &&
      pipelineFields.includes(undefined)) {
      context.addIssue({
        code: "custom",
        message: "cohort, vale, matches, and producer-run must be provided together",
      });
    }
  }).parse(values);
  const scorecard = evaluateReviews({
    manifestFile: args.manifest,
    evidenceRoot: args.evidence,
    paramsFile: args.params,
    outputFile: args.output,
    pipelineEvidence: args.cohort && args.vale && args.matches && args["producer-run"]
      ? {
        cohortFile: args.cohort,
        valeRunFile: args.vale,
        editMatchRunFile: args.matches,
        rewriteProducerRunFiles: args["producer-run"],
      }
      : undefined,
  });
  console.log(`${scorecard.scorecardId}: ${scorecard.recommendation}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
/* v8 ignore stop */
