import { describe, expect, it } from "vitest";
import type { GroundTruthEntry } from "recipe-parsing/schemas/ground-truth";
import {
  average,
  countRecipeValues,
  imageCountHistogram,
  imagesPerRecipe,
} from "../../src/stages/dataset-stats.js";

function entry(
  title: string,
  images: string[],
  cuisine: string[],
  ingredients: string[],
): GroundTruthEntry {
  return {
    images,
    expected: {
      title,
      description: `${title} description`,
      cuisine,
      servings: 2,
      ingredientGroups: [
        {
          items: ingredients.map((ingredient) => ({ ingredient })),
        },
      ],
      instructions: ["Cook it."],
      cookware: [],
    },
  };
}

describe("dataset statistics", () => {
  const entries = [
    entry("Soup", ["soup-1.jpg", "soup-2.jpg"], [" Irish ", ""], [
      "potato",
      "onion",
    ]),
    entry("Bread", ["bread.jpg"], [], ["flour", "onion"]),
    entry("Stew", ["stew.jpg", "stew-2.jpg"], ["Irish"], ["potato"]),
  ];

  it("orders image counts by count and then recipe title", () => {
    expect(imagesPerRecipe(entries)).toEqual([
      { recipe: "Soup", recipe_index: 1, image_count: 2 },
      { recipe: "Stew", recipe_index: 3, image_count: 2 },
      { recipe: "Bread", recipe_index: 2, image_count: 1 },
    ]);
  });

  it("builds a sorted image-count histogram", () => {
    expect(imageCountHistogram(imagesPerRecipe(entries))).toEqual([
      { image_count: 1, recipe_count: 1 },
      { image_count: 2, recipe_count: 2 },
    ]);
  });

  it("counts cuisines, unknown cuisines, and ingredient mentions", () => {
    const counts = countRecipeValues(entries);

    expect([...counts.cuisineCounts]).toEqual([["Irish", 2]]);
    expect(counts.unknownCuisineCount).toBe(1);
    expect([...counts.ingredientCounts]).toEqual([
      ["potato", 2],
      ["onion", 2],
      ["flour", 1],
    ]);
  });

  it("averages and rounds values while handling an empty dataset", () => {
    expect(average([1, 2, 2])).toBe(1.67);
    expect(average([])).toBe(0);
  });
});
