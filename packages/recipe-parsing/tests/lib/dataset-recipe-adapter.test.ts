import { describe, expect, it } from "vitest";
import { adaptExtractedDatasetRecipe } from "../../src/lib/dataset-recipe-adapter";

function sourceRecipe(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    provenance: {
      dataset: "fixture-recipes",
      datasetName: "Fixture recipes",
      recordId: "tomato-soup",
      url: "https://example.com/tomato-soup",
      license: "CC0-1.0",
      retrievedAt: "2026-10-18",
      checksum: "source-checksum",
      format: "fixture",
    },
    completeness: "complete",
    contentSignature: "content-signature",
    title: "Tomato soup",
    description: "A simple soup.",
    ingredientSections: [
      {
        name: "Soup",
        items: [
          {
            text: "2 cans tomatoes",
            name: "tomatoes",
            quantity: 2,
            unit: "cans",
          },
        ],
      },
    ],
    instructionSections: [
      { name: "Method", items: [{ text: "Simmer the tomatoes." }] },
    ],
    equipment: [
      { text: "1 large saucepan", name: "saucepan", quantity: 1 },
    ],
    timers: [
      {
        text: "simmer 20 minutes",
        name: "simmer",
        quantity: 20,
        unit: "minutes",
      },
    ],
    metadata: {
      cuisines: ["British", "European"],
      categories: ["Soup"],
      tags: ["winter", "soup", "winter"],
      servings: "4 bowls",
      yields: ["4 bowls", "8 bowls"],
      prepTime: "PT10M",
      cookTime: "20 minutes",
      totalTime: "PT30M",
      authors: [{ name: "Test Cook" }],
      notes: ["Freezes well."],
      nutrition: { calories: "120 kcal" },
    },
    ...overrides,
  };
}

describe("adaptExtractedDatasetRecipe", () => {
  it("builds a product recipe and retains import fields in the adaptation report", () => {
    const result = adaptExtractedDatasetRecipe(sourceRecipe());

    expect(result.status).toBe("adapted");
    if (result.status !== "adapted") throw new Error("expected adapted recipe");
    expect(result.recipe).toMatchObject({
      title: "Tomato soup",
      description: "A simple soup.",
      cuisine: ["British", "European"],
      servings: 4,
      cookTime: 20,
      instructions: ["Simmer the tomatoes."],
      cookware: ["saucepan"],
    });
    expect(result.recipe.ingredientGroups[0]).toMatchObject({
      name: "Soup",
      items: [{ ingredient: "fresh-tomatoes", amount: 2 }],
    });
    expect(result.cooklang.frontmatter).toMatchObject({
      tags: ["winter", "soup"],
      canonical: "https://example.com/tomato-soup",
    });
    expect(result.diagnostics).toContain("Could not parse prep time: PT10M");
    expect(result.unmappedFields).toEqual(
      expect.arrayContaining([
        "equipment.details",
        "instructionSections.name",
        "metadata.authors",
        "metadata.categories",
        "metadata.notes",
        "metadata.nutrition",
        "metadata.totalTime",
        "metadata.yields",
        "provenance",
        "timers",
      ]),
    );
  });

  it("reports ingredient-only rows without inventing instructions", () => {
    const result = adaptExtractedDatasetRecipe(
      sourceRecipe({ completeness: "ingredients-only", instructionSections: [] }),
    );

    expect(result).toMatchObject({
      status: "ingredients-only",
      diagnostics: ["Product recipes require at least one instruction."],
    });
    expect("recipe" in result).toBe(false);
    expect("cooklang" in result).toBe(false);
  });

  it("keeps duplicate ingredients with incompatible units", () => {
    const result = adaptExtractedDatasetRecipe(
      sourceRecipe({
        ingredientSections: [
          {
            items: [{ text: "1 cup sugar" }, { text: "2 tablespoons sugar" }],
          },
        ],
      }),
    );

    expect(result.status).toBe("adapted");
    if (result.status !== "adapted") throw new Error("expected adapted recipe");
    expect(result.recipe.ingredientGroups[0]?.items).toHaveLength(2);
  });

  it("parses vulgar fractions and splits equipment alternatives", () => {
    const result = adaptExtractedDatasetRecipe(
      sourceRecipe({
        ingredientSections: [
          { items: [{ text: "½ teaspoon salt" }, { text: "1 ½ cups flour" }] },
        ],
        equipment: [
          { text: "wooden spoon or spatula" },
          { text: "blender/food processor" },
        ],
      }),
    );

    expect(result.status).toBe("adapted");
    if (result.status !== "adapted") throw new Error("expected adapted recipe");
    expect(result.recipe.ingredientGroups[0]?.items).toEqual([
      { ingredient: "salt", amount: 0.5, unit: "tsp" },
      { ingredient: "flour", amount: 1.5, unit: "us_cup" },
    ]);
    expect(result.recipe.cookware).toEqual([
      "wooden spoon",
      "spatula",
      "blender",
      "food processor",
    ]);
  });

  it("falls back when literal Cooklang control characters occur in instructions", () => {
    const result = adaptExtractedDatasetRecipe(
      sourceRecipe({
        instructionSections: [
          { items: [{ text: "Heat about ~3.8 L of water." }] },
        ],
      }),
    );

    expect(result.status).toBe("adapted");
    if (result.status !== "adapted") throw new Error("expected adapted recipe");
    expect(result.recipe.instructions).toEqual(["Heat about ~3.8 L of water."]);
    expect(result.diagnostics).toContain(
      "Used structured-text fallback for product adaptation.",
    );
  });

  it("drops malformed normalized ingredients without rejecting the recipe", () => {
    const result = adaptExtractedDatasetRecipe(
      sourceRecipe({
        ingredientSections: [
          {
            items: [
              { text: "1 cup tomatoes" },
              { text: "( (" },
              { text: "0 tsp salt" },
            ],
          },
        ],
      }),
    );

    expect(result.status).toBe("adapted");
    if (result.status !== "adapted") throw new Error("expected adapted recipe");
    expect(result.recipe.ingredientGroups[0]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ingredient: "fresh-tomatoes" }),
        expect.objectContaining({ ingredient: "salt" }),
      ]),
    );
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        "Dropped an ingredient with an empty normalized name.",
        "Dropped non-positive amount from ingredient: salt",
      ]),
    );
  });

  it("rejects extraction schema versions it does not understand", () => {
    expect(() =>
      adaptExtractedDatasetRecipe(sourceRecipe({ schemaVersion: 2 })),
    ).toThrow();
  });
});
