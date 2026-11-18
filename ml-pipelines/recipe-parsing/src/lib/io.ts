import { z } from "zod";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  GroundTruthDatasetSchema,
  PredictionsDatasetSchema,
  type GroundTruthDataset,
  type PredictionsDataset,
} from "recipe-parsing/schemas/ground-truth";
import {
  CooklangPredictionsDatasetSchema,
  ExtractionPredictionsDatasetSchema,
  StructuredTextPredictionsDatasetSchema,
  type CooklangPredictionsDataset,
  type ExtractionPredictionsDataset,
  type StructuredTextPredictionsDataset,
} from "recipe-parsing/schemas/stage-artifacts";
import {
  ParseFailuresDatasetSchema,
  type ParseFailuresDataset,
} from "recipe-parsing/schemas/parse-failures";

const DATA_DIR = "data";
const OUTPUTS_DIR = "outputs";

export const GROUND_TRUTH_PATH = join(DATA_DIR, "ground-truth.json");
export const IMAGES_DIR = join(DATA_DIR, "recipe-images");
export const PREPARED_PATH = join(OUTPUTS_DIR, "prepared.json");
export const IMAGE_ENTRIES_PATH = join(OUTPUTS_DIR, "image-entries.json");
export const PREDICTIONS_PATH = join(OUTPUTS_DIR, "predictions.json");
export const STRUCTURED_TEXT_PREDICTIONS_PATH = join(
  OUTPUTS_DIR,
  "structured-extractions.json",
);
export const COOKLANG_PREDICTIONS_PATH = join(
  OUTPUTS_DIR,
  "cooklang-recipes.json",
);
export const CANONICALIZED_PREDICTIONS_PATH = join(OUTPUTS_DIR, "predictions-canonicalized.json");
export const CANONICALIZATION_DECISIONS_PATH = join(OUTPUTS_DIR, "canonicalization-decisions.json");
export const EXTRACTION_PREDICTIONS_PATH = join(OUTPUTS_DIR, "extraction-predictions.json");
export const EXTRACTION_FAILURES_PATH = join(OUTPUTS_DIR, "extraction-failures.json");
export const NORMALIZE_FAILURES_PATH = join(OUTPUTS_DIR, "normalize-failures.json");
export const NORMALIZATION_METRICS_PATH = join(OUTPUTS_DIR, "normalization-metrics.json");
export const NORMALIZATION_PER_IMAGE_SCORES_PATH = join(OUTPUTS_DIR, "normalization-per-image-scores.json");
export const EXTRACTION_METRICS_PATH = join(OUTPUTS_DIR, "extraction-metrics.json");
export const EXTRACTION_PER_IMAGE_SCORES_PATH = join(OUTPUTS_DIR, "extraction-per-image-scores.json");
export const METRICS_PATH = join(OUTPUTS_DIR, "metrics.json");
export const PER_IMAGE_SCORES_PATH = join(OUTPUTS_DIR, "per-image-scores.json");
export const PARSE_FAILURES_PATH = join(OUTPUTS_DIR, "parse-failures.json");
export const DATASET_STATS_PATH = join(OUTPUTS_DIR, "dataset-stats.json");
export const IMAGES_PER_RECIPE_HISTOGRAM_PATH = join(OUTPUTS_DIR, "images-per-recipe-histogram.json");
export const CUISINE_DISTRIBUTION_PLOT_PATH = join(OUTPUTS_DIR, "cuisine-distribution.json");
export const TOP_INGREDIENTS_PLOT_PATH = join(OUTPUTS_DIR, "top-ingredients.json");
export const PER_ENTRY_SCORE_PLOT_PATH = join(OUTPUTS_DIR, "per-entry-score-plot.json");
export const PARAMS_PATH = "params.yaml";

export async function loadGroundTruth(): Promise<GroundTruthDataset> {
  const raw = JSON.parse(await readFile(GROUND_TRUTH_PATH, "utf-8"));
  return GroundTruthDatasetSchema.parse(raw);
}

export async function loadPreparedData(): Promise<GroundTruthDataset> {
  const raw = JSON.parse(await readFile(PREPARED_PATH, "utf-8"));
  return GroundTruthDatasetSchema.parse(raw);
}

const ImageEntriesSchema = z.object({
  entries: z.array(z.object({ images: z.array(z.string().min(1)).min(1) })),
});

export type ImageEntries = z.infer<typeof ImageEntriesSchema>;

export async function loadImageEntries(): Promise<ImageEntries> {
  const raw = JSON.parse(await readFile(IMAGE_ENTRIES_PATH, "utf-8"));
  return ImageEntriesSchema.parse(raw);
}

export async function loadPredictions(): Promise<PredictionsDataset> {
  const raw = JSON.parse(await readFile(PREDICTIONS_PATH, "utf-8"));
  return PredictionsDatasetSchema.parse(raw);
}

export async function loadStructuredTextPredictions(): Promise<StructuredTextPredictionsDataset> {
  const raw = JSON.parse(await readFile(STRUCTURED_TEXT_PREDICTIONS_PATH, "utf-8"));
  return StructuredTextPredictionsDatasetSchema.parse(raw);
}

export async function loadCooklangPredictions(): Promise<CooklangPredictionsDataset> {
  const raw = JSON.parse(await readFile(COOKLANG_PREDICTIONS_PATH, "utf-8"));
  return CooklangPredictionsDatasetSchema.parse(raw);
}

export async function loadCanonicalizedPredictions(): Promise<PredictionsDataset> {
  const raw = JSON.parse(await readFile(CANONICALIZED_PREDICTIONS_PATH, "utf-8"));
  return PredictionsDatasetSchema.parse(raw);
}

export async function loadExtractionPredictions(): Promise<ExtractionPredictionsDataset> {
  const raw = JSON.parse(await readFile(EXTRACTION_PREDICTIONS_PATH, "utf-8"));
  return ExtractionPredictionsDatasetSchema.parse(raw);
}

export async function loadExtractionFailures(): Promise<ParseFailuresDataset> {
  if (!existsSync(EXTRACTION_FAILURES_PATH)) {
    return { entries: [] };
  }
  const raw = JSON.parse(await readFile(EXTRACTION_FAILURES_PATH, "utf-8"));
  return ParseFailuresDatasetSchema.parse(raw);
}

export async function loadNormalizeFailures(): Promise<ParseFailuresDataset> {
  if (!existsSync(NORMALIZE_FAILURES_PATH)) {
    return { entries: [] };
  }
  const raw = JSON.parse(await readFile(NORMALIZE_FAILURES_PATH, "utf-8"));
  return ParseFailuresDatasetSchema.parse(raw);
}

export async function loadParseFailures(): Promise<ParseFailuresDataset> {
  if (!existsSync(PARSE_FAILURES_PATH)) {
    return { entries: [] };
  }
  const raw = JSON.parse(await readFile(PARSE_FAILURES_PATH, "utf-8"));
  return ParseFailuresDatasetSchema.parse(raw);
}

export async function listImageFiles(): Promise<string[]> {
  if (!existsSync(IMAGES_DIR)) return [];
  const files = await readdir(IMAGES_DIR);
  return files.filter(
    (f) =>
      f.endsWith(".jpg") || f.endsWith(".jpeg") || f.endsWith(".png"),
  );
}

const StageRetryParamsSchema = z.object({
  request_timeout_ms: z.number().int().positive(),
  max_retries: z.number().int().nonnegative(),
  concurrency: z.number().int().positive(),
  retry_base_delay_ms: z.number().int().positive(),
  retry_max_delay_ms: z.number().int().positive(),
});

const ImageParamsSchema = z.object({
  image_max_dim: z.number().int().positive(),
  image_jpeg_quality: z.number().int().min(1).max(100),
});

const ExtractParamsSchema = StageRetryParamsSchema.extend(ImageParamsSchema.shape).extend({
  model: z.string().min(1),
});

const NormalizeParamsSchema = StageRetryParamsSchema.extend({
  model: z.string().min(1),
});

const CanonicalizationParamsSchema = StageRetryParamsSchema.extend({
  model: z.string().min(1),
});

const PipelineParamsSchema = z.object({
  extract: ExtractParamsSchema,
  normalize: NormalizeParamsSchema,
  canonicalize: CanonicalizationParamsSchema.optional(),
});

export type ExtractParams = z.infer<typeof ExtractParamsSchema>;
export type NormalizeParams = z.infer<typeof NormalizeParamsSchema>;
export type CanonicalizationParams = z.infer<typeof CanonicalizationParamsSchema>;
export type PipelineParams = z.infer<typeof PipelineParamsSchema>;

export async function loadParams(): Promise<PipelineParams> {
  const raw = parseYaml(await readFile(PARAMS_PATH, "utf-8"));
  return PipelineParamsSchema.parse(raw);
}

export async function writeJson(
  path: string,
  data: unknown,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + "\n");
}
