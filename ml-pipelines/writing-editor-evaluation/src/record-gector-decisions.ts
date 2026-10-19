import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { createDecision, type Decision } from "writing-editor-domain/decisions";
import type { Proposal } from "writing-editor-domain/proposals";
import { createReviewReceipt } from "writing-editor-domain/review-receipt";
import { applyDecisions, prepareReviewRecords } from "writing-editor-domain/review";
import { canonicalJson } from "writing-editor-domain/canonical-json";
import { sha256 } from "writing-editor-domain/suggestions";
import { z } from "zod";

import { CurrentContentManifestSchema } from "./build-current-content-corpus";
import { readContainedText, readJson, resetDirectory, writeJson } from "./files";
import { buildEditHunks } from "./match-edits";
import { FrozenCohortSchema, GectorProducerRunSchema, type EditHunk } from "./schemas";

const GovernanceSchema = z.object({
  dataClassification: z.literal("private"),
  consentBasis: z.string().trim().min(1),
  consentRecordedAt: z.iso.datetime({ offset: true }),
  retentionPolicy: z.string().trim().min(1),
  deletionStatus: z.literal("active"),
}).strict();
const ArtifactIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const ReviewDecisionConfigSchema = z.object({
  schemaVersion: z.literal(1),
  baselineRevision: z.string().regex(/^[a-f0-9]{40}$/),
  review: z.object({
    reviewStartedAt: z.iso.datetime({ offset: true }),
    decidedAt: z.iso.datetime({ offset: true }),
    method: z.string().trim().min(1),
    timing: z.literal("not-measured"),
    splitSeed: z.string().trim().min(1),
  }).strict(),
  governance: GovernanceSchema,
  targetRenames: z.record(ArtifactIdSchema, ArtifactIdSchema).default({}),
  deletionRequests: z.array(z.object({
    artifactId: ArtifactIdSchema,
    requestedAt: z.iso.datetime({ offset: true }),
  }).strict()).default([]),
  deletedArtifacts: z.array(z.object({
    artifactId: ArtifactIdSchema,
    requestedAt: z.iso.datetime({ offset: true }),
    deletedAt: z.iso.datetime({ offset: true }),
  }).strict()).default([]),
}).strict().superRefine((config, context) => {
  const requests = config.deletionRequests.map(({ artifactId }) => artifactId);
  const deleted = config.deletedArtifacts.map(({ artifactId }) => artifactId);
  if (new Set(requests).size !== requests.length || new Set(deleted).size !== deleted.length) {
    context.addIssue({ code: "custom", message: "deletion artifact IDs must be unique" });
  }
  if (requests.some((artifactId) => deleted.includes(artifactId))) {
    context.addIssue({ code: "custom", message: "an artifact cannot be requested and deleted" });
  }
});
type ReviewDecisionConfig = z.infer<typeof ReviewDecisionConfigSchema>;

const CliOptionsSchema = z.object({
  config: z.string().trim().min(1),
  "seed-cohort": z.string().trim().min(1),
  "seed-corpus": z.string().trim().min(1),
  "seed-run": z.string().trim().min(1),
  "customer-cohort": z.string().trim().min(1),
  "customer-corpus": z.string().trim().min(1),
  "customer-target": z.string().trim().min(1),
  "customer-run": z.string().trim().min(1),
  "developer-cohort": z.string().trim().min(1),
  "developer-corpus": z.string().trim().min(1),
  "developer-target": z.string().trim().min(1),
  "developer-run": z.string().trim().min(1),
  output: z.string().trim().min(1),
}).strict();

interface ReviewInput {
  scope: "seed" | "customer" | "developer";
  cohortFile: string;
  corpusRoot: string;
  runFile: string;
  targetRoot?: string;
}

interface ProposalClassification {
  outcome: "accepted" | "changed" | "rejected";
  replacement?: string;
}

type CohortEntry = z.infer<typeof FrozenCohortSchema>["entries"][number];
type RunArtifact = z.infer<typeof GectorProducerRunSchema>["artifacts"][number];
type ContentEntry = z.infer<typeof CurrentContentManifestSchema>["entries"][number];

function proposalRange(proposal: Proposal): { startByte: number; endByte: number } {
  const suggestions = proposal.suggestions;
  const first = suggestions[0];
  const last = suggestions.at(-1);
  if (!first || !last) throw new Error(`${proposal.proposalId} has no suggestions`);
  return { startByte: first.span.startByte, endByte: last.span.endByte };
}

function overlaps(range: { startByte: number; endByte: number }, hunk: EditHunk): boolean {
  if (hunk.source.startByte === hunk.source.endByte) {
    return hunk.source.startByte >= range.startByte && hunk.source.startByte <= range.endByte;
  }
  return hunk.source.startByte < range.endByte && hunk.source.endByte > range.startByte;
}

function contained(range: { startByte: number; endByte: number }, hunk: EditHunk): boolean {
  return hunk.source.startByte >= range.startByte && hunk.source.endByte <= range.endByte;
}

function hunkSignature(hunk: EditHunk): string {
  return canonicalJson({ source: hunk.source, publishedText: hunk.published.text });
}

function replacementFromHunks(
  source: string,
  range: { startByte: number; endByte: number },
  hunks: EditHunk[],
): string {
  let result = Buffer.from(source, "utf8").subarray(range.startByte, range.endByte);
  for (const hunk of [...hunks].sort((left, right) => right.source.startByte - left.source.startByte)) {
    const start = hunk.source.startByte - range.startByte;
    const end = hunk.source.endByte - range.startByte;
    result = Buffer.concat([
      result.subarray(0, start),
      Buffer.from(hunk.published.text, "utf8"),
      result.subarray(end),
    ]);
  }
  return result.toString("utf8");
}

export function classifyProposal(
  proposal: Proposal,
  source: string,
  targetHunks: EditHunk[],
): ProposalClassification {
  const range = proposalRange(proposal);
  const relevant = targetHunks.filter((hunk) => overlaps(range, hunk));
  if (relevant.length === 0 || relevant.some((hunk) => !contained(range, hunk))) {
    return { outcome: "rejected" };
  }
  const accepted = createDecision(proposal, "accepted", {
    reviewStartedAt: "2000-01-01T00:00:00.000Z",
    decidedAt: "2000-01-01T00:00:00.000Z",
  });
  const expected = applyDecisions(source, [accepted]);
  const expectedHunks = buildEditHunks(source, expected, Math.max(source.length * 2, 10_000))
    .filter((hunk) => overlaps(range, hunk));
  const actualSignatures = relevant.map(hunkSignature)
    .sort((left, right) => left.localeCompare(right));
  const expectedSignatures = expectedHunks.map(hunkSignature)
    .sort((left, right) => left.localeCompare(right));
  if (canonicalJson(actualSignatures) === canonicalJson(expectedSignatures)) {
    return { outcome: "accepted" };
  }
  return {
    outcome: "changed",
    replacement: replacementFromHunks(source, range, relevant),
  };
}

function split(artifactId: string, seed: string): "train" | "validation" | "holdout" {
  const bucket = Number.parseInt(sha256(`${seed}\0${artifactId}`).slice(7, 15), 16) % 10;
  if (bucket < 6) return "train";
  if (bucket < 8) return "validation";
  return "holdout";
}

function decisionForProposal(
  proposal: Proposal,
  source: string,
  targetHunks: EditHunk[],
  config: ReviewDecisionConfig,
): Decision {
  const classification = classifyProposal(proposal, source, targetHunks);
  const timing = {
    reviewStartedAt: config.review.reviewStartedAt,
    decidedAt: config.review.decidedAt,
  };
  if (classification.outcome === "changed") {
    return createDecision(proposal, "changed", classification.replacement ?? "", timing);
  }
  return createDecision(proposal, classification.outcome, timing);
}

function readReviewTarget(options: {
  input: ReviewInput;
  cohortEntry: CohortEntry;
  targetEntries: Map<string, ContentEntry> | undefined;
  targetArtifactId: string;
  evidenceId: string;
}): string {
  const targetEntry = options.targetEntries?.get(options.targetArtifactId);
  if (options.targetEntries && !targetEntry) {
    throw new Error(`target corpus is missing ${options.evidenceId}`);
  }
  if (targetEntry) {
    return readContainedText(
      options.input.targetRoot ?? "",
      targetEntry.file,
      `${options.evidenceId} reviewed source`,
    );
  }
  return readContainedText(
    options.input.corpusRoot,
    options.cohortEntry.published.file,
    `${options.evidenceId} published source`,
  );
}

function writeEvidenceArtifact(options: {
  config: ReviewDecisionConfig;
  input: ReviewInput;
  output: string;
  entries: unknown[];
  deletionRequests: Map<string, ReviewDecisionConfig["deletionRequests"][number]>;
  cohort: z.infer<typeof FrozenCohortSchema>;
  runId: string;
  cohortEntry: CohortEntry;
  artifact: RunArtifact;
  targetEntries: Map<string, ContentEntry> | undefined;
  targetArtifactId: string;
  evidenceId: string;
}): void {
  const { config, input, cohortEntry, artifact, evidenceId } = options;
  const source = readContainedText(input.corpusRoot, cohortEntry.source.file, `${evidenceId} source`);
  const target = readReviewTarget({
    input,
    cohortEntry,
    targetEntries: options.targetEntries,
    targetArtifactId: options.targetArtifactId,
    evidenceId,
  });
  const records = prepareReviewRecords({
    documentId: artifact.source.documentId,
    revision: artifact.source.revision,
    findings: [],
    proposals: artifact.proposals,
  }, source);
  const targetHunks = buildEditHunks(source, target, Math.max(source.length * 4, 100_000));
  const decisions = records.proposals.map((proposal) =>
    decisionForProposal(proposal, source, targetHunks, config)
  );
  const sourceAfter = applyDecisions(source, decisions);
  const receipt = createReviewReceipt(records, decisions, source, sourceAfter);
  const extension = path.extname(cohortEntry.path) || ".md";
  const directory = path.join("artifacts", evidenceId);
  const recordsFile = `${directory}/records.json`;
  const decisionsFile = `${directory}/decisions.jsonl`;
  const receiptFile = `${directory}/receipt.json`;
  const sourceBeforeFile = `${directory}/source-before${extension}`;
  const sourceAfterFile = `${directory}/source-after${extension}`;
  writeJson(path.join(options.output, recordsFile), records);
  fs.mkdirSync(path.join(options.output, directory), { recursive: true });
  const decisionLines = decisions.map((decision) => canonicalJson(decision)).join("\n");
  fs.writeFileSync(path.join(options.output, decisionsFile), `${decisionLines}${decisionLines ? "\n" : ""}`);
  writeJson(path.join(options.output, receiptFile), receipt);
  fs.writeFileSync(path.join(options.output, sourceBeforeFile), source);
  fs.writeFileSync(path.join(options.output, sourceAfterFile), sourceAfter);
  const deletionRequest = options.deletionRequests.get(evidenceId);
  const governance = deletionRequest
    ? {
        ...config.governance,
        deletionStatus: "deletion-requested" as const,
        deletionRequestedAt: deletionRequest.requestedAt,
      }
    : config.governance;
  options.entries.push({
    artifactId: evidenceId,
    artifactType: cohortEntry.artifactType,
    split: input.scope === "seed" ? cohortEntry.split : split(evidenceId, config.review.splitSeed),
    recordsFile,
    decisionsFile,
    receiptFile,
    sourceBeforeFile,
    sourceAfterFile,
    provenance: {
      scope: input.scope,
      sourceDatasetId: options.cohort.datasetId,
      sourceRevision: cohortEntry.source.revision,
      producerRunId: options.runId,
      reviewMethod: config.review.method,
      reviewTiming: config.review.timing,
    },
    governance,
    quality: {
      factualPreservation: "not-assessed",
      terminologyPreservation: "not-assessed",
      voicePreservation: "not-assessed",
      regression: "not-assessed",
    },
  });
}

function runArtifact(
  input: ReviewInput,
  artifacts: ReadonlyMap<string, RunArtifact>,
  cohortEntry: CohortEntry,
): RunArtifact {
  const artifact = artifacts.get(cohortEntry.artifactId);
  if (!artifact) throw new Error(`${input.scope} run is missing ${cohortEntry.artifactId}`);
  return artifact;
}

function validateBaselineRevision(
  input: ReviewInput,
  config: ReviewDecisionConfig,
  cohortEntry: CohortEntry,
): void {
  if (input.scope !== "seed" && cohortEntry.source.revision !== config.baselineRevision) {
    throw new Error(
      `${input.scope} source revision does not match the decision baseline for ${cohortEntry.artifactId}`,
    );
  }
}

function recordInputEvidence(options: {
  config: ReviewDecisionConfig;
  input: ReviewInput;
  output: string;
  entries: unknown[];
  seedArtifactIds: string[];
  deletionRequests: Map<string, ReviewDecisionConfig["deletionRequests"][number]>;
  deletedArtifactIds: Set<string>;
  candidateIds: Set<string>;
}): void {
  const { config, input } = options;
  const cohort = FrozenCohortSchema.parse(readJson(input.cohortFile));
  const run = GectorProducerRunSchema.parse(readJson(input.runFile));
  if (run.cohortId !== cohort.cohortId) throw new Error(`${input.scope} run does not match cohort`);
  const artifacts = new Map(run.artifacts.map((artifact) => [artifact.artifactId, artifact]));
  const targetEntries = input.targetRoot
    ? new Map(CurrentContentManifestSchema.parse(
      readJson(path.join(input.targetRoot, "manifest.json")),
    ).entries.map((entry) => [entry.artifactId, entry]))
    : undefined;

  for (const cohortEntry of cohort.entries) {
    const artifact = runArtifact(input, artifacts, cohortEntry);
    validateBaselineRevision(input, config, cohortEntry);
    if (input.scope !== "seed" && artifact.proposals.length === 0) continue;
    const evidenceId = `${input.scope}-${cohortEntry.artifactId}`;
    options.candidateIds.add(evidenceId);
    if (options.deletedArtifactIds.has(evidenceId)) continue;
    if (input.scope === "seed") options.seedArtifactIds.push(evidenceId);
    const targetArtifactId = input.scope === "seed"
      ? cohortEntry.artifactId
      : config.targetRenames[cohortEntry.artifactId] ?? cohortEntry.artifactId;
    writeEvidenceArtifact({
      config,
      input,
      output: options.output,
      entries: options.entries,
      deletionRequests: options.deletionRequests,
      cohort,
      runId: run.runId,
      cohortEntry,
      artifact,
      targetEntries,
      targetArtifactId,
      evidenceId,
    });
  }
}

export function recordGectorDecisions(options: {
  configFile: string;
  inputs: ReviewInput[];
  output: string;
  outputRoot: string;
}): void {
  const config = ReviewDecisionConfigSchema.parse(readJson(options.configFile));
  resetDirectory(options.output, options.outputRoot);
  const entries: unknown[] = [];
  const seedArtifactIds: string[] = [];
  const deletionRequests = new Map(
    config.deletionRequests.map((request) => [request.artifactId, request]),
  );
  const deletedArtifactIds = new Set(
    config.deletedArtifacts.map(({ artifactId }) => artifactId),
  );
  const candidateIds = new Set<string>();

  for (const input of options.inputs) {
    recordInputEvidence({
      config,
      input,
      output: options.output,
      entries,
      seedArtifactIds,
      deletionRequests,
      deletedArtifactIds,
      candidateIds,
    });
  }
  const unmatchedDeletionIds = [...new Set([
    ...deletionRequests.keys(),
    ...deletedArtifactIds,
  ])]
    .filter((artifactId) => !candidateIds.has(artifactId))
    .sort((left, right) => left.localeCompare(right));
  if (unmatchedDeletionIds.length > 0) {
    throw new Error(
      `deletion entries match no evidence artifact: ${unmatchedDeletionIds.join(", ")}`,
    );
  }
  const manifestBody = {
    schemaVersion: 1,
    recordType: "writing-review-evidence-manifest",
    cohortId: `gector-broad-pilot:${config.baselineRevision}`,
    governance: config.governance,
    entries,
    deletions: config.deletedArtifacts,
  };
  writeJson(path.join(options.output, "manifest.json"), manifestBody);
  writeJson(path.join(options.output, "seed-outcomes.json"), {
    schemaVersion: 1,
    recordType: "writing-editor-seed-outcomes",
    cohortId: FrozenCohortSchema.parse(readJson(options.inputs[0]?.cohortFile ?? "")).cohortId,
    artifactIds: seedArtifactIds,
    evidenceManifestHash: sha256(canonicalJson(manifestBody)),
  });
}

function main(): void {
  const { values } = parseArgs({ options: {
    config: { type: "string" }, output: { type: "string" },
    "seed-cohort": { type: "string" }, "seed-corpus": { type: "string" }, "seed-run": { type: "string" },
    "customer-cohort": { type: "string" }, "customer-corpus": { type: "string" }, "customer-target": { type: "string" }, "customer-run": { type: "string" },
    "developer-cohort": { type: "string" }, "developer-corpus": { type: "string" }, "developer-target": { type: "string" }, "developer-run": { type: "string" },
  } });
  const args = CliOptionsSchema.parse(values);
  recordGectorDecisions({
    configFile: args.config,
    inputs: [
      { scope: "seed", cohortFile: args["seed-cohort"], corpusRoot: args["seed-corpus"], runFile: args["seed-run"] },
      { scope: "customer", cohortFile: args["customer-cohort"], corpusRoot: args["customer-corpus"], targetRoot: args["customer-target"], runFile: args["customer-run"] },
      { scope: "developer", cohortFile: args["developer-cohort"], corpusRoot: args["developer-corpus"], targetRoot: args["developer-target"], runFile: args["developer-run"] },
    ],
    output: args.output,
    outputRoot: path.resolve("."),
  });
  console.log(`Recorded governed GECToR decisions in ${args.output}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
