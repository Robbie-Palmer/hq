import {
  PantryMutationConflictError,
  planPantryCompensation,
  planPantryTransition,
  previewPantryCompensation,
  validatePantryMutationChanges,
} from "recipe-domain/pantry";
import { describe, expect, it } from "vitest";

describe("pantry mutation rules", () => {
  it("plans an optimistic transition using the existing stable identity", () => {
    expect(
      planPantryTransition(
        {
          ingredientSlug: "onion",
          expectedVersion: "4",
          location: "fresh",
        },
        {
          stableItemId: "item-1",
          ingredientSlug: "onion",
          location: "cupboards",
          version: 4n,
        },
        "unused-item-id",
      ),
    ).toEqual({
      stableItemId: "item-1",
      ingredientSlug: "onion",
      beforeValue: { ingredientSlug: "onion", location: "cupboards" },
      afterValue: { ingredientSlug: "onion", location: "fresh" },
      beforeVersion: 4n,
      afterVersion: 5n,
    });
  });

  it("rejects a stale expected version", () => {
    expect(() =>
      planPantryTransition(
        {
          ingredientSlug: "onion",
          expectedVersion: "3",
          location: "fresh",
        },
        {
          stableItemId: "item-1",
          ingredientSlug: "onion",
          location: "cupboards",
          version: 4n,
        },
        "unused-item-id",
      ),
    ).toThrow(PantryMutationConflictError);
  });

  it("only compensates when the recorded after-state is still current", () => {
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

    expect(previewPantryCompensation(record, current, undefined).status).toBe(
      "ready",
    );
    expect(planPantryCompensation(record, current, undefined)).toEqual({
      stableItemId: "item-1",
      ingredientSlug: "onion",
      beforeValue: record.afterValue,
      afterValue: record.beforeValue,
      beforeVersion: 5n,
      afterVersion: 6n,
    });
    expect(
      previewPantryCompensation(
        record,
        { ...current, location: "cupboards", version: 6n },
        undefined,
      ).status,
    ).toBe("conflict");
  });

  it("recognizes a recorded deletion through its absence revision", () => {
    const record = {
      stableItemId: "item-1",
      ingredientSlug: "onion",
      beforeValue: { ingredientSlug: "onion", location: "fresh" as const },
      afterValue: null,
      beforeVersion: 2n,
      afterVersion: 3n,
    };

    expect(
      previewPantryCompensation(record, undefined, {
        stableItemId: "item-1",
        version: 3n,
      }).status,
    ).toBe("ready");
  });

  it("rejects empty and duplicate change sets", () => {
    expect(() => validatePantryMutationChanges([])).toThrow(
      PantryMutationConflictError,
    );
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
  });
});
