import type { ParsedRecipe } from "recipe-domain";
import type {
  CooklangPredictionsDataset,
  CooklangRecipe,
  ExtractionPredictionsDataset,
  ExtractionRecipe,
  GroundTruthEntry,
  PredictionsDataset,
} from "../types/extraction";
import type {
  CanonicalizationDecision,
  CanonicalizationFile,
} from "../types/canonicalization";

function imageKey(images: string[]): string {
  return images.join("\0");
}

export function detailTitle(
  primary: { title: string } | null | undefined,
  fallback: string,
): string {
  return primary?.title || fallback;
}

function findByImages<T extends { images: string[] }>(
  entries: T[] | undefined,
  images: string[] | undefined,
): T | null {
  if (!entries || !images) return null;
  const key = imageKey(images);
  return entries.find((entry) => imageKey(entry.images) === key) ?? null;
}

export function findExtractionPrediction(
  groundTruth: GroundTruthEntry | undefined,
  predictions: ExtractionPredictionsDataset | null,
): ExtractionRecipe | null {
  return findByImages(predictions?.entries, groundTruth?.images)?.extracted ?? null;
}

export interface NormalizationDetailData {
  normalizedFallback: ParsedRecipe | null;
  extraction: ExtractionRecipe | null;
  cooklang: CooklangRecipe | null;
}

export function findNormalizationDetailData(
  groundTruth: GroundTruthEntry | undefined,
  predictions: PredictionsDataset | null,
  extractions: ExtractionPredictionsDataset | null,
  cooklangPredictions: CooklangPredictionsDataset | null,
): NormalizationDetailData {
  const images = groundTruth?.images;
  return {
    normalizedFallback:
      findByImages(predictions?.entries, images)?.predicted ?? null,
    extraction: findByImages(extractions?.entries, images)?.extracted ?? null,
    cooklang: findByImages(cooklangPredictions?.entries, images)?.cooklang ?? null,
  };
}

export function findCanonicalizedPrediction(
  groundTruth: GroundTruthEntry | undefined,
  predictions: PredictionsDataset | null,
): ParsedRecipe | null {
  return findByImages(predictions?.entries, groundTruth?.images)?.predicted ?? null;
}

export function findCanonicalizationDecisions(
  groundTruth: GroundTruthEntry | undefined,
  canonicalization: CanonicalizationFile | null,
): CanonicalizationDecision[] {
  return (
    findByImages(canonicalization?.entries, groundTruth?.images)?.decisions ?? []
  );
}
