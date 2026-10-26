import { and, desc, eq, inArray } from "drizzle-orm";
import {
  IngredientPropertyObservationSchema,
  IngredientPropertySelectionSchema,
  IngredientPropertySourceReferenceSchema,
  ingredientPropertyKey,
  type IngredientPropertyObservation,
  type IngredientPropertyReconciliationDecision,
  type IngredientPropertySelection,
  type IngredientPropertySourceReference,
} from "recipe-domain/ingredient-property";
import { canonicalJson } from "ts-base/json";
import type { Db } from "./index";
import * as schema from "./schema";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type IngredientPropertySourceAdmission =
  IngredientPropertySourceReference & {
    redistributionAllowed: boolean;
    derivativeUseAllowed: boolean;
    admittedAt: Date;
    admissionNotes: string;
  };

export type IngredientPropertyReleaseInput = {
  id: string;
  effectiveAt: Date;
  retrievedAt: Date;
  checksumSha256: string;
  connectorVersion: string;
};

function sourceReferenceFromRow(
  source: typeof schema.ingredientPropertySource.$inferSelect,
  release: typeof schema.ingredientPropertySourceRelease.$inferSelect,
): IngredientPropertySourceReference {
  return IngredientPropertySourceReferenceSchema.parse({
    sourceId: source.id,
    publisher: source.publisher,
    dataset: source.dataset,
    canonicalUrl: source.canonicalUrl,
    license: source.license,
    ...(source.licenseUrl ? { licenseUrl: source.licenseUrl } : {}),
    attribution: source.attribution,
    effectiveVersion: release.effectiveVersion,
  });
}

function assertSourceMatches(
  actual: typeof schema.ingredientPropertySource.$inferSelect,
  expected: IngredientPropertySourceAdmission,
  reference: IngredientPropertySourceReference,
): void {
  const expectedFields = {
    publisher: reference.publisher,
    dataset: reference.dataset,
    canonicalUrl: reference.canonicalUrl,
    license: reference.license,
    licenseUrl: reference.licenseUrl ?? null,
    attribution: reference.attribution,
    redistributionAllowed: expected.redistributionAllowed,
    derivativeUseAllowed: expected.derivativeUseAllowed,
    admissionNotes: expected.admissionNotes,
  } as const;
  const mismatch = (
    Object.keys(expectedFields) as (keyof typeof expectedFields)[]
  ).find((field) => actual[field] !== expectedFields[field]);
  if (
    mismatch ||
    actual.admittedAt.getTime() !== expected.admittedAt.getTime()
  ) {
    throw new Error(
      `Ingredient property source ${expected.sourceId} changed ${mismatch ?? "admittedAt"}`,
    );
  }
}

function assertObservationMatches(
  actual: typeof schema.ingredientPropertyObservation.$inferSelect | undefined,
  expected: IngredientPropertyObservation,
  sourceReleaseId: string,
): void {
  if (
    actual?.sourceReleaseId !== sourceReleaseId ||
    actual.sourceRecordId !== expected.sourceRecordId ||
    actual.ingredientSlug !== expected.ingredientSlug ||
    actual.preparationState !== expected.preparationState ||
    actual.propertyKind !== expected.value.kind ||
    actual.propertyKey !== ingredientPropertyKey(expected.value) ||
    canonicalJson(actual.value) !== canonicalJson(expected.value) ||
    Number(actual.confidence) !== expected.confidence ||
    canonicalJson(actual.originalRecord) !== canonicalJson(expected.originalRecord)
  ) {
    throw new Error(
      `Ingredient property observation ${expected.id} changed after ingestion`,
    );
  }
}

function assertReleaseMatches(
  actual: typeof schema.ingredientPropertySourceRelease.$inferSelect,
  expected: IngredientPropertyReleaseInput,
): void {
  if (
    actual.checksumSha256 !== expected.checksumSha256 ||
    actual.connectorVersion !== expected.connectorVersion ||
    actual.effectiveAt.getTime() !== expected.effectiveAt.getTime()
  ) {
    throw new Error(
      `Ingredient property release ${actual.effectiveVersion} changed after ingestion`,
    );
  }
}

export async function stageIngredientPropertyRelease(
  db: Db,
  input: {
    source: IngredientPropertySourceAdmission;
    release: IngredientPropertyReleaseInput;
    observations: IngredientPropertyObservation[];
  },
): Promise<{ releaseId: string; observationCount: number }> {
  const parsedSourceReference = IngredientPropertySourceReferenceSchema.parse(
    input.source,
  );
  const { licenseUrl, ...requiredSourceReference } = parsedSourceReference;
  const sourceReference: IngredientPropertySourceReference = licenseUrl
    ? { ...requiredSourceReference, licenseUrl }
    : requiredSourceReference;
  if (!/^[0-9a-f]{64}$/.test(input.release.checksumSha256)) {
    throw new Error("Ingredient property release checksum must be SHA-256 hex");
  }
  if (!input.source.admissionNotes.trim()) {
    throw new Error("Ingredient property source admission notes are required");
  }
  const observations = input.observations.map((observation) =>
    IngredientPropertyObservationSchema.parse(observation),
  );
  for (const observation of observations) {
    if (
      canonicalJson(observation.source) !== canonicalJson(sourceReference)
    ) {
      throw new Error("Every observation must reference the ingested source release");
    }
  }

  return db.transaction(async (tx) => {
    await tx
      .insert(schema.ingredientPropertySource)
      .values({
        id: sourceReference.sourceId,
        publisher: sourceReference.publisher,
        dataset: sourceReference.dataset,
        canonicalUrl: sourceReference.canonicalUrl,
        license: sourceReference.license,
        licenseUrl: sourceReference.licenseUrl ?? null,
        attribution: sourceReference.attribution,
        redistributionAllowed: input.source.redistributionAllowed,
        derivativeUseAllowed: input.source.derivativeUseAllowed,
        admittedAt: input.source.admittedAt,
        admissionNotes: input.source.admissionNotes,
      })
      .onConflictDoNothing();
    const [storedSource] = await tx
      .select()
      .from(schema.ingredientPropertySource)
      .where(eq(schema.ingredientPropertySource.id, sourceReference.sourceId))
      .limit(1);
    if (!storedSource) throw new Error("Ingredient property source was not stored");
    assertSourceMatches(storedSource, input.source, sourceReference);

    await tx
      .insert(schema.ingredientPropertySourceRelease)
      .values({
        id: input.release.id,
        sourceId: sourceReference.sourceId,
        effectiveVersion: sourceReference.effectiveVersion,
        effectiveAt: input.release.effectiveAt,
        retrievedAt: input.release.retrievedAt,
        checksumSha256: input.release.checksumSha256,
        connectorVersion: input.release.connectorVersion,
      })
      .onConflictDoNothing();
    const [storedRelease] = await tx
      .select()
      .from(schema.ingredientPropertySourceRelease)
      .where(
        and(
          eq(
            schema.ingredientPropertySourceRelease.sourceId,
            sourceReference.sourceId,
          ),
          eq(
            schema.ingredientPropertySourceRelease.effectiveVersion,
            sourceReference.effectiveVersion,
          ),
        ),
      )
      .limit(1);
    if (!storedRelease) throw new Error("Ingredient property release was not stored");
    assertReleaseMatches(storedRelease, input.release);

    if (observations.length > 0) {
      await tx
        .insert(schema.ingredientPropertyObservation)
        .values(
          observations.map((observation) => ({
            id: observation.id,
            sourceReleaseId: storedRelease.id,
            sourceRecordId: observation.sourceRecordId,
            ingredientSlug: observation.ingredientSlug,
            preparationState: observation.preparationState,
            propertyKind: observation.value.kind,
            propertyKey: ingredientPropertyKey(observation.value),
            value: observation.value,
            confidence: observation.confidence.toString(),
            originalRecord: observation.originalRecord,
          })),
        )
        .onConflictDoNothing();
      const storedObservations = await tx
        .select()
        .from(schema.ingredientPropertyObservation)
        .where(
          inArray(
            schema.ingredientPropertyObservation.id,
            observations.map(({ id }) => id),
          ),
        );
      const storedObservationsById = new Map(
        storedObservations.map((observation) => [observation.id, observation]),
      );
      for (const observation of observations) {
        assertObservationMatches(
          storedObservationsById.get(observation.id),
          observation,
          storedRelease.id,
        );
      }
    }
    return { releaseId: storedRelease.id, observationCount: observations.length };
  });
}

export async function validateIngredientPropertyRelease(
  db: Pick<Db, "update"> | Tx,
  releaseId: string,
  diagnostics: Record<string, unknown> = {},
): Promise<void> {
  const [updated] = await db
    .update(schema.ingredientPropertySourceRelease)
    .set({ status: "validated", diagnostics })
    .where(
      and(
        eq(schema.ingredientPropertySourceRelease.id, releaseId),
        eq(schema.ingredientPropertySourceRelease.status, "staged"),
      ),
    )
    .returning({ id: schema.ingredientPropertySourceRelease.id });
  if (!updated) throw new Error("Only a staged property release can be validated");
}

type ObservationJoin = {
  observation: typeof schema.ingredientPropertyObservation.$inferSelect;
  release: typeof schema.ingredientPropertySourceRelease.$inferSelect;
  source: typeof schema.ingredientPropertySource.$inferSelect;
};

async function readObservationJoins(
  db: Pick<Db, "select"> | Tx,
  observationIds: string[],
): Promise<ObservationJoin[]> {
  if (observationIds.length === 0) return [];
  return db
    .select({
      observation: schema.ingredientPropertyObservation,
      release: schema.ingredientPropertySourceRelease,
      source: schema.ingredientPropertySource,
    })
    .from(schema.ingredientPropertyObservation)
    .innerJoin(
      schema.ingredientPropertySourceRelease,
      eq(
        schema.ingredientPropertyObservation.sourceReleaseId,
        schema.ingredientPropertySourceRelease.id,
      ),
    )
    .innerJoin(
      schema.ingredientPropertySource,
      eq(
        schema.ingredientPropertySourceRelease.sourceId,
        schema.ingredientPropertySource.id,
      ),
    )
    .where(inArray(schema.ingredientPropertyObservation.id, observationIds));
}

function observationFromJoin(row: ObservationJoin): IngredientPropertyObservation {
  return IngredientPropertyObservationSchema.parse({
    id: row.observation.id,
    sourceRecordId: row.observation.sourceRecordId,
    originalRecord: row.observation.originalRecord,
    ingredientSlug: row.observation.ingredientSlug,
    preparationState: row.observation.preparationState,
    value: row.observation.value,
    confidence: Number(row.observation.confidence),
    source: sourceReferenceFromRow(row.source, row.release),
  });
}

function selectionObservationIds(
  selections: IngredientPropertySelection[],
): string[] {
  return [
    ...new Set(
      selections.flatMap((selection) =>
        selection.decision.consideredObservationIds.concat(
          selection.observation.id,
        ),
      ),
    ),
  ];
}

function validateStoredSelection(
  selection: IngredientPropertySelection,
  rowsById: ReadonlyMap<string, ObservationJoin>,
): void {
  const selectedRow = rowsById.get(selection.observation.id);
  if (!selectedRow) throw new Error("A selected property observation is missing");
  if (
    !selection.decision.consideredObservationIds.includes(
      selection.observation.id,
    )
  ) {
    throw new Error("The reconciliation decision must include the selection");
  }
  if (selectedRow.release.status !== "validated") {
    throw new Error("Catalog publication requires validated source releases");
  }
  const storedObservation = observationFromJoin(selectedRow);
  if (
    canonicalJson(storedObservation) !== canonicalJson(selection.observation)
  ) {
    throw new Error("The selected observation does not match its stored source record");
  }
  for (const observationId of selection.decision.consideredObservationIds) {
    const candidate = rowsById.get(observationId);
    if (!candidate) throw new Error("A reconciliation candidate is missing");
    if (candidate.release.status !== "validated") {
      throw new Error("Catalog publication requires validated source releases");
    }
    const observation = candidate.observation;
    if (
      observation.ingredientSlug !== storedObservation.ingredientSlug ||
      observation.preparationState !== storedObservation.preparationState ||
      observation.propertyKey !== ingredientPropertyKey(storedObservation.value)
    ) {
      throw new Error("Stored reconciliation candidates describe different properties");
    }
  }
}

export async function publishIngredientPropertyCatalog(
  db: Db,
  input: {
    version: string;
    effectiveAt: Date;
    publishedAt: Date;
    selections: IngredientPropertySelection[];
  },
): Promise<{ version: string; selectionCount: number }> {
  const selections = input.selections.map((selection) =>
    IngredientPropertySelectionSchema.parse(selection),
  );
  if (selections.length === 0) {
    throw new Error("A published ingredient property catalog cannot be empty");
  }
  if (selections.some(({ catalogVersion }) => catalogVersion !== input.version)) {
    throw new Error("Every property selection must use the published catalog version");
  }

  return db.transaction(async (tx) => {
    const observationIds = selectionObservationIds(selections);
    const rows = await readObservationJoins(tx, observationIds);
    const rowsById = new Map(rows.map((row) => [row.observation.id, row]));
    if (rowsById.size !== observationIds.length) {
      throw new Error("One or more ingredient property observations are missing");
    }
    for (const selection of selections) {
      validateStoredSelection(selection, rowsById);
    }

    await tx.insert(schema.ingredientPropertyCatalogVersion).values({
      version: input.version,
      status: "published",
      effectiveAt: input.effectiveAt,
      publishedAt: input.publishedAt,
    });
    const sourceReleaseIds = [
      ...new Set(rows.map(({ release }) => release.id)),
    ];
    await tx.insert(schema.ingredientPropertyCatalogSourceRelease).values(
      sourceReleaseIds.map((sourceReleaseId) => ({
        catalogVersion: input.version,
        sourceReleaseId,
      })),
    );
    await tx.insert(schema.ingredientPropertySelection).values(
      selections.map((selection) => ({
        catalogVersion: input.version,
        ingredientSlug: selection.observation.ingredientSlug,
        preparationState: selection.observation.preparationState,
        propertyKey: ingredientPropertyKey(selection.observation.value),
        observationId: selection.observation.id,
        confidence: selection.confidence.toString(),
        reconciliationDecision: selection.decision,
      })),
    );
    return { version: input.version, selectionCount: selections.length };
  });
}

export async function readIngredientPropertySelection(
  db: Pick<Db, "select"> | Tx,
  input: {
    ingredientSlug: string;
    preparationState: string;
    propertyKey: string;
    catalogVersion?: string;
  },
): Promise<IngredientPropertySelection | undefined> {
  let version = input.catalogVersion;
  if (!version) {
    const [current] = await db
      .select({ version: schema.ingredientPropertyCatalogVersion.version })
      .from(schema.ingredientPropertyCatalogVersion)
      .where(eq(schema.ingredientPropertyCatalogVersion.status, "published"))
      .orderBy(
        desc(schema.ingredientPropertyCatalogVersion.effectiveAt),
        desc(schema.ingredientPropertyCatalogVersion.version),
      )
      .limit(1);
    version = current?.version;
  }
  if (!version) return undefined;

  const [row] = await db
    .select({
      selection: schema.ingredientPropertySelection,
      observation: schema.ingredientPropertyObservation,
      release: schema.ingredientPropertySourceRelease,
      source: schema.ingredientPropertySource,
    })
    .from(schema.ingredientPropertySelection)
    .innerJoin(
      schema.ingredientPropertyObservation,
      eq(
        schema.ingredientPropertySelection.observationId,
        schema.ingredientPropertyObservation.id,
      ),
    )
    .innerJoin(
      schema.ingredientPropertySourceRelease,
      eq(
        schema.ingredientPropertyObservation.sourceReleaseId,
        schema.ingredientPropertySourceRelease.id,
      ),
    )
    .innerJoin(
      schema.ingredientPropertySource,
      eq(
        schema.ingredientPropertySourceRelease.sourceId,
        schema.ingredientPropertySource.id,
      ),
    )
    .where(
      and(
        eq(schema.ingredientPropertySelection.catalogVersion, version),
        eq(
          schema.ingredientPropertySelection.ingredientSlug,
          input.ingredientSlug,
        ),
        eq(
          schema.ingredientPropertySelection.preparationState,
          input.preparationState,
        ),
        eq(schema.ingredientPropertySelection.propertyKey, input.propertyKey),
      ),
    )
    .limit(1);
  if (!row) return undefined;

  return IngredientPropertySelectionSchema.parse({
    catalogVersion: row.selection.catalogVersion,
    observation: observationFromJoin(row),
    confidence: Number(row.selection.confidence),
    decision:
      row.selection
        .reconciliationDecision as IngredientPropertyReconciliationDecision,
  });
}
