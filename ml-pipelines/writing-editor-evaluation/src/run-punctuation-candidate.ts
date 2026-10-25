import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { canonicalJson } from "writing-editor-domain/canonical-json";
import {
  createProposal,
  ProposalSchema,
  verifyProposalSource,
} from "writing-editor-domain/proposals";
import {
  createSuggestion,
  sha256,
  sourceReference,
  SuggestionSchema,
} from "writing-editor-domain/suggestions";
import { z } from "zod";

import { ReviewEvidenceManifestSchema } from "./evaluate-reviews";
import { readJson, resolveContainedFile, writeJson } from "./files";
import { PunctuationModelManifestSchema } from "./prepare-punctuation-model";

const RawRunSchema = z.object({
  schemaVersion: z.literal(1),
  recordType: z.literal("punctuation-restoration-raw-run"),
  cohortId: z.string().min(1),
  model: z.object({
    modelId: z.literal("horizon-punctuation-restoration-small"),
    revision: z.literal("ee31fdfc5304f876ea3b0dd72d30eda7e940b2b1"),
    checkpointContentHash: z.literal(
      "sha256:85f724b61415c131afa1eb308bafefa99799221b1fbade5e59568e55b3dc6e48",
    ),
  }).strict(),
  runtime: z.object({
    pythonVersion: z.string().min(1),
    torchVersion: z.string().min(1),
    transformersVersion: z.string().min(1),
    cudaVersion: z.string().min(1),
    device: z.literal("cuda"),
    gpuName: z.string().min(1),
    computeCapability: z.string().regex(/^\d+\.\d+$/),
    peakCudaAllocatedBytes: z.number().int().positive(),
  }).strict(),
  parameters: z.object({
    chunkTokens: z.number().int().positive(),
    overlapTokens: z.number().int().nonnegative(),
    minimumCommaProbability: z.number().min(0).max(1),
    dtype: z.literal("float16"),
  }).strict(),
  artifacts: z.array(z.object({
    artifactId: z.string(),
    documentId: z.string(),
    revision: z.string(),
    contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    insertions: z.array(z.object({
      byteOffset: z.number().int().nonnegative(),
      confidence: z.number().min(0).max(1),
    }).strict()),
    inferenceMilliseconds: z.number().nonnegative(),
  }).strict()),
  summary: z.object({
    artifacts: z.number().int().positive(),
    insertions: z.number().int().nonnegative(),
    medianInferenceMillisecondsPerArtifact: z.number().nonnegative(),
  }).strict(),
}).strict();

export const PunctuationExperimentSchema = z.object({
  schemaVersion: z.literal(1),
  failureClass: z.literal("missing-comma"),
  targetBehavior: z.string().min(1),
  excludedEdits: z.array(z.string().min(1)).min(1),
  parameters: RawRunSchema.shape.parameters,
  hardware: z.object({
    targetHost: z.literal("vector-development"),
    accelerator: z.literal("NVIDIA GeForce RTX 4080 Laptop GPU"),
    maximumPeakCudaAllocatedBytes: z.number().int().positive(),
    maximumMedianInferenceMillisecondsPerArtifact: z.number().positive(),
  }).strict(),
  sampleSize: z.object({
    source: z.literal("gector-broad-pilot"),
    eligibleDecisions: z.number().int().positive(),
    minimumEligibleDecisions: z.number().int().positive(),
    rule: z.string().min(1),
  }).strict(),
  primaryMetrics: z.array(z.string()).min(1),
  decisionThresholds: z.object({
    adopt: z.object({
      minimumUsefulYield: z.number().min(0).max(1),
      minimumAcceptedSiteRecall: z.number().min(0).max(1),
      maximumUnassessedProposalsPerArtifact: z.number().nonnegative(),
      requireQualityPreservation: z.boolean(),
    }).strict(),
    reject: z.object({
      maximumUsefulYield: z.number().min(0).max(1),
      maximumAcceptedSiteRecall: z.number().min(0).max(1),
    }).strict(),
    otherwise: z.literal("gather-more-evidence"),
  }).strict(),
}).strict();

const CandidateArtifactSchema = z.object({
  artifactId: z.string(),
  artifactType: z.enum(["adr", "project-page"]),
  split: z.enum(["train", "validation", "holdout"]),
  source: z.object({
    documentId: z.string(),
    revision: z.string(),
    contentHash: z.string(),
  }).strict(),
  suggestionIds: z.array(z.string()),
  suggestions: z.array(SuggestionSchema),
  proposalIds: z.array(z.string()),
  proposals: z.array(ProposalSchema),
  inferenceMilliseconds: z.number().nonnegative(),
}).strict();

export const PunctuationCandidateRunSchema = z.object({
  schemaVersion: z.literal(1),
  recordType: z.literal("writing-editor-punctuation-producer-run"),
  runId: z.string().regex(/^producer-run:v1:[a-f0-9]{64}$/),
  cohortId: z.string().min(1),
  producer: z.object({
    id: z.literal("punctuation-restoration-small"),
    version: z.string().min(1),
    provenance: z.object({
      kind: z.literal("model"),
      modelId: z.literal("horizon-punctuation-restoration-small"),
      revision: z.literal("ee31fdfc5304f876ea3b0dd72d30eda7e940b2b1"),
    }).strict(),
  }).strict(),
  model: z.object({
    checkpointContentHash: z.string(),
    manifestContentHash: z.string(),
  }).strict(),
  experimentContentHash: z.string(),
  runtime: RawRunSchema.shape.runtime,
  parameters: RawRunSchema.shape.parameters,
  artifacts: z.array(CandidateArtifactSchema),
  summary: z.object({
    artifacts: z.number().int().positive(),
    artifactsWithSuggestions: z.number().int().nonnegative(),
    suggestions: z.number().int().nonnegative(),
    proposals: z.number().int().nonnegative(),
    medianInferenceMillisecondsPerArtifact: z.number().nonnegative(),
  }).strict(),
}).strict();

export type PunctuationCandidateRun = z.infer<typeof PunctuationCandidateRunSchema>;

const ReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  recordType: z.literal("punctuation-model-receipt"),
  modelId: z.literal("horizon-punctuation-restoration-small"),
  sourceRepository: z.url(),
  sourceRevision: z.string(),
  assets: z.array(z.object({
    file: z.string(), bytes: z.number(), contentHash: z.string(),
  }).strict()),
  manifestContentHash: z.string(),
}).strict();

const RecordsSourceSchema = z.looseObject({
  documentId: z.string(),
  revision: z.string(),
});

export function runPunctuationCandidate(options: {
  evidenceRoot: string;
  manifestFile: string;
  experimentFile: string;
  modelDirectory: string;
  rawFile: string;
  outputFile: string;
}): PunctuationCandidateRun {
  const evidence = ReviewEvidenceManifestSchema.parse(
    readJson(path.join(options.evidenceRoot, "manifest.json")),
  );
  const manifest = PunctuationModelManifestSchema.parse(readJson(options.manifestFile));
  const experiment = PunctuationExperimentSchema.parse(readJson(options.experimentFile));
  const raw = RawRunSchema.parse(readJson(options.rawFile));
  const receipt = ReceiptSchema.parse(readJson(path.join(options.modelDirectory, "receipt.json")));
  const manifestHash = sha256(fs.readFileSync(options.manifestFile));
  if (receipt.manifestContentHash !== manifestHash) {
    throw new Error("model receipt does not belong to the pinned punctuation manifest");
  }
  const expectedAssets = manifest.assets.map(({ file, bytes, contentHash }) => ({
    file, bytes, contentHash,
  }));
  if (canonicalJson(receipt.assets) !== canonicalJson(expectedAssets)) {
    throw new Error("model receipt assets do not match the pinned punctuation manifest");
  }
  if (raw.cohortId !== evidence.cohortId) {
    throw new Error("raw candidate run does not belong to the governed evidence cohort");
  }
  if (canonicalJson(raw.parameters) !== canonicalJson(experiment.parameters)) {
    throw new Error("raw candidate parameters do not match the pre-registered experiment");
  }
  const rawByArtifact = new Map(raw.artifacts.map((artifact) => [artifact.artifactId, artifact]));
  if (rawByArtifact.size !== evidence.entries.length) {
    throw new Error("raw candidate run did not preserve every evidence artifact");
  }

  const runtimeIdentity = sha256(canonicalJson({
    manifestHash,
    experimentHash: sha256(fs.readFileSync(options.experimentFile)),
    adapterHash: sha256(fs.readFileSync(fileURLToPath(import.meta.url))),
    runtimeHash: sha256(fs.readFileSync(path.join(path.dirname(options.manifestFile), "python/punctuation_runtime.py"))),
    runtime: raw.runtime,
  }));
  const producer = {
    id: "punctuation-restoration-small" as const,
    version: `punctuation-restoration-small@${manifest.source.revision.slice(0, 12)}+runtime.${runtimeIdentity.slice("sha256:".length)}`,
    provenance: {
      kind: "model" as const,
      modelId: "horizon-punctuation-restoration-small" as const,
      revision: manifest.source.revision,
    },
  };

  const artifacts = evidence.entries.map((entry) => {
    const rawArtifact = rawByArtifact.get(entry.artifactId);
    if (!rawArtifact || !entry.sourceBeforeFile) {
      throw new Error(`candidate input is missing ${entry.artifactId}`);
    }
    const sourceFile = resolveContainedFile(
      options.evidenceRoot,
      entry.sourceBeforeFile,
      `${entry.artifactId} source before`,
    );
    const source = fs.readFileSync(sourceFile, "utf8");
    const records = RecordsSourceSchema.parse(readJson(
      resolveContainedFile(
        options.evidenceRoot,
        entry.recordsFile,
        `${entry.artifactId} records`,
      ),
    ));
    const sourceRef = sourceReference(records.documentId, records.revision, source);
    if (
      rawArtifact.documentId !== sourceRef.documentId ||
      rawArtifact.revision !== sourceRef.revision ||
      rawArtifact.contentHash !== sourceRef.contentHash
    ) {
      throw new Error(`${entry.artifactId} raw candidate source is stale`);
    }
    const bytes = Buffer.from(source, "utf8");
    const suggestions = rawArtifact.insertions.map(({ byteOffset, confidence }) => {
      const nextByte = bytes[byteOffset];
      if (byteOffset > bytes.byteLength || (nextByte !== undefined && (nextByte & 0xc0) === 0x80)) {
        throw new Error(`${entry.artifactId} candidate insertion is not on a UTF-8 boundary`);
      }
      if (bytes[byteOffset] === 0x2c) {
        throw new Error(`${entry.artifactId} candidate tried to insert an existing comma`);
      }
      return createSuggestion({
        producer,
        source: sourceRef,
        span: { startByte: byteOffset, endByte: byteOffset, sourceText: "" },
        replacement: ",",
        category: "grammar/missing-comma",
        reason: "The pinned punctuation model assigned the comma label at this prose boundary.",
        confidence,
      });
    });
    const proposals = suggestions.map((suggestion) => {
      const proposal = createProposal([suggestion]);
      const verification = verifyProposalSource(proposal, source);
      if (!verification.ok) {
        throw new Error(`${entry.artifactId} candidate proposal has stale source`);
      }
      return proposal;
    });
    return {
      artifactId: entry.artifactId,
      artifactType: entry.artifactType,
      split: entry.split,
      source: sourceRef,
      suggestionIds: suggestions.map(({ suggestionId }) => suggestionId),
      suggestions,
      proposalIds: proposals.map(({ proposalId }) => proposalId),
      proposals,
      inferenceMilliseconds: rawArtifact.inferenceMilliseconds,
    };
  });

  const summary = {
    artifacts: artifacts.length,
    artifactsWithSuggestions: artifacts.filter(({ suggestions }) => suggestions.length > 0).length,
    suggestions: artifacts.reduce((sum, artifact) => sum + artifact.suggestions.length, 0),
    proposals: artifacts.reduce((sum, artifact) => sum + artifact.proposals.length, 0),
    medianInferenceMillisecondsPerArtifact: raw.summary.medianInferenceMillisecondsPerArtifact,
  };
  const experimentContentHash = sha256(fs.readFileSync(options.experimentFile));
  const runDigest = sha256(canonicalJson({
    cohortId: evidence.cohortId,
    producer,
    model: { checkpointContentHash: raw.model.checkpointContentHash, manifestContentHash: manifestHash },
    experimentContentHash,
    parameters: raw.parameters,
    artifacts: artifacts.map((artifact) => ({
      artifactId: artifact.artifactId,
      suggestionIds: artifact.suggestionIds,
      proposalIds: artifact.proposalIds,
    })),
  })).slice("sha256:".length);
  const result = PunctuationCandidateRunSchema.parse({
    schemaVersion: 1,
    recordType: "writing-editor-punctuation-producer-run",
    runId: `producer-run:v1:${runDigest}`,
    cohortId: evidence.cohortId,
    producer,
    model: { checkpointContentHash: raw.model.checkpointContentHash, manifestContentHash: manifestHash },
    experimentContentHash,
    runtime: raw.runtime,
    parameters: raw.parameters,
    artifacts,
    summary,
  });
  writeJson(options.outputFile, result);
  return result;
}

function main(): void {
  const { values } = parseArgs({ options: {
    evidence: { type: "string" },
    manifest: { type: "string" },
    experiment: { type: "string" },
    model: { type: "string" },
    raw: { type: "string" },
    output: { type: "string" },
  } });
  const args = z.object({
    evidence: z.string(), manifest: z.string(), experiment: z.string(),
    model: z.string(), raw: z.string(), output: z.string(),
  }).parse(values);
  const result = runPunctuationCandidate({
    evidenceRoot: args.evidence,
    manifestFile: args.manifest,
    experimentFile: args.experiment,
    modelDirectory: args.model,
    rawFile: args.raw,
    outputFile: args.output,
  });
  process.stdout.write(
    `Punctuation candidate wrote ${result.summary.proposals} ADR 003 proposals across ${result.summary.artifacts} artifacts\n`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
