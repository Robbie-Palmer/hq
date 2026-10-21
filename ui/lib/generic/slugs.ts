import { normalizeSlug } from "ts-base/strings";

export { normalizeSlug };

export function validateSlug(filename: string): void {
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, ""); // Remove extension
  const normalized = normalizeSlug(nameWithoutExt);
  if (nameWithoutExt !== normalized) {
    throw new Error(
      `Invalid filename: "${filename}". Filenames must be lowercase alphanumeric with hyphens (kebab-case). Expected: "${normalized}".`,
    );
  }
}
