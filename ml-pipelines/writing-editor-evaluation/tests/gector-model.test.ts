import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  type CheckpointDownloader,
  type CurlRunner,
  downloadCheckpoint,
  GectorModelManifestSchema,
  prepareGectorModel,
} from "../src/prepare-gector-model";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gector-model-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function sha256(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

interface TestArtifact {
  url: string;
  filename: string;
  bytes: number;
  contentHash: string;
  sourceRepository: string;
  sourceRevision: string;
  mediaType: string;
}

const RuntimeAssetFilenames = [
  "roberta-large/config.json",
  "roberta-large/merges.txt",
  "roberta-large/tokenizer.json",
  "roberta-large/tokenizer_config.json",
  "roberta-large/vocab.json",
  "vocabulary/labels.txt",
  "vocabulary/d_tags.txt",
  "vocabulary/non_padded_namespaces.txt",
  "verb-form-vocab.txt",
] as const;

function runtimeArtifacts(payload: Buffer): TestArtifact[] {
  return RuntimeAssetFilenames.map((filename) => ({
    sourceRepository: "https://example.invalid/runtime",
    sourceRevision: "a".repeat(40),
    url: `https://example.invalid/${filename}`,
    filename,
    bytes: payload.length,
    contentHash: sha256(payload),
    mediaType: "application/vnd.cncf.model.weight.config.v1.raw",
  }));
}

function modelManifest(checkpoint: TestArtifact, runtimeAssets: TestArtifact[]) {
  const artifacts = [checkpoint, ...runtimeAssets];
  const config = Buffer.from(JSON.stringify({
    descriptor: {
      family: "gector",
      name: "gector-2024-roberta-large",
      title: "GECToR test model",
      description: "Test model",
      docURL: checkpoint.sourceRepository,
      sourceURL: checkpoint.sourceRepository,
      revision: checkpoint.sourceRevision,
    },
    config: {
      architecture: "transformer",
      format: "pytorch",
      capabilities: { inputTypes: ["text"], outputTypes: ["text"] },
    },
    modelfs: { type: "layers", diffIds: artifacts.map(({ contentHash }) => contentHash) },
  }));
  const descriptor = (artifact: TestArtifact) => ({
    mediaType: artifact.mediaType,
    digest: artifact.contentHash,
    size: artifact.bytes,
    urls: [artifact.url],
    annotations: {
      "org.cncf.model.filepath": artifact.filename,
      "org.opencontainers.image.title": artifact.filename,
      "org.opencontainers.image.source": artifact.sourceRepository,
      "org.opencontainers.image.revision": artifact.sourceRevision,
    },
  });
  return {
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    artifactType: "application/vnd.cncf.model.manifest.v1+json",
    config: {
      mediaType: "application/vnd.cncf.model.config.v1+json",
      digest: sha256(config),
      size: config.byteLength,
      data: config.toString("base64"),
      annotations: { "org.opencontainers.image.title": "gector-model-config.json" },
    },
    layers: artifacts.map(descriptor),
    annotations: {
      "org.opencontainers.image.title": "GECToR test model",
      "org.opencontainers.image.source": checkpoint.sourceRepository,
      "org.opencontainers.image.revision": checkpoint.sourceRevision,
      "me.robbiepalmer.gector.checkpoint-license": "not-stated-by-upstream",
      "me.robbiepalmer.gector.usage": "evaluation-only",
      "me.robbiepalmer.modelpack.spec-version": "v0.0.7",
    },
  };
}

function writeManifest(directory: string, payload: Buffer): string {
  const file = path.join(directory, "model-manifest.json");
  fs.writeFileSync(file, `${JSON.stringify(modelManifest(
    {
      url: "https://example.invalid/checkpoint.th",
      filename: "gector-2024-roberta-large.th",
      bytes: payload.length,
      contentHash: sha256(payload),
      sourceRepository: "https://github.com/grammarly/pillars-of-gec",
      sourceRevision: "1014de0bc90faddba0032acb5dec762c6c85d2e1",
      mediaType: "application/vnd.cncf.model.weight.v1.raw",
    },
    runtimeArtifacts(payload),
  ), null, 2)}\n`);
  return file;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("GECToR model preparation", () => {
  test("uses ModelPack-compatible metadata for the pinned model", () => {
    const manifest = GectorModelManifestSchema.parse(
      JSON.parse(fs.readFileSync("model-manifest.json", "utf8")),
    );

    expect(manifest.modelPack).toMatchObject({
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      artifactType: "application/vnd.cncf.model.manifest.v1+json",
    });
    expect(manifest.modelPack.layers.every(({ digest, mediaType, size }) =>
      digest.startsWith("sha256:") && mediaType.length > 0 && size > 0
    )).toBe(true);
    expect(manifest.source).toEqual({
      repository: "https://github.com/grammarly/pillars-of-gec",
      revision: "1014de0bc90faddba0032acb5dec762c6c85d2e1",
    });
    expect(manifest.checkpoint).toMatchObject({
      bytes: 1_442_177_179,
      contentHash: "sha256:77e1c9e0d7ad5507c16509fd765283dbce5221552aa7a90c37d143f1aeaddb10",
    });
    expect(manifest.runtimeAssets).toHaveLength(9);
    expect(new Set(manifest.runtimeAssets.map(({ sourceRevision }) => sourceRevision))).toEqual(
      new Set([
        "722cf37b1afa9454edce342e7895e588b6ff1d59",
        "9f699f274dfab524185c27e11fc2cc70f07045f0",
      ]),
    );
  });

  test("rejects an OCI manifest whose embedded config does not match its descriptor", () => {
    const payload = Buffer.from("fixture");
    const manifest = modelManifest({
      url: "https://example.invalid/checkpoint.th",
      filename: "checkpoint.th",
      bytes: payload.length,
      contentHash: sha256(payload),
      sourceRepository: "https://github.com/grammarly/pillars-of-gec",
      sourceRevision: "1014de0bc90faddba0032acb5dec762c6c85d2e1",
      mediaType: "application/vnd.cncf.model.weight.v1.raw",
    }, []);
    manifest.config.digest = `sha256:${"0".repeat(64)}`;

    expect(() => GectorModelManifestSchema.parse(manifest))
      .toThrow("embedded config digest does not match descriptor");
  });

  test("rejects checkpoint provenance that differs from the model config", () => {
    const manifest = JSON.parse(fs.readFileSync("model-manifest.json", "utf8"));
    manifest.layers[0]!.annotations["org.opencontainers.image.revision"] = "a".repeat(40);

    expect(() => GectorModelManifestSchema.parse(manifest))
      .toThrow("checkpoint provenance does not match model config");
  });

  test("rejects ModelPack diff IDs that differ from the declared layers", () => {
    const payload = Buffer.from("fixture");
    const manifest = modelManifest({
      url: "https://example.invalid/checkpoint.th",
      filename: "checkpoint.th",
      bytes: payload.length,
      contentHash: sha256(payload),
      sourceRepository: "https://github.com/grammarly/pillars-of-gec",
      sourceRevision: "1014de0bc90faddba0032acb5dec762c6c85d2e1",
      mediaType: "application/vnd.cncf.model.weight.v1.raw",
    }, []);
    manifest.layers[0]!.digest = `sha256:${"0".repeat(64)}`;

    expect(() => GectorModelManifestSchema.parse(manifest))
      .toThrow("ModelPack diff IDs do not match layers");
  });

  test("rejects layers that do not match the locked runtime asset layout", () => {
    const manifest = JSON.parse(fs.readFileSync("model-manifest.json", "utf8"));
    manifest.layers[0].annotations["org.cncf.model.filepath"] = "renamed-checkpoint.th";

    expect(() => GectorModelManifestSchema.parse(manifest))
      .toThrow("ModelPack layers do not match the locked GECToR runtime layout");
  });

  test("resumes, verifies, and records the declared checkpoint", async () => {
    const payload = Buffer.from("official-checkpoint-fixture");
    const directory = temporaryDirectory();
    const manifestFile = writeManifest(directory, payload);
    const outputDirectory = path.join(directory, "model");
    const partialFile = path.join(outputDirectory, "gector-2024-roberta-large.th.partial");
    fs.mkdirSync(outputDirectory);
    fs.writeFileSync(partialFile, payload.subarray(0, 8));

    const download: CheckpointDownloader = async (url, target, options) => {
      expect(options.expectedBytes).toBe(payload.length);
      expect(url.hostname).toBe("example.invalid");
      const offset = fs.existsSync(target) ? fs.statSync(target).size : 0;
      fs.appendFileSync(target, payload.subarray(offset));
    };
    const receipt = await prepareGectorModel({
      manifestFile,
      outputDirectory,
      download,
    });

    expect(fs.readFileSync(path.join(outputDirectory, "gector-2024-roberta-large.th")))
      .toEqual(payload);
    expect(fs.existsSync(partialFile)).toBe(false);
    expect(receipt.checkpoint).toEqual({
      file: "gector-2024-roberta-large.th",
      bytes: payload.length,
      contentHash: sha256(payload),
    });
    expect(receipt.runtimeAssets.map(({ file }) => file)).toEqual(RuntimeAssetFilenames);
    expect(JSON.parse(fs.readFileSync(path.join(outputDirectory, "receipt.json"), "utf8")))
      .toEqual(receipt);
  });

  test("uses hardened curl options while preserving a partial download", async () => {
    const payload = Buffer.from("official-checkpoint-fixture");
    const directory = temporaryDirectory();
    const partialFile = path.join(directory, "checkpoint.th.partial");
    fs.writeFileSync(partialFile, payload.subarray(0, 8));
    const runCurl: CurlRunner = vi.fn((_binary, arguments_) => {
      expect(arguments_).toContain("=https");
      expect(arguments_).toContain("--continue-at");
      expect(arguments_).toContain("--retry-all-errors");
      expect(arguments_).toContain("60");
      fs.appendFileSync(partialFile, payload.subarray(8));
    });

    await downloadCheckpoint(
      new URL("https://example.invalid/checkpoint.th"),
      partialFile,
      { expectedBytes: payload.length, timeoutMs: 60_000 },
      runCurl,
    );

    expect(runCurl).toHaveBeenCalledOnce();
    expect(fs.readFileSync(partialFile)).toEqual(payload);
  });

  test("does not download a complete partial file", async () => {
    const payload = Buffer.from("official-checkpoint-fixture");
    const directory = temporaryDirectory();
    const partialFile = path.join(directory, "checkpoint.th.partial");
    fs.writeFileSync(partialFile, payload);
    const runCurl = vi.fn<CurlRunner>();

    await downloadCheckpoint(
      new URL("https://example.invalid/checkpoint.th"),
      partialFile,
      { expectedBytes: payload.length, timeoutMs: 60_000 },
      runCurl,
    );

    expect(runCurl).not.toHaveBeenCalled();
  });

  test("rejects an oversized partial file", async () => {
    const directory = temporaryDirectory();
    const partialFile = path.join(directory, "checkpoint.th.partial");
    fs.writeFileSync(partialFile, "too-large");

    await expect(downloadCheckpoint(
      new URL("https://example.invalid/checkpoint.th"),
      partialFile,
      { expectedBytes: 1, timeoutMs: 60_000 },
    )).rejects.toThrow("partial checkpoint is larger than declared size");
  });

  test("rejects a downloaded checkpoint with the wrong hash", async () => {
    const payload = Buffer.from("official-checkpoint-fixture");
    const directory = temporaryDirectory();
    const manifestFile = writeManifest(directory, payload);
    const outputDirectory = path.join(directory, "model");
    const download: CheckpointDownloader = async (_url, target) => {
      fs.writeFileSync(target, Buffer.alloc(payload.length));
    };

    await expect(prepareGectorModel({ manifestFile, outputDirectory, download }))
      .rejects.toThrow("checkpoint hash mismatch");
    expect(fs.existsSync(path.join(outputDirectory, "gector-2024-roberta-large.th"))).toBe(false);
    expect(fs.existsSync(path.join(
      outputDirectory,
      "gector-2024-roberta-large.th.partial",
    ))).toBe(false);
    expect(fs.existsSync(path.join(outputDirectory, "receipt.json"))).toBe(false);

    await prepareGectorModel({
      manifestFile,
      outputDirectory,
      download: async (_url, target) => fs.writeFileSync(target, payload),
    });
    expect(fs.readFileSync(path.join(outputDirectory, "gector-2024-roberta-large.th")))
      .toEqual(payload);
  });

  test("rejects an invalid existing checkpoint without downloading again", async () => {
    const payload = Buffer.from("official-checkpoint-fixture");
    const directory = temporaryDirectory();
    const manifestFile = writeManifest(directory, payload);
    const outputDirectory = path.join(directory, "model");
    fs.mkdirSync(outputDirectory);
    fs.writeFileSync(path.join(outputDirectory, "gector-2024-roberta-large.th"), "wrong");
    const download = vi.fn<CheckpointDownloader>();

    await expect(prepareGectorModel({ manifestFile, outputDirectory, download }))
      .rejects.toThrow("checkpoint size mismatch");
    expect(download).not.toHaveBeenCalled();
  });

  test("reuses a valid existing checkpoint", async () => {
    const payload = Buffer.from("official-checkpoint-fixture");
    const directory = temporaryDirectory();
    const manifestFile = writeManifest(directory, payload);
    const outputDirectory = path.join(directory, "model");
    fs.mkdirSync(outputDirectory);
    fs.writeFileSync(path.join(outputDirectory, "gector-2024-roberta-large.th"), payload);
    for (const filename of RuntimeAssetFilenames) {
      const asset = path.join(outputDirectory, filename);
      fs.mkdirSync(path.dirname(asset), { recursive: true });
      fs.writeFileSync(asset, payload);
    }
    const download = vi.fn<CheckpointDownloader>();

    const receipt = await prepareGectorModel({ manifestFile, outputDirectory, download });

    expect(receipt.checkpoint.contentHash).toBe(sha256(payload));
    expect(download).not.toHaveBeenCalled();
  });

  test("rejects non-HTTPS checkpoint URLs", () => {
    expect(() => GectorModelManifestSchema.parse(modelManifest(
      {
        url: "http://example.invalid/checkpoint.th",
        filename: "checkpoint.th",
        bytes: 1,
        contentHash: `sha256:${"0".repeat(64)}`,
        sourceRepository: "https://github.com/grammarly/pillars-of-gec",
        sourceRevision: "1014de0bc90faddba0032acb5dec762c6c85d2e1",
        mediaType: "application/vnd.cncf.model.weight.v1.raw",
      },
      [{
        sourceRepository: "https://example.invalid/runtime",
        sourceRevision: "a".repeat(40),
        url: "https://example.invalid/runtime.txt",
        filename: "runtime.txt",
        bytes: 1,
        contentHash: `sha256:${"0".repeat(64)}`,
        mediaType: "application/vnd.cncf.model.weight.config.v1.raw",
      }],
    ))).toThrow("must use HTTPS");
  });
});
