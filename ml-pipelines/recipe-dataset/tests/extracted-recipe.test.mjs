import assert from "node:assert/strict";
import test from "node:test";
import {
  createExtractedRecipe,
  ExtractedRecipeSchema,
  toLegacyRecipe,
} from "../src/lib/extracted-recipe.mjs";

const source = {
  id: "fixture-recipes",
  name: "Fixture recipes",
  url: "https://example.com/recipes",
  license: "CC0-1.0",
  format: "Cooklang",
  revision: "abc123",
};
const snapshot = { retrievedAt: "2026-10-18" };

test("builds a source-faithful recipe without product-domain normalization", () => {
  const recipe = createExtractedRecipe(source, snapshot, {
    sourceRecordId: "soup.cook",
    sourceUrl: "https://example.com/recipes/soup.cook",
    sourceChecksum: "checksum",
    title: "Tomato soup",
    description: "A small test recipe.",
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
      { name: "Method", items: ["Add the tomatoes to a saucepan."] },
    ],
    equipment: [{ text: "1 large saucepan", name: "saucepan", quantity: 1 }],
    timers: [{ text: "simmer 20 minutes", name: "simmer", quantity: 20, unit: "minutes" }],
    metadata: {
      cuisines: ["British"],
      servings: "4 bowls",
      tags: ["soup"],
      authors: [{ name: "Test Cook", url: "https://example.com/cook" }],
      nutrition: { calories: "120 kcal" },
    },
  });

  assert.deepEqual(ExtractedRecipeSchema.parse(recipe), recipe);
  assert.equal(recipe.schemaVersion, 1);
  assert.equal(recipe.completeness, "complete");
  assert.deepEqual(recipe.ingredientSections[0].items[0], {
    text: "2 cans tomatoes",
    name: "tomatoes",
    quantity: 2,
    unit: "cans",
  });
  assert.equal(recipe.metadata.servings, "4 bowls");
  assert.equal(recipe.provenance.revision, "abc123");

  const legacy = toLegacyRecipe(recipe);
  assert.deepEqual(legacy.ingredientGroups, [
    { name: "Soup", items: ["2 cans tomatoes"] },
  ]);
  assert.deepEqual(legacy.instructions, ["Add the tomatoes to a saucepan."]);
  assert.deepEqual(legacy.equipment, ["1 large saucepan"]);
});

test("accepts ingredient-only source records and rejects incomplete complete records", () => {
  const partial = createExtractedRecipe(
    source,
    snapshot,
    {
      title: "Ingredient list",
      ingredientGroups: [{ items: ["1 cup flour"] }],
    },
    { completeness: "ingredients-only" },
  );
  assert.equal(partial.completeness, "ingredients-only");
  assert.deepEqual(partial.instructionSections, []);

  assert.throws(
    () =>
      createExtractedRecipe(source, snapshot, {
        title: "Incomplete recipe",
        ingredientGroups: [{ items: ["1 cup flour"] }],
      }),
    /missing instructions/,
  );
});
