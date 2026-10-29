import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  deriveRecipeFromCooklang,
  recipeToCooklang,
} from "../../src/lib/cooklang";
import { parseRecipeFile } from "../../src/lib/recipe-file";
import type { Recipe } from "../../src/schemas/ground-truth";
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

const recipeArbitrary: fc.Arbitrary<Recipe> = fc.record({
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
  cookware: fc.constant([]),
});

function roundTrip(
  recipe: Recipe,
  servings = recipe.servings,
): Recipe | undefined {
  const serialized = recipeToCooklang({ ...recipe, servings });
  return deriveRecipeFromCooklang(serialized).derived;
}

function sameRecipe(
  left: Recipe | undefined,
  right: Recipe | undefined,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

describe("recipe parser properties", () => {
  it("does not throw on bounded arbitrary recipe files", async () => {
    await expect(
      fc.assert(
        fc.asyncProperty(
          fc.constantFrom(
            "recipe.cook",
            "recipe.cooklang",
            "recipe.json",
            "recipe.jsonld",
            "recipe.txt",
          ),
          fc.string({ maxLength: 512 }),
          async (filename, source) => {
            const result = await parseRecipeFile(filename, source);
            return result === null || typeof result.title === "string";
          },
        ),
        propertyParameters(),
      ),
    ).resolves.toBeUndefined();
  });

  it("round-trips normalized recipes through Cooklang", () => {
    expect(() =>
      fc.assert(
        fc.property(recipeArbitrary, (recipe) => {
          const expected = recipeToCooklang(recipe).derived;
          return sameRecipe(roundTrip(recipe), expected);
        }),
        propertyParameters(),
      ),
    ).not.toThrow();
  });

  it("finds a dropped serving count as a round-trip counterexample", () => {
    const result = fc.check(
      fc.property(recipeArbitrary, (recipe) => {
        const expected = recipeToCooklang(recipe).derived;
        return sameRecipe(roundTrip(recipe, 1), expected);
      }),
      propertyParameters(),
    );

    expect(result.failed).toBe(true);
    const counterexample = result.counterexample?.[0] as Recipe | undefined;
    expect(counterexample?.servings).not.toBe(1);
  });
});
