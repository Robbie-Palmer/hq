import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { canonicalJson } from "writing-editor-domain/canonical-json";
import { DecisionSchema } from "writing-editor-domain/decisions";
import { ReviewReceiptSchema } from "writing-editor-domain/review-receipt";
import {
  ReviewRecordsSchema,
  validateRecordedDecisions,
} from "writing-editor-domain/review";
import { sha256 } from "writing-editor-domain/suggestions";
import { z } from "zod";

import { readJson, resolveContainedFile, writeJson } from "./files";

const EvidencePathSchema = z.string().min(1).refine(
  (value) => !path.isAbsolute(value) && !value.split("/").includes(".."),
  "must be relative to the evidence root",
);
const QualityRatingSchema = z.enum(["pass", "fail", "not-assessed"]);

export const ReviewEvidenceManifestSchema = z.object({
  schemaVersion: z.literal(1),
  recordType: z.literal("writing-review-evidence-manifest"),
  cohortId: z.string().trim().min(1),
  governance: z.object({
    dataClassification: z.enum(["public", "private"]),
    consentBasis: z.string().trim().min(1),
    consentRecordedAt: z.iso.datetime({ offset: true }),
    retentionPolicy: z.string().trim().min(1),
    deletionStatus: z.enum(["active", "deletion-requested"]),
  }).strict(),
  entries: z.array(z.object({
    artifactId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    artifactType: z.enum(["adr", "project-page"]),
    split: z.enum(["train", "validation", "holdout"]),
    recordsFile: EvidencePathSchema,
    decisionsFile: EvidencePathSchema,
    receiptFile: EvidencePathSchema,
    quality: z.object({
      factualPreservation: QualityRatingSchema,
      terminologyPreservation: QualityRatingSchema,
      voicePreservation: QualityRatingSchema,
      regression: z.enum(["none", "present", "not-assessed"]),
    }).strict(),
  }).strict()).min(1),
}).strict().superRefine((manifest, context) => {
  const ids = manifest.entries.map(({ artifactId }) => artifactId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", message: "artifact IDs must be unique", path: ["entries"] });
  }
});

export const ReviewEvaluationParamsSchema = z.object({
  minimumActionableProposals: z.number().int().positive(),
  minimumUsefulYield: z.number().min(0).max(1),
  maximumRegressionRate: z.number().min(0).max(1),
  maximumMedianReviewSeconds: z.number().nonnegative(),
  requireAssessedQuality: z.boolean(),
}).strict();

const MetricCountSchema = z.object({
  pass: z.number().int().nonnegative(),
  fail: z.number().int().nonnegative(),
  notAssessed: z.number().int().nonnegative(),
}).strict();

export const ReviewScorecardSchema = z.object({
  schemaVersion: z.literal(1),
  recordType: z.literal("writing-review-scorecard"),
  scorecardId: z.string().regex(/^scorecard:v1:[a-f0-9]{64}$/),
  cohortId: z.string().trim().min(1),
  evidenceManifestHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  governance: ReviewEvidenceManifestSchema.shape.governance,
  detectionCoverage: z.object({
    artifacts: z.number().int().positive(),
    findings: z.number().int().nonnegative(),
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
    producerIds: z.array(z.string()),
    findings: z.number().int().nonnegative(),
    proposals: z.number().int().nonnegative(),
    accepted: z.number().int().nonnegative(),
    changed: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    reviewSeconds: z.number().nonnegative(),
  }).strict()),
  gates: z.object({
    actionableVolume: z.boolean(),
    usefulYield: z.boolean(),
    regressionRate: z.boolean(),
    reviewTime: z.boolean(),
    qualityAssessed: z.boolean(),
    deletionClear: z.boolean(),
  }).strict(),
  recommendation: z.enum(["adopt-default", "keep-opt-in"]),
}).strict();
export type ReviewScorecard = z.infer<typeof ReviewScorecardSchema>;

export function evaluateReviews(options: {
  manifestFile: string;
  evidenceRoot: string;
  paramsFile: string;
  outputFile?: string;
}): ReviewScorecard {
  const manifest = ReviewEvidenceManifestSchema.parse(readJson(options.manifestFile));
  const params = ReviewEvaluationParamsSchema.parse(readJson(options.paramsFile));
  const artifacts = manifest.entries.map((entry) => {
    const records = ReviewRecordsSchema.parse(readJson(resolveContainedFile(
      options.evidenceRoot,
      entry.recordsFile,
      `${entry.artifactId} producer records`,
    )));
    const decisionsText = fs.readFileSync(resolveContainedFile(
      options.evidenceRoot,
      entry.decisionsFile,
      `${entry.artifactId} decisions`,
    ), "utf8");
    const decisions = decisionsText.split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => DecisionSchema.parse(JSON.parse(line)));
    validateRecordedDecisions(decisions, records.proposals);
    if (decisions.length !== records.proposals.length) {
      throw new Error(`${entry.artifactId} has unadjudicated proposals`);
    }
    const receipt = ReviewReceiptSchema.parse(readJson(resolveContainedFile(
      options.evidenceRoot,
      entry.receiptFile,
      `${entry.artifactId} review receipt`,
    )));
    if (receipt.recordsHash !== sha256(canonicalJson(records))) {
      throw new Error(`${entry.artifactId} receipt does not match its producer records`);
    }
    if (receipt.decisionsHash !== sha256(canonicalJson(decisions))) {
      throw new Error(`${entry.artifactId} receipt does not match its decisions`);
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
      producerIds: [...new Set([
        ...records.findings.map(({ producer }) => producer.id),
        ...records.proposals.flatMap(({ suggestions }) =>
          suggestions.map(({ producer }) => producer.id)
        ),
      ])].sort((left, right) => left.localeCompare(right)),
      findings: records.findings.length,
      proposals: records.proposals.length,
      accepted: count("accepted"),
      changed: count("changed"),
      rejected: count("rejected"),
      reviewSeconds: receipt.summary.reviewMilliseconds / 1_000,
      quality: entry.quality,
    };
  });
  const proposals = sum(artifacts.map(({ proposals: count }) => count));
  const accepted = sum(artifacts.map(({ accepted: count }) => count));
  const changed = sum(artifacts.map(({ changed: count }) => count));
  const rejected = sum(artifacts.map(({ rejected: count }) => count));
  const usefulYield = proposals === 0 ? 0 : (accepted + changed) / proposals;
  const factualPreservation = qualityCounts(artifacts.map(({ quality }) => quality.factualPreservation));
  const terminologyPreservation = qualityCounts(
    artifacts.map(({ quality }) => quality.terminologyPreservation),
  );
  const voicePreservation = qualityCounts(artifacts.map(({ quality }) => quality.voicePreservation));
  const regressions = {
    none: artifacts.filter(({ quality }) => quality.regression === "none").length,
    present: artifacts.filter(({ quality }) => quality.regression === "present").length,
    notAssessed: artifacts.filter(({ quality }) => quality.regression === "not-assessed").length,
  };
  const assessedRegressions = regressions.none + regressions.present;
  const regressionRate = assessedRegressions === 0 ? 0 : regressions.present / assessedRegressions;
  const reviewTimes = artifacts.map(({ reviewSeconds }) => reviewSeconds).sort((a, b) => a - b);
  const medianSeconds = median(reviewTimes);
  const qualityAssessed = [
    factualPreservation,
    terminologyPreservation,
    voicePreservation,
  ].every(({ notAssessed }) => notAssessed === 0) && regressions.notAssessed === 0;
  const gates = {
    actionableVolume: proposals >= params.minimumActionableProposals,
    usefulYield: usefulYield >= params.minimumUsefulYield,
    regressionRate: regressionRate <= params.maximumRegressionRate,
    reviewTime: medianSeconds <= params.maximumMedianReviewSeconds,
    qualityAssessed: !params.requireAssessedQuality || qualityAssessed,
    deletionClear: manifest.governance.deletionStatus === "active",
  };
  const body = {
    schemaVersion: 1 as const,
    recordType: "writing-review-scorecard" as const,
    cohortId: manifest.cohortId,
    evidenceManifestHash: sha256(canonicalJson(manifest)),
    governance: manifest.governance,
    detectionCoverage: {
      artifacts: artifacts.length,
      findings: sum(artifacts.map(({ findings }) => findings)),
    },
    proposalOutcomes: { proposals, accepted, changed, rejected, usefulYield },
    quality: {
      factualPreservation,
      terminologyPreservation,
      voicePreservation,
      regressions: { ...regressions, rate: regressionRate },
    },
    review: {
      totalSeconds: sum(reviewTimes),
      medianSeconds,
    },
    artifacts: artifacts.map(({ quality: _quality, ...artifact }) => artifact),
    gates,
    recommendation: Object.values(gates).every(Boolean)
      ? "adopt-default" as const
      : "keep-opt-in" as const,
  };
  const scorecardDigest = sha256(canonicalJson(body)).slice("sha256:".length);
  const scorecard = ReviewScorecardSchema.parse({
    ...body,
    scorecardId: `scorecard:v1:${scorecardDigest}`,
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

function main(): void {
  const { values } = parseArgs({ options: {
    manifest: { type: "string" },
    evidence: { type: "string" },
    params: { type: "string" },
    output: { type: "string" },
  } });
  const args = z.object({
    manifest: z.string().min(1),
    evidence: z.string().min(1),
    params: z.string().min(1),
    output: z.string().min(1),
  }).parse(values);
  const scorecard = evaluateReviews({
    manifestFile: args.manifest,
    evidenceRoot: args.evidence,
    paramsFile: args.params,
    outputFile: args.output,
  });
  console.log(`${scorecard.scorecardId}: ${scorecard.recommendation}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
