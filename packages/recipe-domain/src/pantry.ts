import { z } from "zod";
import type { Unit } from "./unit";

export const PANTRY_LOCATIONS = [
  "fridge",
  "freezer",
  "cupboards",
  "fresh",
] as const;

export const PANTRY_SOURCE_KINDS = ["user", "inferred"] as const;
export const PANTRY_FRESHNESS_ESTIMATE_BASES = ["user", "catalog"] as const;
export const MAX_PANTRY_FRESHNESS_ESTIMATE_DAYS = 2_147_483_647;

export const PantryLocationSchema = z.enum(PANTRY_LOCATIONS);
export const PantrySourceKindSchema = z.enum(PANTRY_SOURCE_KINDS);
export const PantryFreshnessEstimateBasisSchema = z.enum(
  PANTRY_FRESHNESS_ESTIMATE_BASES,
);
export const PantryFreshnessEstimateSchema = z
  .object({
    expectedDays: z
      .number()
      .int()
      .min(1)
      .max(MAX_PANTRY_FRESHNESS_ESTIMATE_DAYS),
    startingOn: z.iso.date(),
    storage: PantryLocationSchema,
    basis: PantryFreshnessEstimateBasisSchema,
  })
  .strict();
export const PantryFreshnessSchema = z
  .object({
    useBy: z.iso.date().nullable(),
    bestBefore: z.iso.date().nullable(),
    stockedAt: z.iso.date().nullable(),
    openedAt: z.iso.date().nullable(),
    frozenAt: z.iso.date().nullable(),
    estimate: PantryFreshnessEstimateSchema.nullable(),
  })
  .strict();

export type PantryLocation = z.infer<typeof PantryLocationSchema>;
export type PantryFreshness = z.infer<typeof PantryFreshnessSchema>;
export type PantryFreshnessEstimate = z.infer<
  typeof PantryFreshnessEstimateSchema
>;
export type PantrySourceKind = z.infer<typeof PantrySourceKindSchema>;

export type PantryQuantity = {
  amount: number;
  unit: Unit;
};

export type PantryItemDetails = {
  location: PantryLocation;
  quantity: PantryQuantity | null;
  freshness: PantryFreshness;
  source: {
    kind: PantrySourceKind;
    provenance: string;
  };
};

export function emptyPantryFreshness(): PantryFreshness {
  return {
    useBy: null,
    bestBefore: null,
    stockedAt: null,
    openedAt: null,
    frozenAt: null,
    estimate: null,
  };
}

export const MAX_PANTRY_ITEMS = 500;
export const MAX_PANTRY_MUTATION_CHANGES = 100;

export type PantryMutationValue = {
  ingredientSlug: string;
  location: PantryLocation;
};

export type PantryMutationChange = {
  ingredientSlug: string;
  expectedVersion: string | null;
  location: PantryLocation | null;
};

export type PantryCurrentItem = PantryMutationValue & {
  stableItemId: string;
  version: bigint;
};

export type PantryAbsenceRevision = {
  stableItemId: string;
  version: bigint;
};

export type PantryChangeRecord = {
  stableItemId: string;
  ingredientSlug: string;
  beforeValue: PantryMutationValue | null;
  afterValue: PantryMutationValue | null;
  beforeVersion: bigint | null;
  afterVersion: bigint;
};

export type PantryUndoPreviewItem = Omit<
  PantryChangeRecord,
  "beforeVersion" | "afterVersion"
> & {
  currentValue: PantryMutationValue | null;
  status: "ready" | "conflict";
};

export class PantryMutationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PantryMutationConflictError";
  }
}

export class PantryItemLimitError extends Error {
  constructor() {
    super(`A pantry can contain at most ${MAX_PANTRY_ITEMS} ingredients`);
    this.name = "PantryItemLimitError";
  }
}

function expectedVersion(value: string | null): bigint | null {
  if (value === null) return null;
  if (!/^\d+$/.test(value)) {
    throw new PantryMutationConflictError(`Invalid row version: ${value}`);
  }
  return BigInt(value);
}

export function validatePantryMutationChanges(
  changes: PantryMutationChange[],
): void {
  if (
    changes.length === 0 ||
    changes.length > MAX_PANTRY_MUTATION_CHANGES
  ) {
    throw new PantryMutationConflictError(
      `A change set must contain 1-${MAX_PANTRY_MUTATION_CHANGES} items`,
    );
  }
  const slugs = new Set<string>();
  for (const change of changes) {
    if (slugs.has(change.ingredientSlug)) {
      throw new PantryMutationConflictError(
        `Duplicate ingredient: ${change.ingredientSlug}`,
      );
    }
    slugs.add(change.ingredientSlug);
  }
}

export function planPantryTransition(
  change: PantryMutationChange,
  current: PantryCurrentItem | undefined,
  newStableItemId: string,
): PantryChangeRecord {
  if ((current?.version ?? null) !== expectedVersion(change.expectedVersion)) {
    throw new PantryMutationConflictError(
      `${change.ingredientSlug} changed after the actor read it`,
    );
  }
  if (!current && change.location === null) {
    throw new PantryMutationConflictError(
      `${change.ingredientSlug} is already absent`,
    );
  }
  return {
    stableItemId: current?.stableItemId ?? newStableItemId,
    ingredientSlug: change.ingredientSlug,
    beforeValue: current
      ? {
          ingredientSlug: current.ingredientSlug,
          location: current.location,
        }
      : null,
    afterValue: change.location
      ? { ingredientSlug: change.ingredientSlug, location: change.location }
      : null,
    beforeVersion: current?.version ?? null,
    afterVersion: (current?.version ?? BigInt(0)) + BigInt(1),
  };
}

export function previewPantryCompensation(
  record: PantryChangeRecord,
  current: PantryCurrentItem | undefined,
  absence: PantryAbsenceRevision | undefined,
): PantryUndoPreviewItem {
  const afterMatches = record.afterValue
    ? current?.stableItemId === record.stableItemId &&
      current.version === record.afterVersion &&
      current.location === record.afterValue.location
    : !current &&
      absence?.stableItemId === record.stableItemId &&
      absence.version === record.afterVersion;
  return {
    stableItemId: record.stableItemId,
    ingredientSlug: record.ingredientSlug,
    beforeValue: record.beforeValue,
    afterValue: record.afterValue,
    currentValue: current
      ? {
          ingredientSlug: current.ingredientSlug,
          location: current.location,
        }
      : null,
    status: afterMatches ? "ready" : "conflict",
  };
}

export function planPantryCompensation(
  record: PantryChangeRecord,
  current: PantryCurrentItem | undefined,
  absence: PantryAbsenceRevision | undefined,
): PantryChangeRecord {
  const preview = previewPantryCompensation(record, current, absence);
  if (preview.status === "conflict") {
    throw new PantryMutationConflictError(
      `${record.ingredientSlug} changed after the recorded mutation`,
    );
  }
  return {
    stableItemId: record.stableItemId,
    ingredientSlug: record.ingredientSlug,
    beforeValue: record.afterValue,
    afterValue: record.beforeValue,
    beforeVersion: record.afterVersion,
    afterVersion: record.afterVersion + BigInt(1),
  };
}
