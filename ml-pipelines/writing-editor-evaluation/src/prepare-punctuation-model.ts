import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sha256 } from "writing-editor-domain/suggestions";
import { z } from "zod";

import { downloadCheckpoint, type CheckpointDownloader } from "./prepare-gector-model";
import { readJson, writeJson } from "./files";

const MODEL_ID = "horizon-punctuation-restoration-small" as const;
const MODEL_REVISION = "ee31fdfc5304f876ea3b0dd72d30eda7e940b2b1" as const;
const MODEL_SOURCE = "https://huggingface.co/Horizon-Labs/punctuation-restoration-small" as const;
const CONTENT_HASH = /^sha256:[a-f0-9]{64}$/;
const GIT_REVISION = /^[a-f0-9]{40}$/;

const RelativeFileSchema = z.string().min(1).superRefine((value, context) => {
  const segments = value.split("/");
  if (
    value.startsWith("/") || value.includes("\\") || value.includes(":") ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    context.addIssue({ code: "custom", message: "must be a safe relative path" });
  }
});

const LayerSchema = z.object({
  mediaType: z.enum([
    "application/vnd.cncf.model.weight.v1.raw",
    "application/vnd.cncf.model.weight.config.v1.raw",
  ]),
  digest: z.string().regex(CONTENT_HASH),
  size: z.number().int().positive(),
  urls: z.array(z.url().refine((url) => url.startsWith("https://"))).length(1),
  annotations: z.object({
    "org.cncf.model.filepath": RelativeFileSchema,
    "org.opencontainers.image.title": RelativeFileSchema,
    "org.opencontainers.image.source": z.literal(MODEL_SOURCE),
    "org.opencontainers.image.revision": z.literal(MODEL_REVISION),
  }).strict(),
}).strict();

const ModelPackConfigSchema = z.object({
  descriptor: z.object({
    family: z.literal("punctuation-restoration"),
    name: z.literal(MODEL_ID),
    title: z.string().min(1),
    description: z.string().min(1),
    docURL: z.url(),
    sourceURL: z.literal(MODEL_SOURCE),
    revision: z.string().regex(GIT_REVISION),
  }).strict(),
  config: z.object({
    architecture: z.literal("transformer"),
    format: z.literal("safetensors"),
    capabilities: z.object({
      inputTypes: z.tuple([z.literal("text")]),
      outputTypes: z.tuple([z.literal("token-labels")]),
    }).strict(),
  }).strict(),
  modelfs: z.object({
    type: z.literal("layers"),
    diffIds: z.array(z.string().regex(CONTENT_HASH)).length(5),
  }).strict(),
}).strict();

const ModelPackManifestSchema = z.object({
  schemaVersion: z.literal(2),
  mediaType: z.literal("application/vnd.oci.image.manifest.v1+json"),
  artifactType: z.literal("application/vnd.cncf.model.manifest.v1+json"),
  config: z.object({
    mediaType: z.literal("application/vnd.cncf.model.config.v1+json"),
    digest: z.string().regex(CONTENT_HASH),
    size: z.number().int().positive(),
    data: z.string().min(1),
    annotations: z.object({
      "org.opencontainers.image.title": RelativeFileSchema,
    }).strict(),
  }).strict(),
  layers: z.array(LayerSchema).length(5),
  annotations: z.object({
    "org.opencontainers.image.title": z.string().min(1),
    "org.opencontainers.image.source": z.literal(MODEL_SOURCE),
    "org.opencontainers.image.revision": z.literal(MODEL_REVISION),
    "org.opencontainers.image.licenses": z.literal("Apache-2.0"),
    "me.robbiepalmer.model.usage": z.literal("evaluation-only"),
    "me.robbiepalmer.modelpack.spec-version": z.literal("v0.0.7"),
  }).strict(),
}).strict();

const expectedFiles = new Map([
  ["model.safetensors", "application/vnd.cncf.model.weight.v1.raw"],
  ["config.json", "application/vnd.cncf.model.weight.config.v1.raw"],
  ["tokenizer.json", "application/vnd.cncf.model.weight.config.v1.raw"],
  ["tokenizer_config.json", "application/vnd.cncf.model.weight.config.v1.raw"],
  ["special_tokens_map.json", "application/vnd.cncf.model.weight.config.v1.raw"],
]);

export const PunctuationModelManifestSchema = ModelPackManifestSchema.transform(
  (manifest, context) => {
    const configBytes = Buffer.from(manifest.config.data, "base64");
    if (
      configBytes.byteLength !== manifest.config.size ||
      sha256(configBytes) !== manifest.config.digest
    ) {
      context.addIssue({ code: "custom", message: "embedded ModelPack config digest or size is invalid" });
      return z.NEVER;
    }
    const decoded = ModelPackConfigSchema.safeParse(JSON.parse(configBytes.toString("utf8")));
    if (!decoded.success) {
      context.addIssue({ code: "custom", message: "embedded ModelPack config is invalid" });
      return z.NEVER;
    }
    const files = new Map(manifest.layers.map((layer) => [
      layer.annotations["org.cncf.model.filepath"], layer.mediaType,
    ]));
    if (
      files.size !== expectedFiles.size ||
      [...expectedFiles].some(([file, mediaType]) => files.get(file) !== mediaType)
    ) {
      context.addIssue({ code: "custom", message: "ModelPack layers do not match the punctuation runtime" });
      return z.NEVER;
    }
    const digests = manifest.layers.map(({ digest }) => digest);
    if (decoded.data.modelfs.diffIds.some((digest, index) => digest !== digests[index])) {
      context.addIssue({ code: "custom", message: "ModelPack diff IDs do not match layers" });
      return z.NEVER;
    }
    return {
      modelPack: manifest,
      modelId: decoded.data.descriptor.name,
      source: { repository: MODEL_SOURCE, revision: MODEL_REVISION },
      assets: manifest.layers.map((layer) => ({
        file: layer.annotations["org.cncf.model.filepath"],
        bytes: layer.size,
        contentHash: layer.digest,
        url: layer.urls[0],
        mediaType: layer.mediaType,
      })),
    };
  },
);

export type PunctuationModelManifest = z.infer<typeof PunctuationModelManifestSchema>;

export interface PunctuationModelReceipt {
  schemaVersion: 1;
  recordType: "punctuation-model-receipt";
  modelId: typeof MODEL_ID;
  sourceRepository: typeof MODEL_SOURCE;
  sourceRevision: typeof MODEL_REVISION;
  assets: Array<{ file: string; bytes: number; contentHash: string }>;
  manifestContentHash: string;
}

async function fileHash(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const input = fs.createReadStream(file);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("error", reject);
    input.on("end", () => resolve(`sha256:${hash.digest("hex")}`));
  });
}

export async function verifyPunctuationAsset(
  file: string,
  bytes: number,
  contentHash: string,
): Promise<void> {
  if (fs.statSync(file).size !== bytes || await fileHash(file) !== contentHash) {
    throw new Error(`${path.basename(file)} does not match the pinned model manifest`);
  }
}

async function prepareAsset(options: {
  asset: PunctuationModelManifest["assets"][number];
  outputDirectory: string;
  timeoutMs: number;
  download: CheckpointDownloader;
  verifyAsset: typeof verifyPunctuationAsset;
}): Promise<void> {
  const { asset, outputDirectory, timeoutMs, download, verifyAsset } = options;
  const file = path.join(outputDirectory, asset.file);
  if (fs.existsSync(file)) {
    await verifyAsset(file, asset.bytes, asset.contentHash);
    return;
  }
  if (asset.url === undefined) throw new Error(`${asset.file} has no acquisition URL`);
  const partial = `${file}.partial`;
  await download(new URL(asset.url), partial, {
    expectedBytes: asset.bytes,
    timeoutMs,
  });
  await verifyAsset(partial, asset.bytes, asset.contentHash);
  fs.renameSync(partial, file);
}

async function prepareAssets(
  assets: PunctuationModelManifest["assets"],
  options: Omit<Parameters<typeof prepareAsset>[0], "asset">,
  index = 0,
): Promise<void> {
  const asset = assets[index];
  if (asset === undefined) return;
  await prepareAsset({ ...options, asset });
  await prepareAssets(assets, options, index + 1);
}

export async function preparePunctuationModel(options: {
  manifestFile: string;
  outputDirectory: string;
  timeoutMs?: number;
  download?: CheckpointDownloader;
  verifyAsset?: typeof verifyPunctuationAsset;
}): Promise<PunctuationModelReceipt> {
  const manifestBytes = fs.readFileSync(options.manifestFile);
  const manifest = PunctuationModelManifestSchema.parse(readJson(options.manifestFile));
  const outputDirectory = path.resolve(options.outputDirectory);
  const download = options.download ?? downloadCheckpoint;
  const verifyAsset = options.verifyAsset ?? verifyPunctuationAsset;
  fs.mkdirSync(outputDirectory, { recursive: true });

  await prepareAssets(manifest.assets, {
    outputDirectory,
    timeoutMs: options.timeoutMs ?? 60_000,
    download,
    verifyAsset,
  });

  const receipt: PunctuationModelReceipt = {
    schemaVersion: 1,
    recordType: "punctuation-model-receipt",
    modelId: MODEL_ID,
    sourceRepository: MODEL_SOURCE,
    sourceRevision: MODEL_REVISION,
    assets: manifest.assets.map(({ file, bytes, contentHash }) => ({
      file, bytes, contentHash,
    })),
    manifestContentHash: sha256(manifestBytes),
  };
  writeJson(path.join(outputDirectory, "receipt.json"), receipt);
  return receipt;
}

function main(): void {
  preparePunctuationModel({
    manifestFile: "punctuation-model-manifest.json",
    outputDirectory: "data/models/punctuation-restoration-small",
  }).then((receipt) => {
    process.stdout.write(`Prepared ${receipt.modelId} (${receipt.sourceRevision})\n`);
  }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
