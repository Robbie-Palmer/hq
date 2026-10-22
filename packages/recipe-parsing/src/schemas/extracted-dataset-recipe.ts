import { z } from "zod";
import { ParsedRecipeSchema } from "recipe-domain";
import { CooklangRecipeSchema } from "./stage-artifacts.js";

const NonEmptyStringSchema = z.string().min(1);

export const DatasetRecipeItemSchema = z.object({
  text: NonEmptyStringSchema,
  name: NonEmptyStringSchema.optional(),
  quantity: z.union([z.string(), z.number()]).optional(),
  unit: NonEmptyStringSchema.optional(),
  note: NonEmptyStringSchema.optional(),
});

export const DatasetRecipeSectionSchema = z.object({
  name: NonEmptyStringSchema.optional(),
  items: z.array(DatasetRecipeItemSchema).min(1),
});

const DatasetPartySchema = z.object({
  name: NonEmptyStringSchema,
  url: NonEmptyStringSchema.optional(),
});

const DatasetRatingSchema = z.object({
  value: z.union([z.string(), z.number()]),
  count: z.union([z.string(), z.number()]).optional(),
  best: z.union([z.string(), z.number()]).optional(),
  worst: z.union([z.string(), z.number()]).optional(),
});

export const ExtractedDatasetRecipeSchema = z.object({
  schemaVersion: z.literal(1),
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
  ingredientSections: z.array(DatasetRecipeSectionSchema).min(1),
  instructionSections: z.array(DatasetRecipeSectionSchema),
  equipment: z.array(DatasetRecipeItemSchema),
  timers: z.array(DatasetRecipeItemSchema),
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
    authors: z.array(DatasetPartySchema).optional(),
    publishers: z.array(DatasetPartySchema).optional(),
    sourceOrganizations: z.array(DatasetPartySchema).optional(),
    datePublished: NonEmptyStringSchema.optional(),
    images: z.array(NonEmptyStringSchema).optional(),
    notes: z.array(NonEmptyStringSchema).optional(),
    rating: DatasetRatingSchema.optional(),
    nutrition: z.record(z.string(), z.unknown()).optional(),
    sourceMetadata: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type ExtractedDatasetRecipe = z.infer<
  typeof ExtractedDatasetRecipeSchema
>;

const AdaptationBaseSchema = z.object({
  provenance: ExtractedDatasetRecipeSchema.shape.provenance,
  contentSignature: NonEmptyStringSchema,
  diagnostics: z.array(NonEmptyStringSchema),
  unmappedFields: z.array(NonEmptyStringSchema),
});

export const DatasetRecipeAdaptationSchema = z.discriminatedUnion("status", [
  AdaptationBaseSchema.extend({
    status: z.literal("adapted"),
    recipe: ParsedRecipeSchema,
    cooklang: CooklangRecipeSchema,
  }),
  AdaptationBaseSchema.extend({
    status: z.literal("ingredients-only"),
  }),
  AdaptationBaseSchema.extend({
    status: z.literal("unadaptable"),
  }),
]);

export type DatasetRecipeAdaptation = z.infer<
  typeof DatasetRecipeAdaptationSchema
>;
