import { describe, expect, it } from "vitest";
import {
  calculateEdibleMass,
  convertIngredientMassToVolume,
  convertIngredientVolumeToMass,
  type IngredientPropertyObservation,
  reconcileIngredientProperty,
} from "../src/ingredient-property";

const SOURCE = {
  sourceId: "example-density",
  publisher: "Example Publisher",
  dataset: "Ingredient measurements",
  canonicalUrl: "https://example.com/measurements",
  license: "CC BY 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "Example Publisher, Ingredient measurements",
  effectiveVersion: "2026-10",
} as const;

const DENSITY_A: IngredientPropertyObservation = {
  id: "00000000-0000-4000-8000-000000000001",
  sourceRecordId: "cashew-raw-1",
  originalRecord: { description: "Nuts, cashew nuts, raw", gramWeight: 53 },
  ingredientSlug: "cashews",
  preparationState: "raw",
  value: {
    kind: "density",
    unit: "g_per_ml",
    gramsPerMilliliter: "0.53",
  },
  confidence: 0.92,
  source: SOURCE,
};

const DENSITY_B: IngredientPropertyObservation = {
  ...DENSITY_A,
  id: "00000000-0000-4000-8000-000000000002",
  sourceRecordId: "cashew-raw-2",
  value: {
    kind: "density",
    unit: "g_per_ml",
    gramsPerMilliliter: "0.55",
  },
  confidence: 0.86,
};

const DECISION = {
  strategy: "source_priority" as const,
  rationale: "Selected the admitted primary source with the newer release.",
  consideredObservationIds: [DENSITY_A.id, DENSITY_B.id],
  decidedBy: "catalog-reviewer",
  decidedAt: "2026-10-25T12:00:00.000Z",
};

function densitySelection() {
  return reconcileIngredientProperty({
    catalogVersion: "2026.10.0",
    observations: [DENSITY_A, DENSITY_B],
    selectedObservationId: DENSITY_A.id,
    confidence: 0.9,
    decision: DECISION,
  });
}

describe("ingredient property reconciliation", () => {
  it("retains the selected source release and the complete decision", () => {
    const selection = densitySelection();

    expect(selection).toMatchObject({
      catalogVersion: "2026.10.0",
      confidence: 0.9,
      observation: {
        id: DENSITY_A.id,
        source: {
          license: "CC BY 4.0",
          effectiveVersion: "2026-10",
        },
      },
      decision: DECISION,
    });
  });

  it("rejects decisions that omit a competing observation", () => {
    expect(() =>
      reconcileIngredientProperty({
        catalogVersion: "2026.10.0",
        observations: [DENSITY_A, DENSITY_B],
        selectedObservationId: DENSITY_A.id,
        confidence: 0.9,
        decision: {
          ...DECISION,
          consideredObservationIds: [DENSITY_A.id],
        },
      }),
    ).toThrow("must consider every candidate");
  });

  it("rejects candidates for different preparations", () => {
    expect(() =>
      reconcileIngredientProperty({
        catalogVersion: "2026.10.0",
        observations: [
          DENSITY_A,
          { ...DENSITY_B, preparationState: "roasted" },
        ],
        selectedObservationId: DENSITY_A.id,
        confidence: 0.9,
        decision: DECISION,
      }),
    ).toThrow("one ingredient, preparation, and property");
  });

  it("records nutrient units and their edible-mass basis", () => {
    const observation: IngredientPropertyObservation = {
      ...DENSITY_A,
      id: "00000000-0000-4000-8000-000000000004",
      sourceRecordId: "cashew-protein",
      value: {
        kind: "nutrient",
        nutrient: "protein",
        amount: "18.22",
        unit: "g",
        perEdibleGrams: "100",
      },
    };

    expect(
      reconcileIngredientProperty({
        catalogVersion: "2026.10.0",
        observations: [observation],
        selectedObservationId: observation.id,
        confidence: 0.91,
        decision: {
          ...DECISION,
          consideredObservationIds: [observation.id],
        },
      }).observation.value,
    ).toEqual({
      kind: "nutrient",
      nutrient: "protein",
      amount: "18.22",
      unit: "g",
      perEdibleGrams: "100",
    });
  });
});

describe("ingredient property conversion", () => {
  it("converts volume to mass with exact decimal arithmetic", () => {
    expect(
      convertIngredientVolumeToMass({
        amount: "1",
        unit: "us_cup",
        targetUnit: "g",
        density: densitySelection(),
        decimalPlaces: 3,
      }),
    ).toEqual({
      amount: "125.392",
      unit: "g",
      catalogVersion: "2026.10.0",
      observationId: DENSITY_A.id,
    });
  });

  it("reverses mass to volume against the same catalog selection", () => {
    expect(
      convertIngredientMassToVolume({
        amount: "125.392",
        unit: "g",
        targetUnit: "us_cup",
        density: densitySelection(),
        decimalPlaces: 3,
      }),
    ).toEqual({
      amount: "1",
      unit: "us_cup",
      catalogVersion: "2026.10.0",
      observationId: DENSITY_A.id,
    });
  });

  it("applies an edible mass fraction without losing catalog provenance", () => {
    const observation: IngredientPropertyObservation = {
      ...DENSITY_A,
      id: "00000000-0000-4000-8000-000000000003",
      sourceRecordId: "mango-edible-mass-fraction",
      ingredientSlug: "mango",
      preparationState: "raw",
      value: {
        kind: "edible_mass_fraction",
        unit: "fraction",
        edibleMassFraction: "0.71",
      },
    };
    const selection = reconcileIngredientProperty({
      catalogVersion: "2026.10.0",
      observations: [observation],
      selectedObservationId: observation.id,
      confidence: 0.88,
      decision: {
        ...DECISION,
        strategy: "manual",
        consideredObservationIds: [observation.id],
      },
    });

    expect(
      calculateEdibleMass({
        grossAmount: "2",
        grossUnit: "lb",
        targetUnit: "g",
        edibleMassFraction: selection,
        decimalPlaces: 3,
      }),
    ).toEqual({
      amount: "644.101",
      unit: "g",
      catalogVersion: "2026.10.0",
      observationId: observation.id,
    });
  });
});
