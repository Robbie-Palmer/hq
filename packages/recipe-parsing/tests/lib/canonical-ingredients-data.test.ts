import { describe, expect, it } from "vitest";
import { canonicalIngredients } from "../../src/lib/canonical-ingredients-data.js";

describe("canonical ingredient data", () => {
  it("includes the pantry spice and herb labels", () => {
    const categories = new Map(
      canonicalIngredients.ingredients.map(({ slug, category }) => [
        slug,
        category,
      ]),
    );

    expect(Object.fromEntries(categories)).toMatchObject({
      "dried-bay-leaves": "herb",
      "dried-chives": "herb",
      "dried-dill": "herb",
      "dried-tarragon": "herb",
      "ground-allspice": "spice",
      "ground-cinnamon": "spice",
      "ground-nutmeg": "spice",
      "harissa-seasoning": "spice",
      "mixed-spice": "spice",
      "whole-cloves": "spice",
    });
  });
});
