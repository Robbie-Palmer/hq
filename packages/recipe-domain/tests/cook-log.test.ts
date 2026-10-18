import { describe, expect, it } from "vitest";
import {
  CookingOutcomeSchema,
  CookLogMutationEventSchema,
  MAX_COOK_LOG_MUTATION_EVENTS,
  validateCookLogMutationEvents,
} from "../src/cook-log";

const event = {
  sessionId: "0199a770-1111-7111-8111-111111111111",
  recipeSlug: "tomato-soup",
  recipeTitle: "Tomato Soup",
  servings: 2,
  cookedAt: "2026-09-27T18:30:00.000Z",
};

describe("cook-log mutations", () => {
  it("validates leftover tracking", () => {
    expect(
      CookingOutcomeSchema.parse({
        leftoverPortions: 2,
        leftoverStorage: "freezer",
        leftoverUseBy: "2026-10-11",
        audience: "household",
      }),
    ).toMatchObject({ leftoverPortions: 2, audience: "household" });

    expect(() =>
      CookingOutcomeSchema.parse({
        leftoverPortions: 0,
        leftoverStorage: "fridge",
        leftoverUseBy: null,
        audience: "personal",
      }),
    ).toThrow();
  });

  it("accepts a bounded completed cook event", () => {
    expect(CookLogMutationEventSchema.parse(event)).toEqual(event);
    expect(() => validateCookLogMutationEvents([event])).not.toThrow();
  });

  it("rejects duplicate sessions and oversized batches", () => {
    expect(() => validateCookLogMutationEvents([event, event])).toThrow(
      "Duplicate cooking session",
    );
    expect(() =>
      validateCookLogMutationEvents(
        Array.from({ length: MAX_COOK_LOG_MUTATION_EVENTS + 1 }, (_, index) => ({
          ...event,
          sessionId: `session-${index}`,
        })),
      ),
    ).toThrow("must contain");
  });
});
