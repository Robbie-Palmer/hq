import { describe, expect, it } from "vitest";
import { normalizeSlug } from "recipe-domain/slugs";
import { singularizeIngredientTerm } from "recipe-domain/pluralization";
import {
  canonicalizeCookwareList,
  canonicalizeEquipmentName,
  equipmentDisplayName,
  splitEquipmentAlternatives,
} from "../../src/lib/equipment-canonicalization.js";
import { canonicalEquipment } from "../../src/lib/canonical-equipment-data.js";
import { buildOntology, buildOntologyIndex } from "../../src/lib/slug-matching.js";

const ontology = buildOntology(canonicalEquipment.equipment, "equipment");
const ontologyIndex = buildOntologyIndex(ontology);

function canonicalize(rawName: string) {
  return canonicalizeEquipmentName({ rawName, ontology, ontologyIndex });
}

describe("canonical equipment registry", () => {
  it("should hold unique slugs", () => {
    expect(ontology.size).toBe(canonicalEquipment.equipment.length);
  });

  // "scissors", "tongs", and "scales" have no singular form in normal use.
  it("should name equipment in the singular unless the noun has no singular", () => {
    const pluralOnly = new Set(["scissors", "tongs", "scales"]);
    const plural = canonicalEquipment.equipment
      .map(({ slug }) => slug)
      .filter((slug) => !pluralOnly.has(slug))
      .filter(
        (slug) =>
          normalizeSlug(singularizeIngredientTerm(equipmentDisplayName(slug))) !==
          slug,
      );
    expect(plural).toEqual([]);
  });
});

describe("canonicalizeEquipmentName", () => {
  it.each([
    { rawName: "frying pan", expected: "frying-pan" },
    { rawName: "large skillet", expected: "frying-pan" },
    { rawName: "heavy-bottomed saucepan", expected: "saucepan" },
    { rawName: "cast iron skillet", expected: "frying-pan" },
    { rawName: "large wooden spoon", expected: "wooden-spoon" },
    { rawName: "large plastic wrap", expected: "cling-film" },
    { rawName: "stainless steel mixing bowl", expected: "mixing-bowl" },
    { rawName: "baking sheet", expected: "baking-tray" },
    { rawName: "baking trays", expected: "baking-tray" },
    { rawName: "casserole dish", expected: "oven-dish" },
    { rawName: "colander", expected: "sieve" },
    { rawName: "fine mesh strainer", expected: "sieve" },
    { rawName: "large mixing bowl", expected: "mixing-bowl" },
    { rawName: "measuring spoon", expected: "measuring-spoon" },
    { rawName: "measuring spoons", expected: "measuring-spoon" },
    { rawName: "scissors", expected: "scissors" },
    { rawName: "tongs", expected: "tongs" },
    { rawName: "wire rack", expected: "cooling-rack" },
    { rawName: "hand blender", expected: "stick-blender" },
    { rawName: "chef's knife", expected: "knife" },
    { rawName: "kitchen shears", expected: "scissors" },
    { rawName: "tin foil", expected: "foil" },
  ])(
    "should canonicalize $rawName to $expected",
    ({ rawName, expected }) => {
      expect(canonicalize(rawName).canonicalSlug).toBe(expected);
    },
  );

  // A recipe that says "pan" chose that level of detail; the registry carries
  // the generic terms so canonicalization keeps them instead of inventing a
  // specific one.
  it.each(["pan", "pot", "spoon", "lid"])(
    "should keep the generic %s rather than narrowing it",
    (rawName) => {
      expect(canonicalize(rawName)).toMatchObject({
        canonicalSlug: rawName,
        method: "exact",
      });
    },
  );

  it("should leave a genuinely ambiguous name for the LLM rather than guessing", () => {
    const decision = canonicalize("mixer");
    expect(decision.method).toBe("none");
    expect(decision.candidates.map((c) => c.slug)).toEqual(
      expect.arrayContaining(["hand-mixer", "stand-mixer"]),
    );
  });

  it("should record an exact match against the registry", () => {
    const decision = canonicalize("sheet pan");
    expect(decision).toMatchObject({
      originalName: "sheet pan",
      baseSlug: "sheet-pan",
      canonicalSlug: "baking-tray",
      method: "exact",
      score: 1,
    });
  });

  it("should record the score it was judged against when rejecting a near miss", () => {
    const decision = canonicalizeEquipmentName({
      rawName: "pizza stone",
      ontology: new Set(["baking-tray", "pizza-oven"]),
    });
    expect(decision.method).toBe("none");
    expect(decision.canonicalSlug).toBe("pizza-stone");
    expect(decision.threshold).toBeGreaterThan(0);
    expect(decision.score).toBeLessThan(decision.threshold!);
    expect(decision.candidates.map((c) => c.slug)).toContain("pizza-oven");
  });

  it("should leave unknown equipment unresolved with candidates for the LLM", () => {
    const decision = canonicalize("spider strainer ladle");
    expect(decision.method).toBe("none");
    expect(decision.canonicalSlug).toBe("spider-strainer-ladle");
    expect(decision.reason).toBe("below-threshold");
    expect(decision.candidates.length).toBeGreaterThan(0);
  });

  it("should report no candidates against an empty ontology", () => {
    const decision = canonicalizeEquipmentName({
      rawName: "tagine",
      ontology: new Set(),
    });
    expect(decision).toMatchObject({
      canonicalSlug: "tagine",
      method: "none",
      reason: "no-candidates",
      candidates: [],
    });
  });
});

describe("canonicalizeCookwareList", () => {
  it("should canonicalize, deduplicate, and drop blank entries", () => {
    const result = canonicalizeCookwareList(
      ["large skillet", "  ", "frying pan", "strainer"],
      ontology,
      ontologyIndex,
    );
    expect(result.cookware).toEqual(["frying pan", "sieve"]);
    expect(result.decisions).toHaveLength(3);
  });

  it("should keep unmatched equipment in the list", () => {
    const result = canonicalizeCookwareList(["tagine"], ontology, ontologyIndex);
    expect(result.cookware).toEqual(["tagine"]);
  });

  it("should split explicit alternatives before canonicalizing them", () => {
    const result = canonicalizeCookwareList(
      ["wooden spoon or spatula", "blender/food processor"],
      ontology,
      ontologyIndex,
    );
    expect(result.cookware).toEqual([
      "wooden spoon",
      "spatula",
      "blender",
      "food processor",
    ]);
    expect(splitEquipmentAlternatives("whisk and/or fork")).toEqual([
      "whisk",
      "fork",
    ]);
  });

  it("should preserve established compound names", () => {
    expect(splitEquipmentAlternatives("pestle and mortar")).toEqual([
      "pestle and mortar",
    ]);
    expect(splitEquipmentAlternatives("measuring cups and spoons")).toEqual([
      "measuring cups",
      "measuring spoons",
    ]);
  });
});
