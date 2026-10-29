import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  convertUnit,
  VOLUME_UNITS,
  WEIGHT_UNITS,
} from "../../src/conversion";
import { normalizeIngredientSlugForOutput } from "../../src/ingredient-normalization";
import { RecipeContentSchema, type RecipeContent } from "../../src/recipe";
import { SavedRecipePayloadSchema } from "../../src/serialization";
import { propertyParameters } from "./support";

const ingredientSlugs = [
  "black-pepper",
  "olive-oil",
  "plain-flour",
  "salt",
] as const;

const ingredientArbitrary = fc.record({
  ingredient: fc.constantFrom(...ingredientSlugs),
  amount: fc.integer({ min: 1, max: 2_000 }),
  unit: fc.constantFrom("g", "kg", "ml", "l", "tsp", "tbsp" as const),
});

const recipeContentArbitrary: fc.Arbitrary<RecipeContent> = fc.record({
  title: fc.constantFrom("Bean stew", "Flatbread", "Tomato soup"),
  description: fc.constantFrom(
    "A dependable weeknight recipe.",
    "Serve while warm.",
  ),
  cuisine: fc.uniqueArray(
    fc.constantFrom("British", "Italian", "Levantine"),
    { maxLength: 2 },
  ),
  servings: fc.integer({ min: 1, max: 12 }),
  prepTime: fc.integer({ min: 0, max: 120 }),
  cookTime: fc.integer({ min: 0, max: 240 }),
  ingredientGroups: fc
    .uniqueArray(ingredientArbitrary, {
      minLength: 1,
      maxLength: ingredientSlugs.length,
      selector: (item) => item.ingredient,
    })
    .map((items) => [{ name: "Main", items }]),
  instructions: fc
    .array(
      fc.constantFrom(
        "Combine the ingredients.",
        "Cook until tender.",
        "Season and serve.",
      ),
      { minLength: 1, maxLength: 3 },
    ),
  cookware: fc.uniqueArray(fc.constantFrom("bowl", "pan", "spoon"), {
    maxLength: 3,
  }),
  cookBody: fc.constant("Combine the ingredients and cook until tender."),
  date: fc.constant("2026-10-29"),
  tags: fc.uniqueArray(fc.constantFrom("quick", "vegetarian", "weeknight"), {
    maxLength: 3,
  }),
});

const finiteAmountArbitrary = fc.double({
  min: 0.001,
  max: 100_000,
  noNaN: true,
  noDefaultInfinity: true,
});

const compatibleUnitPairArbitrary = fc.oneof(
  fc.tuple(
    fc.constantFrom(...VOLUME_UNITS),
    fc.constantFrom(...VOLUME_UNITS),
  ),
  fc.tuple(
    fc.constantFrom(...WEIGHT_UNITS),
    fc.constantFrom(...WEIGHT_UNITS),
  ),
);

describe("recipe domain properties", () => {
  it("round-trips valid saved recipes through JSON and schema parsing", () => {
    fc.assert(
      fc.property(recipeContentArbitrary, (recipe) => {
        const payload = { version: 1 as const, source: "property-test", recipe };
        const serialized = JSON.parse(JSON.stringify(payload));
        const decoded = SavedRecipePayloadSchema.parse(serialized);
        return JSON.stringify(decoded) === JSON.stringify(serialized);
      }),
      propertyParameters(),
    );
  });

  it("normalizes ingredient slugs idempotently", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), (rawSlug) => {
        const normalized = normalizeIngredientSlugForOutput(rawSlug);
        return (
          normalizeIngredientSlugForOutput(normalized) === normalized &&
          (normalized === "" || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized))
        );
      }),
      propertyParameters(),
    );
  });

  it("round-trips finite quantities between compatible units", () => {
    fc.assert(
      fc.property(
        finiteAmountArbitrary,
        compatibleUnitPairArbitrary,
        (amount, [from, to]) => {
          const converted = convertUnit(amount, from, to);
          if (converted === null) return false;
          const roundTrip = convertUnit(converted, to, from);
          if (roundTrip === null) return false;
          const tolerance = Math.max(1, amount) * 1e-12;
          return Math.abs(roundTrip - amount) <= tolerance;
        },
      ),
      propertyParameters(),
    );
  });

  it("preserves recipe model invariants and rejects non-positive amounts", () => {
    fc.assert(
      fc.property(
        recipeContentArbitrary,
        fc.integer({ min: -2_000, max: 0 }),
        (recipe, invalidAmount) => {
          const invalidRecipe = {
            ...recipe,
            ingredientGroups: recipe.ingredientGroups.map((group, index) =>
              index === 0
                ? {
                    ...group,
                    items: group.items.map((item, itemIndex) =>
                      itemIndex === 0
                        ? { ...item, amount: invalidAmount }
                        : item,
                    ),
                  }
                : group,
            ),
          };
          return (
            RecipeContentSchema.safeParse(recipe).success &&
            !RecipeContentSchema.safeParse(invalidRecipe).success
          );
        },
      ),
      propertyParameters(),
    );
  });

  it("shrinks an invalid quantity invariant to a useful counterexample", () => {
    const result = fc.check(
      fc.property(
        recipeContentArbitrary,
        fc.integer({ min: -2_000, max: 2_000 }),
        (recipe, amount) => {
          const firstGroup = recipe.ingredientGroups[0];
          const firstItem = firstGroup?.items[0];
          if (!firstGroup || !firstItem) return false;
          const candidate = {
            ...recipe,
            ingredientGroups: [
              {
                ...firstGroup,
                items: [{ ...firstItem, amount }],
              },
            ],
          };
          return RecipeContentSchema.safeParse(candidate).success;
        },
      ),
      propertyParameters(),
    );

    expect(result.failed).toBe(true);
    expect(result.counterexample?.[1]).toBeLessThanOrEqual(0);
  });
});
