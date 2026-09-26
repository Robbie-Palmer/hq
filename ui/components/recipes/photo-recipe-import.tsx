"use client";

import {
  AlertCircle,
  Camera,
  CheckCircle2,
  FileText,
  Images,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { isRecord } from "ts-base/records";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api/http";

type PhotoImportStatus = "queued" | "running" | "succeeded" | "failed";

export type PhotoRecipeImportDraft = {
  cooklang: {
    frontmatter: {
      title?: string;
      description?: string;
      cuisine?: string[];
      servings?: number;
      prepTime?: number;
      cookTime?: number;
    };
    body: string;
  };
  recipe: {
    title: string;
    description: string;
    cuisine: string[];
    servings: number;
    prepTime?: number;
    cookTime?: number;
  };
};

type PhotoImportJob = {
  id: string;
  status: PhotoImportStatus;
  progressLabel?: string | null;
  error?: { message?: string };
  draft?: PhotoRecipeImportDraft;
};

const PHOTO_IMPORT_POLL_INTERVAL_MS = 1_500;
const MAX_PHOTO_POLL_FAILURES = 3;
const MAX_PHOTO_COUNT = 6;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_PHOTO_BYTES = 30 * 1024 * 1024;
const MAX_RECIPE_SOURCE_LENGTH = 10_000;
const ACCEPTED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function hasOptionalString(record: Record<string, unknown>, key: string) {
  return record[key] === undefined || typeof record[key] === "string";
}

function hasNullableOptionalString(
  record: Record<string, unknown>,
  key: string,
) {
  return record[key] === null || hasOptionalString(record, key);
}

function hasOptionalNumber(record: Record<string, unknown>, key: string) {
  return record[key] === undefined || typeof record[key] === "number";
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isPhotoRecipeImportDraft(
  value: unknown,
): value is PhotoRecipeImportDraft {
  if (!isRecord(value) || !isRecord(value.cooklang) || !isRecord(value.recipe))
    return false;
  const { cooklang, recipe } = value;
  if (!isRecord(cooklang.frontmatter)) return false;
  const frontmatter = cooklang.frontmatter;
  return (
    typeof cooklang.body === "string" &&
    hasOptionalString(frontmatter, "title") &&
    hasOptionalString(frontmatter, "description") &&
    (frontmatter.cuisine === undefined || isStringArray(frontmatter.cuisine)) &&
    hasOptionalNumber(frontmatter, "servings") &&
    hasOptionalNumber(frontmatter, "prepTime") &&
    hasOptionalNumber(frontmatter, "cookTime") &&
    typeof recipe.title === "string" &&
    typeof recipe.description === "string" &&
    isStringArray(recipe.cuisine) &&
    typeof recipe.servings === "number" &&
    hasOptionalNumber(recipe, "prepTime") &&
    hasOptionalNumber(recipe, "cookTime")
  );
}

function isPhotoImportJob(value: unknown): value is PhotoImportJob {
  if (!isRecord(value)) return false;
  const validStatus =
    value.status === "queued" ||
    value.status === "running" ||
    value.status === "succeeded" ||
    value.status === "failed";
  const validError =
    value.error === undefined ||
    (isRecord(value.error) && hasOptionalString(value.error, "message"));
  return (
    typeof value.id === "string" &&
    validStatus &&
    hasNullableOptionalString(value, "progressLabel") &&
    validError &&
    (value.draft === undefined || isPhotoRecipeImportDraft(value.draft))
  );
}

async function fetchPhotoImportJob(
  jobId: string,
  signal: AbortSignal,
): Promise<PhotoImportJob> {
  const body = await apiRequest<unknown>(`/api/recipe-imports/${jobId}`, {
    signal,
    fallbackMessage: "We couldn't check the photo import status.",
  });
  if (!isPhotoImportJob(body) || body.id !== jobId) {
    throw new Error("We couldn't check the photo import status.");
  }
  return body;
}

function ImportStatusIcon({ status }: Readonly<{ status: PhotoImportStatus }>) {
  if (status === "succeeded") {
    return (
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--sage)]" />
    );
  }
  if (status === "failed") {
    return <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />;
  }
  return (
    <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-[var(--terracotta)]" />
  );
}

function importButtonLabel(
  uploading: boolean,
  status?: PhotoImportStatus,
): string {
  if (uploading) return "Uploading…";
  if (status === "queued" || status === "running") return "Reading recipe…";
  return "Import from photos";
}

function importProgressLabel(job: PhotoImportJob): string {
  if (job.progressLabel) return job.progressLabel;
  if (job.status === "queued") return "Waiting to read your photos";
  if (job.status === "running") return "Processing your recipe";
  if (job.status === "succeeded") return "Draft ready";
  return "Import failed";
}

type PhotoPollOutcome =
  | { kind: "continue"; job: PhotoImportJob }
  | { kind: "draft"; draft: PhotoRecipeImportDraft; job: PhotoImportJob }
  | { kind: "error"; message: string; job: PhotoImportJob };

function photoPollOutcome(job: PhotoImportJob): PhotoPollOutcome {
  if (job.status === "succeeded") {
    if (!job.draft) {
      return {
        kind: "error",
        job,
        message: "The import finished without an editable recipe draft.",
      };
    }
    if (job.draft.cooklang.body.length > MAX_RECIPE_SOURCE_LENGTH) {
      return {
        kind: "error",
        job: {
          ...job,
          status: "failed",
          progressLabel: "Imported recipe is too long",
        },
        message:
          "The imported recipe is too long to save. Try fewer photos or import the recipe in sections.",
      };
    }
    return { kind: "draft", draft: job.draft, job };
  }
  if (job.status === "failed") {
    return {
      kind: "error",
      job,
      message:
        job.error?.message ||
        "We couldn't read a recipe from those photos. Try clearer, well-lit images.",
    };
  }
  return { kind: "continue", job };
}

function photoPollErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "We couldn't check the photo import status.";
}

function SelectedPhoto({
  file,
  index,
  onRemove,
  disabled,
}: Readonly<{
  file: File;
  index: number;
  onRemove: (index: number) => void;
  disabled: boolean;
}>) {
  return (
    <li className="flex items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--card)] px-2.5 py-2 text-sm">
      <FileText className="size-4 shrink-0 text-[var(--terracotta)]" />
      <span className="min-w-0 flex-1 truncate">{file.name}</span>
      <span className="text-xs text-[var(--ink-4)]">
        {(file.size / 1024 / 1024).toFixed(1)} MB
      </span>
      <button
        type="button"
        aria-label={`Remove ${file.name}`}
        className="rounded p-1 text-[var(--ink-3)] hover:bg-[var(--paper-warm)] hover:text-[var(--ink)]"
        disabled={disabled}
        onClick={() => onRemove(index)}
      >
        <X className="size-3.5" />
      </button>
    </li>
  );
}

export function PhotoRecipeImport({
  active,
  onDraftReady,
}: Readonly<{
  active: boolean;
  onDraftReady: (draft: PhotoRecipeImportDraft) => void;
}>) {
  const [files, setFiles] = useState<File[]>([]);
  const [job, setJob] = useState<PhotoImportJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const onDraftReadyRef = useRef(onDraftReady);
  const handledJobIdRef = useRef<string | null>(null);
  const jobId = job?.id;
  const jobStatus = job?.status;
  const processing =
    uploading || jobStatus === "queued" || jobStatus === "running";

  useEffect(() => {
    onDraftReadyRef.current = onDraftReady;
  }, [onDraftReady]);

  useEffect(() => {
    if (!active || !jobId || handledJobIdRef.current === jobId) return;
    const currentJobId = jobId;

    let activeRequest = true;
    let pollTimeout: number | undefined;
    let consecutiveFailures = 0;
    const controller = new AbortController();

    function schedulePoll() {
      pollTimeout = window.setTimeout(poll, PHOTO_IMPORT_POLL_INTERVAL_MS);
    }

    function handlePollResult(body: PhotoImportJob) {
      consecutiveFailures = 0;
      setError(null);
      const outcome = photoPollOutcome(body);
      setJob(outcome.job);
      if (outcome.kind === "continue") {
        schedulePoll();
        return;
      }
      handledJobIdRef.current = body.id;
      if (outcome.kind === "draft") {
        onDraftReadyRef.current(outcome.draft);
        return;
      }
      setError(outcome.message);
    }

    function handlePollError(pollError: unknown) {
      if (controller.signal.aborted || !activeRequest) return;
      const message = photoPollErrorMessage(pollError);
      consecutiveFailures += 1;
      if (consecutiveFailures < MAX_PHOTO_POLL_FAILURES) {
        setError(`${message} Retrying…`);
        schedulePoll();
        return;
      }
      handledJobIdRef.current = currentJobId;
      setJob((current) =>
        current?.id === currentJobId
          ? {
              ...current,
              status: "failed",
              progressLabel: "Status check failed",
              error: { message },
            }
          : current,
      );
      setError(`${message} Start the import again to retry.`);
    }

    async function poll() {
      try {
        const body = await fetchPhotoImportJob(currentJobId, controller.signal);
        if (!activeRequest) return;
        handlePollResult(body);
      } catch (pollError) {
        handlePollError(pollError);
      }
    }

    void poll();
    return () => {
      activeRequest = false;
      controller.abort();
      if (pollTimeout !== undefined) window.clearTimeout(pollTimeout);
    };
  }, [active, jobId]);

  function addFiles(selectedFiles: FileList | null) {
    if (!selectedFiles?.length) return;
    setError(null);
    const incoming = Array.from(selectedFiles);
    if (incoming.some((file) => !ACCEPTED_PHOTO_TYPES.has(file.type))) {
      setError("Choose JPEG, PNG, or WebP images.");
      return;
    }
    const oversized = incoming.find((file) => file.size > MAX_PHOTO_BYTES);
    if (oversized) {
      setError(`“${oversized.name}” is larger than 10 MB.`);
      return;
    }
    if (files.length + incoming.length > MAX_PHOTO_COUNT) {
      setError(`You can import up to ${MAX_PHOTO_COUNT} photos at once.`);
      return;
    }
    const totalBytes = [...files, ...incoming].reduce(
      (total, file) => total + file.size,
      0,
    );
    if (totalBytes > MAX_TOTAL_PHOTO_BYTES) {
      setError("Selected photos must total 30 MB or less.");
      return;
    }
    setFiles((current) => [...current, ...incoming]);
  }

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    addFiles(event.target.files);
    event.target.value = "";
  }

  function removeFile(index: number) {
    setFiles((current) =>
      current.filter((_, itemIndex) => itemIndex !== index),
    );
  }

  function openCamera() {
    cameraInputRef.current?.click();
  }

  function openPhotoPicker() {
    photoInputRef.current?.click();
  }

  async function importPhotos() {
    if (!files.length || processing) return;
    setUploading(true);
    setError(null);
    setJob(null);
    handledJobIdRef.current = null;
    const form = new FormData();
    for (const file of files) form.append("images", file);
    try {
      const body = await apiRequest<unknown>("/api/recipe-imports", {
        method: "POST",
        body: form,
        fallbackMessage: "The photos could not be uploaded.",
      });
      if (!isPhotoImportJob(body)) {
        throw new Error("The photos could not be uploaded.");
      }
      setJob(body);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "The photos could not be uploaded.",
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="grid gap-3 rounded-lg border border-dashed border-[var(--line-strong)] bg-[var(--paper-warm)] p-3">
      <div>
        <p className="rt-mono text-[var(--ink-3)]">Recipe photos</p>
        <p className="mt-1 text-xs text-[var(--ink-3)]">
          Add up to six clear photos. Include every ingredient list and
          instruction page.
        </p>
      </div>
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="sr-only"
        aria-label="Take a recipe photo"
        tabIndex={-1}
        onChange={selectFiles}
      />
      <input
        ref={photoInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="sr-only"
        aria-label="Choose recipe photos"
        tabIndex={-1}
        onChange={selectFiles}
      />
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={openCamera}
          disabled={processing}
        >
          <Camera /> Take photo
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={openPhotoPicker}
          disabled={processing}
        >
          <Images /> Choose photos
        </Button>
      </div>
      {files.length > 0 && (
        <ul className="grid gap-1.5" aria-label="Selected recipe photos">
          {files.map((file, index) => (
            <SelectedPhoto
              key={`${file.name}-${file.lastModified}-${index}`}
              file={file}
              index={index}
              onRemove={removeFile}
              disabled={processing}
            />
          ))}
        </ul>
      )}
      <Button
        type="button"
        onClick={() => void importPhotos()}
        disabled={!files.length || processing}
        className="bg-[var(--terracotta)] text-white hover:bg-[var(--terracotta-deep)]"
      >
        {processing ? <Loader2 className="animate-spin" /> : <Upload />}
        {importButtonLabel(uploading, jobStatus)}
      </Button>
      {job && (
        <div
          className="flex items-start gap-2 rounded-md border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-sm"
          role="status"
          aria-live="polite"
        >
          <ImportStatusIcon status={job.status} />
          <span>
            {importProgressLabel(job)}
            {job.status === "succeeded" &&
              " — refine it below, then save it to your recipe box."}
          </span>
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="flex items-start gap-1.5 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
