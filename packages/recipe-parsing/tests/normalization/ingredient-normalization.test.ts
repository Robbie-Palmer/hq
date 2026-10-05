import { describe, expect, it } from "vitest";
import {
  canonicalizeIngredientSlug,
  normalizeIngredientSlug,
  canonicalizePredictionEntry,
} from "../../src/lib/ingredient-canonicalization.js";

describe("normalizeIngredientSlug", () => {
  it("should do baseline slug normalization", () => {
    expect(normalizeIngredientSlug("Chicken Breasts")).toBe("chicken-breasts");
    expect(normalizeIngredientSlug("Parmesan Cheese")).toBe("parmesan-cheese");
    expect(normalizeIngredientSlug("salt and pepper")).toBe("salt-and-pepper");
  });
});

describe("canonicalizeIngredientSlug", () => {
  it("should match typo via token fixup to canonical form", () => {
    const decision = canonicalizeIngredientSlug({
      rawSlug: "garlic-clov",
      ontology: new Set(["garlic", "garlic-clove"]),
    });
    // "clov" fixup → "clove", so "garlic-clove" is an exact match
    expect(decision.canonicalSlug).toBe("garlic-clove");
    expect(decision.method).toBe("exact");
  });

  it("should resolve alias when only the alias target is in the ontology", () => {
    const decision = canonicalizeIngredientSlug({
      rawSlug: "garlic-clov",
      ontology: new Set(["garlic"]),
    });
    // "clov" fixup → "clove" → "garlic-clove" → alias to "garlic"
    expect(decision.canonicalSlug).toBe("garlic");
    expect(decision.method).toBe("exact");
  });

  it.each([
    ["neutral-oil", "vegetable-oil"],
    ["rice-vinegar", "rice-wine-vinegar"],
  ])("maps %s to the existing canonical ingredient", (rawSlug, canonicalSlug) => {
    const decision = canonicalizeIngredientSlug({
      rawSlug,
      ontology: new Set([canonicalSlug]),
    });

    expect(decision.canonicalSlug).toBe(canonicalSlug);
    expect(decision.method).toBe("exact");
  });

  it("should keep unknown if below strict threshold", () => {
    const decision = canonicalizeIngredientSlug({
      rawSlug: "salt-and-pepper",
      ontology: new Set(["black-pepper", "salt"]),
    });
    expect(decision.method).toBe("none");
    expect(decision.canonicalSlug).toBe("salt-and-pepper");
  });

  it("flags tomato-pure as a typo instead of treating it as an alias", () => {
    const decision = canonicalizeIngredientSlug({
      rawSlug: "tomato-pure",
      ontology: new Set(["tomato-puree"]),
    });

    expect(decision.method).toBe("none");
    expect(decision.canonicalSlug).toBe("tomato-pure");
  });

  it("should not collapse garlic-powder to garlic", () => {
    const decision = canonicalizeIngredientSlug({
      rawSlug: "garlic-powder",
      ontology: new Set(["garlic"]),
    });
    expect(decision.method).toBe("none");
    expect(decision.canonicalSlug).toBe("garlic-powder");
  });

  it.each(["butter", "salted-butter", "unsalted-butter"])(
    "keeps the purchasing identity for %s",
    (rawSlug) => {
      const decision = canonicalizeIngredientSlug({
        rawSlug,
        ontology: new Set(["butter", "salted-butter", "unsalted-butter"]),
      });

      expect(decision.canonicalSlug).toBe(rawSlug);
      expect(decision.method).toBe("exact");
    },
  );

  it.each([
    {
      rawSlug: "slices-of-bacon",
      ontology: new Set(["bacon"]),
      expected: "bacon",
    },
    {
      rawSlug: "semi-skimmed-milk",
      ontology: new Set(["milk"]),
      expected: "milk",
    },
    {
      rawSlug: "red-pepper",
      ontology: new Set(["bell-pepper"]),
      expected: "bell-pepper",
    },
    {
      rawSlug: "yellow-pepper",
      ontology: new Set(["bell-pepper"]),
      expected: "bell-pepper",
    },
    {
      rawSlug: "green-pepper",
      ontology: new Set(["bell-pepper"]),
      expected: "bell-pepper",
    },
    {
      rawSlug: "sausages",
      ontology: new Set(["pork-sausage"]),
      expected: "pork-sausage",
    },
    {
      rawSlug: "onion",
      ontology: new Set(["onion"]),
      expected: "onion",
    },
    {
      rawSlug: "medium-onion",
      ontology: new Set(["onion"]),
      expected: "onion",
    },
    {
      rawSlug: "chili-powder",
      ontology: new Set(["chilli-powder"]),
      expected: "chilli-powder",
    },
    {
      rawSlug: "cheddar",
      ontology: new Set(["cheddar-cheese"]),
      expected: "cheddar-cheese",
    },
    {
      rawSlug: "scallion",
      ontology: new Set(["spring-onion"]),
      expected: "spring-onion",
    },
    {
      rawSlug: "scallions",
      ontology: new Set(["spring-onion"]),
      expected: "spring-onion",
    },
    {
      rawSlug: "mayo",
      ontology: new Set(["mayonnaise"]),
      expected: "mayonnaise",
    },
    {
      rawSlug: "mayonaise",
      ontology: new Set(["mayonnaise"]),
      expected: "mayonnaise",
    },
    {
      rawSlug: "cajun-powder",
      ontology: new Set(["cajun-seasoning"]),
      expected: "cajun-seasoning",
    },
  ])(
    "should apply safe deterministic cleanup rules for $rawSlug",
    ({ rawSlug, ontology, expected }) => {
      const decision = canonicalizeIngredientSlug({
        rawSlug,
        ontology,
      });
      expect(decision.canonicalSlug).toBe(expected);
    },
  );

  it("should use pluralization normalization when ontology has singular form", () => {
    const onionDecision = canonicalizeIngredientSlug({
      rawSlug: "onions",
      ontology: new Set(["onion"]),
    });
    expect(onionDecision.canonicalSlug).toBe("onion");

    const garlicDecision = canonicalizeIngredientSlug({
      rawSlug: "garlic-cloves",
      ontology: new Set(["garlic"]),
    });
    expect(garlicDecision.canonicalSlug).toBe("garlic");
  });
});

describe("canonicalizePredictionEntry", () => {
  it("should canonicalize ingredient slugs inside ingredient groups", () => {
    const result = canonicalizePredictionEntry({
      images: ["a.jpg"],
      predicted: {
        title: "x",
        description: "y",
        cuisine: [],
        servings: 2,
        ingredientGroups: [
          {
            items: [
              { ingredient: "chicken-fillets", amount: 2, unit: "piece" },
              { ingredient: "garlic-clove", amount: 1, unit: "clove" },
            ],
          },
        ],
        instructions: ["step"],
        cookware: ["large skillet", "strainer", "frying pan"],
      },
    }, {
      ingredients: new Set(["chicken-breast", "garlic"]),
      equipment: new Set(["frying-pan", "sieve"]),
    });

    expect(
      result.entry.predicted.ingredientGroups[0]?.items.map((i) => i.ingredient),
    ).toEqual(["chicken-breast", "garlic"]);
    expect(result.entry.predicted.cookware).toEqual(["frying pan", "sieve"]);
    expect(result.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          originalSlug: "chicken-fillets",
          canonicalSlug: "chicken-breast",
          method: "exact",
        }),
        expect.objectContaining({
          originalSlug: "garlic-clove",
          canonicalSlug: "garlic",
          method: "exact",
        }),
      ]),
    );
    expect(result.cookwareDecisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          originalName: "large skillet",
          canonicalSlug: "frying-pan",
          method: "exact",
        }),
        expect.objectContaining({
          originalName: "strainer",
          canonicalSlug: "sieve",
          method: "exact",
        }),
      ]),
    );
  });

  it("should preserve allowlisted compound cuisine labels", () => {
    const result = canonicalizePredictionEntry({
      images: ["a.jpg"],
      predicted: {
        title: "x",
        description: "y",
        cuisine: ["Tex-Mex"],
        servings: 2,
        ingredientGroups: [{ items: [{ ingredient: "garlic", amount: 1 }] }],
        instructions: ["step"],
        cookware: [],
      },
    }, { ingredients: new Set(["garlic"]), equipment: new Set() });

    expect(result.entry.predicted.cuisine).toEqual(["Tex-Mex"]);
  });

  it("should split non-allowlisted hyphenated cuisine labels", () => {
    const result = canonicalizePredictionEntry({
      images: ["a.jpg"],
      predicted: {
        title: "x",
        description: "y",
        cuisine: ["Italian-American"],
        servings: 2,
        ingredientGroups: [{ items: [{ ingredient: "garlic", amount: 1 }] }],
        instructions: ["step"],
        cookware: [],
      },
    }, { ingredients: new Set(["garlic"]), equipment: new Set() });

    expect(result.entry.predicted.cuisine).toEqual(["Italian", "American"]);
  });
});
