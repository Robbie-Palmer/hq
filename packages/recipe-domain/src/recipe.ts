import { z } from "zod";
import { IngredientSlugSchema } from "./ingredient";
import { UnitSchema } from "./unit";

export const RecipeSlugSchema = z.string().min(1);
export type RecipeSlug = z.infer<typeof RecipeSlugSchema>;

export const RecipeIngredientSchema = z.object({
  ingredient: IngredientSlugSchema,
  amount: z.number().positive().optional(),
  unit: UnitSchema.optional(),
  quantityBasis: z.enum(["edible", "as_purchased"]).optional(),
  preparation: z.string().optional(),
  note: z.string().optional(),
});

export type RecipeIngredient = z.infer<typeof RecipeIngredientSchema>;

export const IngredientGroupSchema = z.object({
  name: z.string().optional(),
  items: z.array(RecipeIngredientSchema).min(1),
});

export type IngredientGroup = z.infer<typeof IngredientGroupSchema>;

export const RecipeInstructionItemSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), value: z.string() }),
  z.object({ type: z.literal("ingredient"), index: z.number().int().nonnegative() }),
  z.object({ type: z.literal("timer"), index: z.number().int().nonnegative() }),
  z.object({ type: z.literal("cookware"), index: z.number().int().nonnegative() }),
  z.object({
    type: z.literal("inlineQuantity"),
    index: z.number().int().nonnegative(),
  }),
]);

export type RecipeInstructionItem = z.infer<typeof RecipeInstructionItemSchema>;

export const RecipeInstructionStepSchema = z.object({
  number: z.number().int().positive().optional(),
  items: z.array(RecipeInstructionItemSchema),
});

export type RecipeInstructionStep = z.infer<typeof RecipeInstructionStepSchema>;

export const RecipeInstructionSectionContentSchema = z.discriminatedUnion(
  "type",
  [
    z.object({ type: z.literal("text"), value: z.string() }),
    z.object({ type: z.literal("step"), value: RecipeInstructionStepSchema }),
  ],
);

export type RecipeInstructionSectionContent = z.infer<
  typeof RecipeInstructionSectionContentSchema
>;

export const RecipeInstructionSectionSchema = z.object({
  name: z.string().nullable(),
  content: z.array(RecipeInstructionSectionContentSchema),
});

export type RecipeInstructionSection = z.infer<
  typeof RecipeInstructionSectionSchema
>;

export const RecipeInstructionSdkSchema = z.object({
  sections: z.array(RecipeInstructionSectionSchema),
  ingredientNames: z.array(z.string()),
  ingredientDisplayValues: z.array(z.string()),
  ingredientAmounts: z.array(z.number().nullable()),
  ingredientUnits: z.array(z.string().nullable()),
  cookwareDisplayValues: z.array(z.string()),
  inlineQuantityDisplayValues: z.array(z.string()),
  timerDisplayValues: z.array(z.string()),
  timerDurationSeconds: z.array(z.number().nullable()),
});

export type RecipeInstructionSdk = z.infer<typeof RecipeInstructionSdkSchema>;

export const ParsedRecipeSchema = z.object({
  title: z.string().min(1),
  description: z.string(),
  cuisine: z.preprocess(
    (val) => (typeof val === "string" ? [val] : val),
    z.array(z.string().min(1)).default([]),
  ),
  servings: z.number().int().positive(),
  prepTime: z.number().int().nonnegative().optional(),
  cookTime: z.number().int().nonnegative().optional(),
  ingredientGroups: z.array(IngredientGroupSchema).min(1),
  instructions: z.array(z.string().min(1)).min(1),
  cookware: z.array(z.string().min(1)).default([]),
});

export type ParsedRecipe = z.infer<typeof ParsedRecipeSchema>;

export const RecipeContentSchema = ParsedRecipeSchema.extend({
  slug: RecipeSlugSchema.optional(),
  cookBody: z.string().min(1),
  instructionSdk: RecipeInstructionSdkSchema.optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tags: z.array(z.string()).default([]),
  image: z
    .string()
    .regex(/^recipes\/[a-z0-9_-]+-\d{4}-\d{2}-\d{2}$/)
    .optional(),
  imageAlt: z.string().min(1).optional(),
  canonical: z.string().url().optional(),
});

export type RecipeContent = z.infer<typeof RecipeContentSchema>;

export const IngredientAnnotationSchema = z.object({
  preparation: z.string().min(1).optional(),
  note: z.string().min(1).optional(),
});

export type IngredientAnnotation = z.infer<typeof IngredientAnnotationSchema>;

export const RecipeFrontmatterSchema = RecipeContentSchema.omit({
  slug: true,
  cookBody: true,
  instructionSdk: true,
  cookware: true,
  ingredientGroups: true,
  instructions: true,
}).extend({
  ingredientAnnotations: z
    .record(IngredientSlugSchema, IngredientAnnotationSchema)
    .optional(),
});

export type RecipeFrontmatter = z.infer<typeof RecipeFrontmatterSchema>;

export type Recipe = RecipeContent & {
  slug: RecipeSlug;
};
