import type { RecipeIngredient } from "recipe-domain";
import {
  createIngredientGroupAccumulator,
  mergeIngredientIntoGroup,
} from "recipe-domain";
import { describe, expect, it } from "vitest";

function ingredient(
  overrides: Partial<RecipeIngredient> = {},
): RecipeIngredient {
  return { ingredient: "flour", ...overrides };
}

describe("mergeIngredientIntoGroup", () => {
  it("adds the first ingredient and sums compatible quantities", () => {
    const group = createIngredientGroupAccumulator("Dough");

    mergeIngredientIntoGroup(group, ingredient({ amount: 1, unit: "us_cup" }));
    mergeIngredientIntoGroup(
      group,
      ingredient({ amount: 0.5, unit: "us_cup" }),
    );

    expect(group.items).toEqual([ingredient({ amount: 1.5, unit: "us_cup" })]);
  });

  it("adds a quantity to an existing unquantified ingredient", () => {
    const group = createIngredientGroupAccumulator();
    mergeIngredientIntoGroup(group, ingredient({ unit: "us_cup" }));

    mergeIngredientIntoGroup(group, ingredient({ amount: 2 }));

    expect(group.items).toEqual([ingredient({ amount: 2, unit: "us_cup" })]);
  });

  it("accepts a compatible unquantified duplicate", () => {
    const group = createIngredientGroupAccumulator();
    mergeIngredientIntoGroup(group, ingredient({ unit: "us_cup" }));

    mergeIngredientIntoGroup(group, ingredient({ unit: "us_cup" }));

    expect(group.items).toEqual([ingredient({ unit: "us_cup" })]);
  });

  it("accepts an unquantified duplicate of a quantified ingredient", () => {
    const group = createIngredientGroupAccumulator();
    mergeIngredientIntoGroup(group, ingredient({ amount: 1, unit: "us_cup" }));

    mergeIngredientIntoGroup(group, ingredient({ unit: "us_cup" }));

    expect(group.items).toEqual([ingredient({ amount: 1, unit: "us_cup" })]);
  });

  it.each([
    [
      ingredient({ preparation: "sifted" }),
      ingredient({ preparation: "packed" }),
      "preparation annotations differ",
    ],
    [
      ingredient({ note: "divided" }),
      ingredient({ note: "for dusting" }),
      "notes differ",
    ],
    [
      ingredient({ amount: 1, unit: "us_cup" }),
      ingredient({ amount: 1, unit: "g" }),
      "units differ",
    ],
    [
      ingredient({ unit: "us_cup" }),
      ingredient({ amount: 1, unit: "g" }),
      "unit differs from the existing entry",
    ],
    [
      ingredient({ amount: 1, unit: "us_cup" }),
      ingredient({ unit: "g" }),
      "unit differs from the existing quantified entry",
    ],
    [
      ingredient({ unit: "us_cup" }),
      ingredient({ unit: "g" }),
      "unit differs between unquantified duplicate entries",
    ],
  ])("rejects incompatible duplicates", (existing, next, reason) => {
    const group = createIngredientGroupAccumulator("Dough");
    mergeIngredientIntoGroup(group, existing);

    expect(() => mergeIngredientIntoGroup(group, next)).toThrow(reason);
  });
});
