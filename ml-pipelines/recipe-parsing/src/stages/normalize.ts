import "dotenv/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requiredEnv } from "node-base/env";
import {
  PREDICTIONS_PATH,
  COOKLANG_PREDICTIONS_PATH,
  NORMALIZE_FAILURES_PATH,
  loadExtractionPredictions,
  loadPredictions,
  loadCooklangPredictions,
  loadNormalizeFailures,
  loadParams,
  writeJson,
} from "../lib/io";
import {
  buildCooklangDraftFromExtraction,
  deriveRecipeFromCooklang,
} from "recipe-parsing/cooklang";
import { normalizeExtractionToCooklang } from "recipe-parsing/openrouter";
import { stringifyProviderErrorBody } from "recipe-parsing/parse-retry";
import { imageSetKey } from "../lib/image-key.js";
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
import type {
  PredictionEntry,
  PredictionsDataset,
} from "recipe-parsing/schemas/ground-truth";
import type {
  CooklangPredictionEntry,
  CooklangPredictionsDataset,
  ExtractionPredictionEntry,
} from "recipe-parsing/schemas/stage-artifacts";
import type { ParseFailuresDataset } from "recipe-parsing/schemas/parse-failures";

type NormalizeSuccess = {
  ok: true;
  prediction: PredictionEntry;
  cooklang: CooklangPredictionEntry;
};

type NormalizeFailure = {
  ok: false;
  prediction?: PredictionEntry;
  cooklang?: CooklangPredictionEntry;
  failure: ParseFailuresDataset["entries"][number];
};

export type NormalizeResult = NormalizeSuccess | NormalizeFailure;

export type NormalizeParams = {
  apiKey: string;
  entry: ExtractionPredictionEntry;
  model: string;
  requestTimeoutMs: number;
  maxRetries: number;
  backoffBaseDelayMs: number;
  backoffMaxDelayMs: number;
};

function buildFailure(params: {
  images: string[];
  model?: string;
  lastError: unknown;
  attemptErrors: AttemptErrorDetail[];
  prediction?: PredictionEntry;
  cooklang?: CooklangPredictionEntry;
}): NormalizeFailure {
  const attemptCount = params.attemptErrors.length;
  const lastDetail =
    params.attemptErrors[params.attemptErrors.length - 1] ??
    extractAttemptErrorDetail(params.lastError, attemptCount);
  const candidate = isOpenAIStyleError(params.lastError) ? params.lastError : undefined;

  return {
    ok: false,
    prediction: params.prediction,
    cooklang: params.cooklang,
    failure: {
      images: params.images,
      stage: "normalize",
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

function normalizationSuccess(
  entry: ExtractionPredictionEntry,
  cooklang: CooklangPredictionEntry["cooklang"],
  predicted: PredictionEntry["predicted"],
): NormalizeSuccess {
  return {
    ok: true,
    prediction: { images: entry.images, predicted },
    cooklang: { images: entry.images, cooklang },
  };
}

function normalizationDerivationResult(
  params: NormalizeParams,
  derived: CooklangPredictionEntry["cooklang"],
  draft: CooklangPredictionEntry["cooklang"],
  attemptErrors: AttemptErrorDetail[],
): NormalizeResult {
  if (derived.derived) {
    return normalizationSuccess(params.entry, derived, derived.derived);
  }
  if (draft.derived) {
    return normalizationSuccess(
      params.entry,
      {
        ...derived,
        derived: draft.derived,
        diagnostics: [
          ...derived.diagnostics,
          "LLM cooklang derivation failed; using deterministic draft.",
        ],
      },
      draft.derived,
    );
  }
  return buildFailure({
    images: params.entry.images,
    model: params.model,
    lastError: new Error(derived.diagnostics.join(" | ")),
    attemptErrors,
    cooklang: { images: params.entry.images, cooklang: derived },
  });
}

function failedNormalizationFallback(
  params: NormalizeParams,
  draft: CooklangPredictionEntry["cooklang"],
  attemptErrors: AttemptErrorDetail[],
): NormalizeResult {
  if (draft.derived) {
    console.log(
      `Using deterministic draft for [${params.entry.images.join(", ")}] after normalization failures.`,
    );
    return normalizationSuccess(
      params.entry,
      {
        ...draft,
        diagnostics: [
          ...draft.diagnostics,
          `Normalization LLM failed after ${attemptErrors.length} attempts; using deterministic draft.`,
        ],
      },
      draft.derived,
    );
  }
  return buildFailure({
    images: params.entry.images,
    model: params.model,
    lastError: new Error(
      "Normalization failed and deterministic draft could not produce a recipe",
    ),
    attemptErrors,
    cooklang: { images: params.entry.images, cooklang: draft },
  });
}

export async function normalizeEntryWithRetries(
  params: NormalizeParams,
): Promise<NormalizeResult> {
  const { entry } = params;
  const draft = buildCooklangDraftFromExtraction(entry.extracted);
  const attempts = params.maxRetries + 1;
  const attemptErrors: AttemptErrorDetail[] = [];

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const cooklang = await normalizeExtractionToCooklang({
        apiKey: params.apiKey,
        extracted: entry.extracted,
        model: params.model,
        requestTimeoutMs: params.requestTimeoutMs,
      });

      // Always re-derive from the body to ensure slug normalization is applied.
      // The LLM may include a `derived` field but it won't have normalized slugs.
      const derived = deriveRecipeFromCooklang({ ...cooklang.value, derived: undefined });

      return normalizationDerivationResult(
        params,
        derived,
        draft,
        attemptErrors,
      );
    } catch (error) {
      const detail = extractAttemptErrorDetail(error, attempt);
      attemptErrors.push(detail);
      console.warn(
        `Normalization failed for [${entry.images.join(", ")}] attempt ${attempt}/${attempts}: ${detail.errorMessage}`,
      );
      const hasNextAttempt = attempt < attempts;
      if (hasNextAttempt && detail.retryable) {
        const delayMs = computeBackoffDelayMs(
          attempt,
          params.backoffBaseDelayMs,
          params.backoffMaxDelayMs,
        );
        console.log(`Retrying [${entry.images.join(", ")}] in ${delayMs}ms...`);
        await sleep(delayMs);
        continue;
      }
      if (hasNextAttempt && !detail.retryable) {
        break;
      }
    }
  }

  return failedNormalizationFallback(params, draft, attemptErrors);
}

export function selectNormalizationEntries(
  entries: ExtractionPredictionEntry[],
  targetImages: string[] | undefined,
): { entries: ExtractionPredictionEntry[]; targetKeys: Set<string> } {
  if (!targetImages) return { entries, targetKeys: new Set() };
  const targetSet = new Set(targetImages);
  const matches = entries.filter(
    (entry) =>
      entry.images.length === targetImages.length &&
      entry.images.every((image) => targetSet.has(image)),
  );
  if (matches.length === 0) {
    const available = entries
      .map((entry) => entry.images.join(", "))
      .sort((a, b) => a.localeCompare(b))
      .join("\n  - ");
    throw new Error(
      `No entry matched NORMALIZE_TARGET_IMAGES=${targetImages.join(", ")}.\nAvailable image sets:\n  - ${available}`,
    );
  }
  return {
    entries: matches,
    targetKeys: new Set(matches.map((entry) => imageSetKey(entry.images))),
  };
}

export async function runNormalizationWorkers(
  entries: ExtractionPredictionEntry[],
  concurrency: number,
  params: Omit<NormalizeParams, "entry">,
): Promise<Array<NormalizeResult | undefined>> {
  const results = new Array<NormalizeResult | undefined>(entries.length);
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= entries.length) return;
      results[currentIndex] = await normalizeEntryWithRetries({
        ...params,
        entry: entries[currentIndex]!,
      });
    }
  };
  const workerCount = Math.min(concurrency, Math.max(entries.length, 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export type NormalizeOutputs = {
  predictions: PredictionsDataset;
  cooklangPredictions: CooklangPredictionsDataset;
  failures: ParseFailuresDataset;
};

export function collectNormalizationOutputs(
  results: Array<NormalizeResult | undefined>,
): NormalizeOutputs {
  const outputs: NormalizeOutputs = {
    predictions: { entries: [] },
    cooklangPredictions: { entries: [] },
    failures: { entries: [] },
  };
  for (const result of results) {
    if (!result) continue;
    if (result.ok) {
      outputs.predictions.entries.push(result.prediction);
      outputs.cooklangPredictions.entries.push(result.cooklang);
      continue;
    }
    if (result.prediction) outputs.predictions.entries.push(result.prediction);
    if (result.cooklang) {
      outputs.cooklangPredictions.entries.push(result.cooklang);
    }
    outputs.failures.entries.push(result.failure);
  }
  return outputs;
}

export async function mergeExistingNormalizationOutputs(
  outputs: NormalizeOutputs,
  targetKeys: Set<string>,
): Promise<void> {
  if (targetKeys.size === 0) return;
  const [existingPredictions, existingCooklang, existingFailures] =
    await Promise.all([
      loadPredictions().catch(
        catchMissingFile({ entries: [] } as PredictionsDataset),
      ),
      loadCooklangPredictions().catch(
        catchMissingFile({ entries: [] } as CooklangPredictionsDataset),
      ),
      loadNormalizeFailures().catch(
        catchMissingFile({ entries: [] } as ParseFailuresDataset),
      ),
    ]);
  outputs.predictions.entries = mergeByImageSet(
    existingPredictions.entries,
    outputs.predictions.entries,
    targetKeys,
  );
  outputs.cooklangPredictions.entries = mergeByImageSet(
    existingCooklang.entries,
    outputs.cooklangPredictions.entries,
    targetKeys,
  );
  outputs.failures.entries = mergeByImageSet(
    existingFailures.entries,
    outputs.failures.entries,
    targetKeys,
  );
}

async function main() {
  const {
    model,
    request_timeout_ms: requestTimeoutMs,
    max_retries: maxRetries,
    concurrency,
    retry_base_delay_ms: backoffBaseDelayMs,
    retry_max_delay_ms: backoffMaxDelayMs,
  } = (await loadParams()).normalize;
  const targetImages = parseCsvEnv("NORMALIZE_TARGET_IMAGES");
  const hasApiKey = Boolean(process.env.OPENROUTER_API_KEY);

  console.log("Normalize config:");
  console.log(`  model:              ${model}`);
  console.log(`  request_timeout_ms: ${requestTimeoutMs}`);
  console.log(`  max_retries:        ${maxRetries}`);
  console.log(`  concurrency:        ${concurrency}`);
  console.log(`  retry_base_delay_ms: ${backoffBaseDelayMs}`);
  console.log(`  retry_max_delay_ms: ${backoffMaxDelayMs}`);
  console.log(
    `  target_images:      ${targetImages ? targetImages.join(", ") : "(all entries)"}`,
  );
  console.log(`  OPENROUTER_API_KEY: ${hasApiKey ? "set" : "missing"}`);
  const apiKey = requiredEnv("OPENROUTER_API_KEY");

  console.log("Loading extraction predictions...");
  const extractionPredictions = await loadExtractionPredictions();
  const selection = selectNormalizationEntries(
    extractionPredictions.entries,
    targetImages,
  );

  console.log(
    `Running normalization on ${selection.entries.length} entries...`,
  );

  const results = await runNormalizationWorkers(selection.entries, concurrency, {
    apiKey,
    model,
    requestTimeoutMs,
    maxRetries,
    backoffBaseDelayMs,
    backoffMaxDelayMs,
  });
  const outputs = collectNormalizationOutputs(results);
  await mergeExistingNormalizationOutputs(outputs, selection.targetKeys);

  await Promise.all([
    writeJson(PREDICTIONS_PATH, outputs.predictions),
    writeJson(COOKLANG_PREDICTIONS_PATH, outputs.cooklangPredictions),
    writeJson(NORMALIZE_FAILURES_PATH, outputs.failures),
  ]);

  console.log(
    `Normalized ${outputs.predictions.entries.length} entries -> ${PREDICTIONS_PATH}`,
  );
  console.log(`Cooklang artifacts written to ${COOKLANG_PREDICTIONS_PATH}`);
  console.log(`Failures written to ${NORMALIZE_FAILURES_PATH}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
