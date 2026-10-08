import { describe, expect, it } from "vitest";
import {
  MAX_PANTRY_MUTATION_CHANGES,
  emptyPantryFreshness,
  PantryFreshnessSchema,
  PantryItemLimitError,
  PantryLocationSchema,
  PantryMutationConflictError,
  planPantryCompensation,
  planPantryTransition,
  previewPantryCompensation,
  validatePantryMutationChanges,
} from "../src/pantry";

const record = {
  stableItemId: "item-1",
  ingredientSlug: "onion",
  beforeValue: { ingredientSlug: "onion", location: "cupboards" as const },
  afterValue: { ingredientSlug: "onion", location: "fresh" as const },
  beforeVersion: 4n,
  afterVersion: 5n,
};
const current = {
  stableItemId: "item-1",
  ingredientSlug: "onion",
  location: "fresh" as const,
  version: 5n,
};

describe("pantry mutation rules", () => {
  it("owns and validates the pantry location vocabulary", () => {
    expect(PantryLocationSchema.parse("fridge")).toBe("fridge");
    expect(PantryLocationSchema.safeParse("garage").success).toBe(false);
  });

  it("models use-by and best-before as independent optional dates", () => {
    expect(
      PantryFreshnessSchema.parse({
        ...emptyPantryFreshness(),
        useBy: "2026-10-12",
        bestBefore: "2026-10-10",
      }),
    ).toMatchObject({
      useBy: "2026-10-12",
      bestBefore: "2026-10-10",
    });
    expect(PantryFreshnessSchema.parse(emptyPantryFreshness())).toEqual(
      emptyPantryFreshness(),
    );
  });

  it("records produce freshness as an explicit day-count estimate", () => {
    expect(
      PantryFreshnessSchema.parse({
        ...emptyPantryFreshness(),
        estimate: {
          expectedDays: 5,
          startingOn: "2026-10-07",
          storage: "fresh",
          basis: "user",
        },
      }).estimate,
    ).toEqual({
      expectedDays: 5,
      startingOn: "2026-10-07",
      storage: "fresh",
      basis: "user",
    });
  });

  it("plans inserts, updates, and deletions with stable identities", () => {
    expect(
      planPantryTransition(
        {
          ingredientSlug: "onion",
          expectedVersion: null,
          location: "fresh",
        },
        undefined,
        "new-item-id",
      ),
    ).toEqual({
      stableItemId: "new-item-id",
      ingredientSlug: "onion",
      beforeValue: null,
      afterValue: { ingredientSlug: "onion", location: "fresh" },
      beforeVersion: null,
      afterVersion: 1n,
    });
    expect(
      planPantryTransition(
        {
          ingredientSlug: "onion",
          expectedVersion: "4",
          location: "fresh",
        },
        { ...current, location: "cupboards", version: 4n },
        "unused-item-id",
      ),
    ).toEqual(record);
    expect(
      planPantryTransition(
        {
          ingredientSlug: "onion",
          expectedVersion: "5",
          location: null,
        },
        current,
        "unused-item-id",
      ).afterValue,
    ).toBeNull();
  });

  it("rejects malformed, stale, and already-absent transitions", () => {
    expect(() =>
      planPantryTransition(
        {
          ingredientSlug: "onion",
          expectedVersion: "invalid",
          location: "fresh",
        },
        current,
        "unused-item-id",
      ),
    ).toThrow("Invalid row version");
    expect(() =>
      planPantryTransition(
        {
          ingredientSlug: "onion",
          expectedVersion: "3",
          location: "fresh",
        },
        { ...current, version: 4n },
        "unused-item-id",
      ),
    ).toThrow("changed after the actor read it");
    expect(() =>
      planPantryTransition(
        {
          ingredientSlug: "onion",
          expectedVersion: null,
          location: null,
        },
        undefined,
        "unused-item-id",
      ),
    ).toThrow("already absent");
  });

  it("validates change-set size and ingredient uniqueness", () => {
    expect(() => validatePantryMutationChanges([])).toThrow(
      PantryMutationConflictError,
    );
    expect(() =>
      validatePantryMutationChanges(
        Array.from({ length: MAX_PANTRY_MUTATION_CHANGES + 1 }, (_, index) => ({
          ingredientSlug: `ingredient-${index}`,
          expectedVersion: null,
          location: "fresh" as const,
        })),
      ),
    ).toThrow(`1-${MAX_PANTRY_MUTATION_CHANGES}`);
    expect(() =>
      validatePantryMutationChanges([
        {
          ingredientSlug: "onion",
          expectedVersion: null,
          location: "fresh",
        },
        {
          ingredientSlug: "onion",
          expectedVersion: null,
          location: "cupboards",
        },
      ]),
    ).toThrow("Duplicate ingredient: onion");
    expect(() =>
      validatePantryMutationChanges([
        {
          ingredientSlug: "onion",
          expectedVersion: null,
          location: "fresh",
        },
      ]),
    ).not.toThrow();
  });

  it("previews and plans an update compensation", () => {
    expect(previewPantryCompensation(record, current, undefined)).toEqual({
      stableItemId: "item-1",
      ingredientSlug: "onion",
      beforeValue: record.beforeValue,
      afterValue: record.afterValue,
      currentValue: { ingredientSlug: "onion", location: "fresh" },
      status: "ready",
    });
    expect(planPantryCompensation(record, current, undefined)).toEqual({
      stableItemId: "item-1",
      ingredientSlug: "onion",
      beforeValue: record.afterValue,
      afterValue: record.beforeValue,
      beforeVersion: 5n,
      afterVersion: 6n,
    });
  });

  it("recognizes recorded deletions only through their absence revision", () => {
    const deletion = {
      ...record,
      beforeVersion: 2n,
      afterVersion: 3n,
      afterValue: null,
    };
    expect(
      previewPantryCompensation(deletion, undefined, {
        stableItemId: "item-1",
        version: 3n,
      }).status,
    ).toBe("ready");
    expect(
      previewPantryCompensation(deletion, undefined, {
        stableItemId: "another-item",
        version: 3n,
      }).status,
    ).toBe("conflict");
    expect(
      previewPantryCompensation(deletion, current, undefined).status,
    ).toBe("conflict");
  });

  it("rejects compensation after the recorded state changes", () => {
    expect(
      previewPantryCompensation(
        record,
        { ...current, location: "cupboards", version: 6n },
        undefined,
      ).status,
    ).toBe("conflict");
    expect(() =>
      planPantryCompensation(
        record,
        { ...current, stableItemId: "another-item" },
        undefined,
      ),
    ).toThrow("changed after the recorded mutation");
  });

  it("names pantry domain errors", () => {
    expect(new PantryMutationConflictError("conflict").name).toBe(
      "PantryMutationConflictError",
    );
    expect(new PantryItemLimitError()).toMatchObject({
      name: "PantryItemLimitError",
      message: "A pantry can contain at most 500 ingredients",
    });
  });
});
