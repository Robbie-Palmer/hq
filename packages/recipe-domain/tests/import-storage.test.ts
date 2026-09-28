import { describe, expect, it } from "vitest";
import {
  recipeImportImageExtension,
  RECIPE_IMPORT_IMAGE_MIME_TYPES,
  RECIPE_IMPORT_MAX_IMAGES,
  RECIPE_IMPORT_STAGES,
  RECIPE_IMPORT_STATUSES,
} from "../src/import-storage";

describe("recipe import contract", () => {
  it("publishes the workflow states and shared image limit", () => {
    expect(RECIPE_IMPORT_STATUSES).toEqual([
      "queued",
      "running",
      "succeeded",
      "failed",
    ]);
    expect(RECIPE_IMPORT_STAGES).toEqual([
      "extract",
      "normalize",
      "canonicalize",
      "finalize",
    ]);
    expect(RECIPE_IMPORT_MAX_IMAGES).toBe(6);
  });

  it("maps every accepted image type to its storage extension", () => {
    expect(
      RECIPE_IMPORT_IMAGE_MIME_TYPES.map((contentType) => [
        contentType,
        recipeImportImageExtension(contentType),
      ]),
    ).toEqual([
      ["image/jpeg", "jpg"],
      ["image/png", "png"],
      ["image/webp", "webp"],
    ]);
    expect(recipeImportImageExtension("image/gif")).toBeUndefined();
  });
});
