import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { sha256 } from "writing-editor-domain/suggestions";

import { runGector } from "../src/run-gector";
import { GectorProducerRunSchema } from "../src/schemas";
import { GectorModelManifestSchema } from "../src/prepare-gector-model";

const temporaryDirectories = new Set<string>();
const projectRoot = path.resolve(import.meta.dirname, "..");

afterEach(() => {
  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gector-producer-test-"));
  temporaryDirectories.add(directory);
  return directory;
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

describe("GECToR producer", () => {
  it("preserves artifact and source provenance in ADR 003 suggestions and proposals", () => {
    const temporary = temporaryDirectory();
    const corpusRoot = path.join(temporary, "corpus");
    const sourceFile = "artifacts/example/source.md";
    const source = "Café are useful.\n";
    fs.mkdirSync(path.join(corpusRoot, "artifacts/example"), { recursive: true });
    fs.writeFileSync(path.join(corpusRoot, sourceFile), source);

    const revision = "a".repeat(40);
    const cohortFile = path.join(temporary, "cohort.json");
    writeJson(cohortFile, {
      schemaVersion: 1,
      recordType: "writing-editor-frozen-cohort",
      cohortId: `cohort:v1:${"b".repeat(64)}`,
      datasetId: `dataset:v1:${"c".repeat(64)}`,
      frozenAt: "2026-09-09T00:00:00Z",
      seed: "fixture",
      splitRatios: { train: 0.6, validation: 0.2, holdout: 0.2 },
      entries: [{
        artifactId: "example",
        artifactType: "adr",
        path: "docs/example.md",
        outcomeStatus: "unrecorded",
        split: "train",
        source: {
          revision,
          committedAt: "2026-09-08T00:00:00Z",
          contentHash: sha256(source),
          bytes: Buffer.byteLength(source),
          file: sourceFile,
        },
        published: {
          revision: "d".repeat(40),
          committedAt: "2026-09-09T00:00:00Z",
          contentHash: `sha256:${"e".repeat(64)}`,
          bytes: 1,
          file: "artifacts/example/published.md",
        },
      }],
    });

    const paramsFile = path.join(temporary, "params.json");
    const gectorParams = {
      batchSize: 8,
      iterations: 5,
      maxTokens: 50,
      minTokens: 3,
      minErrorProbability: 0.65,
      minTokenProbability: 0,
      additionalConfidence: 0.1,
    };
    writeJson(paramsFile, {
      cohort: {
        frozenAt: "2026-09-09T00:00:00Z",
        seed: "fixture",
        split: { train: 0.6, validation: 0.2, holdout: 0.2 },
        requiredArtifactTypes: ["adr"],
      },
      producers: {
        gector: gectorParams,
        vale: { binaryVersion: "3.20.0", timeoutMs: 1_000 },
      },
      matching: { characterDiff: { maxEditLength: 1_000 } },
    });

    const manifestFile = path.join(temporary, "model-manifest.json");
    fs.copyFileSync(path.join(projectRoot, "model-manifest.json"), manifestFile);
    const manifest = GectorModelManifestSchema.parse(
      JSON.parse(fs.readFileSync(manifestFile, "utf8")),
    );
    const checkpoint = manifest.checkpoint;
    const manifestHash = sha256(fs.readFileSync(manifestFile));
    const modelDirectory = path.join(temporary, "model");
    writeJson(path.join(modelDirectory, "receipt.json"), {
      schemaVersion: 1,
      recordType: "gector-model-receipt",
      modelId: manifest.modelId,
      sourceRepository: manifest.source.repository,
      sourceRevision: manifest.source.revision,
      checkpoint: {
        file: checkpoint.filename,
        bytes: checkpoint.bytes,
        contentHash: checkpoint.contentHash,
      },
      runtimeAssets: manifest.runtimeAssets.map((runtimeAsset) => ({
        file: runtimeAsset.filename,
        bytes: runtimeAsset.bytes,
        contentHash: runtimeAsset.contentHash,
        sourceRepository: runtimeAsset.sourceRepository,
        sourceRevision: runtimeAsset.sourceRevision,
      })),
      manifestContentHash: manifestHash,
    });

    const rawFile = path.join(temporary, "raw.json");
    writeJson(rawFile, {
      schemaVersion: 1,
      recordType: "gector-raw-inference-run",
      model: {
        modelId: manifest.modelId,
        sourceRevision: manifest.source.revision,
        checkpointContentHash: checkpoint.contentHash,
      },
      runtime: {
        python_version: "3.12.12",
        torch_version: "2.11.0+cu128",
        transformers_version: "5.17.0",
        cuda_version: "12.8",
        device: "cuda",
        compute_capability: "8.9",
      },
      parameters: {
        batch_size: gectorParams.batchSize,
        iterations: gectorParams.iterations,
        max_tokens: gectorParams.maxTokens,
        min_tokens: gectorParams.minTokens,
        min_error_probability: gectorParams.minErrorProbability,
        min_token_probability: gectorParams.minTokenProbability,
        additional_confidence: gectorParams.additionalConfidence,
      },
      artifacts: [{
        artifactId: "example",
        generatedText: "Café is useful.\n",
        correctedLines: [1],
        iterationUpdates: 1,
      }],
    });

    const outputDirectory = path.join(temporary, "outputs/gector");
    const options = {
      cohortFile,
      corpusRoot,
      modelDirectory,
      manifestFile,
      paramsFile,
      rawFile,
      outputDirectory,
      outputRoot: temporary,
      projectRoot,
    };
    const result = runGector(options);

    expect(GectorProducerRunSchema.parse(result)).toEqual(result);
    expect(result.artifacts[0]?.artifactId).toBe("example");
    expect(result.artifacts[0]?.source).toEqual({
      documentId: "docs/example.md",
      revision,
      contentHash: sha256(source),
    });
    expect(result.artifacts[0]?.suggestions).toHaveLength(1);
    expect(result.artifacts[0]?.suggestions[0]).toMatchObject({
      producer: {
        id: "gector-2024",
        provenance: {
          kind: "model",
          modelId: "gector-2024-roberta-large",
          revision: manifest.source.revision,
        },
      },
      span: { sourceText: "are" },
      replacement: "is",
    });
    expect(result.artifacts[0]?.proposals[0]?.suggestionIds).toEqual(
      result.artifacts[0]?.suggestionIds,
    );
    expect(fs.readFileSync(path.join(outputDirectory, "generated/example.md"), "utf8"))
      .toBe("Café is useful.\n");

    expect(runGector(options).runId).toBe(result.runId);
    fs.mkdirSync(`${outputDirectory}.backup`);
    fs.writeFileSync(path.join(`${outputDirectory}.backup`, "stale"), "stale");
    expect(runGector(options).runId).toBe(result.runId);
    fs.renameSync(outputDirectory, `${outputDirectory}.backup`);
    expect(runGector(options).runId).toBe(result.runId);
    const publishedRun = fs.readFileSync(path.join(outputDirectory, "run.json"), "utf8");
    fs.writeFileSync(path.join(corpusRoot, sourceFile), "Changed source.\n");
    expect(() => runGector(options)).toThrow("source hash does not match the frozen cohort");
    expect(fs.readFileSync(path.join(outputDirectory, "run.json"), "utf8")).toBe(publishedRun);

    const repeatedLine = structuredClone(result);
    repeatedLine.artifacts[0]!.generated.correctedLines = [1, 1];
    expect(GectorProducerRunSchema.safeParse(repeatedLine).success).toBe(false);

    const missingSuggestionId = structuredClone(result);
    missingSuggestionId.artifacts[0]!.suggestionIds = [];
    expect(GectorProducerRunSchema.safeParse(missingSuggestionId).success).toBe(false);

    const missingProposalId = structuredClone(result);
    missingProposalId.artifacts[0]!.proposalIds = [];
    expect(GectorProducerRunSchema.safeParse(missingProposalId).success).toBe(false);

    const wrongSummary = structuredClone(result);
    wrongSummary.summary.suggestions += 1;
    expect(GectorProducerRunSchema.safeParse(wrongSummary).success).toBe(false);
  });
});
