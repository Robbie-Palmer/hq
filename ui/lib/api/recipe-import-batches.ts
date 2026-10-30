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
  kind: "structured" | "photo";
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
  photoImages?: PhotoBatchImage[];
  photoManifest?: PhotoBatchManifest | null;
};
export type PhotoBatchImage = {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  position: number;
};
export type PhotoBatchManifestGroup = {
  position: number;
  title?: string;
  jobId: string;
  imageIds: string[];
};
export type PhotoBatchManifest = {
  version: number;
  checksum: string;
  confirmedAt: string;
  groups: PhotoBatchManifestGroup[];
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
export function createPhotoImportBatch(input: {
  idempotencyKey: string;
  visibility: RecipeVisibility;
  duplicatePolicy: "skip" | "allow";
  images: File[];
}) {
  const form = new FormData();
  form.set("idempotencyKey", input.idempotencyKey);
  form.set("visibility", input.visibility);
  form.set("duplicatePolicy", input.duplicatePolicy);
  for (const image of input.images) form.append("images", image);
  return apiRequest<ImportBatch>(`${recipeImportBatchesPath}/photos`, {
    method: "POST",
    body: form,
  });
}
export function confirmPhotoBatchManifest(
  batchId: string,
  input: {
    idempotencyKey: string;
    expectedVersion: number;
    groups: Array<{ title?: string; imageIds: string[] }>;
  },
) {
  return apiRequest<ImportBatch>(
    `${recipeImportBatchesPath}/${batchId}/photo-manifests`,
    { method: "POST", json: input },
  );
}
export const photoBatchImagePath = (batchId: string, imageId: string) =>
  `${recipeImportBatchesPath}/${batchId}/photos/${imageId}`;
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
