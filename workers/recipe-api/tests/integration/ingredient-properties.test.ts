import { createDb, schema } from "recipe-db";
import {
  publishIngredientPropertyCatalog,
  readIngredientPropertySelection,
  readRecipeIngredientPropertySelections,
  stageIngredientPropertyRelease,
  validateIngredientPropertyRelease,
} from "recipe-db/ingredient-properties";
import {
  convertIngredientVolumeToMass,
  type IngredientPropertyObservation,
  reconcileIngredientProperty,
} from "recipe-domain/ingredient-property";
import { calculateRecipeNutrition } from "recipe-domain/nutrition";
import { afterAll, afterEach, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests");

const { db, client } = createDb(databaseUrl);

const RELEASE_1_ID = "10000000-0000-4000-8000-000000000001";
const RELEASE_2_ID = "10000000-0000-4000-8000-000000000002";
const OBSERVATION_1_ID = "20000000-0000-4000-8000-000000000001";
const OBSERVATION_2_ID = "20000000-0000-4000-8000-000000000002";
const OBSERVATION_3_ID = "20000000-0000-4000-8000-000000000003";

const SOURCE_ADMISSION = {
  sourceId: "integration-density-source",
  publisher: "Integration Food Laboratory",
  dataset: "Ingredient property fixtures",
  canonicalUrl: "https://example.test/ingredient-properties",
  license: "CC BY 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "Integration Food Laboratory",
  effectiveVersion: "2026-10",
  redistributionAllowed: true,
  derivativeUseAllowed: true,
  admittedAt: new Date("2026-10-01T00:00:00.000Z"),
  admissionNotes: "Synthetic integration fixture approved for repository tests.",
};

function observation(input: {
  id: string;
  sourceRecordId: string;
  density: string;
  effectiveVersion?: string;
}): IngredientPropertyObservation {
  return {
    id: input.id,
    sourceRecordId: input.sourceRecordId,
    originalRecord: {
      foodDescription: "Cashew nuts, raw",
      gramsPerCup: input.density,
    },
    ingredientSlug: "cashews",
    preparationState: "raw",
    value: {
      kind: "density",
      unit: "g_per_ml",
      gramsPerMilliliter: input.density,
    },
    confidence: 0.9,
    source: {
      sourceId: SOURCE_ADMISSION.sourceId,
      publisher: SOURCE_ADMISSION.publisher,
      dataset: SOURCE_ADMISSION.dataset,
      canonicalUrl: SOURCE_ADMISSION.canonicalUrl,
      license: SOURCE_ADMISSION.license,
      licenseUrl: SOURCE_ADMISSION.licenseUrl,
      attribution: SOURCE_ADMISSION.attribution,
      effectiveVersion:
        input.effectiveVersion ?? SOURCE_ADMISSION.effectiveVersion,
    },
  };
}

function selection(input: {
  catalogVersion: string;
  observations: IngredientPropertyObservation[];
  selectedObservationId: string;
}) {
  return reconcileIngredientProperty({
    ...input,
    confidence: 0.88,
    decision: {
      strategy: "manual",
      rationale: "Integration reviewer selected the admitted laboratory result.",
      consideredObservationIds: input.observations.map(({ id }) => id),
      decidedBy: "integration-reviewer",
      decidedAt: "2026-10-25T12:00:00.000Z",
    },
  });
}

afterEach(async () => {
  await client.unsafe(`
    truncate table ingredient_property_catalog_version, ingredient_property_source restart identity cascade
  `);
});

afterAll(async () => {
  await client.end({ timeout: 5 });
});

describe("ingredient property catalog persistence", () => {
  it("stages, reconciles, publishes, and reproduces historical conversions", async () => {
    const firstObservations = [
      observation({
        id: OBSERVATION_1_ID,
        sourceRecordId: "cashews-density-a",
        density: "0.53",
      }),
      observation({
        id: OBSERVATION_2_ID,
        sourceRecordId: "cashews-density-b",
        density: "0.55",
      }),
    ];
    const firstRelease = {
      id: RELEASE_1_ID,
      effectiveAt: new Date("2026-10-01T00:00:00.000Z"),
      retrievedAt: new Date("2026-10-02T00:00:00.000Z"),
      checksumSha256: "a".repeat(64),
      connectorVersion: "1.0.0",
    };

    await expect(
      stageIngredientPropertyRelease(db, {
        source: SOURCE_ADMISSION,
        release: firstRelease,
        observations: firstObservations,
      }),
    ).resolves.toEqual({ releaseId: RELEASE_1_ID, observationCount: 2 });
    await expect(
      stageIngredientPropertyRelease(db, {
        source: SOURCE_ADMISSION,
        release: firstRelease,
        observations: firstObservations,
      }),
    ).resolves.toEqual({ releaseId: RELEASE_1_ID, observationCount: 2 });
    await validateIngredientPropertyRelease(db, RELEASE_1_ID, {
      observationCount: 2,
    });

    const firstSelection = selection({
      catalogVersion: "2026.10.0",
      observations: firstObservations,
      selectedObservationId: OBSERVATION_1_ID,
    });
    await publishIngredientPropertyCatalog(db, {
      version: "2026.10.0",
      effectiveAt: new Date("2026-10-05T00:00:00.000Z"),
      publishedAt: new Date("2026-10-05T12:00:00.000Z"),
      selections: [firstSelection],
    });

    const historical = await readIngredientPropertySelection(db, {
      ingredientSlug: "cashews",
      preparationState: "raw",
      propertyKey: "density",
      catalogVersion: "2026.10.0",
    });
    expect(historical).toEqual(firstSelection);
    if (!historical) throw new Error("Historical catalog selection is missing");
    const historicalConversion = convertIngredientVolumeToMass({
      amount: "1",
      unit: "us_cup",
      targetUnit: "g",
      density: historical,
      decimalPlaces: 3,
    });

    const secondObservation = observation({
      id: OBSERVATION_3_ID,
      sourceRecordId: "cashews-density-c",
      density: "0.57",
      effectiveVersion: "2026-11",
    });
    await stageIngredientPropertyRelease(db, {
      source: { ...SOURCE_ADMISSION, effectiveVersion: "2026-11" },
      release: {
        id: RELEASE_2_ID,
        effectiveAt: new Date("2026-11-01T00:00:00.000Z"),
        retrievedAt: new Date("2026-11-02T00:00:00.000Z"),
        checksumSha256: "b".repeat(64),
        connectorVersion: "1.0.0",
      },
      observations: [secondObservation],
    });
    await validateIngredientPropertyRelease(db, RELEASE_2_ID);
    const secondSelection = selection({
      catalogVersion: "2026.11.0",
      observations: [secondObservation],
      selectedObservationId: OBSERVATION_3_ID,
    });
    await publishIngredientPropertyCatalog(db, {
      version: "2026.11.0",
      effectiveAt: new Date("2026-11-05T00:00:00.000Z"),
      publishedAt: new Date("2026-11-05T12:00:00.000Z"),
      selections: [secondSelection],
    });

    const current = await readIngredientPropertySelection(db, {
      ingredientSlug: "cashews",
      preparationState: "raw",
      propertyKey: "density",
    });
    expect(current).toEqual(secondSelection);
    if (!current) throw new Error("Current catalog selection is missing");
    expect(
      convertIngredientVolumeToMass({
        amount: "1",
        unit: "us_cup",
        targetUnit: "g",
        density: current,
        decimalPlaces: 3,
      }).amount,
    ).toBe("134.855");

    const historicalAfterUpdate = await readIngredientPropertySelection(db, {
      ingredientSlug: "cashews",
      preparationState: "raw",
      propertyKey: "density",
      catalogVersion: "2026.10.0",
    });
    if (!historicalAfterUpdate) {
      throw new Error("Historical catalog selection changed after publication");
    }
    expect(
      convertIngredientVolumeToMass({
        amount: "1",
        unit: "us_cup",
        targetUnit: "g",
        density: historicalAfterUpdate,
        decimalPlaces: 3,
      }),
    ).toEqual(historicalConversion);

    const [storedSource] = await db
      .select()
      .from(schema.ingredientPropertySource);
    expect(storedSource).toMatchObject({
      license: "CC BY 4.0",
      attribution: "Integration Food Laboratory",
      redistributionAllowed: true,
      derivativeUseAllowed: true,
    });
  });

  it("reads an exact catalog snapshot for a reproducible recipe calculation", async () => {
    const density = {
      ...observation({
        id: OBSERVATION_1_ID,
        sourceRecordId: "cashews-density-reference",
        density: "0.53",
      }),
      value: {
        kind: "density" as const,
        unit: "g_per_ml" as const,
        gramsPerMilliliter: "0.53",
        uncertainty: {
          lowerBound: "0.52",
          upperBound: "0.54",
          basis: "Integration fixture interval",
        },
      },
    };
    const protein: IngredientPropertyObservation = {
      ...density,
      id: OBSERVATION_2_ID,
      sourceRecordId: "cashews-protein-reference",
      originalRecord: { foodDescription: "Cashew nuts, raw", protein: "18.22" },
      value: {
        kind: "nutrient",
        nutrient: "protein",
        category: "macronutrient",
        amount: "18.22",
        unit: "g",
        perEdibleGrams: "100",
        uncertainty: {
          lowerBound: "18",
          upperBound: "18.4",
          basis: "Integration fixture interval",
        },
      },
    };
    await stageIngredientPropertyRelease(db, {
      source: SOURCE_ADMISSION,
      release: {
        id: RELEASE_1_ID,
        effectiveAt: new Date("2026-10-01T00:00:00.000Z"),
        retrievedAt: new Date("2026-10-02T00:00:00.000Z"),
        checksumSha256: "d".repeat(64),
        connectorVersion: "1.0.0",
      },
      observations: [density, protein],
    });
    await validateIngredientPropertyRelease(db, RELEASE_1_ID);
    await publishIngredientPropertyCatalog(db, {
      version: "2026.10.0",
      effectiveAt: new Date("2026-10-05T00:00:00.000Z"),
      publishedAt: new Date("2026-10-05T12:00:00.000Z"),
      selections: [
        selection({
          catalogVersion: "2026.10.0",
          observations: [density],
          selectedObservationId: density.id,
        }),
        selection({
          catalogVersion: "2026.10.0",
          observations: [protein],
          selectedObservationId: protein.id,
        }),
      ],
    });

    const selections = await readRecipeIngredientPropertySelections(db, {
      catalogVersion: "2026.10.0",
      ingredients: [
        { ingredientSlug: "cashews", preparationState: "raw" },
      ],
    });
    expect(selections).toHaveLength(2);

    const calculation = calculateRecipeNutrition({
      recipeVersion: "cashew-cream-v1",
      catalogVersion: "2026.10.0",
      servings: 2,
      ingredientGroups: [
        {
          items: [
            {
              ingredient: "cashews",
              amount: 100,
              unit: "ml",
              quantityBasis: "edible",
              preparation: "raw",
            },
          ],
        },
      ],
      selections,
      decimalPlaces: 4,
    });
    expect(calculation).toMatchObject({
      recipeVersion: "cashew-cream-v1",
      catalogVersion: "2026.10.0",
      totals: [
        {
          nutrient: "protein",
          amount: "9.6566",
          unit: "g",
          uncertainty: { lowerBound: "9.36", upperBound: "9.936" },
          complete: true,
        },
      ],
      perServing: [{ nutrient: "protein", amount: "4.8283", unit: "g" }],
    });
    expect(calculation.ingredients[0]?.nutrients[0]?.conversionPath).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: "density" }),
        expect.objectContaining({ operation: "nutrient" }),
      ]),
    );
    await expect(
      readRecipeIngredientPropertySelections(db, {
        catalogVersion: "missing-version",
        ingredients: [
          { ingredientSlug: "cashews", preparationState: "raw" },
        ],
      }),
    ).rejects.toThrow("missing-version is not published");
    await expect(
      readRecipeIngredientPropertySelections(db, {
        catalogVersion: "2026.10.0",
        ingredients: [],
      }),
    ).resolves.toEqual([]);
  });

  it("rejects a changed payload for an existing source version", async () => {
    const firstObservation = observation({
      id: OBSERVATION_1_ID,
      sourceRecordId: "cashews-density-a",
      density: "0.53",
    });
    const release = {
      id: RELEASE_1_ID,
      effectiveAt: new Date("2026-10-01T00:00:00.000Z"),
      retrievedAt: new Date("2026-10-02T00:00:00.000Z"),
      checksumSha256: "a".repeat(64),
      connectorVersion: "1.0.0",
    };
    await stageIngredientPropertyRelease(db, {
      source: SOURCE_ADMISSION,
      release,
      observations: [firstObservation],
    });

    await expect(
      stageIngredientPropertyRelease(db, {
        source: SOURCE_ADMISSION,
        release,
        observations: [
          {
            ...firstObservation,
            value: {
              kind: "density",
              unit: "g_per_ml",
              gramsPerMilliliter: "0.54",
            },
          },
        ],
      }),
    ).rejects.toThrow(`observation ${OBSERVATION_1_ID} changed after ingestion`);

    await expect(
      stageIngredientPropertyRelease(db, {
        source: SOURCE_ADMISSION,
        release: { ...release, checksumSha256: "b".repeat(64) },
        observations: [firstObservation],
      }),
    ).rejects.toThrow("changed after ingestion");
  });

  it("normalizes admitted sources without optional license URLs", async () => {
    const source = {
      ...SOURCE_ADMISSION,
      sourceId: "integration-source-without-license-url",
      publisher: `  ${SOURCE_ADMISSION.publisher}  `,
      licenseUrl: undefined,
    };
    const sourceObservation = {
      ...observation({
        id: OBSERVATION_1_ID,
        sourceRecordId: "cashews-density-without-license-url",
        density: "0.53",
      }),
      source: {
        sourceId: source.sourceId,
        publisher: SOURCE_ADMISSION.publisher,
        dataset: source.dataset,
        canonicalUrl: source.canonicalUrl,
        license: source.license,
        attribution: source.attribution,
        effectiveVersion: source.effectiveVersion,
      },
    };

    await expect(
      stageIngredientPropertyRelease(db, {
        source,
        release: {
          id: RELEASE_1_ID,
          effectiveAt: new Date("2026-10-01T00:00:00.000Z"),
          retrievedAt: new Date("2026-10-02T00:00:00.000Z"),
          checksumSha256: "c".repeat(64),
          connectorVersion: "1.0.0",
        },
        observations: [sourceObservation],
      }),
    ).resolves.toEqual({ releaseId: RELEASE_1_ID, observationCount: 1 });
  });

  it("requires the selected observation to belong to a validated release", async () => {
    const validatedObservation = observation({
      id: OBSERVATION_1_ID,
      sourceRecordId: "cashews-density-validated",
      density: "0.53",
    });
    const stagedObservation = observation({
      id: OBSERVATION_2_ID,
      sourceRecordId: "cashews-density-staged",
      density: "0.55",
      effectiveVersion: "2026-11",
    });
    await stageIngredientPropertyRelease(db, {
      source: SOURCE_ADMISSION,
      release: {
        id: RELEASE_1_ID,
        effectiveAt: new Date("2026-10-01T00:00:00.000Z"),
        retrievedAt: new Date("2026-10-02T00:00:00.000Z"),
        checksumSha256: "a".repeat(64),
        connectorVersion: "1.0.0",
      },
      observations: [validatedObservation],
    });
    await validateIngredientPropertyRelease(db, RELEASE_1_ID);
    await stageIngredientPropertyRelease(db, {
      source: { ...SOURCE_ADMISSION, effectiveVersion: "2026-11" },
      release: {
        id: RELEASE_2_ID,
        effectiveAt: new Date("2026-11-01T00:00:00.000Z"),
        retrievedAt: new Date("2026-11-02T00:00:00.000Z"),
        checksumSha256: "b".repeat(64),
        connectorVersion: "1.0.0",
      },
      observations: [stagedObservation],
    });
    const stagedSelection = selection({
      catalogVersion: "2026.11.0",
      observations: [stagedObservation],
      selectedObservationId: stagedObservation.id,
    });

    await expect(
      publishIngredientPropertyCatalog(db, {
        version: "2026.11.0",
        effectiveAt: new Date("2026-11-05T00:00:00.000Z"),
        publishedAt: new Date("2026-11-05T12:00:00.000Z"),
        selections: [stagedSelection],
      }),
    ).rejects.toThrow("requires validated source releases");
    await expect(
      publishIngredientPropertyCatalog(db, {
        version: "2026.11.0",
        effectiveAt: new Date("2026-11-05T00:00:00.000Z"),
        publishedAt: new Date("2026-11-05T12:00:00.000Z"),
        selections: [
          {
            ...stagedSelection,
            decision: {
              ...stagedSelection.decision,
              consideredObservationIds: [validatedObservation.id],
            },
          },
        ],
      }),
    ).rejects.toThrow("must include the selection");
  });
});
