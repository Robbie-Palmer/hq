import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { createDecision } from "writing-editor-domain/decisions";
import { sha256 } from "writing-editor-domain/suggestions";

import { evaluatePunctuationCandidate } from "../src/evaluate-punctuation-candidate";
import {
  preparePunctuationModel,
  PunctuationModelManifestSchema,
  verifyPunctuationAsset,
} from "../src/prepare-punctuation-model";
import {
  PunctuationCandidateRunSchema,
  PunctuationExperimentSchema,
  runPunctuationCandidate,
} from "../src/run-punctuation-candidate";

const temporaryDirectories = new Set<string>();
const projectRoot = path.resolve(import.meta.dirname, "..");

afterEach(() => {
  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "punctuation-candidate-test-"));
  temporaryDirectories.add(directory);
  return directory;
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function createCandidateFixture() {
  const temporary = temporaryDirectory();
  const evidenceRoot = path.join(temporary, "evidence");
  const modelDirectory = path.join(temporary, "model");
  const source = "Hello world.\n";
  const revision = "a".repeat(40);
  const manifestFile = path.join(projectRoot, "punctuation-model-manifest.json");
  const experimentFile = path.join(temporary, "experiment.json");
  const experiment = JSON.parse(fs.readFileSync(
    path.join(projectRoot, "punctuation-experiment.json"),
    "utf8",
  ));
  experiment.sampleSize.eligibleDecisions = 1;
  experiment.sampleSize.minimumEligibleDecisions = 1;
  writeJson(experimentFile, experiment);
  const manifest = PunctuationModelManifestSchema.parse(
    JSON.parse(fs.readFileSync(manifestFile, "utf8")),
  );
  writeJson(path.join(evidenceRoot, "manifest.json"), {
    schemaVersion: 1,
    recordType: "writing-review-evidence-manifest",
    cohortId: "fixture:punctuation",
    governance: {
      dataClassification: "public",
      consentBasis: "Synthetic fixture",
      consentRecordedAt: "2026-10-25T00:00:00.000Z",
      retentionPolicy: "Delete after test",
      deletionStatus: "active",
    },
    entries: [{
      artifactId: "fixture-adr",
      artifactType: "adr",
      split: "holdout",
      recordsFile: "fixture/records.json",
      decisionsFile: "fixture/decisions.jsonl",
      receiptFile: "fixture/receipt.json",
      sourceBeforeFile: "fixture/source-before.md",
      sourceAfterFile: "fixture/source-after.md",
      provenance: {
        scope: "developer",
        sourceDatasetId: "fixture-dataset",
        sourceRevision: revision,
        producerRunId: `producer-run:v1:${"b".repeat(64)}`,
        reviewMethod: "synthetic fixture",
        reviewTiming: "not-measured",
      },
      quality: {
        factualPreservation: "not-assessed",
        terminologyPreservation: "not-assessed",
        voicePreservation: "not-assessed",
        regression: "not-assessed",
      },
    }],
    deletions: [],
  });
  fs.mkdirSync(path.join(evidenceRoot, "fixture"), { recursive: true });
  fs.writeFileSync(path.join(evidenceRoot, "fixture/source-before.md"), source);
  writeJson(path.join(evidenceRoot, "fixture/records.json"), {
    documentId: "docs/fixture.md",
    revision,
    findings: [],
    proposals: [],
  });
  const receiptFile = path.join(modelDirectory, "receipt.json");
  const receipt = {
    schemaVersion: 1,
    recordType: "punctuation-model-receipt",
    modelId: manifest.modelId,
    sourceRepository: manifest.source.repository,
    sourceRevision: manifest.source.revision,
    assets: manifest.assets.map(({ file, bytes, contentHash }) => ({
      file, bytes, contentHash,
    })),
    manifestContentHash: sha256(fs.readFileSync(manifestFile)),
  };
  writeJson(receiptFile, receipt);
  const rawFile = path.join(temporary, "raw.json");
  const raw = {
    schemaVersion: 1,
    recordType: "punctuation-restoration-raw-run",
    cohortId: "fixture:punctuation",
    model: {
      modelId: manifest.modelId,
      revision: manifest.source.revision,
      checkpointContentHash: manifest.assets[0]?.contentHash,
    },
    runtime: {
      pythonVersion: "3.14.7",
      torchVersion: "2.13.0+cu126",
      transformersVersion: "5.17.0",
      cudaVersion: "12.6",
      device: "cuda",
      gpuName: "Fixture GPU",
      computeCapability: "8.9",
      peakCudaAllocatedBytes: 1024,
    },
    parameters: {
      chunkTokens: 400,
      overlapTokens: 50,
      minimumCommaProbability: 0.9,
      dtype: "float16",
    },
    artifacts: [{
      artifactId: "fixture-adr",
      documentId: "docs/fixture.md",
      revision,
      contentHash: sha256(source),
      insertions: [{ byteOffset: 5, confidence: 0.97 }],
      inferenceMilliseconds: 4,
    }],
    summary: {
      artifacts: 1,
      insertions: 1,
      medianInferenceMillisecondsPerArtifact: 4,
    },
  };
  writeJson(rawFile, raw);
  const outputFile = path.join(temporary, "run.json");

  return {
    temporary,
    evidenceRoot,
    modelDirectory,
    source,
    revision,
    manifestFile,
    experimentFile,
    experiment,
    manifest,
    receiptFile,
    receipt,
    rawFile,
    raw,
    outputFile,
    runOptions: {
      evidenceRoot,
      manifestFile,
      experimentFile,
      modelDirectory,
      rawFile,
      outputFile,
    },
  };
}

describe("punctuation candidate", () => {
  it("pins a ModelPack-compatible checkpoint and a pre-registered experiment", () => {
    const manifest = PunctuationModelManifestSchema.parse(JSON.parse(fs.readFileSync(
      path.join(projectRoot, "punctuation-model-manifest.json"),
      "utf8",
    )));
    const experiment = PunctuationExperimentSchema.parse(JSON.parse(fs.readFileSync(
      path.join(projectRoot, "punctuation-experiment.json"),
      "utf8",
    )));

    expect(manifest.modelId).toBe("horizon-punctuation-restoration-small");
    expect(manifest.assets.map(({ file }) => file)).toEqual([
      "model.safetensors",
      "config.json",
      "tokenizer.json",
      "tokenizer_config.json",
      "special_tokens_map.json",
    ]);
    expect(experiment.failureClass).toBe("missing-comma");
    expect(experiment.sampleSize.eligibleDecisions).toBe(41);
    expect(experiment.parameters.minimumCommaProbability).toBe(0.9);
    expect(experiment.hardware.accelerator).toBe("NVIDIA GeForce RTX 4080 Laptop GPU");
  });

  it("prepares every pinned model asset through injected acquisition boundaries", async () => {
    const temporary = temporaryDirectory();
    const outputDirectory = path.join(temporary, "model");
    const manifestFile = path.join(projectRoot, "punctuation-model-manifest.json");
    const manifest = PunctuationModelManifestSchema.parse(JSON.parse(fs.readFileSync(
      manifestFile,
      "utf8",
    )));
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(path.join(outputDirectory, "config.json"), "existing");
    const downloads: string[] = [];
    const verified: string[] = [];

    const receipt = await preparePunctuationModel({
      manifestFile,
      outputDirectory,
      timeoutMs: 1234,
      download: async (url, partialFile, options) => {
        downloads.push(url.toString());
        expect(options.timeoutMs).toBe(1234);
        fs.writeFileSync(partialFile, "downloaded");
      },
      verifyAsset: async (file) => {
        verified.push(path.basename(file).replace(/\.partial$/u, ""));
      },
    });

    expect(downloads).toHaveLength(4);
    expect(verified.sort()).toEqual(manifest.assets.map(({ file }) => file).sort());
    expect(receipt.assets).toHaveLength(5);
    expect(JSON.parse(fs.readFileSync(path.join(outputDirectory, "receipt.json"), "utf8")))
      .toEqual(receipt);
  });

  it("rejects model assets whose size or digest differs from the manifest", async () => {
    const temporary = temporaryDirectory();
    const asset = path.join(temporary, "asset.bin");
    fs.writeFileSync(asset, "verified bytes");

    await expect(verifyPunctuationAsset(
      asset,
      fs.statSync(asset).size,
      sha256(fs.readFileSync(asset)),
    )).resolves.toBeUndefined();
    await expect(verifyPunctuationAsset(asset, 1, `sha256:${"0".repeat(64)}`))
      .rejects.toThrow("asset.bin does not match the pinned model manifest");
  });

  it("emits source-verified ADR 003 suggestions with immutable provenance", () => {
    const {
      temporary,
      evidenceRoot,
      source,
      revision,
      manifest,
      experimentFile,
      outputFile,
      runOptions,
    } = createCandidateFixture();

    const result = runPunctuationCandidate(runOptions);

    expect(PunctuationCandidateRunSchema.parse(result)).toEqual(result);
    expect(result.artifacts[0]?.suggestions[0]).toMatchObject({
      source: {
        documentId: "docs/fixture.md",
        revision,
        contentHash: sha256(source),
      },
      span: { startByte: 5, endByte: 5, sourceText: "" },
      replacement: ",",
      confidence: 0.97,
      producer: {
        id: "punctuation-restoration-small",
        provenance: {
          kind: "model",
          modelId: "horizon-punctuation-restoration-small",
          revision: manifest.source.revision,
        },
      },
    });

    const proposal = result.artifacts[0]?.proposals[0];
    if (!proposal) throw new Error("fixture candidate did not create a proposal");
    fs.writeFileSync(
      path.join(evidenceRoot, "fixture/decisions.jsonl"),
      `${JSON.stringify(createDecision(proposal, "accepted", {
        reviewStartedAt: "2026-10-25T00:00:00.000Z",
        decidedAt: "2026-10-25T00:01:00.000Z",
      }))}\n`,
    );
    const deterministicRoot = path.join(temporary, "deterministic");
    writeJson(path.join(deterministicRoot, "fixture/records.json"), { proposals: [] });

    const evaluation = evaluatePunctuationCandidate({
      evidenceRoot,
      deterministicEvidenceRoot: deterministicRoot,
      experimentFile,
      candidateFile: outputFile,
      outputFile: path.join(temporary, "evaluation.json"),
      reportFile: path.join(temporary, "report.md"),
    });

    expect(evaluation).toMatchObject({
      decision: "gather-more-evidence",
      sample: { eligibleDecisions: 1, accepted: 1, rejected: 0 },
      candidate: {
        matchedAccepted: 1,
        matchedRejected: 0,
        targetHardware: false,
        qualityPreservationAssessed: false,
      },
    });
  });

  it("rejects model, experiment, and source drift before creating proposals", () => {
    const {
      evidenceRoot,
      receiptFile,
      receipt,
      rawFile,
      raw,
      runOptions,
    } = createCandidateFixture();
    const expectRunFailure = (candidateRaw: unknown, message: string) => {
      writeJson(rawFile, candidateRaw);
      expect(() => runPunctuationCandidate(runOptions)).toThrow(message);
    };

    writeJson(receiptFile, {
      ...receipt,
      manifestContentHash: `sha256:${"0".repeat(64)}`,
    });
    expect(() => runPunctuationCandidate(runOptions)).toThrow(
      "model receipt does not belong to the pinned punctuation manifest",
    );

    writeJson(receiptFile, { ...receipt, assets: receipt.assets.slice(1) });
    expect(() => runPunctuationCandidate(runOptions)).toThrow(
      "model receipt assets do not match the pinned punctuation manifest",
    );
    writeJson(receiptFile, receipt);

    expectRunFailure(
      { ...raw, cohortId: "fixture:other" },
      "raw candidate run does not belong to the governed evidence cohort",
    );
    expectRunFailure(
      { ...raw, parameters: { ...raw.parameters, chunkTokens: 401 } },
      "raw candidate parameters do not match the pre-registered experiment",
    );
    expectRunFailure(
      { ...raw, artifacts: [] },
      "raw candidate run did not preserve every evidence artifact",
    );
    expectRunFailure(
      {
        ...raw,
        artifacts: raw.artifacts.map((artifact) => ({
          ...artifact,
          artifactId: "missing-adr",
        })),
      },
      "candidate input is missing fixture-adr",
    );
    expectRunFailure(
      {
        ...raw,
        artifacts: raw.artifacts.map((artifact) => ({
          ...artifact,
          revision: "c".repeat(40),
        })),
      },
      "fixture-adr raw candidate source is stale",
    );

    const sourceFile = path.join(evidenceRoot, "fixture/source-before.md");
    const unicodeSource = "Héllo world.\n";
    fs.writeFileSync(sourceFile, unicodeSource);
    expectRunFailure(
      {
        ...raw,
        artifacts: raw.artifacts.map((artifact) => ({
          ...artifact,
          contentHash: sha256(unicodeSource),
          insertions: [{ byteOffset: 2, confidence: 0.97 }],
        })),
      },
      "fixture-adr candidate insertion is not on a UTF-8 boundary",
    );

    const commaSource = "Hello, world.\n";
    fs.writeFileSync(sourceFile, commaSource);
    expectRunFailure(
      {
        ...raw,
        artifacts: raw.artifacts.map((artifact) => ({
          ...artifact,
          contentHash: sha256(commaSource),
          insertions: [{ byteOffset: 5, confidence: 0.97 }],
        })),
      },
      "fixture-adr candidate tried to insert an existing comma",
    );
  });

  it("rejects evaluation inputs outside the pre-registered cohort", () => {
    const {
      temporary,
      evidenceRoot,
      experimentFile,
      outputFile,
      runOptions,
    } = createCandidateFixture();
    const candidate = runPunctuationCandidate(runOptions);
    const evaluationOptions = {
      evidenceRoot,
      deterministicEvidenceRoot: path.join(temporary, "deterministic"),
      experimentFile,
      candidateFile: outputFile,
      outputFile: path.join(temporary, "evaluation.json"),
      reportFile: path.join(temporary, "report.md"),
    };

    writeJson(outputFile, { ...candidate, cohortId: "fixture:other" });
    expect(() => evaluatePunctuationCandidate(evaluationOptions)).toThrow(
      "candidate run does not belong to the governed decision cohort",
    );

    writeJson(outputFile, candidate);
    fs.writeFileSync(path.join(evidenceRoot, "fixture/decisions.jsonl"), "");
    expect(() => evaluatePunctuationCandidate(evaluationOptions)).toThrow(
      "pre-registered 1 eligible decisions, found 0",
    );
  });
});
