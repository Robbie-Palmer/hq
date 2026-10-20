import { createHash } from "node:crypto";
import { z } from "zod";

export const EXTRACTED_RECIPE_SCHEMA_VERSION = 1;

const NonEmptyStringSchema = z.string().min(1);

export const ExtractedRecipeItemSchema = z.object({
  text: NonEmptyStringSchema,
  name: NonEmptyStringSchema.optional(),
  quantity: z.union([z.string(), z.number()]).optional(),
  unit: NonEmptyStringSchema.optional(),
  note: NonEmptyStringSchema.optional(),
});

export const ExtractedRecipeSectionSchema = z.object({
  name: NonEmptyStringSchema.optional(),
  items: z.array(ExtractedRecipeItemSchema).min(1),
});

const PartySchema = z.object({
  name: NonEmptyStringSchema,
  url: NonEmptyStringSchema.optional(),
});

const RatingSchema = z.object({
  value: z.union([z.string(), z.number()]),
  count: z.union([z.string(), z.number()]).optional(),
  best: z.union([z.string(), z.number()]).optional(),
  worst: z.union([z.string(), z.number()]).optional(),
});

export const ExtractedRecipeSchema = z.object({
  schemaVersion: z.literal(EXTRACTED_RECIPE_SCHEMA_VERSION),
  provenance: z.object({
    dataset: NonEmptyStringSchema,
    datasetName: NonEmptyStringSchema.optional(),
    recordId: NonEmptyStringSchema,
    url: NonEmptyStringSchema,
    license: NonEmptyStringSchema,
    retrievedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    checksum: NonEmptyStringSchema,
    format: NonEmptyStringSchema.optional(),
    revision: NonEmptyStringSchema.optional(),
  }),
  completeness: z.enum(["complete", "ingredients-only"]),
  contentSignature: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  description: NonEmptyStringSchema.optional(),
  ingredientSections: z.array(ExtractedRecipeSectionSchema).min(1),
  instructionSections: z.array(ExtractedRecipeSectionSchema),
  equipment: z.array(ExtractedRecipeItemSchema),
  timers: z.array(ExtractedRecipeItemSchema),
  metadata: z.object({
    cuisines: z.array(NonEmptyStringSchema).optional(),
    categories: z.array(NonEmptyStringSchema).optional(),
    tags: z.array(NonEmptyStringSchema).optional(),
    servings: NonEmptyStringSchema.optional(),
    yields: z.array(NonEmptyStringSchema).optional(),
    prepTime: NonEmptyStringSchema.optional(),
    cookTime: NonEmptyStringSchema.optional(),
    totalTime: NonEmptyStringSchema.optional(),
    difficulty: NonEmptyStringSchema.optional(),
    authors: z.array(PartySchema).optional(),
    publishers: z.array(PartySchema).optional(),
    sourceOrganizations: z.array(PartySchema).optional(),
    datePublished: NonEmptyStringSchema.optional(),
    images: z.array(NonEmptyStringSchema).optional(),
    notes: z.array(NonEmptyStringSchema).optional(),
    rating: RatingSchema.optional(),
    nutrition: z.record(z.string(), z.unknown()).optional(),
    sourceMetadata: z.record(z.string(), z.unknown()).optional(),
  }),
});

function text(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function strings(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(values.map(text).filter(Boolean))];
}

function item(value) {
  if (typeof value === "string" || typeof value === "number") {
    const normalizedText = text(value);
    return normalizedText ? { text: normalizedText } : undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const normalizedText = text(value.text);
  if (!normalizedText) return undefined;
  const name = text(value.name);
  const quantity =
    typeof value.quantity === "number" && Number.isFinite(value.quantity)
      ? value.quantity
      : text(value.quantity);
  const unit = text(value.unit);
  const note = text(value.note);
  return {
    text: normalizedText,
    ...(name ? { name } : {}),
    ...(quantity !== "" ? { quantity } : {}),
    ...(unit ? { unit } : {}),
    ...(note ? { note } : {}),
  };
}

function sections(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((section) => {
    if (!section || typeof section !== "object") return [];
    const items = (section.items || section.steps || []).map(item).filter(Boolean);
    if (!items.length) return [];
    const name = text(section.name);
    return [{ ...(name ? { name } : {}), items }];
  });
}

function parties(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values.flatMap((party) => {
    if (typeof party === "string") return text(party) ? [{ name: text(party) }] : [];
    if (!party || typeof party !== "object") return [];
    const name = text(party.name);
    const url = text(party.url);
    return name ? [{ name, ...(url ? { url } : {}) }] : [];
  });
}

function record(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return Object.keys(value).length ? value : undefined;
}

function optionalStrings(value) {
  const values = strings(value);
  return values.length ? values : undefined;
}

function optionalParties(value) {
  const values = parties(value);
  return values.length ? values : undefined;
}

function optionalText(value) {
  return text(value) || undefined;
}

function withoutUndefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

function metadataFrom(value) {
  const supplied = value.metadata && typeof value.metadata === "object" ? value.metadata : {};
  return withoutUndefined({
    cuisines: optionalStrings(supplied.cuisines ?? value.cuisine),
    categories: optionalStrings(supplied.categories ?? value.category),
    tags: optionalStrings(supplied.tags),
    servings: optionalText(supplied.servings ?? value.servings),
    yields: optionalStrings(supplied.yields),
    prepTime: optionalText(supplied.prepTime ?? value.prepTime),
    cookTime: optionalText(supplied.cookTime ?? value.cookTime),
    totalTime: optionalText(supplied.totalTime),
    difficulty: optionalText(supplied.difficulty),
    authors: optionalParties(supplied.authors),
    publishers: optionalParties(supplied.publishers),
    sourceOrganizations: optionalParties(supplied.sourceOrganizations),
    datePublished: optionalText(supplied.datePublished),
    images: optionalStrings(supplied.images),
    notes: optionalStrings(supplied.notes),
    rating: record(supplied.rating),
    nutrition: record(supplied.nutrition ?? value.nutrition),
    sourceMetadata: record(supplied.sourceMetadata),
  });
}

function recipeProvenance(source, snapshot, value, contentSignature) {
  return withoutUndefined({
    dataset: source.id,
    datasetName: optionalText(source.name),
    recordId: optionalText(value.sourceRecordId) ?? contentSignature,
    url: optionalText(value.sourceUrl) ?? source.url,
    license: source.license,
    retrievedAt: snapshot.retrievedAt,
    checksum: optionalText(value.sourceChecksum) ?? contentSignature,
    format: optionalText(source.format),
    revision: optionalText(source.revision),
  });
}

export function createExtractedRecipe(source, snapshot, value, options = {}) {
  const title = text(value.title);
  const ingredientSections = sections(value.ingredientSections ?? value.ingredientGroups);
  const instructionSections = sections(
    value.instructionSections ?? [{ items: value.instructions }],
  );
  const completeness = options.completeness ?? "complete";
  if (!title || !ingredientSections.length) {
    throw new Error("missing title or ingredients");
  }
  if (completeness === "complete" && !instructionSections.length) {
    throw new Error("missing instructions");
  }
  const contentSignature = createHash("sha256")
    .update(JSON.stringify({ title, ingredientSections, instructionSections }))
    .digest("hex");
  return ExtractedRecipeSchema.parse({
    schemaVersion: EXTRACTED_RECIPE_SCHEMA_VERSION,
    provenance: recipeProvenance(source, snapshot, value, contentSignature),
    completeness,
    contentSignature,
    title,
    description: optionalText(value.description),
    ingredientSections,
    instructionSections,
    equipment: (value.equipment || []).map(item).filter(Boolean),
    timers: (value.timers || []).map(item).filter(Boolean),
    metadata: metadataFrom(value),
  });
}

export function toLegacyRecipe(recipe, value = {}) {
  return {
    sourceDataset: recipe.provenance.dataset,
    sourceRecordId: recipe.provenance.recordId,
    sourceUrl: recipe.provenance.url,
    license: recipe.provenance.license,
    retrievedAt: recipe.provenance.retrievedAt,
    sourceChecksum: recipe.provenance.checksum,
    contentSignature: recipe.contentSignature,
    title: recipe.title,
    description: recipe.description ?? "",
    cuisine: recipe.metadata.cuisines ?? [],
    category: recipe.metadata.categories?.join(", ") ?? "",
    servings: recipe.metadata.servings,
    prepTime: recipe.metadata.prepTime,
    cookTime: recipe.metadata.cookTime,
    ingredientGroups: recipe.ingredientSections.map((section) => ({
      ...(section.name ? { name: section.name } : {}),
      items: section.items.map((entry) => entry.text),
    })),
    instructions: recipe.instructionSections.flatMap((section) =>
      section.items.map((entry) => entry.text),
    ),
    nutrition: recipe.metadata.nutrition,
    equipment: recipe.equipment.map((entry) => entry.text),
    cooklangSource:
      typeof value.cooklangSource === "string" ? value.cooklangSource : undefined,
    parserDiagnostics:
      typeof value.parserDiagnostics === "string" ? value.parserDiagnostics : undefined,
    originalSource: value.originalSource,
  };
}
