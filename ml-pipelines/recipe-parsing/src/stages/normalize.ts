import "dotenv/config";
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

type NormalizeResult = NormalizeSuccess | NormalizeFailure;

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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
async function normalizeEntryWithRetries(params: {
  apiKey: string;
  entry: ExtractionPredictionEntry;
  model: string;
  requestTimeoutMs: number;
  maxRetries: number;
  backoffBaseDelayMs: number;
  backoffMaxDelayMs: number;
}): Promise<NormalizeResult> {
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

      if (!derived.derived) {
        // LLM produced cooklang but derivation failed — use draft fallback
        const fallbackDerived = draft.derived;
        if (fallbackDerived) {
          return {
            ok: true,
            prediction: { images: entry.images, predicted: fallbackDerived },
            cooklang: {
              images: entry.images,
              cooklang: {
                ...derived,
                diagnostics: [
                  ...derived.diagnostics,
                  "LLM cooklang derivation failed; using deterministic draft.",
                ],
              },
            },
          };
        }
        return buildFailure({
          images: entry.images,
          model: params.model,
          lastError: new Error(derived.diagnostics.join(" | ")),
          attemptErrors,
          cooklang: { images: entry.images, cooklang: derived },
        });
      }

      return {
        ok: true,
        prediction: { images: entry.images, predicted: derived.derived },
        cooklang: { images: entry.images, cooklang: derived },
      };
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

  // All retries exhausted — fall back to deterministic draft
  if (draft.derived) {
    console.log(
      `Using deterministic draft for [${entry.images.join(", ")}] after normalization failures.`,
    );
    return {
      ok: true,
      prediction: { images: entry.images, predicted: draft.derived },
      cooklang: {
        images: entry.images,
        cooklang: {
          ...draft,
          diagnostics: [
            ...draft.diagnostics,
            `Normalization LLM failed after ${attemptErrors.length} attempts; using deterministic draft.`,
          ],
        },
      },
    };
  }

  return buildFailure({
    images: entry.images,
    model: params.model,
    lastError: new Error("Normalization failed and deterministic draft could not produce a recipe"),
    attemptErrors,
    cooklang: { images: entry.images, cooklang: draft },
  });
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
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
  let entriesToProcess = extractionPredictions.entries;
  let targetEntryKeys = new Set<string>();

  if (targetImages) {
    const targetSet = new Set(targetImages);
    const matches = extractionPredictions.entries.filter((entry) => {
      if (entry.images.length !== targetImages.length) return false;
      return entry.images.every((image) => targetSet.has(image));
    });
    if (matches.length === 0) {
      const available = extractionPredictions.entries
        .map((entry) => entry.images.join(", "))
        .sort((a, b) => a.localeCompare(b))
        .join("\n  - ");
      throw new Error(
        `No entry matched NORMALIZE_TARGET_IMAGES=${targetImages.join(", ")}.\nAvailable image sets:\n  - ${available}`,
      );
    }
    entriesToProcess = matches;
    targetEntryKeys = new Set(matches.map((entry) => imageSetKey(entry.images)));
  }

  console.log(
    `Running normalization on ${entriesToProcess.length} entries...`,
  );

  const results = new Array<NormalizeResult | undefined>(entriesToProcess.length);
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= entriesToProcess.length) {
        return;
      }
      const entry = entriesToProcess[currentIndex]!;
      results[currentIndex] = await normalizeEntryWithRetries({
        apiKey,
        entry,
        model,
        requestTimeoutMs,
        maxRetries,
        backoffBaseDelayMs,
        backoffMaxDelayMs,
      });
    }
  };

  const workerCount = Math.min(concurrency, Math.max(entriesToProcess.length, 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const predictions: PredictionsDataset = { entries: [] };
  const cooklangPredictions: CooklangPredictionsDataset = { entries: [] };
  const failures: ParseFailuresDataset = { entries: [] };

  for (const result of results) {
    if (!result) continue;
    if (result.ok) {
      predictions.entries.push(result.prediction);
      cooklangPredictions.entries.push(result.cooklang);
    } else {
      if (result.prediction) {
        predictions.entries.push(result.prediction);
      }
      if (result.cooklang) {
        cooklangPredictions.entries.push(result.cooklang);
      }
      failures.entries.push(result.failure);
    }
  }

  if (targetEntryKeys.size > 0) {
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

    predictions.entries = mergeByImageSet(
      existingPredictions.entries,
      predictions.entries,
      targetEntryKeys,
    );
    cooklangPredictions.entries = mergeByImageSet(
      existingCooklang.entries,
      cooklangPredictions.entries,
      targetEntryKeys,
    );
    failures.entries = mergeByImageSet(
      existingFailures.entries,
      failures.entries,
      targetEntryKeys,
    );
  }

  await Promise.all([
    writeJson(PREDICTIONS_PATH, predictions),
    writeJson(COOKLANG_PREDICTIONS_PATH, cooklangPredictions),
    writeJson(NORMALIZE_FAILURES_PATH, failures),
  ]);

  console.log(
    `Normalized ${predictions.entries.length} entries -> ${PREDICTIONS_PATH}`,
  );
  console.log(`Cooklang artifacts written to ${COOKLANG_PREDICTIONS_PATH}`);
  console.log(`Failures written to ${NORMALIZE_FAILURES_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
