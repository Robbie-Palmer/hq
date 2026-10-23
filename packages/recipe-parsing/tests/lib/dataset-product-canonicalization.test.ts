import { describe, expect, it } from "vitest";
import { canonicalizeDatasetRecipe } from "../../src/lib/dataset-product-canonicalization.js";
import type { AdaptedDatasetRecipe } from "../../src/lib/dataset-product-canonicalization.js";

function adaptation(): AdaptedDatasetRecipe {
  const recipe = {
    title: "Pasta",
    description: "A quick pasta.",
    cuisine: [],
    servings: 2,
    ingredientGroups: [
      {
        items: [
          { ingredient: "tomatoes" },
          { ingredient: "unknown-seasoning" },
        ],
      },
    ],
    instructions: ["Cook the pasta."],
    cookware: ["wooden spoon or spatula", "large skillet"],
  };
  return {
    status: "adapted",
    provenance: {
      dataset: "fixtures",
      recordId: "pasta",
      url: "https://example.com/pasta",
      license: "CC0-1.0",
      retrievedAt: "2026-10-20",
      checksum: "checksum",
    },
    contentSignature: "signature",
    diagnostics: [],
    unmappedFields: [],
    recipe,
    cooklang: {
      frontmatter: { tags: [] },
      body: "@tomatoes{}\n\nCook the pasta.",
      diagnostics: [],
      derived: recipe,
    },
  };
}

describe("canonicalizeDatasetRecipe", () => {
  it("canonicalizes product ingredients and splits equipment alternatives", () => {
    const result = canonicalizeDatasetRecipe(adaptation());

    expect(result.adaptation.recipe.ingredientGroups[0]?.items).toEqual([
      { ingredient: "fresh-tomatoes" },
      { ingredient: "unknown-seasoning" },
    ]);
    expect(result.adaptation.recipe.cookware).toEqual([
      "wooden spoon",
      "spatula",
      "frying pan",
    ]);
    expect(result.adaptation.cooklang.derived).toEqual(
      result.adaptation.recipe,
    );
    expect(result.ingredientDecisions.map((decision) => decision.method)).toEqual([
      "exact",
      "none",
    ]);
  });
});
