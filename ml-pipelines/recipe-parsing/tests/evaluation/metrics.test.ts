
import { describe, it, expect } from "vitest";
import {
  aggregateMetrics,
  CANONICALIZATION_SCORING_PROFILE,
  computeCharErrorRate,
  computeEntryScores,
  computeRougeL,
  computeWordErrorRate,
  evaluateEquipmentParsing,
  evaluateIngredientParsing,
  evaluateInstructions,
  evaluateScalarFields,
  splitWords,
} from "../../src/evaluation/metrics.js";
import {
  normalizeComparableText,
  splitComparableWords,
} from "../../src/lib/comparable-text.js";
import type { Recipe } from "recipe-parsing/schemas/ground-truth";

describe("splitWords", () => {
    it("should split words correctly", () => {
        expect(splitWords("hello world")).toEqual(["hello", "world"]);
    });

    it("should handle accented characters", () => {
        expect(splitWords("café standard")).toEqual(["café", "standard"]);
    });

    it("should handle non-Latin characters", () => {
        // Simple check to ensure we don't regress if we add more support
        expect(splitWords("你好 code")).toEqual(["你好", "code"]);
    });
});

describe("comparable text normalization", () => {
  it("treats digit and number words as equivalent", () => {
    expect(normalizeComparableText("two")).toBe("2");
    expect(normalizeComparableText("21")).toBe("21");
    expect(normalizeComparableText("twenty one")).toBe("21");
  });

  it("normalizes number words inside larger text", () => {
    expect(splitComparableWords("Cook for twenty one minutes")).toEqual([
      "cook",
      "for",
      "21",
      "minutes",
    ]);
  });

  it("normalizes multiple number phrases inside one string", () => {
    expect(
      normalizeComparableText("Bake two potatoes for twenty one minutes"),
    ).toBe("bake 2 potatoes for 21 minutes");
  });

  it("normalizes articles, connectors, and integer scales", () => {
    expect(normalizeComparableText("a hundred and five")).toBe("105");
    expect(normalizeComparableText("two thousand three hundred")).toBe(
      "2300",
    );
    expect(normalizeComparableText("a potato")).toBe("a potato");
  });

  it("treats em dash and hyphen as equivalent", () => {
    expect(normalizeComparableText("Mix well—and serve")).toBe(
      normalizeComparableText("Mix well-and serve"),
    );
  });
});

describe("text fidelity metrics", () => {
  it("computes word error rate over token edits", () => {
    expect(computeWordErrorRate("boil water now", "boil water")).toBeCloseTo(0.5);
  });

  it("computes char error rate over normalized characters", () => {
    expect(computeCharErrorRate("abc", "adc")).toBeCloseTo(1 / 3);
  });

  it("computes ROUGE-L from token sequence overlap", () => {
    const result = computeRougeL(
      "boil water add pasta",
      "boil water then add pasta",
    );
    expect(result.precision).toBe(1);
    expect(result.recall).toBeCloseTo(4 / 5);
    expect(result.f1).toBeCloseTo(8 / 9);
  });

  it("treats both empty strings as perfect for ROUGE-L and zero error for WER/CER", () => {
    expect(computeWordErrorRate("", "")).toBe(0);
    expect(computeCharErrorRate("", "")).toBe(0);
    expect(computeRougeL("", "").f1).toBe(1);
  });
});

function makeRecipe(overrides: Partial<Recipe> & { instructions: string[] }): Recipe {
  return {
    title: "Test",
    description: "",
    cuisine: [],
    servings: 1,
    ingredientGroups: [],
    cookware: [],
    ...overrides,
  };
}

describe("evaluateInstructions", () => {
  it("scores identical multi-step instructions as 1.0", () => {
    const steps = ["Boil water.", "Add pasta.", "Drain and serve."];
    const result = evaluateInstructions(makeRecipe({ instructions: steps }), makeRecipe({ instructions: steps }));
    expect(result.f1).toBe(1);
  });

  it("penalizes a single paragraph vs multiple steps with same words", () => {
    const expected = makeRecipe({ instructions: [
      "Boil water.",
      "Add pasta.",
      "Drain and serve.",
    ] });
    const predicted = makeRecipe({ instructions: [
      "Boil water. Add pasta. Drain and serve.",
    ] });
    const result = evaluateInstructions(predicted, expected);
    // Content matches perfectly but step count 1 vs 3 → ~15% penalty
    expect(result.f1).toBeGreaterThan(0.8);
    expect(result.f1).toBeLessThan(1);
  });

  it("scores completely different instructions near 0", () => {
    const predicted = makeRecipe({ instructions: ["Fry the chicken."] });
    const expected = makeRecipe({ instructions: ["Boil the pasta."] });
    const result = evaluateInstructions(predicted, expected);
    expect(result.f1).toBeLessThan(0.5);
  });

  it("scores both empty as 1.0", () => {
    const result = evaluateInstructions(makeRecipe({ instructions: [] }), makeRecipe({ instructions: [] }));
    expect(result.f1).toBe(1);
  });

  it("scores one empty side as 0", () => {
    const result = evaluateInstructions(
      makeRecipe({ instructions: [] }),
      makeRecipe({ instructions: ["Do something."] }),
    );
    expect(result.f1).toBe(0);
  });

  it("treats timer unit synonyms as equivalent (minutes)", () => {
    const predicted = makeRecipe({ instructions: ["Simmer for 15 minutes."] });
    const expected = makeRecipe({ instructions: ["Simmer for 15 min."] });
    const result = evaluateInstructions(predicted, expected);
    expect(result.f1).toBe(1);
  });

  it("treats timer unit synonyms as equivalent (hours)", () => {
    const predicted = makeRecipe({ instructions: ["Cook for 1 hour."] });
    const expected = makeRecipe({ instructions: ["Cook for 1 hr."] });
    const result = evaluateInstructions(predicted, expected);
    expect(result.f1).toBe(1);
  });

  it("treats spelled-out numbers as equivalent to digits", () => {
    const predicted = makeRecipe({ instructions: ["Bake two potatoes for twenty one minutes."] });
    const expected = makeRecipe({ instructions: ["Bake 2 potatoes for 21 min."] });
    const result = evaluateInstructions(predicted, expected);
    expect(result.f1).toBe(1);
  });

  it("treats em dash and hyphen as equivalent in instructions", () => {
    const predicted = makeRecipe({ instructions: ["Stir-fry the onions."] });
    const expected = makeRecipe({ instructions: ["Stir—fry the onions."] });
    const result = evaluateInstructions(predicted, expected);
    expect(result.f1).toBe(1);
  });
});

describe("evaluateScalarFields cuisine F1", () => {
  it("scores exact match as 1.0", () => {
    const a = makeRecipe({ instructions: ["x"], cuisine: ["Italian"] });
    const b = makeRecipe({ instructions: ["x"], cuisine: ["Italian"] });
    expect(evaluateScalarFields(a, b).cuisine.f1).toBe(1);
  });

  it("scores partial overlap with F1", () => {
    const predicted = makeRecipe({ instructions: ["x"], cuisine: ["British", "Chinese"] });
    const expected = makeRecipe({ instructions: ["x"], cuisine: ["Chinese", "Japanese"] });
    const result = evaluateScalarFields(predicted, expected).cuisine;
    // 1 TP (chinese), predicted=2, expected=2 → P=0.5, R=0.5, F1=0.5
    expect(result.f1).toBeCloseTo(0.5);
  });

  it("is case-insensitive", () => {
    const a = makeRecipe({ instructions: ["x"], cuisine: ["italian"] });
    const b = makeRecipe({ instructions: ["x"], cuisine: ["Italian"] });
    expect(evaluateScalarFields(a, b).cuisine.f1).toBe(1);
  });

  it("scores both empty as 1.0", () => {
    const a = makeRecipe({ instructions: ["x"], cuisine: [] });
    const b = makeRecipe({ instructions: ["x"], cuisine: [] });
    expect(evaluateScalarFields(a, b).cuisine.f1).toBe(1);
  });
});

describe("evaluateScalarFields text fields", () => {
  it("treats spelled-out numbers as equivalent to digits in titles", () => {
    const predicted = makeRecipe({ instructions: ["x"], title: "2 bean chili" });
    const expected = makeRecipe({ instructions: ["x"], title: "two bean chili" });
    expect(evaluateScalarFields(predicted, expected).title.f1).toBe(1);
  });
});

describe("evaluateScalarFields description", () => {
  it("returns perfect score when ground truth description is empty", () => {
    const predicted = makeRecipe({ instructions: ["x"], description: "A tasty dish with lots of flavor" });
    const expected = makeRecipe({ instructions: ["x"], description: "" });
    const result = evaluateScalarFields(predicted, expected).description;
    expect(result.f1).toBe(1);
    expect(result.precision).toBe(1);
    expect(result.recall).toBe(1);
  });

  it("scores normally when ground truth description is non-empty", () => {
    const predicted = makeRecipe({ instructions: ["x"], description: "A tasty chicken dish" });
    const expected = makeRecipe({ instructions: ["x"], description: "A tasty chicken dish" });
    const result = evaluateScalarFields(predicted, expected).description;
    expect(result.f1).toBe(1);
  });
});

describe("evaluateEquipmentParsing", () => {
  it("scores matching equipment as 1.0", () => {
    const predicted = makeRecipe({
      instructions: ["x"],
      cookware: ["Saucepan", "Wooden Spoon"],
    });
    const expected = makeRecipe({
      instructions: ["x"],
      cookware: ["saucepan", "wooden spoon"],
    });

    expect(evaluateEquipmentParsing(predicted, expected).f1).toBe(1);
  });

  it("scores partial overlap with bag F1", () => {
    const predicted = makeRecipe({
      instructions: ["x"],
      cookware: ["saucepan", "knife"],
    });
    const expected = makeRecipe({
      instructions: ["x"],
      cookware: ["saucepan", "spatula"],
    });

    expect(evaluateEquipmentParsing(predicted, expected).f1).toBeCloseTo(0.5);
  });
});

describe("aggregateMetrics", () => {
    it("should treat missing predictions as failed entries", () => {
        const expectedRecipe = {
            title: "Test",
            description: "Test recipe",
            cuisine: [],
            servings: 2,
            ingredientGroups: [{ items: [{ ingredient: "olive-oil", amount: 1, unit: "tbsp" }] }],
            instructions: ["Mix well"],
            cookware: [],
        };

        const { metrics, perEntry } = aggregateMetrics([], [
            {
                images: ["img-1.jpg"],
                expected: expectedRecipe,
            } as any,
        ]);

        expect(metrics.entryCount).toBe(1);
        expect(metrics.overall.score).toBe(0);
        expect(perEntry).toHaveLength(1);
        expect(perEntry[0]!.missingPrediction).toBe(true);
        expect(perEntry[0]!.scores.overall).toBe(0);
    });

    it("uses stage-owned weights for canonicalization overall", () => {
        const expectedRecipe = makeRecipe({
            title: "Chicken Alfredo Pasta",
            description: "Creamy pasta",
            cuisine: ["Italian"],
            servings: 4,
            ingredientGroups: [{ items: [{ ingredient: "parmesan-cheese", amount: 100, unit: "g" }] }],
            instructions: ["Boil pasta.", "Stir through sauce."],
            cookware: ["saucepan"],
        });

        const predictedRecipe = makeRecipe({
            title: "Completely Different Title",
            description: "Different description",
            cuisine: ["Italian"],
            servings: 2,
            ingredientGroups: [{ items: [{ ingredient: "parmesan-cheese", amount: 250, unit: "cup" }] }],
            instructions: ["Do something else entirely."],
            cookware: ["saucepan"],
        });

        const scalar = evaluateScalarFields(predictedRecipe, expectedRecipe);
        const ingredients = evaluateIngredientParsing(predictedRecipe, expectedRecipe);
        const instructions = evaluateInstructions(predictedRecipe, expectedRecipe);
        const equipment = evaluateEquipmentParsing(predictedRecipe, expectedRecipe);

        const defaultScores = computeEntryScores(
            scalar,
            ingredients,
            instructions,
            equipment,
        );
        const canonicalizationScores = computeEntryScores(
            scalar,
            ingredients,
            instructions,
            equipment,
            CANONICALIZATION_SCORING_PROFILE,
        );

        expect(defaultScores.overall).toBeLessThan(1);
        // Ingredient name matches but amount (100 vs 250) and unit (g vs cup)
        // differ, so field quality penalises the canonicalization score.
        expect(canonicalizationScores.overall).toBeCloseTo(0.8, 5);
        expect(canonicalizationScores.instructions).toBeLessThan(1);
        expect(canonicalizationScores.equipmentParsing).toBe(1);
    });

    it("applies the canonicalization profile in aggregate metrics", () => {
        const expectedRecipe = makeRecipe({
            title: "Chicken Alfredo Pasta",
            cuisine: ["Italian"],
            ingredientGroups: [{ items: [{ ingredient: "parmesan-cheese", amount: 100, unit: "g" }] }],
            instructions: ["Boil pasta.", "Stir through sauce."],
            cookware: ["saucepan"],
        });

        const predictedRecipe = makeRecipe({
            title: "Wrong title",
            cuisine: ["American"],
            ingredientGroups: [{ items: [{ ingredient: "parmesan", amount: 100, unit: "g" }] }],
            instructions: ["Completely different."],
            cookware: ["wok"],
        });

        const defaultAggregate = aggregateMetrics(
            [{ images: ["img-1.jpg"], predicted: predictedRecipe }] as any,
            [{ images: ["img-1.jpg"], expected: expectedRecipe }] as any,
        );
        const canonicalizationAggregate = aggregateMetrics(
            [{ images: ["img-1.jpg"], predicted: predictedRecipe }] as any,
            [{ images: ["img-1.jpg"], expected: expectedRecipe }] as any,
            CANONICALIZATION_SCORING_PROFILE,
        );

        expect(defaultAggregate.metrics.overall.score).toBeGreaterThan(0);
        expect(canonicalizationAggregate.metrics.overall.score).toBe(0);
        expect(canonicalizationAggregate.metrics.byCategory.instructions.f1).toBeLessThan(1);
    });

    it("counts equipment in the canonicalization profile", () => {
        const expectedRecipe = makeRecipe({
            title: "Chicken Alfredo Pasta",
            cuisine: ["Italian"],
            ingredientGroups: [{ items: [{ ingredient: "parmesan-cheese", amount: 100, unit: "g" }] }],
            instructions: ["Boil pasta."],
            cookware: ["frying pan"],
        });

        const predictedRecipe = makeRecipe({
            title: "Wrong title",
            cuisine: ["Italian"],
            ingredientGroups: [{ items: [{ ingredient: "parmesan-cheese", amount: 999, unit: "cup" }] }],
            instructions: ["Completely different."],
            cookware: ["saucepan"],
        });

        const aggregate = aggregateMetrics(
            [{ images: ["img-1.jpg"], predicted: predictedRecipe }] as any,
            [{ images: ["img-1.jpg"], expected: expectedRecipe }] as any,
            CANONICALIZATION_SCORING_PROFILE,
        );

        // Ingredient name matches but amount (100 vs 999) and unit (g vs cup)
        // differ, so field quality reduces ingredient F1 from 1.0.
        expect(aggregate.metrics.byCategory.ingredientParsing.f1).toBeCloseTo(0.667, 2);
        expect(aggregate.metrics.byCategory.scalarFields.cuisine.f1).toBe(1);
        expect(aggregate.metrics.byCategory.equipmentParsing.f1).toBe(0);
        expect(aggregate.metrics.overall.score).toBeCloseTo(0.5, 1);
    });
});
