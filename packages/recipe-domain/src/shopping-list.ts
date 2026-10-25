import { z } from "zod";

export const ShoppingListIdSchema = z.uuid().max(36);
export const ShoppingListCommandIdSchema = z.uuid().max(36);
export const ShoppingListRevisionSchema = z.string().regex(/^\d+$/).max(30);

export const ShoppingListChecklistCommandSchema = z
  .object({
    type: z.literal("set_checked"),
    itemType: z.enum(["ingredient", "extra"]),
    itemId: z.string().trim().min(1).max(200),
    checked: z.boolean(),
  })
  .strict();

export const ShoppingListCommandBodySchema = z
  .object({
    baseRevision: ShoppingListRevisionSchema,
    command: ShoppingListChecklistCommandSchema,
  })
  .strict();

export const ShoppingListCommandRequestSchema =
  ShoppingListCommandBodySchema.extend({
    commandId: ShoppingListCommandIdSchema,
    listId: ShoppingListIdSchema,
  }).strict();

export type ShoppingListChecklistCommand = z.infer<
  typeof ShoppingListChecklistCommandSchema
>;
export type ShoppingListCommandBody = z.infer<
  typeof ShoppingListCommandBodySchema
>;
export type ShoppingListCommandRequest = z.infer<
  typeof ShoppingListCommandRequestSchema
>;
