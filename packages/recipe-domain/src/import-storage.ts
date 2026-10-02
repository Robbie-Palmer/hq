export const RECIPE_IMPORT_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
] as const;

export type RecipeImportStatus = (typeof RECIPE_IMPORT_STATUSES)[number];

export const RECIPE_IMPORT_STAGES = [
  "extract",
  "normalize",
  "canonicalize",
  "finalize",
] as const;

export type ImportStage = (typeof RECIPE_IMPORT_STAGES)[number];

export const RECIPE_IMPORT_MAX_IMAGES = 6;
export const RECIPE_IMPORT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const RECIPE_IMPORT_MAX_TOTAL_BYTES = 30 * 1024 * 1024;
export const RECIPE_IMPORT_MAX_ACTIVE_JOBS = 2;
export const RECIPE_IMPORT_DAILY_JOB_LIMIT = 10;

export const RECIPE_IMPORT_IMAGE_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export const RECIPE_IMPORT_IMAGE_MIME_TYPES = Object.freeze(
  Object.keys(RECIPE_IMPORT_IMAGE_EXTENSIONS) as Array<
    keyof typeof RECIPE_IMPORT_IMAGE_EXTENSIONS
  >,
);

export function recipeImportImageExtension(
  contentType: string,
): string | undefined {
  if (!(contentType in RECIPE_IMPORT_IMAGE_EXTENSIONS)) return undefined;
  return RECIPE_IMPORT_IMAGE_EXTENSIONS[
    contentType as keyof typeof RECIPE_IMPORT_IMAGE_EXTENSIONS
  ];
}

export function importJobPrefix(jobId: string): string {
  return `imports/${jobId}/`;
}

export function sourcePrefix(jobId: string): string {
  return `${importJobPrefix(jobId)}source/`;
}

export function sourceImageKey(
  jobId: string,
  index: number,
  extension: string,
): string {
  return `${sourcePrefix(jobId)}${index}.${extension}`;
}

export function artifactKey(
  jobId: string,
  stage: ImportStage,
  filename: string,
): string {
  return `${importJobPrefix(jobId)}${stage}/${filename}`;
}
