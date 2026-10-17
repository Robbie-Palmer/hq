import { z } from "zod";

export const MAX_COOK_LOG_MUTATION_EVENTS = 50;

export const COOKING_AUDIENCES = ["personal", "household"] as const;
export const LEFTOVER_STORAGE_LOCATIONS = ["fridge", "freezer"] as const;

export const CookingAudienceSchema = z.enum(COOKING_AUDIENCES);
export const LeftoverStorageLocationSchema = z.enum(
  LEFTOVER_STORAGE_LOCATIONS,
);

export const CookingOutcomeSchema = z
  .object({
    leftoverPortions: z.number().int().min(1).max(1_000),
    leftoverStorage: LeftoverStorageLocationSchema,
    leftoverUseBy: z.iso.date().nullable(),
    audience: CookingAudienceSchema,
  })
  .strict();

export type CookingOutcome = z.infer<typeof CookingOutcomeSchema>;
export type CookingAudience = z.infer<typeof CookingAudienceSchema>;
export type LeftoverStorageLocation = z.infer<
  typeof LeftoverStorageLocationSchema
>;

export const CookLogMutationEventSchema = z
  .object({
    sessionId: z.uuid(),
    recipeSlug: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    recipeTitle: z.string().trim().min(1).max(120),
    servings: z.number().int().min(1).max(1_000),
    cookedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type CookLogMutationEvent = z.infer<typeof CookLogMutationEventSchema>;

export type CookLogMutationValue = CookLogMutationEvent & {
  cookedAt: string;
};

export type CookLogChangeRecord = {
  sessionId: string;
  beforeValue: CookLogMutationValue | null;
  afterValue: CookLogMutationValue | null;
  beforeVersion: bigint | null;
  afterVersion: bigint;
};

export class CookLogMutationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CookLogMutationConflictError";
  }
}

export function validateCookLogMutationEvents(
  events: CookLogMutationEvent[],
): void {
  if (events.length === 0 || events.length > MAX_COOK_LOG_MUTATION_EVENTS) {
    throw new CookLogMutationConflictError(
      `A change set must contain 1-${MAX_COOK_LOG_MUTATION_EVENTS} cook events`,
    );
  }
  const ids = new Set<string>();
  for (const event of events) {
    if (ids.has(event.sessionId)) {
      throw new CookLogMutationConflictError(
        `Duplicate cooking session: ${event.sessionId}`,
      );
    }
    ids.add(event.sessionId);
  }
}
