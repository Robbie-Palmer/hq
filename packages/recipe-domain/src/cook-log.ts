import { z } from "zod";

export const MAX_COOK_LOG_MUTATION_EVENTS = 50;
export const MAX_COOK_LOG_DINERS = 20;

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
    diners: z.array(z.string().trim().min(1).max(120)).max(MAX_COOK_LOG_DINERS),
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
