import type { BatchDraft } from "recipe-domain/batch-import";
import type { RecipeVisibility } from "recipe-domain/visibility";
import { apiRequest } from "./http";

export const recipeImportBatchesPath = "/api/recipe-import-batches";
export type ImportBatchItem = {
  id: string;
  sourceLabel: string;
  status: string;
  reviewState: string;
  errorType?: string;
  errorMessage?: string;
  draft?: BatchDraft;
  draftVersion: number;
  archive?: { archiveName: string; archiveChecksum: string; entryPath: string };
  undoOutcome?: string;
  undoMessage?: string;
};
export type ImportBatch = {
  id: string;
  createdAt: string;
  visibility: RecipeVisibility;
  status: string;
  items: ImportBatchItem[];
  counts: {
    processing: number;
    ready: number;
    failed: number;
    accepted: number;
    skipped: number;
  };
};
export type ImportBatchSummary = { id: string; createdAt: string };
export type BatchRecipeSave = {
  slug: string;
  title: string;
  description: string;
  body: string;
  visibility: RecipeVisibility;
};
export const batchItemPath = (batchId: string, itemId: string) =>
  `${recipeImportBatchesPath}/${batchId}/items/${itemId}`;
export function startImportBatch(batchId: string) {
  return apiRequest(`${recipeImportBatchesPath}/${batchId}/execution`, {
    method: "PUT",
    json: { state: "started" },
  });
}
export function updateBatchItemReview(
  batchId: string,
  itemId: string,
  action: "skip" | "retry",
) {
  const path = batchItemPath(batchId, itemId);
  if (action === "retry")
    return apiRequest(`${path}/attempts`, { method: "POST" });
  return apiRequest(`${path}/review`, {
    method: "PUT",
    json: { state: "skipped" },
  });
}
export function batchErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The batch could not be updated.";
}
