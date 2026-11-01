import { CooklangParser } from "@cooklang/cooklang";
import { httpUrl } from "ts-base/urls";
import { z } from "zod";
import { deriveRecipeFromCooklang } from "./cooklang.js";
import type { SchemaOrgRecipeFileImport } from "./schema-org.js";
import { parseSchemaOrgRecipeJson } from "./schema-org.js";

export const RecipeFileFormatSchema = z.enum(["cooklang", "schema-org"]);

export type RecipeFileFormat = z.infer<typeof RecipeFileFormatSchema>;

export type RecipeFileImport = SchemaOrgRecipeFileImport;

const parser = new CooklangParser();

function fileFormat(filename: string): RecipeFileFormat | undefined {
  const extension = filename.toLowerCase().split(".").pop();
  if (extension === "cook" || extension === "cooklang") {
    return RecipeFileFormatSchema.enum.cooklang;
  }
  if (extension === "json" || extension === "jsonld") {
    return RecipeFileFormatSchema.enum["schema-org"];
  }
  return undefined;
}

function unsupportedRecipeFileFormat(format: never): never {
  throw new TypeError(`Unsupported recipe file format: ${String(format)}`);
}

function cooklangBody(source: string): string | undefined {
  const normalized = source.replace(/^\uFEFF/, "");
  const frontmatter = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(
    normalized,
  );
  if (normalized.startsWith("---") && !frontmatter) return undefined;
  return (frontmatter ? normalized.slice(frontmatter[0].length) : normalized).trim();
}

function metadataValue(
  metadata: Map<unknown, unknown>,
  key: string,
): unknown {
  const normalizedKey = key.toLowerCase();
  for (const [candidate, value] of metadata) {
    if (String(candidate).toLowerCase() === normalizedKey) return value;
  }
  return undefined;
}

function numericValue(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number.parseFloat(value);
  return Number.NaN;
}

function positiveNumber(value: unknown): number | undefined {
  const parsed = numericValue(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  const parsed = numericValue(value);
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.round(parsed)
    : undefined;
}

function cuisineLabels(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return typeof value === "string"
    ? value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

function fallbackTitle(filename: string): string {
  const basename = filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
  return basename || "Imported recipe";
}

function parseCooklangRecipeFile(
  source: string,
  filename: string,
): RecipeFileImport | null {
  const body = cooklangBody(source);
  if (!body) return null;

  const parsed = (() => {
    try {
      return parser.parse(source.replace(/^\uFEFF/, ""))[0];
    } catch {
      return undefined;
    }
  })();
  if (!parsed) return null;
  const title = (parsed.title?.trim() || fallbackTitle(filename)).slice(0, 120);
  const description = (
    parsed.description?.trim() ||
    `Recipe for ${title}, imported from a Cooklang file.`
  ).slice(0, 500);
  const servings = positiveNumber(parsed.servings) ?? 1;
  const parsedTime =
    parsed.time && typeof parsed.time === "object" ? parsed.time : undefined;
  const prepTime =
    nonNegativeNumber(metadataValue(parsed.rawMetadata, "prepTime")) ??
    nonNegativeNumber(parsedTime?.prep_time);
  const cookTime =
    nonNegativeNumber(metadataValue(parsed.rawMetadata, "cookTime")) ??
    nonNegativeNumber(parsedTime?.cook_time);
  const cuisine = cuisineLabels(parsed.cuisine);
  const derived = deriveRecipeFromCooklang({
    frontmatter: {
      title,
      description,
      servings,
      cuisine,
      prepTime,
      cookTime,
      tags: [],
    },
    body,
    diagnostics: [],
  });
  if (!derived.derived) return null;

  const canonical = httpUrl(metadataValue(parsed.rawMetadata, "canonical"));
  return {
    title,
    description,
    cuisine: cuisine.join(", "),
    servings,
    prepTime,
    cookTime,
    source: body,
    ...(canonical ? { url: canonical } : {}),
  };
}

export async function parseRecipeFile(
  filename: string,
  source: string,
): Promise<RecipeFileImport | null> {
  const format = fileFormat(filename);
  switch (format) {
    case RecipeFileFormatSchema.enum.cooklang:
      return parseCooklangRecipeFile(source, filename);
    case RecipeFileFormatSchema.enum["schema-org"]:
      return await parseSchemaOrgRecipeJson(source);
    case undefined:
      return null;
    default:
      return unsupportedRecipeFileFormat(format);
  }
}
