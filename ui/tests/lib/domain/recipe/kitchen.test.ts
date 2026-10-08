import { emptyPantryFreshness } from "recipe-domain/pantry";
import { describe, expect, it } from "vitest";
import {
  getDietRelevantKitchenIngredients,
  getKitchenFreshnessStatus,
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

  it("derives warnings without conflating safety and quality dates", () => {
    const bothDates = {
      ...emptyPantryFreshness(),
      useBy: "2026-10-10",
      bestBefore: "2026-10-01",
    };

    expect(getKitchenFreshnessStatus(bothDates, "2026-10-07")).toBe(
      "past_best_before",
    );
    expect(
      getKitchenFreshnessStatus(
        { ...bothDates, useBy: "2026-10-06" },
        "2026-10-07",
      ),
    ).toBe("past_use_by");
    expect(
      getKitchenFreshnessStatus(
        {
          ...emptyPantryFreshness(),
          estimate: {
            expectedDays: 4,
            startingOn: "2026-10-01",
            storage: "fresh",
            basis: "user",
          },
        },
        "2026-10-07",
      ),
    ).toBe("estimate_elapsed");
  });

  it("uses use-by dates and compatible quantities when matching stock", () => {
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
            { slug: "yogurt", name: "yogurt" },
          ],
        },
      ],
      {
        stock: {
          location: "cupboards",
          quantity: { amount: 0.5, unit: "l" },
          freshness: emptyPantryFreshness(),
          source: {
            kind: "user",
            provenance: "Household member update",
          },
        },
        peas: {
          location: "freezer",
          quantity: null,
          freshness: {
            ...emptyPantryFreshness(),
            bestBefore: "2026-10-01",
          },
          source: {
            kind: "user",
            provenance: "Household member update",
          },
        },
        mint: {
          location: "fresh",
          quantity: null,
          freshness: emptyPantryFreshness(),
          source: {
            kind: "inferred",
            provenance: "Receipt scan on 5 October",
          },
        },
        yogurt: {
          location: "fridge",
          quantity: null,
          freshness: {
            ...emptyPantryFreshness(),
            useBy: "2026-10-01",
          },
          source: {
            kind: "user",
            provenance: "Household member update",
          },
        },
      },
      null,
      "2026-10-07",
    );

    expect(match).toMatchObject({
      canCook: false,
      haveCount: 3,
      missingIngredients: [{ slug: "yogurt", name: "yogurt" }],
    });
  });

  it("marks a compatible but insufficient quantity as missing", () => {
    const [match] = getKitchenRecipeMatches(
      [
        {
          slug: "soup",
          title: "Soup",
          cuisine: [],
          ingredients: [
            { slug: "stock", name: "stock", amount: 500, unit: "ml" },
          ],
        },
      ],
      {
        stock: {
          location: "cupboards",
          quantity: { amount: 0.25, unit: "l" },
          freshness: emptyPantryFreshness(),
          source: { kind: "user", provenance: "Manual kitchen update" },
        },
      },
      null,
      "2026-10-07",
    );

    expect(match?.missingCount).toBe(1);
  });
});
