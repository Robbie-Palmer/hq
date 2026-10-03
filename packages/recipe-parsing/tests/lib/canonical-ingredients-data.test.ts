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
      "fajita-seasoning": "spice",
      "garlic-italian-seasoning": "spice",
      "ground-allspice": "spice",
      "ground-cinnamon": "spice",
      "ground-ginger": "spice",
      "ground-nutmeg": "spice",
      "ground-white-pepper": "spice",
      "harissa-seasoning": "spice",
      "medium-curry-powder": "spice",
      "mixed-spice": "spice",
      "whole-cloves": "spice",
    });
  });
});
