import {
  compareDecimals,
  decimalFraction,
  divideFractions,
  formatFraction,
  multiplyFractions,
  type Fraction,
} from "ts-base/numbers";
import { z } from "zod";
import {
  convertUnitFraction,
  type VolumeUnit,
  type WeightUnit,
} from "./conversion";
import { IngredientSlugSchema } from "./ingredient";
import type { Unit } from "./unit";

export type { VolumeUnit, WeightUnit } from "./conversion";

export const INGREDIENT_PROPERTY_KINDS = [
  "density",
  "edible_mass_fraction",
  "nutrient",
] as const;

export const IngredientPropertyKindSchema = z.enum(INGREDIENT_PROPERTY_KINDS);
export type IngredientPropertyKind = z.infer<
  typeof IngredientPropertyKindSchema
>;

export const INGREDIENT_PREPARATION_STATES = [
  "unspecified",
  "raw",
  "cooked",
  "dried",
  "drained",
  "peeled",
] as const;

export const IngredientPreparationStateSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:[ _-][a-z0-9]+)*$/);
export type IngredientPreparationState = z.infer<
  typeof IngredientPreparationStateSchema
>;

export const PositiveDecimalSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/)
  .refine((value) => /[1-9]/.test(value), "Value must be greater than zero");
export type PositiveDecimal = z.infer<typeof PositiveDecimalSchema>;

export const NonNegativeDecimalSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
export type NonNegativeDecimal = z.infer<typeof NonNegativeDecimalSchema>;

export const IngredientPropertySourceReferenceSchema = z.object({
  sourceId: z.string().trim().min(1).max(120),
  publisher: z.string().trim().min(1),
  dataset: z.string().trim().min(1),
  canonicalUrl: z.url(),
  license: z.string().trim().min(1),
  licenseUrl: z.url().optional(),
  attribution: z.string().trim().min(1),
  effectiveVersion: z.string().trim().min(1).max(160),
});
export type IngredientPropertySourceReference = z.infer<
  typeof IngredientPropertySourceReferenceSchema
>;

const DensityPropertyValueSchema = z.object({
  kind: z.literal("density"),
  unit: z.literal("g_per_ml"),
  gramsPerMilliliter: PositiveDecimalSchema,
});

/** Edible mass divided by as-purchased gross mass, expressed from 0 to 1. */
const EdibleMassFractionPropertyValueSchema = z.object({
  kind: z.literal("edible_mass_fraction"),
  unit: z.literal("fraction"),
  edibleMassFraction: PositiveDecimalSchema.refine(
    (value) => compareDecimals(value, "1") <= 0,
    "Edible mass fraction cannot exceed 1",
  ),
});

export const NUTRIENT_UNITS = ["g", "mg", "ug", "kcal", "kj"] as const;
export const NutrientUnitSchema = z.enum(NUTRIENT_UNITS);
export type NutrientUnit = z.infer<typeof NutrientUnitSchema>;

const NutrientPropertyValueSchema = z.object({
  kind: z.literal("nutrient"),
  nutrient: z.string().trim().min(1).max(120),
  amount: NonNegativeDecimalSchema,
  unit: NutrientUnitSchema,
  perEdibleGrams: PositiveDecimalSchema,
});

export const IngredientPropertyValueSchema = z.discriminatedUnion("kind", [
  DensityPropertyValueSchema,
  EdibleMassFractionPropertyValueSchema,
  NutrientPropertyValueSchema,
]);
export type IngredientPropertyValue = z.infer<
  typeof IngredientPropertyValueSchema
>;

export const IngredientPropertyObservationSchema = z.object({
  id: z.uuid(),
  sourceRecordId: z.string().trim().min(1).max(240),
  originalRecord: z.record(z.string(), z.unknown()),
  ingredientSlug: IngredientSlugSchema,
  preparationState: IngredientPreparationStateSchema,
  value: IngredientPropertyValueSchema,
  confidence: z.number().min(0).max(1),
  source: IngredientPropertySourceReferenceSchema,
});
export type IngredientPropertyObservation = z.infer<
  typeof IngredientPropertyObservationSchema
>;

export const INGREDIENT_PROPERTY_RECONCILIATION_STRATEGIES = [
  "manual",
  "source_priority",
  "consensus",
] as const;

export const IngredientPropertyReconciliationDecisionSchema = z.object({
  strategy: z.enum(INGREDIENT_PROPERTY_RECONCILIATION_STRATEGIES),
  rationale: z.string().trim().min(1),
  consideredObservationIds: z.array(z.uuid()).min(1),
  decidedBy: z.string().trim().min(1),
  decidedAt: z.iso.datetime(),
});
export type IngredientPropertyReconciliationDecision = z.infer<
  typeof IngredientPropertyReconciliationDecisionSchema
>;

export const IngredientPropertySelectionSchema = z.object({
  catalogVersion: z.string().trim().min(1).max(160),
  observation: IngredientPropertyObservationSchema,
  confidence: z.number().min(0).max(1),
  decision: IngredientPropertyReconciliationDecisionSchema,
});
export type IngredientPropertySelection = z.infer<
  typeof IngredientPropertySelectionSchema
>;

export function ingredientPropertyKey(value: IngredientPropertyValue): string {
  if (value.kind === "nutrient") return `nutrient:${value.nutrient}`;
  return value.kind;
}

export function reconcileIngredientProperty(input: {
  catalogVersion: string;
  observations: IngredientPropertyObservation[];
  selectedObservationId: string;
  confidence: number;
  decision: IngredientPropertyReconciliationDecision;
}): IngredientPropertySelection {
  const observations = input.observations.map((observation) =>
    IngredientPropertyObservationSchema.parse(observation),
  );
  if (observations.length === 0) {
    throw new Error("At least one ingredient property observation is required");
  }

  const selected = observations.find(
    (observation) => observation.id === input.selectedObservationId,
  );
  if (!selected) {
    throw new Error("The selected observation is not one of the candidates");
  }

  const first = observations[0];
  if (!first) throw new Error("Ingredient property candidates are missing");
  const expectedIdentity = ingredientPropertyKey(first.value);
  const incompatible = observations.some(
    (observation) =>
      observation.ingredientSlug !== first.ingredientSlug ||
      observation.preparationState !== first.preparationState ||
      ingredientPropertyKey(observation.value) !== expectedIdentity,
  );
  if (incompatible) {
    throw new Error(
      "Reconciliation candidates must describe one ingredient, preparation, and property",
    );
  }

  const decision = IngredientPropertyReconciliationDecisionSchema.parse(
    input.decision,
  );
  const candidateIds = new Set(observations.map(({ id }) => id));
  if (
    decision.consideredObservationIds.length !== candidateIds.size ||
    decision.consideredObservationIds.some((id) => !candidateIds.has(id))
  ) {
    throw new Error("The reconciliation decision must consider every candidate");
  }

  return IngredientPropertySelectionSchema.parse({
    catalogVersion: input.catalogVersion,
    observation: selected,
    confidence: input.confidence,
    decision,
  });
}

function convertedFraction(amount: string, from: Unit, to: Unit): Fraction {
  const converted = convertUnitFraction(amount, from, to);
  if (!converted) throw new Error(`Cannot convert ${from} to ${to}`);
  return converted;
}

export function convertIngredientVolumeToMass(input: {
  amount: NonNegativeDecimal;
  unit: VolumeUnit;
  targetUnit: WeightUnit;
  density: IngredientPropertySelection;
  decimalPlaces?: number;
}): {
  amount: string;
  unit: WeightUnit;
  catalogVersion: string;
  observationId: string;
} {
  const selection = IngredientPropertySelectionSchema.parse(input.density);
  if (selection.observation.value.kind !== "density") {
    throw new Error("Volume-to-mass conversion requires a density selection");
  }
  const millilitres = convertedFraction(input.amount, input.unit, "ml");
  const grams = multiplyFractions(
    millilitres,
    decimalFraction(selection.observation.value.gramsPerMilliliter),
  );
  const target = multiplyFractions(
    grams,
    convertedFraction("1", "g", input.targetUnit),
  );
  return {
    amount: formatFraction(target, input.decimalPlaces ?? 6),
    unit: input.targetUnit,
    catalogVersion: selection.catalogVersion,
    observationId: selection.observation.id,
  };
}

export function convertIngredientMassToVolume(input: {
  amount: NonNegativeDecimal;
  unit: WeightUnit;
  targetUnit: VolumeUnit;
  density: IngredientPropertySelection;
  decimalPlaces?: number;
}): {
  amount: string;
  unit: VolumeUnit;
  catalogVersion: string;
  observationId: string;
} {
  const selection = IngredientPropertySelectionSchema.parse(input.density);
  if (selection.observation.value.kind !== "density") {
    throw new Error("Mass-to-volume conversion requires a density selection");
  }
  const grams = convertedFraction(input.amount, input.unit, "g");
  const millilitres = divideFractions(
    grams,
    decimalFraction(selection.observation.value.gramsPerMilliliter),
  );
  const target = multiplyFractions(
    millilitres,
    convertedFraction("1", "ml", input.targetUnit),
  );
  return {
    amount: formatFraction(target, input.decimalPlaces ?? 6),
    unit: input.targetUnit,
    catalogVersion: selection.catalogVersion,
    observationId: selection.observation.id,
  };
}

export function calculateEdibleMass(input: {
  grossAmount: NonNegativeDecimal;
  grossUnit: WeightUnit;
  targetUnit: WeightUnit;
  edibleMassFraction: IngredientPropertySelection;
  decimalPlaces?: number;
}): {
  amount: string;
  unit: WeightUnit;
  catalogVersion: string;
  observationId: string;
} {
  const selection = IngredientPropertySelectionSchema.parse(
    input.edibleMassFraction,
  );
  if (selection.observation.value.kind !== "edible_mass_fraction") {
    throw new Error(
      "Edible mass calculation requires an edible-mass-fraction selection",
    );
  }
  const grossGrams = convertedFraction(input.grossAmount, input.grossUnit, "g");
  const edibleGrams = multiplyFractions(
    grossGrams,
    decimalFraction(selection.observation.value.edibleMassFraction),
  );
  const target = multiplyFractions(
    edibleGrams,
    convertedFraction("1", "g", input.targetUnit),
  );
  return {
    amount: formatFraction(target, input.decimalPlaces ?? 6),
    unit: input.targetUnit,
    catalogVersion: selection.catalogVersion,
    observationId: selection.observation.id,
  };
}
