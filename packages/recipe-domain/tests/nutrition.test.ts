import { describe, expect, it } from "vitest";
import reference from "./fixtures/nutrition-reference.json";
import {
  IngredientPropertyObservationSchema,
  IngredientPropertyValueSchema,
  reconcileIngredientProperty,
  type IngredientPropertySelection,
} from "../src/ingredient-property";
import { calculateRecipeNutrition } from "../src/nutrition";
import { IngredientGroupSchema } from "../src/recipe";

function fixtureSelection(input: {
  id: string;
  ingredientSlug: string;
  preparationState: string;
  value: unknown;
}): IngredientPropertySelection {
  const observation = IngredientPropertyObservationSchema.parse({
    id: input.id,
    sourceRecordId: `reference-property-${input.id}`,
    originalRecord: { fixture: reference.id, value: input.value },
    ingredientSlug: input.ingredientSlug,
    preparationState: input.preparationState,
    value: input.value,
    confidence: 0.95,
    source: reference.source,
  });
  return reconcileIngredientProperty({
    catalogVersion: reference.catalogVersion,
    observations: [observation],
    selectedObservationId: observation.id,
    confidence: 0.95,
    decision: {
      strategy: "manual",
      rationale: "The independent reference case declares this property.",
      consideredObservationIds: [observation.id],
      decidedBy: "reference-fixture",
      decidedAt: "2026-10-29T00:00:00.000Z",
    },
  });
}

function referenceSelections(): IngredientPropertySelection[] {
  return reference.properties.map((property) => fixtureSelection(property));
}

function expectWithin(actual: string, expected: string, tolerance: string): void {
  const difference = Math.abs(Number(actual) - Number(expected));
  expect(difference, `${actual} differs from ${expected} by more than ${tolerance}`)
    .toBeLessThanOrEqual(Number(tolerance));
}

function referenceCalculation(servings = reference.servings) {
  return calculateRecipeNutrition({
    recipeVersion: reference.recipeVersion,
    catalogVersion: reference.catalogVersion,
    servings,
    ingredientGroups: reference.ingredientGroups.map((group) =>
      IngredientGroupSchema.parse(group),
    ),
    selections: referenceSelections(),
    decimalPlaces: 8,
  });
}

describe("recipe nutrition reference fixture", () => {
  it("matches independently declared totals and per-serving values", () => {
    const result = referenceCalculation();

    for (const [section, actualValues] of [
      ["totals", result.totals],
      ["perServing", result.perServing],
    ] as const) {
      const expectedValues = reference.expected[section];
      for (const [nutrient, expected] of Object.entries(expectedValues)) {
        const actual = actualValues.find((value) => value.nutrient === nutrient);
        expect(actual).toBeDefined();
        if (!actual) continue;
        expect(actual.unit).toBe(expected.unit);
        expect(actual.complete).toBe(true);
        expectWithin(actual.amount, expected.amount, reference.declaredTolerance);
        expect(actual.uncertainty).not.toBeNull();
        if (!actual.uncertainty) continue;
        expectWithin(
          actual.uncertainty.lowerBound,
          expected.lowerBound,
          reference.declaredTolerance,
        );
        expectWithin(
          actual.uncertainty.upperBound,
          expected.upperBound,
          reference.declaredTolerance,
        );
      }
    }

    expect(result.coverage).toEqual({
      ingredientCount: 2,
      completeIngredientCount: 2,
      partialIngredientCount: 0,
      unsupportedIngredientCount: 0,
      completeIngredientRatio: 1,
    });
    expect(result.gaps).toEqual([]);
  });

  it("keeps totals stable when only the serving count changes", () => {
    const twoServings = referenceCalculation(2);
    const fourServings = referenceCalculation(4);

    expect(fourServings.totals).toEqual(twoServings.totals);
    for (const total of twoServings.perServing) {
      const scaled = fourServings.perServing.find(
        ({ nutrient }) => nutrient === total.nutrient,
      );
      expect(scaled).toBeDefined();
      expect(Number(scaled?.amount)).toBeCloseTo(Number(total.amount) / 2, 8);
    }
  });

  it("recalculates deterministically after a recipe quantity edit", () => {
    const original = referenceCalculation();
    const editedGroups = reference.ingredientGroups.map((group) => ({
      ...group,
      items: group.items.map((item) =>
        item.ingredient === "rolled-oats" ? { ...item, amount: 160 } : item,
      ),
    }));
    const input = {
      recipeVersion: "oats-and-milk-v2",
      catalogVersion: reference.catalogVersion,
      servings: reference.servings,
      ingredientGroups: editedGroups.map((group) =>
        IngredientGroupSchema.parse(group),
      ),
      selections: referenceSelections(),
      decimalPlaces: 8,
    };

    const first = calculateRecipeNutrition(input);
    const replay = calculateRecipeNutrition({
      ...input,
      selections: [...input.selections].reverse(),
    });
    expect(replay).toEqual(first);
    expect(first.recipeVersion).toBe("oats-and-milk-v2");
    expect(Number(first.totals.find(({ nutrient }) => nutrient === "protein")?.amount))
      .toBeGreaterThan(
        Number(original.totals.find(({ nutrient }) => nutrient === "protein")?.amount),
      );
  });
});

describe("recipe nutrition boundaries and gaps", () => {
  it("keeps unsupported and ambiguous ingredients visible", () => {
    const selections = referenceSelections();
    const density = selections.find(
      ({ observation }) => observation.value.kind === "density",
    );
    if (!density) throw new Error("Reference density selection is missing");
    const duplicateDensity = {
      ...density,
      observation: {
        ...density.observation,
        id: "30000000-0000-4000-8000-000000000099",
      },
    };
    const result = calculateRecipeNutrition({
      recipeVersion: "gaps-v1",
      catalogVersion: reference.catalogVersion,
      servings: 1,
      ingredientGroups: [
        {
          items: [
            {
              ingredient: "whole-milk",
              amount: 250,
              unit: "ml",
              quantityBasis: "edible",
            },
            {
              ingredient: "unknown-spice",
              amount: 1,
              unit: "pinch",
              quantityBasis: "edible",
            },
            { ingredient: "unknown-produce", amount: 1, unit: "g" },
          ],
        },
      ],
      selections: [...selections, duplicateDensity],
    });

    expect(result.ingredients).toHaveLength(3);
    expect(result.ingredients[0]).toMatchObject({
      ingredient: "whole-milk",
      status: "unsupported",
      edibleMass: null,
    });
    expect(result.ingredients[1]).toMatchObject({
      ingredient: "unknown-spice",
      status: "unsupported",
      edibleMass: null,
    });
    expect(result.ingredients[2]).toMatchObject({
      ingredient: "unknown-produce",
      status: "unsupported",
      edibleMass: null,
    });
    expect(result.gaps.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "ambiguous_property",
        "missing_quantity_basis",
        "unsupported_unit",
      ]),
    );
  });

  it("does not invent uncertainty when catalog properties omit it", () => {
    const selections = referenceSelections().map((selection) => ({
      ...selection,
      observation: {
        ...selection.observation,
        value: IngredientPropertyValueSchema.parse({
          ...selection.observation.value,
          uncertainty: undefined,
        }),
      },
    }));
    const result = calculateRecipeNutrition({
      recipeVersion: reference.recipeVersion,
      catalogVersion: reference.catalogVersion,
      servings: reference.servings,
      ingredientGroups: reference.ingredientGroups.map((group) =>
        IngredientGroupSchema.parse(group),
      ),
      selections,
    });

    expect(result.totals.every(({ uncertainty }) => uncertainty === null)).toBe(
      true,
    );
    expect(result.gaps.some(({ code }) => code === "missing_uncertainty")).toBe(
      true,
    );
  });

  it("applies a catalog edible fraction to as-purchased weight", () => {
    const protein = referenceSelections().find(
      ({ observation }) =>
        observation.ingredientSlug === "rolled-oats" &&
        observation.value.kind === "nutrient" &&
        observation.value.nutrient === "protein",
    );
    if (!protein) throw new Error("Reference protein selection is missing");
    const edibleFraction = fixtureSelection({
      id: "30000000-0000-4000-8000-000000000020",
      ingredientSlug: "rolled-oats",
      preparationState: "raw",
      value: {
        kind: "edible_mass_fraction",
        unit: "fraction",
        edibleMassFraction: "0.8",
        uncertainty: {
          lowerBound: "0.75",
          upperBound: "0.85",
          basis: "Boundary fixture interval",
        },
      },
    });
    const result = calculateRecipeNutrition({
      recipeVersion: "as-purchased-v1",
      catalogVersion: reference.catalogVersion,
      servings: 1,
      ingredientGroups: [
        {
          items: [
            {
              ingredient: "rolled-oats",
              amount: 100,
              unit: "g",
              quantityBasis: "as_purchased",
              preparation: "raw",
            },
          ],
        },
      ],
      selections: [edibleFraction, protein],
      decimalPlaces: 6,
    });

    expect(result.ingredients[0]).toMatchObject({
      status: "complete",
      edibleMass: {
        amount: "80",
        uncertainty: { lowerBound: "75", upperBound: "85" },
      },
    });
    expect(result.totals[0]).toMatchObject({
      nutrient: "protein",
      amount: "10.52",
      uncertainty: { lowerBound: "9.675", upperBound: "11.39" },
    });
  });

  it("normalizes catalog nutrient units before aggregation", () => {
    const protein = fixtureSelection({
      id: "30000000-0000-4000-8000-000000000021",
      ingredientSlug: "plain-flour",
      preparationState: "raw",
      value: {
        kind: "nutrient",
        nutrient: "protein",
        category: "macronutrient",
        amount: "12500",
        unit: "mg",
        perEdibleGrams: "100",
        uncertainty: {
          lowerBound: "12000",
          upperBound: "13000",
          basis: "Unit conversion fixture interval",
        },
      },
    });
    const energy = fixtureSelection({
      id: "30000000-0000-4000-8000-000000000022",
      ingredientSlug: "plain-flour",
      preparationState: "raw",
      value: {
        kind: "nutrient",
        nutrient: "energy",
        category: "energy",
        amount: "418.4",
        unit: "kj",
        perEdibleGrams: "100",
        uncertainty: {
          lowerBound: "414.216",
          upperBound: "422.584",
          basis: "Unit conversion fixture interval",
        },
      },
    });
    const result = calculateRecipeNutrition({
      recipeVersion: "unit-conversion-v1",
      catalogVersion: reference.catalogVersion,
      servings: 1,
      ingredientGroups: [
        {
          items: [
            {
              ingredient: "plain-flour",
              amount: 100,
              unit: "g",
              quantityBasis: "edible",
              preparation: "raw",
            },
          ],
        },
      ],
      selections: [protein, energy],
      decimalPlaces: 6,
    });

    expect(result.totals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nutrient: "protein", amount: "12.5", unit: "g" }),
        expect.objectContaining({ nutrient: "energy", amount: "100", unit: "kcal" }),
      ]),
    );
  });

  it("sums exact contributions before rounding the recipe total", () => {
    const traceMineral = fixtureSelection({
      id: "30000000-0000-4000-8000-000000000023",
      ingredientSlug: "trace-ingredient",
      preparationState: "raw",
      value: {
        kind: "nutrient",
        nutrient: "trace-mineral",
        category: "micronutrient",
        amount: "0.4",
        unit: "mg",
        perEdibleGrams: "100",
        uncertainty: {
          lowerBound: "0.4",
          upperBound: "0.4",
          basis: "Exact rounding fixture",
        },
      },
    });
    const ingredient = {
      ingredient: "trace-ingredient",
      amount: 1,
      unit: "g" as const,
      quantityBasis: "edible" as const,
      preparation: "raw",
    };
    const result = calculateRecipeNutrition({
      recipeVersion: "round-once-v1",
      catalogVersion: reference.catalogVersion,
      servings: 1,
      ingredientGroups: [{ items: [ingredient, ingredient, ingredient] }],
      selections: [traceMineral],
      decimalPlaces: 2,
    });

    expect(result.ingredients.map(({ nutrients }) => nutrients[0]?.amount)).toEqual([
      "0",
      "0",
      "0",
    ]);
    expect(result.totals[0]?.amount).toBe("0.01");
  });

  it("marks nutrient totals incomplete when one ingredient lacks a selection", () => {
    const selections = referenceSelections().filter(
      ({ observation }) =>
        !(
          observation.ingredientSlug === "whole-milk" &&
          observation.value.kind === "nutrient" &&
          observation.value.nutrient === "iron"
        ),
    );
    const result = calculateRecipeNutrition({
      recipeVersion: reference.recipeVersion,
      catalogVersion: reference.catalogVersion,
      servings: reference.servings,
      ingredientGroups: reference.ingredientGroups.map((group) =>
        IngredientGroupSchema.parse(group),
      ),
      selections,
    });
    const iron = result.totals.find(({ nutrient }) => nutrient === "iron");

    expect(iron).toMatchObject({
      contributingIngredientCount: 1,
      ingredientCount: 2,
      coverage: 0.5,
      complete: false,
      uncertainty: null,
    });
    expect(result.gaps).toContainEqual(
      expect.objectContaining({
        code: "missing_nutrient",
        nutrient: "iron",
      }),
    );
  });

  it("rejects a catalog nutrient whose category and unit disagree", () => {
    const invalidProtein = fixtureSelection({
      id: "30000000-0000-4000-8000-000000000024",
      ingredientSlug: "plain-flour",
      preparationState: "raw",
      value: {
        kind: "nutrient",
        nutrient: "protein",
        category: "macronutrient",
        amount: "10",
        unit: "kcal",
        perEdibleGrams: "100",
        uncertainty: {
          lowerBound: "9",
          upperBound: "11",
          basis: "Invalid definition fixture",
        },
      },
    });
    const result = calculateRecipeNutrition({
      recipeVersion: "invalid-definition-v1",
      catalogVersion: reference.catalogVersion,
      servings: 1,
      ingredientGroups: [
        {
          items: [
            {
              ingredient: "plain-flour",
              amount: 100,
              unit: "g",
              quantityBasis: "edible",
              preparation: "raw",
            },
          ],
        },
      ],
      selections: [invalidProtein],
    });

    expect(result.totals).toEqual([]);
    expect(result.gaps).toContainEqual(
      expect.objectContaining({
        code: "incompatible_nutrient_definition",
        nutrient: "protein",
      }),
    );
  });

  it("reports missing structured fields and supports an empty recipe", () => {
    const gaps = calculateRecipeNutrition({
      recipeVersion: "missing-fields-v1",
      catalogVersion: reference.catalogVersion,
      servings: 1,
      ingredientGroups: [
        {
          items: [
            { ingredient: "salt", unit: "g", quantityBasis: "edible" },
            { ingredient: "water", amount: 10, quantityBasis: "edible" },
            {
              ingredient: "broth",
              amount: 10,
              unit: "ml",
              quantityBasis: "edible",
            },
            {
              ingredient: "apple",
              amount: 100,
              unit: "g",
              quantityBasis: "as_purchased",
            },
          ],
        },
      ],
      selections: [],
    });
    expect(gaps.gaps.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "missing_quantity",
        "missing_unit",
        "missing_density",
        "missing_edible_mass_fraction",
      ]),
    );

    const empty = calculateRecipeNutrition({
      recipeVersion: "empty-v1",
      catalogVersion: reference.catalogVersion,
      servings: 1,
      ingredientGroups: [],
      selections: [],
    });
    expect(empty).toMatchObject({
      totals: [],
      perServing: [],
      coverage: { ingredientCount: 0, completeIngredientRatio: 0 },
    });
  });

  it("requires an exact catalog version", () => {
    expect(() =>
      calculateRecipeNutrition({
        recipeVersion: reference.recipeVersion,
        catalogVersion: "different-version",
        servings: reference.servings,
        ingredientGroups: reference.ingredientGroups.map((group) =>
          IngredientGroupSchema.parse(group),
        ),
        selections: referenceSelections(),
      }),
    ).toThrow("cannot use selections from another version");
  });

  it("rejects estimates outside declared uncertainty bounds", () => {
    expect(
      IngredientPropertyValueSchema.safeParse({
        kind: "nutrient",
        nutrient: "protein",
        amount: "12",
        unit: "g",
        perEdibleGrams: "100",
        uncertainty: {
          lowerBound: "13",
          upperBound: "14",
          basis: "Invalid test interval",
        },
      }).success,
    ).toBe(false);
  });
});
