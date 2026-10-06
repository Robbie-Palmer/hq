import { describe, expect, it } from "vitest";
import {
  getDietRelevantKitchenIngredients,
  getKitchenRecipeMatches,
  isKitchenLocation,
  KITCHEN_LOCATIONS,
} from "@/lib/domain/recipe/kitchen";

describe("kitchen helpers", () => {
  it("defines the supported locations once for kitchen features", () => {
    expect(KITCHEN_LOCATIONS.map((location) => location.id)).toEqual([
      "fridge",
      "freezer",
      "cupboards",
      "fresh",
    ]);
    expect(isKitchenLocation("garage")).toBe(false);
    expect(isKitchenLocation("freezer")).toBe(true);
    expect(isKitchenLocation("fridge")).toBe(true);
  });

  it("ranks recipes by match ratio then missing ingredients", () => {
    const matches = getKitchenRecipeMatches(
      [
        {
          slug: "small-recipe",
          title: "Small Recipe",
          cuisine: [],
          ingredients: [
            { slug: "pasta", name: "pasta" },
            { slug: "tomatoes", name: "tomatoes" },
          ],
        },
        {
          slug: "larger-recipe",
          title: "Larger Recipe",
          cuisine: [],
          ingredients: [
            { slug: "rice", name: "rice" },
            { slug: "parmesan", name: "parmesan" },
            { slug: "stock", name: "stock" },
            { slug: "peas", name: "peas" },
            { slug: "butter", name: "butter" },
          ],
        },
      ],
      ["pasta", "rice", "parmesan", "stock", "peas"],
    );

    expect(matches[0]?.slug).toBe("larger-recipe");
    expect(matches[0]?.matchRatio).toBe(0.8);
    expect(matches[0]?.missingIngredients).toEqual([
      { slug: "butter", name: "butter" },
    ]);
    expect(matches[1]?.slug).toBe("small-recipe");
    expect(matches[1]?.matchRatio).toBe(0.5);
    expect(matches[1]?.missingIngredients).toEqual([
      { slug: "tomatoes", name: "tomatoes" },
    ]);
  });

  it("removes diet-excluded ingredients from pantry suggestions", () => {
    const ingredients = [
      { slug: "bacon", name: "Bacon", category: "protein" as const },
      {
        slug: "cheddar-cheese",
        name: "Cheddar cheese",
        category: "dairy" as const,
      },
      { slug: "chickpeas", name: "Chickpeas", category: "legume" as const },
    ];

    expect(
      getDietRelevantKitchenIngredients(
        ingredients,
        new Set(["bacon", "cheddar-cheese"]),
      ),
    ).toEqual([ingredients[2]]);

    expect(
      getDietRelevantKitchenIngredients(
        ingredients,
        new Set(["bacon", "cheddar-cheese"]),
        true,
      ),
    ).toEqual(ingredients);
  });

  it("requires both ingredients and household equipment to cook", () => {
    const [match] = getKitchenRecipeMatches(
      [
        {
          slug: "soup",
          title: "Soup",
          cuisine: [],
          ingredients: [{ slug: "stock", name: "stock" }],
          cookware: ["saucepan", "stick blender"],
        },
      ],
      ["stock"],
      ["saucepan"],
    );

    expect(match).toMatchObject({
      canCook: false,
      missingCount: 0,
      equipmentHaveCount: 1,
      equipmentTotalCount: 2,
      missingEquipment: [{ slug: "stick-blender", name: "stick blender" }],
    });
  });

  it("uses quantity, freshness, and confidence when matching stock", () => {
    const [match] = getKitchenRecipeMatches(
      [
        {
          slug: "soup",
          title: "Soup",
          cuisine: [],
          ingredients: [
            { slug: "stock", name: "stock", amount: 500, unit: "ml" },
            { slug: "peas", name: "peas" },
            { slug: "mint", name: "mint" },
          ],
        },
      ],
      {
        stock: {
          location: "cupboards",
          quantity: { amount: 250, unit: "ml" },
          freshness: "fresh",
          source: {
            kind: "user",
            confidence: 1,
            provenance: "Household member update",
          },
        },
        peas: {
          location: "freezer",
          quantity: null,
          freshness: "past_best_before",
          source: {
            kind: "user",
            confidence: 1,
            provenance: "Household member update",
          },
        },
        mint: {
          location: "fresh",
          quantity: null,
          freshness: "fresh",
          source: {
            kind: "inferred",
            confidence: 0.3,
            provenance: "Receipt scan on 5 October",
          },
        },
      },
    );

    expect(match).toMatchObject({
      canCook: false,
      haveCount: 0,
      missingIngredients: [
        { slug: "stock", name: "stock", amount: 500, unit: "ml" },
        { slug: "peas", name: "peas" },
        { slug: "mint", name: "mint" },
      ],
    });
  });
});
