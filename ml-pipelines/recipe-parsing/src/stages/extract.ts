import "dotenv/config";
import { requiredEnv } from "node-base/env";
import {
  EXTRACTION_PREDICTIONS_PATH,
  EXTRACTION_FAILURES_PATH,
  IMAGES_DIR,
  loadImageEntries,
  loadExtractionPredictions,
  loadExtractionFailures,
  loadParams,
  writeJson,
} from "../lib/io";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractRecipeFromImages } from "recipe-parsing/openrouter";
import { imageSetKey } from "../lib/image-key.js";
import { stringifyProviderErrorBody } from "recipe-parsing/parse-retry";
import {
  type AttemptErrorDetail,
  sleep,
  computeBackoffDelayMs,
  isOpenAIStyleError,
  extractAttemptErrorDetail,
} from "recipe-parsing/attempts";
import {
  parseCsvEnv,
  mergeByImageSet,
  catchMissingFile,
} from "../lib/stage-runner.js";
import { imagePathToDataUrl } from "../lib/images.js";
import type {
  ExtractionPredictionEntry,
  ExtractionPredictionsDataset,
} from "recipe-parsing/schemas/stage-artifacts";
import type { ParseFailuresDataset } from "recipe-parsing/schemas/parse-failures";

type ExtractSuccess = {
  ok: true;
  prediction: ExtractionPredictionEntry;
};

type ExtractFailure = {
  ok: false;
  failure: ParseFailuresDataset["entries"][number];
};

export type ExtractResult = ExtractSuccess | ExtractFailure;

export type ExtractParams = {
  apiKey: string;
  images: string[];
  model: string;
  requestTimeoutMs: number;
  maxRetries: number;
  maxImageDimension: number;
  jpegQuality: number;
  backoffBaseDelayMs: number;
  backoffMaxDelayMs: number;
};

function buildFailure(params: {
  images: string[];
  model?: string;
  lastError: unknown;
  attemptErrors: AttemptErrorDetail[];
}): ExtractFailure {
  const attemptCount = params.attemptErrors.length;
  const lastDetail =
    params.attemptErrors[params.attemptErrors.length - 1] ??
    extractAttemptErrorDetail(params.lastError, attemptCount);
  const candidate = isOpenAIStyleError(params.lastError) ? params.lastError : undefined;

  return {
    ok: false,
    failure: {
      images: params.images,
      stage: "extraction",
      attemptCount,
      model: params.model,
      errorType: lastDetail.errorType,
      errorMessage: lastDetail.errorMessage,
      statusCode: lastDetail.statusCode,
      requestId: lastDetail.requestId,
      providerErrorCode: lastDetail.providerErrorCode,
      providerErrorType: lastDetail.providerErrorType,
      providerErrorParam: lastDetail.providerErrorParam,
      providerErrorBody: stringifyProviderErrorBody(candidate?.error),
      causeMessage: lastDetail.causeMessage,
      attemptErrors: params.attemptErrors,
    },
  };
}

async function loadImageDataUrls(
  params: ExtractParams,
): Promise<{ ok: true; imageDataUrls: string[] } | ExtractFailure> {
  try {
    return {
      ok: true,
      imageDataUrls: await Promise.all(
        params.images.map((imageFile) =>
          imagePathToDataUrl(
            join(IMAGES_DIR, imageFile),
            params.maxImageDimension,
            params.jpegQuality,
          ),
        ),
      ),
    };
  } catch (error) {
    return buildFailure({
      images: params.images,
      model: params.model,
      lastError: error,
      attemptErrors: [extractAttemptErrorDetail(error, 1)],
    });
  }
}

function extractionDiagnosticSuffix(detail: AttemptErrorDetail): string {
  const diagnostics: string[] = [];
  if (detail.statusCode !== undefined) {
    diagnostics.push(`status=${detail.statusCode}`);
  }
  if (detail.requestId) diagnostics.push(`request_id=${detail.requestId}`);
  if (detail.providerErrorCode) {
    diagnostics.push(`code=${detail.providerErrorCode}`);
  }
  if (detail.providerErrorType) {
    diagnostics.push(`type=${detail.providerErrorType}`);
  }
  return diagnostics.length > 0 ? ` (${diagnostics.join(", ")})` : "";
}

function logExtractionFailure(
  images: string[],
  detail: AttemptErrorDetail,
  attempt: number,
  attempts: number,
): void {
  console.warn(
    `Extraction failed for [${images.join(", ")}] attempt ${attempt}/${attempts}: ${detail.errorMessage}${extractionDiagnosticSuffix(detail)}`,
  );
}

export async function extractEntryWithRetries(
  params: ExtractParams,
): Promise<ExtractResult> {
  const attempts = params.maxRetries + 1;
  let lastError: unknown;
  const attemptErrors: AttemptErrorDetail[] = [];

  // A single unreadable image should fail this entry, not abort the whole run.
  const loadedImages = await loadImageDataUrls(params);
  if (!loadedImages.ok) return loadedImages;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const extracted = await extractRecipeFromImages({
        apiKey: params.apiKey,
        imageDataUrls: loadedImages.imageDataUrls,
        model: params.model,
        requestTimeoutMs: params.requestTimeoutMs,
      });

      return {
        ok: true,
        prediction: {
          images: params.images,
          extracted: extracted.value,
        },
      };
    } catch (error) {
      lastError = error;
      const detail = extractAttemptErrorDetail(error, attempt);
      attemptErrors.push(detail);
      logExtractionFailure(params.images, detail, attempt, attempts);
      const hasNextAttempt = attempt < attempts;
      if (!hasNextAttempt || !detail.retryable) break;
      const delayMs = computeBackoffDelayMs(
        attempt,
        params.backoffBaseDelayMs,
        params.backoffMaxDelayMs,
      );
      console.log(`Retrying [${params.images.join(", ")}] in ${delayMs}ms...`);
      await sleep(delayMs);
    }
  }

  return buildFailure({
    images: params.images,
    model: params.model,
    lastError,
    attemptErrors,
  });
}

async function main() {
  const {
    model,
    request_timeout_ms: requestTimeoutMs,
    max_retries: maxRetries,
    concurrency,
    image_max_dim: maxImageDimension,
    image_jpeg_quality: jpegQuality,
    retry_base_delay_ms: backoffBaseDelayMs,
    retry_max_delay_ms: backoffMaxDelayMs,
  } = (await loadParams()).extract;
  const targetImages = parseCsvEnv("EXTRACT_TARGET_IMAGES");
  const hasApiKey = Boolean(process.env.OPENROUTER_API_KEY);

  console.log("Extract config:");
  console.log(`  model:              ${model}`);
  console.log(`  request_timeout_ms: ${requestTimeoutMs}`);
  console.log(`  max_retries:        ${maxRetries}`);
  console.log(`  concurrency:        ${concurrency}`);
  console.log(`  retry_base_delay_ms: ${backoffBaseDelayMs}`);
  console.log(`  retry_max_delay_ms: ${backoffMaxDelayMs}`);
  console.log(`  image_max_dim:      ${maxImageDimension}`);
  console.log(`  image_jpeg_quality: ${jpegQuality}`);
  console.log(
    `  target_images:      ${targetImages ? targetImages.join(", ") : "(all entries)"}`,
  );
  console.log(`  OPENROUTER_API_KEY: ${hasApiKey ? "set" : "missing"}`);
  const apiKey = requiredEnv("OPENROUTER_API_KEY");

  console.log("Loading image entries...");
  const imageEntries = await loadImageEntries();
  let entriesToProcess = imageEntries.entries;
  let targetEntryKeys = new Set<string>();

  if (targetImages) {
    const targetSet = new Set(targetImages);
    const matches = imageEntries.entries.filter((entry) => {
      if (entry.images.length !== targetImages.length) return false;
      return entry.images.every((image) => targetSet.has(image));
    });
    if (matches.length === 0) {
      const available = imageEntries.entries
        .map((entry) => entry.images.join(", "))
        .sort((a, b) => a.localeCompare(b))
        .join("\n  - ");
      throw new Error(
        `No entry matched EXTRACT_TARGET_IMAGES=${targetImages.join(", ")}.\nAvailable image sets:\n  - ${available}`,
      );
    }
    entriesToProcess = matches;
    targetEntryKeys = new Set(matches.map((entry) => imageSetKey(entry.images)));
  }

  console.log(
    `Running OCR extraction on ${entriesToProcess.length} entries...`,
  );

  const results = new Array<ExtractResult | undefined>(entriesToProcess.length);
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= entriesToProcess.length) {
        return;
      }
      const entry = entriesToProcess[currentIndex]!;
      results[currentIndex] = await extractEntryWithRetries({
        apiKey,
        images: entry.images,
        model,
        requestTimeoutMs,
        maxRetries,
        maxImageDimension,
        jpegQuality,
        backoffBaseDelayMs,
        backoffMaxDelayMs,
      });
    }
  };

  const workerCount = Math.min(concurrency, Math.max(entriesToProcess.length, 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const predictions: ExtractionPredictionsDataset = { entries: [] };
  const failures: ParseFailuresDataset = { entries: [] };

  for (const result of results) {
    if (!result) continue;
    if (result.ok) {
      predictions.entries.push(result.prediction);
    } else {
      failures.entries.push(result.failure);
    }
  }

  if (targetEntryKeys.size > 0) {
    const [existingPredictions, existingFailures] = await Promise.all([
      loadExtractionPredictions().catch(
        catchMissingFile({ entries: [] } as ExtractionPredictionsDataset),
      ),
      loadExtractionFailures().catch(
        catchMissingFile({ entries: [] } as ParseFailuresDataset),
      ),
    ]);

    predictions.entries = mergeByImageSet(
      existingPredictions.entries,
      predictions.entries,
      targetEntryKeys,
    );
    failures.entries = mergeByImageSet(
      existingFailures.entries,
      failures.entries,
      targetEntryKeys,
    );
  }

  await Promise.all([
    writeJson(EXTRACTION_PREDICTIONS_PATH, predictions),
    writeJson(EXTRACTION_FAILURES_PATH, failures),
  ]);

  console.log(
    `Extracted ${predictions.entries.length} entries -> ${EXTRACTION_PREDICTIONS_PATH}`,
  );
  console.log(`Failures written to ${EXTRACTION_FAILURES_PATH}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
