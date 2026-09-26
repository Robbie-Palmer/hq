import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { z } from "zod";
import { canonicalJson } from "writing-editor-domain/canonical-json";
import { createProposal, verifyProposalSource } from "writing-editor-domain/proposals";
import {
  compareSuggestions,
  createSuggestion,
  sha256,
  sourceReference,
  type Suggestion,
} from "writing-editor-domain/suggestions";

import {
  GectorModelManifestSchema,
  type GectorModelReceipt,
} from "./prepare-gector-model";
import { buildEditHunks } from "./match-edits";
import {
  readContainedText,
  readJson,
  resetDirectory,
  writeJson,
} from "./files";
import {
  FrozenCohortSchema,
  GectorProducerRunSchema,
  PipelineParamsSchema,
  type GectorProducerRun,
} from "./schemas";

const ADAPTER_REVISION = 1;

const RawRunSchema = z.object({
  schemaVersion: z.literal(1),
  recordType: z.literal("gector-raw-inference-run"),
  model: z.object({
    modelId: z.literal("gector-2024-roberta-large"),
    sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
    checkpointContentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  }).strict(),
  runtime: z.object({
    python_version: z.string(),
    torch_version: z.string(),
    transformers_version: z.string(),
    cuda_version: z.string(),
    device: z.literal("cuda"),
    compute_capability: z.string(),
  }).strict(),
  parameters: z.object({
    batch_size: z.number().int().positive(),
    iterations: z.number().int().positive(),
    max_tokens: z.number().int().positive(),
    min_tokens: z.number().int().positive(),
    min_error_probability: z.number().min(0).max(1),
    min_token_probability: z.number().min(0).max(1),
    additional_confidence: z.number().min(0).max(1),
  }).strict(),
  artifacts: z.array(z.object({
    artifactId: z.string(),
    generatedText: z.string(),
    correctedLines: z.array(z.number().int().positive()),
    iterationUpdates: z.number().int().nonnegative(),
  }).strict()).min(1),
}).strict();

const CliOptionsSchema = z.object({
  cohort: z.string().trim().min(1),
  corpus: z.string().trim().min(1),
  model: z.string().trim().min(1),
  manifest: z.string().trim().min(1),
  params: z.string().trim().min(1),
  raw: z.string().trim().min(1),
  output: z.string().trim().min(1),
  artifact: z.string().trim().min(1).optional(),
}).strict();

export interface RunGectorOptions {
  cohortFile: string;
  corpusRoot: string;
  modelDirectory: string;
  manifestFile: string;
  paramsFile: string;
  rawFile: string;
  outputDirectory: string;
  outputRoot: string;
  projectRoot: string;
  artifactId?: string;
}

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`${label} does not match the pinned pipeline input`);
  }
}

function lineAtByte(source: string, byte: number): number {
  const bytes = Buffer.from(source, "utf8");
  let line = 1;
  for (let index = 0; index < byte; index += 1) {
    if (bytes[index] === 0x0a) line += 1;
  }
  return line;
}

function groupSuggestionsByLine(source: string, suggestions: Suggestion[]): Suggestion[][] {
  const groups = new Map<number, Suggestion[]>();
  for (const suggestion of suggestions) {
    const line = lineAtByte(source, suggestion.span.startByte);
    const group = groups.get(line) ?? [];
    group.push(suggestion);
    groups.set(line, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, records]) => {
      records.sort(compareSuggestions);
      return records;
    });
}

function applySuggestions(source: string, suggestions: Suggestion[]): string {
  let result = Buffer.from(source, "utf8");
  for (const suggestion of [...suggestions].sort((left, right) =>
    right.span.startByte - left.span.startByte || right.span.endByte - left.span.endByte
  )) {
    result = Buffer.concat([
      result.subarray(0, suggestion.span.startByte),
      Buffer.from(suggestion.replacement, "utf8"),
      result.subarray(suggestion.span.endByte),
    ]);
  }
  return result.toString("utf8");
}

function modelReceipt(value: unknown): GectorModelReceipt {
  const parsed = z.object({
    schemaVersion: z.literal(1),
    recordType: z.literal("gector-model-receipt"),
    modelId: z.literal("gector-2024-roberta-large"),
    sourceRepository: z.url(),
    sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
    checkpoint: z.object({
      file: z.string(),
      bytes: z.number().int().positive(),
      contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    }),
    runtimeAssets: z.array(z.object({
      file: z.string(),
      bytes: z.number().int().positive(),
      contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      sourceRepository: z.url(),
      sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
    })),
    manifestContentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  }).strict().parse(value);
  return parsed;
}

function publishDirectory(
  stagingDirectory: string,
  outputDirectory: string,
  outputRoot: string,
): void {
  const backupDirectory = `${outputDirectory}.backup`;
  if (fs.existsSync(backupDirectory)) {
    if (!fs.existsSync(outputDirectory)) {
      fs.renameSync(backupDirectory, outputDirectory);
    } else {
      resetDirectory(backupDirectory, outputRoot);
      fs.rmdirSync(backupDirectory);
    }
  }
  const hadOutput = fs.existsSync(outputDirectory);
  if (hadOutput) fs.renameSync(outputDirectory, backupDirectory);
  try {
    fs.renameSync(stagingDirectory, outputDirectory);
  } catch (error) {
    if (hadOutput && !fs.existsSync(outputDirectory)) {
      fs.renameSync(backupDirectory, outputDirectory);
    }
    throw error;
  }
  if (hadOutput) fs.rmSync(backupDirectory, { recursive: true, force: true });
}

export function runGector(options: RunGectorOptions): GectorProducerRun {
  const cohort = FrozenCohortSchema.parse(readJson(options.cohortFile));
  const params = PipelineParamsSchema.parse(readJson(options.paramsFile));
  const manifest = GectorModelManifestSchema.parse(readJson(options.manifestFile));
  const receipt = modelReceipt(readJson(path.join(options.modelDirectory, "receipt.json")));
  const manifestContentHash = sha256(fs.readFileSync(options.manifestFile));
  if (receipt.manifestContentHash !== manifestContentHash) {
    throw new Error("model receipt does not belong to the pinned model manifest");
  }
  assertEqual("model receipt checkpoint", receipt.checkpoint, {
    file: manifest.checkpoint.filename,
    bytes: manifest.checkpoint.bytes,
    contentHash: manifest.checkpoint.contentHash,
  });
  assertEqual("model receipt runtime assets", receipt.runtimeAssets, manifest.runtimeAssets.map(
    (asset) => ({
      file: asset.filename,
      bytes: asset.bytes,
      contentHash: asset.contentHash,
      sourceRepository: asset.sourceRepository,
      sourceRevision: asset.sourceRevision,
    }),
  ));

  const entries = options.artifactId === undefined
    ? cohort.entries
    : cohort.entries.filter(({ artifactId }) => artifactId === options.artifactId);
  if (entries.length === 0) {
    throw new Error(`frozen cohort does not contain artifact ${options.artifactId}`);
  }

  const runtimeSource = path.join(options.projectRoot, "python/gector_runtime.py");
  {
    const raw = RawRunSchema.parse(readJson(options.rawFile));
    assertEqual("raw model identity", raw.model, {
      modelId: manifest.modelId,
      sourceRevision: manifest.source.revision,
      checkpointContentHash: manifest.checkpoint.contentHash,
    });
    assertEqual("raw inference parameters", raw.parameters, {
      batch_size: params.producers.gector.batchSize,
      iterations: params.producers.gector.iterations,
      max_tokens: params.producers.gector.maxTokens,
      min_tokens: params.producers.gector.minTokens,
      min_error_probability: params.producers.gector.minErrorProbability,
      min_token_probability: params.producers.gector.minTokenProbability,
      additional_confidence: params.producers.gector.additionalConfidence,
    });

    const rawById = new Map(raw.artifacts.map((artifact) => [artifact.artifactId, artifact]));
    if (rawById.size !== entries.length || entries.some(({ artifactId }) => !rawById.has(artifactId))) {
      throw new Error("raw inference did not preserve the requested artifact IDs");
    }

    const adapterSourceHash = sha256(fs.readFileSync(fileURLToPath(import.meta.url)));
    const runtimeLockHash = sha256(fs.readFileSync(path.join(options.projectRoot, "uv.lock")));
    const runtimeIdentityHash = sha256(canonicalJson({
      adapterRevision: ADAPTER_REVISION,
      adapterSourceHash,
      checkpointContentHash: manifest.checkpoint.contentHash,
      manifestContentHash,
      modelRevision: manifest.source.revision,
      params: params.producers.gector,
      pythonSourceHash: sha256(fs.readFileSync(runtimeSource)),
      runtimeLockHash,
    }));
    const producer = {
      id: "gector-2024",
      version: `gector-2024@${manifest.source.revision.slice(0, 12)}+runtime.${runtimeIdentityHash.slice("sha256:".length)}`,
      provenance: {
        kind: "model" as const,
        modelId: manifest.modelId,
        revision: manifest.source.revision,
      },
    };

    const stagingDirectory = `${options.outputDirectory}.staging`;
    resetDirectory(stagingDirectory, options.outputRoot);
    const artifacts = entries.map((entry) => {
      const rawArtifact = rawById.get(entry.artifactId);
      if (!rawArtifact) throw new Error(`raw inference is missing ${entry.artifactId}`);
      const source = readContainedText(
        options.corpusRoot,
        entry.source.file,
        `${entry.artifactId} source`,
      );
      const sourceRef = sourceReference(entry.path, entry.source.revision, source);
      if (sourceRef.contentHash !== entry.source.contentHash) {
        throw new Error(`${entry.artifactId} source hash does not match the frozen cohort`);
      }
      const hunks = buildEditHunks(
        source,
        rawArtifact.generatedText,
        params.matching.characterDiff.maxEditLength,
      );
      const correctedLines = [...new Set(
        hunks.map((hunk) => lineAtByte(source, hunk.source.startByte)),
      )].sort((left, right) => left - right);
      const suggestions = hunks.map((hunk) => createSuggestion({
        producer,
        source: sourceRef,
        span: {
          startByte: hunk.source.startByte,
          endByte: hunk.source.endByte,
          sourceText: hunk.source.text,
        },
        replacement: hunk.published.text,
        category: "grammar/gector-2024",
        reason: "GECToR-2024 changed this span in its generated revision.",
      })).sort(compareSuggestions);
      const proposals = groupSuggestionsByLine(source, suggestions).map((group) => {
        const proposal = createProposal(group);
        const verification = verifyProposalSource(proposal, source);
        if (!verification.ok) {
          throw new Error(
            `GECToR proposal ${proposal.proposalId} has stale source: ${JSON.stringify(verification.conflicts)}`,
          );
        }
        return proposal;
      });
      if (applySuggestions(source, suggestions) !== rawArtifact.generatedText) {
        throw new Error(`${entry.artifactId} suggestions do not reproduce the generated text`);
      }
      const generatedFile = `generated/${entry.artifactId}${path.extname(entry.source.file) || ".md"}`;
      fs.mkdirSync(path.join(stagingDirectory, "generated"), { recursive: true });
      fs.writeFileSync(
        path.join(stagingDirectory, generatedFile),
        rawArtifact.generatedText,
      );
      return {
        artifactId: entry.artifactId,
        artifactType: entry.artifactType,
        split: entry.split,
        source: sourceRef,
        generated: {
          file: generatedFile,
          contentHash: sha256(rawArtifact.generatedText),
          correctedLines,
          iterationUpdates: rawArtifact.iterationUpdates,
        },
        suggestionIds: suggestions.map(({ suggestionId }) => suggestionId),
        suggestions,
        proposalIds: proposals.map(({ proposalId }) => proposalId),
        proposals,
      };
    });

    const runtime = {
      pythonVersion: raw.runtime.python_version,
      torchVersion: raw.runtime.torch_version,
      transformersVersion: raw.runtime.transformers_version,
      cudaVersion: raw.runtime.cuda_version,
      device: raw.runtime.device,
      computeCapability: raw.runtime.compute_capability,
      lockContentHash: runtimeLockHash,
      adapterRevision: ADAPTER_REVISION,
    };
    const parameters = params.producers.gector;
    const summary = {
      artifacts: artifacts.length,
      artifactsWithSuggestions: artifacts.filter(({ suggestions }) => suggestions.length > 0).length,
      suggestions: artifacts.reduce((total, artifact) => total + artifact.suggestions.length, 0),
      proposals: artifacts.reduce((total, artifact) => total + artifact.proposals.length, 0),
    };
    const digest = sha256(canonicalJson({
      cohortId: cohort.cohortId,
      producer,
      model: {
        checkpointContentHash: manifest.checkpoint.contentHash,
        manifestContentHash,
      },
      parameters,
      artifacts: artifacts.map((artifact) => ({
        artifactId: artifact.artifactId,
        generatedContentHash: artifact.generated.contentHash,
        suggestionIds: artifact.suggestionIds,
        proposalIds: artifact.proposalIds,
      })),
    })).slice("sha256:".length);
    const result = GectorProducerRunSchema.parse({
      schemaVersion: 1,
      recordType: "writing-editor-gector-producer-run",
      runId: `producer-run:v1:${digest}`,
      cohortId: cohort.cohortId,
      producer,
      model: {
        checkpointContentHash: manifest.checkpoint.contentHash,
        manifestContentHash,
      },
      runtime,
      parameters,
      artifacts,
      summary,
    });
    writeJson(path.join(stagingDirectory, "run.json"), result);
    publishDirectory(stagingDirectory, options.outputDirectory, options.outputRoot);
    return result;
  }
}

function main(): void {
  const { values } = parseArgs({
    options: {
      cohort: { type: "string" },
      corpus: { type: "string" },
      model: { type: "string" },
      manifest: { type: "string" },
      params: { type: "string" },
      raw: { type: "string" },
      output: { type: "string" },
      artifact: { type: "string" },
    },
  });
  const args = CliOptionsSchema.parse(values);
  const result = runGector({
    cohortFile: args.cohort,
    corpusRoot: args.corpus,
    modelDirectory: args.model,
    manifestFile: args.manifest,
    paramsFile: args.params,
    rawFile: args.raw,
    outputDirectory: args.output,
    outputRoot: path.resolve("."),
    projectRoot: path.resolve("."),
    ...(args.artifact === undefined ? {} : { artifactId: args.artifact }),
  });
  process.stdout.write(
    `GECToR wrote ${result.summary.suggestions} suggestions in ${result.summary.proposals} proposals across ${result.summary.artifacts} artifacts\n`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
