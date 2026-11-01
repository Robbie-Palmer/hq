import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { diffChars } from "diff";
import { meanOrZero, medianOrZero, ratioOrZero } from "ts-base/numbers";
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

import {
  ensureOutputDirectory,
  readContainedText,
  readJson,
  resolveContainedDirectory,
  resolveContainedFile,
  writeJson,
} from "./files";
import { fileAtRevision } from "./git-revisions";

const ArtifactIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const ArtifactTypeSchema = z.enum([
  "adr",
  "idea",
  "initiative",
  "pitch",
  "project-page",
]);
const EvidencePathSchema = z.string().min(1).refine(
  (value) => !path.isAbsolute(value) && !value.split("/").includes(".."),
  "must be relative to the evidence root",
);
const ContentHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const OutcomeSchema = z.enum(["accepted", "changed", "rejected"]);
const RepositoryPathSchema = z.string().min(1).superRefine((value, context) => {
  const segments = value.split("/");
  if (
    value.startsWith("/") || value.includes("\\") || value.includes(":") ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    context.addIssue({ code: "custom", message: "must be a safe repository-relative path" });
  }
});

const RequiredMixSchema = z.object({
  artifactType: ArtifactTypeSchema,
  minimum: z.number().int().positive(),
}).strict();

export const PublicationPilotPreregistrationSchema = z.object({
  schemaVersion: z.literal(1),
  recordType: z.literal("writing-publication-pilot-preregistration"),
  pilotId: z.string().trim().min(1),
  preregisteredAt: z.iso.datetime({ offset: true }),
  sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
  cohort: z.object({
    minimumArtifacts: z.number().int().positive(),
    requiredMix: z.array(RequiredMixSchema).min(2),
    minimumNewArtifacts: z.number().int().nonnegative(),
    minimumMaterialRevisions: z.number().int().nonnegative(),
  }).strict(),
  comparison: z.object({
    design: z.literal("blinded-within-artifact"),
    minimumReadersPerArtifact: z.number().int().positive(),
    cognitiveLoadScale: z.object({
      minimum: z.number().int(),
      maximum: z.number().int(),
      lowerIsBetter: z.literal(true),
    }).strict(),
  }).strict(),
  thresholds: z.object({
    minimumUsefulEditYield: z.number().min(0).max(1),
    minimumMedianTimeSavedFraction: z.number().min(0).max(1),
    minimumReviewedPreferenceRate: z.number().min(0).max(1),
    maximumMeanCognitiveLoadDelta: z.number().max(0),
    maximumRegressionRate: z.number().min(0).max(1),
    maximumUnwantedVoiceChangeRate: z.number().min(0).max(1),
    requireZeroFactualRegressions: z.literal(true),
    requireZeroTerminologyRegressions: z.literal(true),
  }).strict(),
}).strict().superRefine((preregistration, context) => {
  const types = preregistration.cohort.requiredMix.map(({ artifactType }) => artifactType);
  if (new Set(types).size !== types.length) {
    context.addIssue({ code: "custom", message: "required artifact types must be unique" });
  }
  const declaredMinimum = preregistration.cohort.requiredMix.reduce(
    (total, { minimum }) => total + minimum,
    0,
  );
  if (declaredMinimum > preregistration.cohort.minimumArtifacts) {
    context.addIssue({
      code: "custom",
      message: "required artifact mix cannot exceed the minimum cohort size",
      path: ["cohort", "requiredMix"],
    });
  }
  const declaredChangeKinds = preregistration.cohort.minimumNewArtifacts +
    preregistration.cohort.minimumMaterialRevisions;
  if (declaredChangeKinds > preregistration.cohort.minimumArtifacts) {
    context.addIssue({
      code: "custom",
      message: "required change-kind counts cannot exceed the minimum cohort size",
      path: ["cohort"],
    });
  }
  if (
    preregistration.comparison.cognitiveLoadScale.maximum <=
      preregistration.comparison.cognitiveLoadScale.minimum
  ) {
    context.addIssue({
      code: "custom",
      message: "the cognitive-load scale maximum must exceed its minimum",
      path: ["comparison", "cognitiveLoadScale"],
    });
  }
});

const QualitySchema = z.object({
  factualPreservation: z.enum(["pass", "fail"]),
  terminologyPreservation: z.enum(["pass", "fail"]),
  unwantedVoiceChange: z.boolean(),
  regression: z.enum(["none", "present"]),
  notes: z.array(z.string().trim().min(1)).default([]),
}).strict();

const PublicationPilotArtifactSchema = z.object({
  artifactId: ArtifactIdSchema,
  artifactType: ArtifactTypeSchema,
  changeKind: z.enum(["new", "material-revision"]),
  sessionStartedAt: z.iso.datetime({ offset: true }),
  rawAgentDraftFile: EvidencePathSchema,
  editorReviewedFile: EvidencePathSchema,
  finalPublishedFile: EvidencePathSchema,
  recordsFile: EvidencePathSchema,
  decisionsFile: EvidencePathSchema,
  receiptFile: EvidencePathSchema,
  finalManualReview: z.object({
    startedAt: z.iso.datetime({ offset: true }),
    finishedAt: z.iso.datetime({ offset: true }),
    notes: z.array(z.string().trim().min(1)).default([]),
  }).strict(),
  priorManualWorkflow: z.object({
    comparisonArtifactId: z.string().trim().min(1),
    reviewMilliseconds: z.number().int().positive(),
    method: z.string().trim().min(1),
  }).strict(),
  deterministicCatchFindingIds: z.array(z.string()).default([]),
  quality: QualitySchema,
  publication: z.object({
    repositoryPath: RepositoryPathSchema,
    revision: z.string().regex(/^[a-f0-9]{40}$/),
    contentHash: ContentHashSchema,
    publishedAt: z.iso.datetime({ offset: true }),
    finalReview: z.object({
      reviewerId: z.string().trim().min(1),
      reviewedAt: z.iso.datetime({ offset: true }),
      approved: z.literal(true),
    }).strict(),
  }).strict(),
}).strict();

const ReaderComparisonSchema = z.object({
  comparisonId: z.string().trim().min(1),
  artifactId: ArtifactIdSchema,
  readerId: z.string().trim().min(1),
  completedAt: z.iso.datetime({ offset: true }),
  blindingAttested: z.literal(true),
  presentedFirst: z.enum(["a", "b"]),
  variantA: z.enum(["raw", "reviewed"]),
  variantB: z.enum(["raw", "reviewed"]),
  variantAContentHash: ContentHashSchema,
  variantBContentHash: ContentHashSchema,
  preference: z.enum(["a", "b", "tie"]),
  cognitiveLoad: z.object({
    a: z.number().int(),
    b: z.number().int(),
  }).strict(),
}).strict().superRefine((comparison, context) => {
  if (comparison.variantA === comparison.variantB) {
    context.addIssue({ code: "custom", message: "reader variants must differ" });
  }
});

export const PublicationPilotEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  recordType: z.literal("writing-publication-pilot-evidence"),
  pilotId: z.string().trim().min(1),
  governance: z.object({
    dataClassification: z.enum(["public", "private"]),
    consentBasis: z.string().trim().min(1),
    retentionPolicy: z.string().trim().min(1),
    deletionStatus: z.enum(["active", "deletion-requested"]),
  }).strict(),
  artifacts: z.array(PublicationPilotArtifactSchema),
  readerComparisons: z.array(ReaderComparisonSchema),
}).strict().superRefine((evidence, context) => {
  const artifactIds = evidence.artifacts.map(({ artifactId }) => artifactId);
  if (new Set(artifactIds).size !== artifactIds.length) {
    context.addIssue({ code: "custom", message: "artifact IDs must be unique" });
  }
  const comparisonIds = evidence.readerComparisons.map(({ comparisonId }) => comparisonId);
  if (new Set(comparisonIds).size !== comparisonIds.length) {
    context.addIssue({ code: "custom", message: "comparison IDs must be unique" });
  }
  const readerAssignments = evidence.readerComparisons.map(
    ({ artifactId, readerId }) => `${artifactId}\0${readerId}`,
  );
  if (new Set(readerAssignments).size !== readerAssignments.length) {
    context.addIssue({
      code: "custom",
      message: "a reader may submit only one comparison per artifact",
    });
  }
});

const CountSchema = z.object({
  pass: z.number().int().nonnegative(),
  fail: z.number().int().nonnegative(),
}).strict();

const ArtifactResultSchema = z.object({
  artifactId: ArtifactIdSchema,
  artifactType: ArtifactTypeSchema,
  changeKind: z.enum(["new", "material-revision"]),
  publicationRevision: z.string(),
  proposals: z.number().int().nonnegative(),
  outcomes: z.object({
    accepted: z.number().int().nonnegative(),
    changed: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
  }).strict(),
  usefulEditYield: z.number().min(0).max(1),
  deterministicCatches: z.number().int().nonnegative(),
  timing: z.object({
    editorReviewMilliseconds: z.number().int().nonnegative(),
    finalManualReviewMilliseconds: z.number().int().nonnegative(),
    totalReviewMilliseconds: z.number().int().nonnegative(),
    priorManualWorkflowMilliseconds: z.number().int().positive(),
    timeSavedFraction: z.number(),
  }).strict(),
  finalManualEdits: z.object({
    changedSegments: z.number().int().nonnegative(),
    removedCharacters: z.number().int().nonnegative(),
    addedCharacters: z.number().int().nonnegative(),
  }).strict(),
  readers: z.object({
    comparisons: z.number().int().nonnegative(),
    reviewedPreferred: z.number().int().nonnegative(),
    rawPreferred: z.number().int().nonnegative(),
    ties: z.number().int().nonnegative(),
    meanCognitiveLoadDelta: z.number(),
  }).strict(),
  quality: QualitySchema,
  failures: z.array(z.string()),
}).strict();

export const PublicationPilotReportSchema = z.object({
  schemaVersion: z.literal(1),
  recordType: z.literal("writing-publication-pilot-report"),
  reportId: z.string().regex(/^publication-report:v1:[a-f0-9]{64}$/),
  pilotId: z.string(),
  preregistrationHash: ContentHashSchema,
  evidenceHash: ContentHashSchema,
  governance: PublicationPilotEvidenceSchema.shape.governance,
  sample: z.object({
    artifacts: z.number().int().nonnegative(),
    byArtifactType: z.record(ArtifactTypeSchema, z.number().int().nonnegative()),
    newArtifacts: z.number().int().nonnegative(),
    materialRevisions: z.number().int().nonnegative(),
    readerComparisons: z.number().int().nonnegative(),
  }).strict(),
  proposalOutcomes: z.object({
    proposals: z.number().int().nonnegative(),
    accepted: z.number().int().nonnegative(),
    changed: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    usefulEditYield: z.number().min(0).max(1),
  }).strict(),
  review: z.object({
    totalEditorMilliseconds: z.number().int().nonnegative(),
    totalFinalManualMilliseconds: z.number().int().nonnegative(),
    medianTimeSavedFraction: z.number(),
  }).strict(),
  quality: z.object({
    factualPreservation: CountSchema,
    terminologyPreservation: CountSchema,
    unwantedVoiceChanges: z.number().int().nonnegative(),
    regressions: z.number().int().nonnegative(),
    regressionRate: z.number().min(0).max(1),
  }).strict(),
  readers: z.object({
    reviewedPreferred: z.number().int().nonnegative(),
    rawPreferred: z.number().int().nonnegative(),
    ties: z.number().int().nonnegative(),
    reviewedPreferenceRate: z.number().min(0).max(1),
    meanCognitiveLoadDelta: z.number(),
  }).strict(),
  deterministicCatches: z.number().int().nonnegative(),
  artifacts: z.array(ArtifactResultSchema),
  gates: z.record(z.string(), z.boolean()),
  recommendation: z.enum([
    "justify-general-editor",
    "do-not-justify",
    "gather-more-evidence",
  ]),
}).strict();

type Preregistration = z.infer<typeof PublicationPilotPreregistrationSchema>;
type Evidence = z.infer<typeof PublicationPilotEvidenceSchema>;
type ArtifactEvidence = Evidence["artifacts"][number];
type ReaderComparison = Evidence["readerComparisons"][number];
type ArtifactResult = z.infer<typeof ArtifactResultSchema>;

function readDecisions(evidenceRoot: string, file: string) {
  const text = readContainedText(evidenceRoot, file, "publication pilot decisions").trim();
  return text === ""
    ? []
    : text.split("\n").map((line) => DecisionSchema.parse(JSON.parse(line)));
}

function durationMilliseconds(startedAt: string, finishedAt: string, label: string): number {
  const duration = Date.parse(finishedAt) - Date.parse(startedAt);
  if (duration < 0) throw new Error(`${label} finishes before it starts`);
  return duration;
}

function countOutcome(
  decisions: z.infer<typeof DecisionSchema>[],
  outcome: z.infer<typeof OutcomeSchema>,
): number {
  return decisions.filter((decision) => decision.outcome === outcome).length;
}

function manualEditCounts(editorReviewed: string, finalPublished: string) {
  let changedSegments = 0;
  let removedCharacters = 0;
  let addedCharacters = 0;
  for (const change of diffChars(editorReviewed, finalPublished)) {
    if (!change.added && !change.removed) continue;
    changedSegments += 1;
    if (change.added) addedCharacters += [...change.value].length;
    if (change.removed) removedCharacters += [...change.value].length;
  }
  return { changedSegments, removedCharacters, addedCharacters };
}

function comparisonOutcome(comparison: ReaderComparison): "raw" | "reviewed" | "tie" {
  if (comparison.preference === "tie") return "tie";
  return comparison.preference === "a" ? comparison.variantA : comparison.variantB;
}

function comparisonCognitiveLoadDelta(comparison: ReaderComparison): number {
  const raw = comparison.variantA === "raw"
    ? comparison.cognitiveLoad.a
    : comparison.cognitiveLoad.b;
  const reviewed = comparison.variantA === "reviewed"
    ? comparison.cognitiveLoad.a
    : comparison.cognitiveLoad.b;
  return reviewed - raw;
}

function assertPublicationChronology(
  preregistration: Preregistration,
  artifact: ArtifactEvidence,
): void {
  if (Date.parse(artifact.sessionStartedAt) < Date.parse(preregistration.preregisteredAt)) {
    throw new Error(`${artifact.artifactId} began before the pilot was preregistered`);
  }
  const finalReview = artifact.publication.finalReview;
  if (Date.parse(finalReview.reviewedAt) > Date.parse(artifact.publication.publishedAt)) {
    throw new Error(`${artifact.artifactId} was published before final author review`);
  }
}

function verifyPublishedRevision(
  repositoryRoot: string,
  artifact: ArtifactEvidence,
  published: string,
): void {
  let committed: string;
  try {
    committed = fileAtRevision(
      repositoryRoot,
      artifact.publication.revision,
      artifact.publication.repositoryPath,
    ).toString("utf8");
  } catch {
    throw new Error(`${artifact.artifactId} published revision cannot be read from Git`);
  }
  if (committed !== published) {
    throw new Error(`${artifact.artifactId} published bytes do not match its Git revision`);
  }
}

function loadArtifactSession(evidenceRoot: string, artifact: ArtifactEvidence) {
  const raw = readContainedText(evidenceRoot, artifact.rawAgentDraftFile, "raw agent draft");
  const reviewed = readContainedText(
    evidenceRoot,
    artifact.editorReviewedFile,
    "editor-reviewed artifact",
  );
  const published = readContainedText(
    evidenceRoot,
    artifact.finalPublishedFile,
    "published artifact",
  );
  const records = ReviewRecordsSchema.parse(readJson(resolveContainedFile(
    evidenceRoot,
    artifact.recordsFile,
    `${artifact.artifactId} producer records`,
  )));
  const decisions = readDecisions(evidenceRoot, artifact.decisionsFile);
  const receipt = ReviewReceiptSchema.parse(readJson(resolveContainedFile(
    evidenceRoot,
    artifact.receiptFile,
    `${artifact.artifactId} review receipt`,
  )));
  return { raw, reviewed, published, records, decisions, receipt };
}

type ArtifactSession = ReturnType<typeof loadArtifactSession>;

function verifyReviewSession(
  artifact: ArtifactEvidence,
  session: ArtifactSession,
): number {
  const { raw, reviewed, records, decisions, receipt } = session;
  prepareReviewRecords(records, raw);
  validateRecordedDecisions(decisions, records.proposals);
  if (decisions.length !== records.proposals.length) {
    throw new Error(`${artifact.artifactId} has unadjudicated proposals`);
  }
  if (applyDecisions(raw, decisions) !== reviewed) {
    throw new Error(`${artifact.artifactId} editor-reviewed bytes do not match its decisions`);
  }
  if (
    receipt.recordsHash !== sha256(canonicalJson(records)) ||
    receipt.decisionsHash !== sha256(canonicalJson(decisions)) ||
    receipt.sourceBeforeHash !== sha256(raw) ||
    receipt.sourceAfterHash !== sha256(reviewed)
  ) {
    throw new Error(`${artifact.artifactId} review receipt does not match its session evidence`);
  }
  if (receipt.documentId !== records.documentId || receipt.revision !== records.revision) {
    throw new Error(`${artifact.artifactId} review receipt does not match its source identity`);
  }
  const expectedReviewMilliseconds = decisions.reduce(
    (total, decision) => total + durationMilliseconds(
      decision.reviewStartedAt,
      decision.decidedAt,
      `${artifact.artifactId} proposal review`,
    ),
    0,
  );
  const expectedSummary = {
    findings: records.findings.length,
    proposals: records.proposals.length,
    accepted: countOutcome(decisions, "accepted"),
    rejected: countOutcome(decisions, "rejected"),
    changed: countOutcome(decisions, "changed"),
    reviewMilliseconds: expectedReviewMilliseconds,
  };
  if (canonicalJson(receipt.summary) !== canonicalJson(expectedSummary)) {
    throw new Error(`${artifact.artifactId} review receipt summary does not match its decisions`);
  }
  return expectedReviewMilliseconds;
}

function verifyDeterministicCatches(
  artifact: ArtifactEvidence,
  session: ArtifactSession,
): void {
  const { records } = session;
  const findings = new Map(records.findings.map((finding) => [finding.findingId, finding]));
  for (const findingId of artifact.deterministicCatchFindingIds) {
    const finding = findings.get(findingId);
    if (finding?.producer.provenance.kind !== "rule") {
      throw new Error(`${artifact.artifactId} deterministic catch ${findingId} is not a rule finding`);
    }
  }
}

function verifyReaderComparisons(
  preregistration: Preregistration,
  comparisons: ReaderComparison[],
  session: ArtifactSession,
): void {
  const { raw, reviewed } = session;
  const scale = preregistration.comparison.cognitiveLoadScale;
  for (const comparison of comparisons) {
    const expectedAHash = comparison.variantA === "raw" ? sha256(raw) : sha256(reviewed);
    const expectedBHash = comparison.variantB === "raw" ? sha256(raw) : sha256(reviewed);
    if (
      comparison.variantAContentHash !== expectedAHash ||
      comparison.variantBContentHash !== expectedBHash
    ) {
      throw new Error(`${comparison.comparisonId} variants do not match the reviewed session`);
    }
    for (const rating of [comparison.cognitiveLoad.a, comparison.cognitiveLoad.b]) {
      if (rating < scale.minimum || rating > scale.maximum) {
        throw new Error(`${comparison.comparisonId} cognitive-load rating is outside the scale`);
      }
    }
  }
}

function reviewTiming(
  artifact: ArtifactEvidence,
  comparisons: ReaderComparison[],
  decisions: ArtifactSession["decisions"],
  editorReviewMilliseconds: number,
) {
  const finalManualReviewMilliseconds = durationMilliseconds(
    artifact.finalManualReview.startedAt,
    artifact.finalManualReview.finishedAt,
    `${artifact.artifactId} final manual review`,
  );
  const firstReviewStartedAt = decisions.reduce(
    (earliest, decision) => Math.min(earliest, Date.parse(decision.reviewStartedAt)),
    Number.POSITIVE_INFINITY,
  );
  if (firstReviewStartedAt < Date.parse(artifact.sessionStartedAt)) {
    throw new Error(`${artifact.artifactId} proposal review began before the session start`);
  }
  const lastDecisionAt = decisions.reduce(
    (latest, decision) => Math.max(latest, Date.parse(decision.decidedAt)),
    Date.parse(artifact.sessionStartedAt),
  );
  if (Date.parse(artifact.finalManualReview.startedAt) < lastDecisionAt) {
    throw new Error(`${artifact.artifactId} final manual review overlaps proposal review`);
  }
  if (
    Date.parse(artifact.finalManualReview.finishedAt) >
      Date.parse(artifact.publication.finalReview.reviewedAt)
  ) {
    throw new Error(`${artifact.artifactId} author approval predates final manual edits`);
  }
  if (comparisons.some((comparison) => Date.parse(comparison.completedAt) < lastDecisionAt)) {
    throw new Error(`${artifact.artifactId} reader comparison predates the reviewed result`);
  }
  const totalReviewMilliseconds = editorReviewMilliseconds + finalManualReviewMilliseconds;
  const priorManualWorkflowMilliseconds = artifact.priorManualWorkflow.reviewMilliseconds;
  return {
    editorReviewMilliseconds,
    finalManualReviewMilliseconds,
    totalReviewMilliseconds,
    priorManualWorkflowMilliseconds,
    timeSavedFraction:
      (priorManualWorkflowMilliseconds - totalReviewMilliseconds) /
      priorManualWorkflowMilliseconds,
  };
}

function readerSummary(comparisons: ReaderComparison[]) {
  const preferenceOutcomes = comparisons.map(comparisonOutcome);
  return {
    comparisons: comparisons.length,
    reviewedPreferred: preferenceOutcomes.filter((outcome) => outcome === "reviewed").length,
    rawPreferred: preferenceOutcomes.filter((outcome) => outcome === "raw").length,
    ties: preferenceOutcomes.filter((outcome) => outcome === "tie").length,
    meanCognitiveLoadDelta: meanOrZero(comparisons.map(comparisonCognitiveLoadDelta)),
  };
}

function artifactFailures(
  preregistration: Preregistration,
  artifact: ArtifactEvidence,
  readers: ReturnType<typeof readerSummary>,
  timing: ReturnType<typeof reviewTiming>,
  usefulEditYield: number,
): string[] {
  const reviewedPreferenceRate = ratioOrZero(
    readers.reviewedPreferred,
    readers.comparisons,
  );
  return [
    ...(artifact.quality.factualPreservation === "fail" ? ["factual-regression"] : []),
    ...(artifact.quality.terminologyPreservation === "fail"
      ? ["terminology-regression"]
      : []),
    ...(artifact.quality.unwantedVoiceChange ? ["unwanted-voice-change"] : []),
    ...(artifact.quality.regression === "present" ? ["editorial-regression"] : []),
    ...(readers.comparisons < preregistration.comparison.minimumReadersPerArtifact
      ? ["reader-sample-incomplete"]
      : []),
    ...(usefulEditYield < preregistration.thresholds.minimumUsefulEditYield
      ? ["useful-edit-yield"]
      : []),
    ...(timing.timeSavedFraction < preregistration.thresholds.minimumMedianTimeSavedFraction
      ? ["review-time"]
      : []),
    ...(reviewedPreferenceRate < preregistration.thresholds.minimumReviewedPreferenceRate
      ? ["reader-preference"]
      : []),
    ...(readers.meanCognitiveLoadDelta >
      preregistration.thresholds.maximumMeanCognitiveLoadDelta
      ? ["reader-cognitive-load"]
      : []),
  ];
}

function evaluateArtifact(options: {
  preregistration: Preregistration;
  artifact: ArtifactEvidence;
  comparisons: ReaderComparison[];
  evidenceRoot: string;
  repositoryRoot: string;
}): ArtifactResult {
  const { preregistration, artifact, comparisons, evidenceRoot, repositoryRoot } = options;
  assertPublicationChronology(preregistration, artifact);
  const session = loadArtifactSession(evidenceRoot, artifact);
  const editorReviewMilliseconds = verifyReviewSession(artifact, session);
  if (artifact.publication.contentHash !== sha256(session.published)) {
    throw new Error(`${artifact.artifactId} published content hash does not match its evidence`);
  }
  verifyPublishedRevision(repositoryRoot, artifact, session.published);
  verifyDeterministicCatches(artifact, session);
  verifyReaderComparisons(preregistration, comparisons, session);

  const accepted = countOutcome(session.decisions, "accepted");
  const changed = countOutcome(session.decisions, "changed");
  const rejected = countOutcome(session.decisions, "rejected");
  const usefulEditYield = ratioOrZero(accepted + changed, session.decisions.length);
  const timing = reviewTiming(
    artifact,
    comparisons,
    session.decisions,
    editorReviewMilliseconds,
  );
  const readers = readerSummary(comparisons);

  return ArtifactResultSchema.parse({
    artifactId: artifact.artifactId,
    artifactType: artifact.artifactType,
    changeKind: artifact.changeKind,
    publicationRevision: artifact.publication.revision,
    proposals: session.decisions.length,
    outcomes: { accepted, changed, rejected },
    usefulEditYield,
    deterministicCatches: artifact.deterministicCatchFindingIds.length,
    timing,
    finalManualEdits: manualEditCounts(session.reviewed, session.published),
    readers,
    quality: artifact.quality,
    failures: artifactFailures(preregistration, artifact, readers, timing, usefulEditYield),
  });
}

function artifactTypeCounts(artifacts: ArtifactResult[]) {
  return Object.fromEntries(
    ArtifactTypeSchema.options.map((artifactType) => [
      artifactType,
      artifacts.filter((artifact) => artifact.artifactType === artifactType).length,
    ]),
  );
}

function recommendation(
  prerequisitesComplete: boolean,
  gates: Record<string, boolean>,
): "justify-general-editor" | "do-not-justify" | "gather-more-evidence" {
  if (!prerequisitesComplete) return "gather-more-evidence";
  return Object.values(gates).every(Boolean)
    ? "justify-general-editor"
    : "do-not-justify";
}

export function evaluatePublicationPilot(options: {
  preregistrationFile: string;
  evidenceFile: string;
  evidenceRoot: string;
  repositoryRoot: string;
}) {
  const preregistration = PublicationPilotPreregistrationSchema.parse(
    readJson(options.preregistrationFile),
  );
  const evidence = PublicationPilotEvidenceSchema.parse(readJson(options.evidenceFile));
  if (evidence.pilotId !== preregistration.pilotId) {
    throw new Error("publication pilot evidence does not match the preregistration");
  }
  const artifactIds = new Set(evidence.artifacts.map(({ artifactId }) => artifactId));
  for (const comparison of evidence.readerComparisons) {
    if (!artifactIds.has(comparison.artifactId)) {
      throw new Error(`${comparison.comparisonId} references an unknown artifact`);
    }
    if (Date.parse(comparison.completedAt) < Date.parse(preregistration.preregisteredAt)) {
      throw new Error(`${comparison.comparisonId} predates the preregistration`);
    }
  }
  const artifacts = evidence.artifacts.map((artifact) => evaluateArtifact({
    preregistration,
    artifact,
    comparisons: evidence.readerComparisons.filter(
      (comparison) => comparison.artifactId === artifact.artifactId,
    ),
    evidenceRoot: options.evidenceRoot,
    repositoryRoot: options.repositoryRoot,
  }));
  const proposals = artifacts.reduce((total, artifact) => total + artifact.proposals, 0);
  const accepted = artifacts.reduce((total, artifact) => total + artifact.outcomes.accepted, 0);
  const changed = artifacts.reduce((total, artifact) => total + artifact.outcomes.changed, 0);
  const rejected = artifacts.reduce((total, artifact) => total + artifact.outcomes.rejected, 0);
  const reviewedPreferred = artifacts.reduce(
    (total, artifact) => total + artifact.readers.reviewedPreferred,
    0,
  );
  const rawPreferred = artifacts.reduce(
    (total, artifact) => total + artifact.readers.rawPreferred,
    0,
  );
  const ties = artifacts.reduce((total, artifact) => total + artifact.readers.ties, 0);
  const allComparisons = evidence.readerComparisons.length;
  const byArtifactType = artifactTypeCounts(artifacts);
  const quality = {
    factualPreservation: {
      pass: artifacts.filter(({ quality: result }) => result.factualPreservation === "pass").length,
      fail: artifacts.filter(({ quality: result }) => result.factualPreservation === "fail").length,
    },
    terminologyPreservation: {
      pass: artifacts.filter(({ quality: result }) => result.terminologyPreservation === "pass").length,
      fail: artifacts.filter(({ quality: result }) => result.terminologyPreservation === "fail").length,
    },
    unwantedVoiceChanges: artifacts.filter(({ quality: result }) => result.unwantedVoiceChange).length,
    regressions: artifacts.filter(({ quality: result }) => result.regression === "present").length,
    regressionRate: ratioOrZero(
      artifacts.filter(({ quality: result }) => result.regression === "present").length,
      artifacts.length,
    ),
  };
  const readerDeltas = evidence.readerComparisons.map(comparisonCognitiveLoadDelta);
  const metrics = {
    usefulEditYield: ratioOrZero(accepted + changed, proposals),
    medianTimeSavedFraction: medianOrZero(
      artifacts.map(({ timing }) => timing.timeSavedFraction),
    ),
    reviewedPreferenceRate: ratioOrZero(reviewedPreferred, allComparisons),
    meanCognitiveLoadDelta: meanOrZero(readerDeltas),
    unwantedVoiceChangeRate: ratioOrZero(
      quality.unwantedVoiceChanges,
      artifacts.length,
    ),
  };
  const cohortGates = {
    cohortSize: artifacts.length >= preregistration.cohort.minimumArtifacts,
    artifactMix: preregistration.cohort.requiredMix.every(
      ({ artifactType, minimum }) => (byArtifactType[artifactType] ?? 0) >= minimum,
    ),
    newArtifacts:
      artifacts.filter(({ changeKind }) => changeKind === "new").length >=
      preregistration.cohort.minimumNewArtifacts,
    materialRevisions:
      artifacts.filter(({ changeKind }) => changeKind === "material-revision").length >=
      preregistration.cohort.minimumMaterialRevisions,
    readerCoverage: artifacts.length > 0 && artifacts.every(
      ({ readers }) =>
        readers.comparisons >= preregistration.comparison.minimumReadersPerArtifact,
    ),
  };
  const outcomeGates = {
    usefulEditYield:
      metrics.usefulEditYield >= preregistration.thresholds.minimumUsefulEditYield,
    timeSaved:
      metrics.medianTimeSavedFraction >=
      preregistration.thresholds.minimumMedianTimeSavedFraction,
    readerPreference:
      metrics.reviewedPreferenceRate >=
      preregistration.thresholds.minimumReviewedPreferenceRate,
    cognitiveLoad:
      metrics.meanCognitiveLoadDelta <=
      preregistration.thresholds.maximumMeanCognitiveLoadDelta,
    regressions:
      quality.regressionRate <= preregistration.thresholds.maximumRegressionRate,
    unwantedVoiceChanges:
      metrics.unwantedVoiceChangeRate <=
      preregistration.thresholds.maximumUnwantedVoiceChangeRate,
    factualPreservation:
      !preregistration.thresholds.requireZeroFactualRegressions ||
      quality.factualPreservation.fail === 0,
    terminologyPreservation:
      !preregistration.thresholds.requireZeroTerminologyRegressions ||
      quality.terminologyPreservation.fail === 0,
    deletionClear: evidence.governance.deletionStatus === "active",
  };
  const gates = { ...cohortGates, ...outcomeGates };
  const prerequisitesComplete = Object.values(cohortGates).every(Boolean);
  const body = {
    schemaVersion: 1 as const,
    recordType: "writing-publication-pilot-report" as const,
    pilotId: preregistration.pilotId,
    preregistrationHash: sha256(canonicalJson(preregistration)),
    evidenceHash: sha256(canonicalJson(evidence)),
    governance: evidence.governance,
    sample: {
      artifacts: artifacts.length,
      byArtifactType,
      newArtifacts: artifacts.filter(({ changeKind }) => changeKind === "new").length,
      materialRevisions: artifacts.filter(
        ({ changeKind }) => changeKind === "material-revision",
      ).length,
      readerComparisons: allComparisons,
    },
    proposalOutcomes: {
      proposals,
      accepted,
      changed,
      rejected,
      usefulEditYield: metrics.usefulEditYield,
    },
    review: {
      totalEditorMilliseconds: artifacts.reduce(
        (total, artifact) => total + artifact.timing.editorReviewMilliseconds,
        0,
      ),
      totalFinalManualMilliseconds: artifacts.reduce(
        (total, artifact) => total + artifact.timing.finalManualReviewMilliseconds,
        0,
      ),
      medianTimeSavedFraction: metrics.medianTimeSavedFraction,
    },
    quality,
    readers: {
      reviewedPreferred,
      rawPreferred,
      ties,
      reviewedPreferenceRate: metrics.reviewedPreferenceRate,
      meanCognitiveLoadDelta: metrics.meanCognitiveLoadDelta,
    },
    deterministicCatches: artifacts.reduce(
      (total, artifact) => total + artifact.deterministicCatches,
      0,
    ),
    artifacts,
    gates,
    recommendation: recommendation(prerequisitesComplete, gates),
  };
  const reportId = `publication-report:v1:${sha256(canonicalJson(body)).slice("sha256:".length)}`;
  return PublicationPilotReportSchema.parse({ ...body, reportId });
}

export function renderPublicationPilotReport(
  report: z.infer<typeof PublicationPilotReportSchema>,
): string {
  const percentage = (value: number) => `${(value * 100).toFixed(1)}%`;
  const rows = report.artifacts.map((artifact) =>
    `| ${artifact.artifactId} | ${artifact.artifactType} | ${percentage(artifact.usefulEditYield)} | ${percentage(artifact.timing.timeSavedFraction)} | ${artifact.readers.comparisons} | ${artifact.failures.join(", ") || "None"} |`
  );
  return [
    "# Repository publication pilot",
    "",
    `Recommendation: **${report.recommendation}**.`,
    "",
    `The pilot contains ${report.sample.artifacts} published artifacts and ${report.sample.readerComparisons} blinded reader comparisons.`,
    `The reviewed output won ${percentage(report.readers.reviewedPreferenceRate)} of comparisons. Its mean cognitive-load change was ${report.readers.meanCognitiveLoadDelta.toFixed(2)} points, where a negative value is better.`,
    `Useful-edit yield was ${percentage(report.proposalOutcomes.usefulEditYield)}. Median review-time savings against the declared manual baselines were ${percentage(report.review.medianTimeSavedFraction)}.`,
    "",
    "## Release gates",
    "",
    ...Object.entries(report.gates).map(([gate, passed]) => `- ${passed ? "Pass" : "Fail"}: ${gate}`),
    "",
    "## Artifacts",
    "",
    "| Artifact | Type | Useful yield | Time saved | Readers | Failures |",
    "| --- | --- | ---: | ---: | ---: | --- |",
    ...rows,
    "",
  ].join("\n");
}

function resolveOutputFile(
  workingDirectory: string,
  requestedFile: string,
  label: string,
): string {
  const outputRoot = path.resolve(workingDirectory, "outputs");
  const resolved = path.resolve(workingDirectory, requestedFile);
  const relative = path.relative(outputRoot, resolved);
  if (
    relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${label} must be a file below ${outputRoot}`);
  }
  ensureOutputDirectory(path.dirname(resolved), workingDirectory);
  return resolved;
}

export function runPublicationPilotCli(
  args: string[],
  workingDirectory = process.cwd(),
): void {
  const { values } = parseArgs({
    args,
    options: {
      preregistration: { type: "string" },
      evidence: { type: "string" },
      "evidence-root": { type: "string" },
      repository: { type: "string" },
      output: { type: "string" },
      report: { type: "string" },
    },
    strict: true,
  });
  if (
    !values.preregistration || !values.evidence || !values["evidence-root"] ||
    !values.repository ||
    !values.output || !values.report
  ) {
    throw new Error(
      "usage: evaluate-publication-pilot --preregistration <file> --evidence <file> --evidence-root <directory> --repository <directory> --output <file> --report <file>",
    );
  }
  const preregistrationFile = resolveContainedFile(
    workingDirectory,
    values.preregistration,
    "publication pilot preregistration",
  );
  const evidenceRoot = resolveContainedDirectory(
    workingDirectory,
    values["evidence-root"],
    "publication pilot evidence root",
  );
  const evidenceFile = resolveContainedFile(
    evidenceRoot,
    path.resolve(workingDirectory, values.evidence),
    "publication pilot evidence",
  );
  const result = evaluatePublicationPilot({
    preregistrationFile,
    evidenceFile,
    evidenceRoot,
    repositoryRoot: values.repository,
  });
  const outputFile = resolveOutputFile(workingDirectory, values.output, "JSON report");
  const reportFile = resolveOutputFile(workingDirectory, values.report, "Markdown report");
  writeJson(outputFile, result);
  fs.writeFileSync(reportFile, renderPublicationPilotReport(result));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runPublicationPilotCli(process.argv.slice(2));
}
