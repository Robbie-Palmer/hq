import { z } from "zod";
import { RecipeVisibilitySchema } from "./visibility";

export const BatchSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("url"), url: z.string().trim().min(1).max(2048) }),
  z.object({
    type: z.literal("file"),
    filename: z
      .string()
      .min(1)
      .max(255)
      .regex(/\.(cook|cooklang|json|jsonld)$/i),
    content: z
      .string()
      .min(1)
      .max(100_000)
      .refine((value) => new TextEncoder().encode(value).byteLength <= 100_000),
  }),
]);
export const CreateBatchSchema = z.object({
  idempotencyKey: z.uuid().max(36),
  sources: z.array(BatchSourceSchema).min(1).max(50),
  visibility: RecipeVisibilitySchema.default("private"),
});
export const BatchDraftSchema = z.object({
  visibility: RecipeVisibilitySchema.optional(),
  title: z.string().trim().min(1).max(120),
  description: z.string().max(500),
  cuisine: z.string().max(500),
  servings: z.number().int().min(1).max(10000),
  prepTime: z.number().int().min(0).max(1_000_000).optional(),
  cookTime: z.number().int().min(0).max(1_000_000).optional(),
  source: z.string().min(1).max(10000),
  url: z.url().max(2048).optional(),
});
export const MutableBatchDraftSchema = BatchDraftSchema.extend({
  title: z.string().max(120),
  source: z.string().max(10000),
});
export const AutosaveBatchDraftSchema = z.object({
  version: z.number().int().min(1).max(2_147_483_647),
  draft: MutableBatchDraftSchema,
});
export type BatchSource = z.infer<typeof BatchSourceSchema>;
export type BatchDraft = z.infer<typeof BatchDraftSchema>;
export const batchSourceKey = (jobId: string) =>
  `imports/${jobId}/source/manifest.json`;
