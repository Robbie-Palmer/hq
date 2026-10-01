import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { readJson, writeJson } from "./files";

const ContentHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const RelativeFileSchema = z.string().min(1).superRefine((value, context) => {
  const segments = value.split("/");
  if (
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes(":") ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    context.addIssue({ code: "custom", message: "must be a safe relative path" });
  }
});

const HttpsUrlSchema = z.url().refine((url) => url.startsWith("https://"), "must use HTTPS");
const GitRevisionSchema = z.string().regex(/^[a-f0-9]{40}$/);
const ModelPackManifestMediaType = "application/vnd.cncf.model.manifest.v1+json" as const;
const ModelPackConfigMediaType = "application/vnd.cncf.model.config.v1+json" as const;
const ModelPackWeightMediaType = "application/vnd.cncf.model.weight.v1.raw" as const;
const ModelPackWeightConfigMediaType =
  "application/vnd.cncf.model.weight.config.v1.raw" as const;
const ModelPackFilepathAnnotation = "org.cncf.model.filepath" as const;
const OciTitleAnnotation = "org.opencontainers.image.title" as const;
const OciSourceAnnotation = "org.opencontainers.image.source" as const;
const OciRevisionAnnotation = "org.opencontainers.image.revision" as const;
const GectorLicenseAnnotation = "me.robbiepalmer.gector.checkpoint-license" as const;
const GectorUsageAnnotation = "me.robbiepalmer.gector.usage" as const;
const ModelPackVersionAnnotation = "me.robbiepalmer.modelpack.spec-version" as const;
const GectorRuntimeLayerMediaTypes = new Map<string, string>([
  ["gector-2024-roberta-large.th", ModelPackWeightMediaType],
  ["roberta-large/config.json", ModelPackWeightConfigMediaType],
  ["roberta-large/merges.txt", ModelPackWeightConfigMediaType],
  ["roberta-large/tokenizer.json", ModelPackWeightConfigMediaType],
  ["roberta-large/tokenizer_config.json", ModelPackWeightConfigMediaType],
  ["roberta-large/vocab.json", ModelPackWeightConfigMediaType],
  ["vocabulary/labels.txt", ModelPackWeightConfigMediaType],
  ["vocabulary/d_tags.txt", ModelPackWeightConfigMediaType],
  ["vocabulary/non_padded_namespaces.txt", ModelPackWeightConfigMediaType],
  ["verb-form-vocab.txt", ModelPackWeightConfigMediaType],
]);
const RedirectStatuses = new Set([301, 302, 303, 307, 308]);
const RetryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);
const MaximumRedirects = 10;
const MaximumDownloadAttempts = 6;

const ConfigAnnotationsSchema = z.object({
  [OciTitleAnnotation]: RelativeFileSchema,
}).strict();

const LayerAnnotationsSchema = z.object({
  [ModelPackFilepathAnnotation]: RelativeFileSchema,
  [OciTitleAnnotation]: RelativeFileSchema,
  [OciSourceAnnotation]: z.url(),
  [OciRevisionAnnotation]: GitRevisionSchema,
}).strict();

const OciDescriptorSchema = z.object({
  mediaType: z.union([
    z.literal(ModelPackWeightMediaType),
    z.literal(ModelPackWeightConfigMediaType),
  ]),
  digest: ContentHashSchema,
  size: z.number().int().positive(),
  urls: z.array(HttpsUrlSchema).min(1).optional(),
  annotations: LayerAnnotationsSchema,
}).strict();

const ModelPackConfigSchema = z.object({
  descriptor: z.object({
    family: z.literal("gector"),
    name: z.literal("gector-2024-roberta-large"),
    title: z.string().min(1),
    description: z.string().min(1),
    docURL: z.url(),
    sourceURL: z.url(),
    revision: GitRevisionSchema,
  }).strict(),
  config: z.object({
    architecture: z.literal("transformer"),
    format: z.literal("pytorch"),
    capabilities: z.object({
      inputTypes: z.tuple([z.literal("text")]),
      outputTypes: z.tuple([z.literal("text")]),
    }).strict(),
  }).strict(),
  modelfs: z.object({
    type: z.literal("layers"),
    diffIds: z.array(ContentHashSchema).min(1),
  }).strict(),
}).strict();

export const ModelPackManifestSchema = z.object({
  schemaVersion: z.literal(2),
  mediaType: z.literal("application/vnd.oci.image.manifest.v1+json"),
  artifactType: z.literal(ModelPackManifestMediaType),
  config: z.object({
    mediaType: z.literal(ModelPackConfigMediaType),
    digest: ContentHashSchema,
    size: z.number().int().positive(),
    data: z.string().min(1),
    annotations: ConfigAnnotationsSchema,
  }).strict(),
  layers: z.array(OciDescriptorSchema).min(1),
  annotations: z.object({
    [OciTitleAnnotation]: z.string().min(1),
    [OciSourceAnnotation]: z.url(),
    [OciRevisionAnnotation]: GitRevisionSchema,
    [GectorLicenseAnnotation]: z.literal("not-stated-by-upstream"),
    [GectorUsageAnnotation]: z.literal("evaluation-only"),
    [ModelPackVersionAnnotation]: z.literal("v0.0.7"),
  }).strict(),
}).strict();

export const GectorModelManifestSchema = ModelPackManifestSchema.transform((manifest, context) => {
  const configBytes = Buffer.from(manifest.config.data, "base64");
  if (configBytes.byteLength !== manifest.config.size) {
    context.addIssue({ code: "custom", message: "embedded config size does not match descriptor" });
    return z.NEVER;
  }
  if (sha256Bytes(configBytes) !== manifest.config.digest) {
    context.addIssue({ code: "custom", message: "embedded config digest does not match descriptor" });
    return z.NEVER;
  }
  let decodedConfig: unknown;
  try {
    decodedConfig = JSON.parse(configBytes.toString("utf8"));
  } catch {
    context.addIssue({ code: "custom", message: "embedded config is not valid JSON" });
    return z.NEVER;
  }
  const config = ModelPackConfigSchema.safeParse(decodedConfig);
  if (!config.success) {
    context.addIssue({ code: "custom", message: "embedded ModelPack config is invalid" });
    return z.NEVER;
  }
  const layerDigests = manifest.layers.map(({ digest }) => digest);
  if (
    config.data.modelfs.diffIds.length !== layerDigests.length ||
    config.data.modelfs.diffIds.some((digest, index) => digest !== layerDigests[index])
  ) {
    context.addIssue({ code: "custom", message: "ModelPack diff IDs do not match layers" });
    return z.NEVER;
  }
  if (
    manifest.annotations[OciSourceAnnotation] !== config.data.descriptor.sourceURL ||
    manifest.annotations[OciRevisionAnnotation] !== config.data.descriptor.revision
  ) {
    context.addIssue({ code: "custom", message: "OCI annotations do not match ModelPack config" });
    return z.NEVER;
  }
  const artifacts = manifest.layers.map((layer) => ({
    url: layer.urls?.[0],
    filename: layer.annotations[ModelPackFilepathAnnotation],
    bytes: layer.size,
    contentHash: layer.digest,
    sourceRepository: layer.annotations[OciSourceAnnotation],
    sourceRevision: layer.annotations[OciRevisionAnnotation],
    mediaType: layer.mediaType,
  }));
  const runtimeLayout = new Map(artifacts.map(({ filename, mediaType }) => [
    filename,
    mediaType,
  ]));
  const hasExpectedRuntimeLayout =
    runtimeLayout.size === artifacts.length &&
    runtimeLayout.size === GectorRuntimeLayerMediaTypes.size &&
    [...GectorRuntimeLayerMediaTypes].every(
      ([filename, mediaType]) => runtimeLayout.get(filename) === mediaType,
    );
  if (!hasExpectedRuntimeLayout) {
    context.addIssue({
      code: "custom",
      message: "ModelPack layers do not match the locked GECToR runtime layout",
    });
    return z.NEVER;
  }
  const checkpointLayers = artifacts.filter(
    ({ mediaType }) => mediaType === ModelPackWeightMediaType,
  );
  if (checkpointLayers.length !== 1) {
    context.addIssue({ code: "custom", message: "ModelPack must contain one checkpoint layer" });
    return z.NEVER;
  }
  const checkpoint = checkpointLayers[0]!;
  if (
    checkpoint.sourceRepository !== config.data.descriptor.sourceURL ||
    checkpoint.sourceRevision !== config.data.descriptor.revision
  ) {
    context.addIssue({ code: "custom", message: "checkpoint provenance does not match model config" });
    return z.NEVER;
  }
  return {
    modelPack: manifest,
    modelId: config.data.descriptor.name,
    source: {
      repository: config.data.descriptor.sourceURL,
      revision: config.data.descriptor.revision,
    },
    checkpoint,
    runtimeAssets: artifacts.filter(({ mediaType }) =>
      mediaType === ModelPackWeightConfigMediaType
    ),
    usage: manifest.annotations[GectorUsageAnnotation],
    checkpointLicense: manifest.annotations[GectorLicenseAnnotation],
  };
});
export type GectorModelManifest = z.infer<typeof GectorModelManifestSchema>;

export interface DownloadOptions {
  expectedBytes: number;
  timeoutMs: number;
}

export interface CheckpointDownloadDependencies {
  fetch?: typeof globalThis.fetch;
  wait?: (delayMs: number) => Promise<void>;
}

export type CheckpointDownloader = (
  url: URL,
  partialFile: string,
  options: DownloadOptions,
) => Promise<void>;

export interface PrepareGectorModelOptions {
  manifestFile: string;
  outputDirectory: string;
  timeoutMs?: number;
  download?: CheckpointDownloader;
}

export interface GectorModelReceipt {
  schemaVersion: 1;
  recordType: "gector-model-receipt";
  modelId: "gector-2024-roberta-large";
  sourceRepository: string;
  sourceRevision: string;
  checkpoint: {
    file: string;
    bytes: number;
    contentHash: string;
  };
  runtimeAssets: {
    file: string;
    bytes: number;
    contentHash: string;
    sourceRepository: string;
    sourceRevision: string;
  }[];
  manifestContentHash: string;
}

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const input = fs.createReadStream(file);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("error", reject);
    input.on("end", () => resolve(`sha256:${hash.digest("hex")}`));
  });
}

function sha256Bytes(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

class CheckpointDownloadError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = "CheckpointDownloadError";
  }
}

function assertHttps(url: URL): void {
  if (url.protocol !== "https:") {
    throw new CheckpointDownloadError(
      `refusing non-HTTPS checkpoint URL: ${url}`,
      false,
    );
  }
}

function partialSize(partialFile: string, expectedBytes: number): number {
  const bytes = fs.existsSync(partialFile) ? fs.statSync(partialFile).size : 0;
  if (bytes > expectedBytes) {
    throw new CheckpointDownloadError(
      `partial checkpoint is larger than declared size: ${bytes} > ${expectedBytes}`,
      false,
    );
  }
  return bytes;
}

async function withStallTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  controller: AbortController,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stalled = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new CheckpointDownloadError(
        `checkpoint download stalled for ${timeoutMs}ms`,
        true,
      );
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation, stalled]);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithHttpsRedirects(
  initialUrl: URL,
  startByte: number,
  timeoutMs: number,
  fetchRequest: typeof globalThis.fetch,
  controller: AbortController,
): Promise<Response> {
  let url = initialUrl;
  for (let redirectCount = 0; redirectCount <= MaximumRedirects; redirectCount += 1) {
    assertHttps(url);
    const headers = startByte === 0 ? undefined : { Range: `bytes=${startByte}-` };
    const response = await withStallTimeout(
      fetchRequest(url, {
        headers,
        redirect: "manual",
        signal: controller.signal,
      }),
      timeoutMs,
      controller,
    );
    if (!RedirectStatuses.has(response.status)) return response;

    const location = response.headers.get("location");
    await response.body?.cancel();
    if (location === null) {
      throw new CheckpointDownloadError(
        `checkpoint redirect from ${url} has no location`,
        false,
      );
    }
    url = new URL(location, url);
  }
  throw new CheckpointDownloadError(
    `checkpoint download exceeded ${MaximumRedirects} redirects`,
    false,
  );
}

function validatePartialResponse(
  response: Response,
  startByte: number,
  expectedBytes: number,
): void {
  const value = response.headers.get("content-range");
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/u.exec(value ?? "");
  const responseStart = Number(match?.[1]);
  const responseEnd = Number(match?.[2]);
  const responseTotal = match?.[3] === "*" ? undefined : Number(match?.[3]);
  if (
    match === null ||
    responseStart !== startByte ||
    responseEnd < responseStart ||
    (responseTotal !== undefined && responseTotal !== expectedBytes)
  ) {
    throw new CheckpointDownloadError(
      `invalid checkpoint content-range: ${value ?? "missing"}`,
      false,
    );
  }
}

async function writeResponse(
  response: Response,
  partialFile: string,
  append: boolean,
  timeoutMs: number,
  controller: AbortController,
): Promise<void> {
  if (response.body === null) {
    throw new CheckpointDownloadError("checkpoint response has no body", true);
  }
  const reader = response.body.getReader();
  const output = await fs.promises.open(partialFile, append ? "a" : "w");
  let complete = false;
  try {
    while (true) {
      const result = await withStallTimeout(reader.read(), timeoutMs, controller);
      if (result.done) break;
      let written = 0;
      while (written < result.value.byteLength) {
        const write = await output.write(result.value.subarray(written));
        if (write.bytesWritten === 0) {
          throw new CheckpointDownloadError(
            "checkpoint download could not write response data",
            true,
          );
        }
        written += write.bytesWritten;
      }
    }
    complete = true;
  } finally {
    await output.close();
    if (!complete) await reader.cancel().catch(() => undefined);
  }
}

async function downloadAttempt(
  url: URL,
  partialFile: string,
  options: DownloadOptions,
  fetchRequest: typeof globalThis.fetch,
): Promise<void> {
  const startByte = partialSize(partialFile, options.expectedBytes);
  if (startByte === options.expectedBytes) return;

  process.stdout.write(
    `Downloading checkpoint from byte ${startByte} of ${options.expectedBytes}\n`,
  );
  const controller = new AbortController();
  const response = await fetchWithHttpsRedirects(
    url,
    startByte,
    options.timeoutMs,
    fetchRequest,
    controller,
  );
  if (response.status !== 200 && response.status !== 206) {
    await response.body?.cancel();
    throw new CheckpointDownloadError(
      `checkpoint download failed with HTTP ${response.status}`,
      RetryableStatuses.has(response.status),
    );
  }

  if (response.status === 206) {
    try {
      validatePartialResponse(response, startByte, options.expectedBytes);
    } catch (error) {
      await response.body?.cancel();
      throw error;
    }
  }
  await writeResponse(
    response,
    partialFile,
    response.status === 206 && startByte > 0,
    options.timeoutMs,
    controller,
  );

  const downloadedBytes = partialSize(partialFile, options.expectedBytes);
  if (downloadedBytes !== options.expectedBytes) {
    throw new CheckpointDownloadError(
      `checkpoint download ended early: ${downloadedBytes} of ${options.expectedBytes} bytes`,
      true,
    );
  }
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function downloadCheckpoint(
  url: URL,
  partialFile: string,
  options: DownloadOptions,
  dependencies: CheckpointDownloadDependencies = {},
): Promise<void> {
  const fetchRequest = dependencies.fetch ?? globalThis.fetch;
  const waitForRetry = dependencies.wait ?? wait;
  assertHttps(url);
  if (partialSize(partialFile, options.expectedBytes) === options.expectedBytes) return;
  for (let attempt = 1; attempt <= MaximumDownloadAttempts; attempt += 1) {
    try {
      await downloadAttempt(url, partialFile, options, fetchRequest);
      process.stdout.write("Checkpoint download complete; verifying SHA-256\n");
      return;
    } catch (error) {
      const retryable = !(error instanceof CheckpointDownloadError) || error.retryable;
      if (!retryable || attempt === MaximumDownloadAttempts) throw error;
      await waitForRetry(Math.min(2 ** (attempt - 1) * 1_000, 10_000));
    }
  }
}

async function verifyArtifact(
  file: string,
  expectedBytes: number,
  expectedHash: string,
  label: string,
): Promise<void> {
  const bytes = fs.statSync(file).size;
  if (bytes !== expectedBytes) {
    throw new Error(`${label} size mismatch: expected ${expectedBytes}, got ${bytes}`);
  }
  const contentHash = await sha256File(file);
  if (contentHash !== expectedHash) {
    throw new Error(`${label} hash mismatch: expected ${expectedHash}, got ${contentHash}`);
  }
}

async function prepareArtifact(
  artifact: { url: string | undefined; filename: string; bytes: number; contentHash: string },
  outputDirectory: string,
  timeoutMs: number,
  download: CheckpointDownloader,
  label: string = artifact.filename,
): Promise<void> {
  const file = path.join(outputDirectory, artifact.filename);
  const partialFile = `${file}.partial`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    await verifyArtifact(file, artifact.bytes, artifact.contentHash, label);
    return;
  }
  if (artifact.url === undefined) {
    throw new Error(`${label} is missing and its descriptor has no acquisition URL`);
  }
  await download(new URL(artifact.url), partialFile, {
    expectedBytes: artifact.bytes,
    timeoutMs,
  });
  try {
    await verifyArtifact(partialFile, artifact.bytes, artifact.contentHash, label);
  } catch (error) {
    fs.rmSync(partialFile, { force: true });
    throw error;
  }
  fs.renameSync(partialFile, file);
}

export async function prepareGectorModel(
  options: PrepareGectorModelOptions,
): Promise<GectorModelReceipt> {
  const manifestBytes = fs.readFileSync(options.manifestFile);
  const manifest = GectorModelManifestSchema.parse(readJson(options.manifestFile));
  const outputDirectory = path.resolve(options.outputDirectory);
  fs.mkdirSync(outputDirectory, { recursive: true });
  const download = options.download ?? downloadCheckpoint;
  const timeoutMs = options.timeoutMs ?? 60_000;
  await prepareArtifact(manifest.checkpoint, outputDirectory, timeoutMs, download, "checkpoint");
  for (const artifact of manifest.runtimeAssets) {
    await prepareArtifact(artifact, outputDirectory, timeoutMs, download);
  }

  const receipt: GectorModelReceipt = {
    schemaVersion: 1,
    recordType: "gector-model-receipt",
    modelId: manifest.modelId,
    sourceRepository: manifest.source.repository,
    sourceRevision: manifest.source.revision,
    checkpoint: {
      file: manifest.checkpoint.filename,
      bytes: manifest.checkpoint.bytes,
      contentHash: manifest.checkpoint.contentHash,
    },
    runtimeAssets: manifest.runtimeAssets.map((asset) => ({
      file: asset.filename,
      bytes: asset.bytes,
      contentHash: asset.contentHash,
      sourceRepository: asset.sourceRepository,
      sourceRevision: asset.sourceRevision,
    })),
    manifestContentHash: sha256Bytes(manifestBytes),
  };
  writeJson(path.join(outputDirectory, "receipt.json"), receipt);
  return receipt;
}

function main(): void {
  prepareGectorModel({
    manifestFile: "model-manifest.json",
    outputDirectory: "data/models/gector-2024",
  }).then((receipt) => {
    process.stdout.write(`Prepared ${receipt.modelId} (${receipt.checkpoint.contentHash})\n`);
  }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
