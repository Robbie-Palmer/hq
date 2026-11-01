"use client";

import { useRef, useState } from "react";
import {
  RECIPE_IMPORT_IMAGE_MIME_TYPES,
  RECIPE_IMPORT_MAX_IMAGE_BYTES,
  RECIPE_IMPORT_MAX_TOTAL_BYTES,
} from "recipe-domain/import-storage";
import { RECIPE_PHOTO_BATCH_MAX_IMAGES } from "recipe-domain/photo-batch";
import type { RecipeVisibility } from "recipe-domain/visibility";
import { PhotoBatchGrouping } from "@/components/recipes/photo-batch-grouping";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  batchErrorMessage,
  createPhotoImportBatch,
  type ImportBatch,
} from "@/lib/api/recipe-import-batches";

type DuplicatePolicy = "skip" | "allow";

function validatePhotos(files: File[]): string | null {
  if (files.length > RECIPE_PHOTO_BATCH_MAX_IMAGES)
    return `Choose at most ${RECIPE_PHOTO_BATCH_MAX_IMAGES} photos.`;
  const accepted = new Set<string>(RECIPE_IMPORT_IMAGE_MIME_TYPES);
  const invalid = files.find((file) => !accepted.has(file.type));
  if (invalid) return `${invalid.name} must be a JPEG, PNG, or WebP image.`;
  const oversized = files.find(
    (file) => file.size > RECIPE_IMPORT_MAX_IMAGE_BYTES,
  );
  if (oversized) return `${oversized.name} exceeds 10 MB.`;
  const total = files.reduce((sum, file) => sum + file.size, 0);
  return total > RECIPE_IMPORT_MAX_TOTAL_BYTES
    ? "Photo batches must total 30 MB or less."
    : null;
}

function usePhotoBatchCapture(
  visibility: RecipeVisibility,
  duplicatePolicy: DuplicatePolicy,
) {
  const [files, setFiles] = useState<File[]>([]);
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submission = useRef<{ key: string; input: string } | null>(null);
  function choose(next: File[]) {
    const issue = validatePhotos(next);
    setError(issue);
    setBatch(null);
    setFiles(issue ? [] : next);
  }
  async function upload() {
    setBusy(true);
    setError(null);
    try {
      const input = JSON.stringify([
        files.map((file) => [
          file.name,
          file.size,
          file.type,
          file.lastModified,
        ]),
        visibility,
        duplicatePolicy,
      ]);
      if (submission.current?.input !== input)
        submission.current = { key: crypto.randomUUID(), input };
      setBatch(
        await createPhotoImportBatch({
          idempotencyKey: submission.current.key,
          visibility,
          duplicatePolicy,
          images: files,
        }),
      );
    } catch (cause) {
      setError(batchErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return { batch, busy, choose, error, files, setBatch, setFiles, upload };
}

function PhotoSelection({
  busy,
  files,
  onChoose,
  onUpload,
}: Readonly<{
  busy: boolean;
  files: File[];
  onChoose: (files: File[]) => void;
  onUpload: () => void;
}>) {
  return (
    <>
      <label htmlFor="batch-recipe-photos" className="my-3 grid gap-2">
        Recipe page photos
        <Input
          id="batch-recipe-photos"
          type="file"
          multiple
          accept={RECIPE_IMPORT_IMAGE_MIME_TYPES.join(",")}
          disabled={busy}
          onChange={(event) => {
            onChoose(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      </label>
      {files.length > 0 && (
        <>
          <ul className="my-3 text-sm" aria-label="Photo batch pages">
            {files.map((file, index) => (
              <li key={`${file.name}-${file.lastModified}-${index}`}>
                {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
              </li>
            ))}
          </ul>
          <Button disabled={busy} onClick={onUpload}>
            Upload pages
          </Button>
        </>
      )}
    </>
  );
}

export function PhotoBatchCapture({
  duplicatePolicy,
  hasBatch,
  onStart,
  visibility,
}: Readonly<{
  duplicatePolicy: DuplicatePolicy;
  hasBatch: boolean;
  onStart: (batchId: string) => Promise<void>;
  visibility: RecipeVisibility;
}>) {
  const capture = usePhotoBatchCapture(visibility, duplicatePolicy);
  return (
    <details
      open={!hasBatch && capture.files.length > 0}
      className="my-4 rounded-lg border border-[var(--line)] p-4"
    >
      <summary className="cursor-pointer">New photo batch</summary>
      <p className="my-2 text-sm text-[var(--ink-3)]">
        Upload up to {RECIPE_PHOTO_BATCH_MAX_IMAGES} pages, then group and order
        one to six pages for each recipe before extraction starts.
      </p>
      {capture.error && (
        <p role="alert" className="my-3 text-destructive">
          {capture.error}
        </p>
      )}
      {!capture.batch && (
        <PhotoSelection
          busy={capture.busy}
          files={capture.files}
          onChoose={capture.choose}
          onUpload={() => void capture.upload()}
        />
      )}
      {capture.batch && (
        <PhotoBatchGrouping
          batch={capture.batch}
          onConfirmed={async (batchId) => {
            capture.setBatch(null);
            capture.setFiles([]);
            await onStart(batchId);
          }}
        />
      )}
    </details>
  );
}
