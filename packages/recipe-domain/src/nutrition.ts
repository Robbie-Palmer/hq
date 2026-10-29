import {
  decimalFraction,
  divideFractions,
  formatFraction,
  multiplyFractions,
  type Fraction,
} from "ts-base/numbers";
import { z } from "zod";
import {
  IngredientPropertySelectionSchema,
  ingredientPropertyKey,
  type IngredientPropertySelection,
  type NutrientCategory,
  type NutrientUnit,
  type PropertyUncertainty,
} from "./ingredient-property";
import {
  convertUnitFraction,
  getUnitDimension,
  type VolumeUnit,
} from "./conversion";
import { RecipeIngredientSchema, type IngredientGroup } from "./recipe";
import type { Unit } from "./unit";

const CalculationInputSchema = z.object({
  recipeVersion: z.string().trim().min(1).max(240),
  catalogVersion: z.string().trim().min(1).max(160),
  servings: z.number().int().positive(),
  ingredientGroups: z.array(
    z.object({
      name: z.string().optional(),
      items: z.array(RecipeIngredientSchema).min(1),
    }),
  ),
  selections: z.array(IngredientPropertySelectionSchema),
  decimalPlaces: z.number().int().min(0).max(12).default(6),
});

export type NutritionGapCode =
  | "ambiguous_property"
  | "incompatible_nutrient_definition"
  | "missing_density"
  | "missing_edible_mass_fraction"
  | "missing_nutrient"
  | "missing_quantity"
  | "missing_quantity_basis"
  | "missing_uncertainty"
  | "missing_unit"
  | "unsupported_unit";

export type NutritionGap = {
  code: NutritionGapCode;
  message: string;
  nutrient?: string;
  propertyKey?: string;
};

export type NutritionAssumption = {
  code: "authored_quantity_is_exact" | "linear_nutrient_scaling";
  message: string;
};

export type DecimalRange = { lowerBound: string; upperBound: string };

export type PropertyConversionStep = {
  operation: "density" | "edible_mass_fraction" | "nutrient";
  selection: IngredientPropertySelection;
};

export type UnitConversionStep = {
  operation: "unit_conversion";
  amount: string;
  from: string;
  to: string;
};

export type IngredientNutrientContribution = {
  nutrient: string;
  category: NutrientCategory | "unclassified";
  amount: string;
  unit: NutrientUnit;
  uncertainty: DecimalRange | null;
  conversionPath: Array<UnitConversionStep | PropertyConversionStep>;
};

export type IngredientNutritionResult = {
  groupIndex: number;
  itemIndex: number;
  ingredient: string;
  preparationState: string;
  quantityBasis: "edible" | "as_purchased" | null;
  edibleMass: {
    amount: string;
    unit: "g";
    uncertainty: DecimalRange | null;
    conversionPath: Array<UnitConversionStep | PropertyConversionStep>;
  } | null;
  nutrients: IngredientNutrientContribution[];
  gaps: NutritionGap[];
  status: "complete" | "partial" | "unsupported";
};

export type NutrientTotal = {
  nutrient: string;
  category: NutrientCategory | "unclassified";
  amount: string;
  unit: NutrientUnit;
  uncertainty: DecimalRange | null;
  contributingIngredientCount: number;
  ingredientCount: number;
  coverage: number;
  complete: boolean;
};

export type RecipeNutritionCalculation = {
  recipeVersion: string;
  catalogVersion: string;
  servings: number;
  totals: NutrientTotal[];
  perServing: NutrientTotal[];
  ingredients: IngredientNutritionResult[];
  coverage: {
    ingredientCount: number;
    completeIngredientCount: number;
    partialIngredientCount: number;
    unsupportedIngredientCount: number;
    completeIngredientRatio: number;
  };
  assumptions: NutritionAssumption[];
  gaps: NutritionGap[];
};

type FractionRange = { lowerBound: Fraction; upperBound: Fraction };

type MassCalculation = {
  point: Fraction;
  range: FractionRange | null;
  path: Array<UnitConversionStep | PropertyConversionStep>;
};

type PreciseNutrientContribution = {
  result: IngredientNutrientContribution;
  point: Fraction;
  range: FractionRange | null;
};

type CalculatedIngredient = {
  result: IngredientNutritionResult;
  preciseNutrients: PreciseNutrientContribution[];
};

const ZERO: Fraction = { numerator: BigInt(0), denominator: BigInt(1) };

const MASS_UNIT_FACTORS: Record<"g" | "mg" | "ug", string> = {
  g: "1",
  mg: "0.001",
  ug: "0.000001",
};

const ENERGY_UNIT_FACTORS: Record<"kcal" | "kj", string> = {
  kcal: "1",
  kj: "0.2390057361376673",
};

function addFractions(left: Fraction, right: Fraction): Fraction {
  return {
    numerator:
      left.numerator * right.denominator +
      right.numerator * left.denominator,
    denominator: left.denominator * right.denominator,
  };
}

function decimalAmount(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError("Ingredient quantities must be finite and non-negative");
  }
  return String(value);
}

function formatRange(
  range: FractionRange | null,
  decimalPlaces: number,
): DecimalRange | null {
  return range
    ? {
        lowerBound: formatFraction(range.lowerBound, decimalPlaces),
        upperBound: formatFraction(range.upperBound, decimalPlaces),
      }
    : null;
}

function uncertaintyRange(
  uncertainty: PropertyUncertainty | undefined,
): FractionRange | null {
  return uncertainty
    ? {
        lowerBound: decimalFraction(uncertainty.lowerBound),
        upperBound: decimalFraction(uncertainty.upperBound),
      }
    : null;
}

function multiplyRanges(
  left: FractionRange | null,
  right: FractionRange | null,
): FractionRange | null {
  if (!left || !right) return null;
  return {
    lowerBound: multiplyFractions(left.lowerBound, right.lowerBound),
    upperBound: multiplyFractions(left.upperBound, right.upperBound),
  };
}

function exactRange(value: Fraction): FractionRange {
  return { lowerBound: value, upperBound: value };
}

function addRanges(
  left: FractionRange | null,
  right: FractionRange | null,
): FractionRange | null {
  if (!left || !right) return null;
  return {
    lowerBound: addFractions(left.lowerBound, right.lowerBound),
    upperBound: addFractions(left.upperBound, right.upperBound),
  };
}

function divideRange(range: FractionRange, divisor: Fraction): FractionRange {
  return {
    lowerBound: divideFractions(range.lowerBound, divisor),
    upperBound: divideFractions(range.upperBound, divisor),
  };
}

function canonicalNutrientUnit(
  category: NutrientCategory | "unclassified",
  observedUnits: NutrientUnit[],
): NutrientUnit | null {
  const energyUnits = observedUnits.filter(
    (unit): unit is "kcal" | "kj" => unit === "kcal" || unit === "kj",
  );
  const massUnits = observedUnits.filter(
    (unit): unit is "g" | "mg" | "ug" =>
      unit === "g" || unit === "mg" || unit === "ug",
  );
  if (energyUnits.length > 0 && massUnits.length > 0) return null;
  if (category === "energy") {
    return energyUnits.length > 0 ? "kcal" : null;
  }
  if (category === "macronutrient") {
    return massUnits.length > 0 ? "g" : null;
  }
  if (category === "micronutrient") {
    return massUnits.length > 0 ? "mg" : null;
  }
  if (energyUnits.length > 0) return "kcal";
  if (massUnits.length === 0) return null;
  return (["g", "mg", "ug"] as const).find((unit) => massUnits.includes(unit)) ?? null;
}

function convertNutrientFraction(
  amount: Fraction,
  from: NutrientUnit,
  to: NutrientUnit,
): Fraction | null {
  if (from === to) return amount;
  if (from in MASS_UNIT_FACTORS && to in MASS_UNIT_FACTORS) {
    const fromFactor = MASS_UNIT_FACTORS[from as keyof typeof MASS_UNIT_FACTORS];
    const toFactor = MASS_UNIT_FACTORS[to as keyof typeof MASS_UNIT_FACTORS];
    return divideFractions(
      multiplyFractions(amount, decimalFraction(fromFactor)),
      decimalFraction(toFactor),
    );
  }
  if (from in ENERGY_UNIT_FACTORS && to in ENERGY_UNIT_FACTORS) {
    const fromFactor = ENERGY_UNIT_FACTORS[from as keyof typeof ENERGY_UNIT_FACTORS];
    const toFactor = ENERGY_UNIT_FACTORS[to as keyof typeof ENERGY_UNIT_FACTORS];
    return divideFractions(
      multiplyFractions(amount, decimalFraction(fromFactor)),
      decimalFraction(toFactor),
    );
  }
  return null;
}

function selectionIdentity(selection: IngredientPropertySelection): string {
  return [
    selection.observation.ingredientSlug,
    selection.observation.preparationState,
    ingredientPropertyKey(selection.observation.value),
  ].join("\u0000");
}

function groupSelections(
  selections: IngredientPropertySelection[],
): Map<string, IngredientPropertySelection[]> {
  const grouped = new Map<string, IngredientPropertySelection[]>();
  for (const selection of selections) {
    const key = selectionIdentity(selection);
    const values = grouped.get(key) ?? [];
    values.push(selection);
    grouped.set(key, values);
  }
  for (const values of grouped.values()) {
    values.sort((left, right) =>
      left.observation.id.localeCompare(right.observation.id),
    );
  }
  return grouped;
}

function lookupSelection(input: {
  grouped: Map<string, IngredientPropertySelection[]>;
  ingredient: string;
  preparationState: string;
  propertyKey: string;
  gaps: NutritionGap[];
}): IngredientPropertySelection | undefined {
  const key = [
    input.ingredient,
    input.preparationState,
    input.propertyKey,
  ].join("\u0000");
  const matches = input.grouped.get(key) ?? [];
  if (matches.length > 1) {
    input.gaps.push({
      code: "ambiguous_property",
      propertyKey: input.propertyKey,
      message: `Catalog has ${matches.length} selections for ${input.propertyKey}`,
    });
    return undefined;
  }
  return matches[0];
}

function densityMass(input: {
  amount: string;
  unit: VolumeUnit;
  selection: IngredientPropertySelection;
}): MassCalculation {
  const value = input.selection.observation.value;
  if (value.kind !== "density") throw new TypeError("Expected density selection");
  const millilitres = convertUnitFraction(input.amount, input.unit, "ml");
  if (!millilitres) throw new TypeError(`Cannot convert ${input.unit} to ml`);
  const density = decimalFraction(value.gramsPerMilliliter);
  return {
    point: multiplyFractions(millilitres, density),
    range: multiplyRanges(
      exactRange(millilitres),
      uncertaintyRange(value.uncertainty),
    ),
    path: [
      {
        operation: "unit_conversion",
        amount: input.amount,
        from: input.unit,
        to: "ml",
      },
      { operation: "density", selection: input.selection },
    ],
  };
}

type StructuredQuantity = {
  amount: string;
  unit: Unit;
  basis: "edible" | "as_purchased";
};

function readStructuredQuantity(
  ingredient: z.infer<typeof RecipeIngredientSchema>,
  gaps: NutritionGap[],
): StructuredQuantity | null {
  if (ingredient.amount === undefined) {
    gaps.push({ code: "missing_quantity", message: "Ingredient has no quantity" });
    return null;
  }
  if (!ingredient.unit) {
    gaps.push({ code: "missing_unit", message: "Ingredient has no unit" });
    return null;
  }
  if (!ingredient.quantityBasis) {
    gaps.push({
      code: "missing_quantity_basis",
      message: "Ingredient quantity does not say whether it is edible or as purchased",
    });
    return null;
  }
  return {
    amount: decimalAmount(ingredient.amount),
    unit: ingredient.unit,
    basis: ingredient.quantityBasis,
  };
}

function weightMass(amount: string, unit: Unit): MassCalculation {
  const grams = convertUnitFraction(amount, unit, "g");
  if (!grams) throw new TypeError(`Cannot convert ${unit} to g`);
  return {
    point: grams,
    range: exactRange(grams),
    path: [{ operation: "unit_conversion", amount, from: unit, to: "g" }],
  };
}

function baseIngredientMass(input: {
  quantity: StructuredQuantity;
  ingredient: string;
  preparationState: string;
  grouped: Map<string, IngredientPropertySelection[]>;
  gaps: NutritionGap[];
}): MassCalculation | null {
  const dimension = getUnitDimension(input.quantity.unit);
  if (dimension === "weight") {
    return weightMass(input.quantity.amount, input.quantity.unit);
  }
  if (dimension !== "volume") {
    input.gaps.push({
      code: "unsupported_unit",
      message: `Unit ${input.quantity.unit} has no catalog-backed mass conversion`,
    });
    return null;
  }
  const density = lookupSelection({
    ...input,
    propertyKey: "density",
  });
  if (!density) {
    if (!input.gaps.some(({ code }) => code === "ambiguous_property")) {
      input.gaps.push({
        code: "missing_density",
        propertyKey: "density",
        message: `No density matches ${input.ingredient} (${input.preparationState})`,
      });
    }
    return null;
  }
  if (!density.observation.value.uncertainty) {
    input.gaps.push({
      code: "missing_uncertainty",
      propertyKey: "density",
      message: "Density selection has no source uncertainty range",
    });
  }
  return densityMass({
    amount: input.quantity.amount,
    unit: input.quantity.unit as VolumeUnit,
    selection: density,
  });
}

function applyEdibleMassFraction(input: {
  mass: MassCalculation;
  ingredient: string;
  preparationState: string;
  grouped: Map<string, IngredientPropertySelection[]>;
  gaps: NutritionGap[];
}): MassCalculation | null {
  const selection = lookupSelection({
    ...input,
    propertyKey: "edible_mass_fraction",
  });
  if (!selection) {
    if (!input.gaps.some(({ code }) => code === "ambiguous_property")) {
      input.gaps.push({
        code: "missing_edible_mass_fraction",
        propertyKey: "edible_mass_fraction",
        message: `No edible fraction matches ${input.ingredient} (${input.preparationState})`,
      });
    }
    return null;
  }
  const fraction = selection.observation.value;
  if (fraction.kind !== "edible_mass_fraction") {
    throw new TypeError("Expected edible-mass-fraction selection");
  }
  if (!fraction.uncertainty) {
    input.gaps.push({
      code: "missing_uncertainty",
      propertyKey: "edible_mass_fraction",
      message: "Edible fraction selection has no source uncertainty range",
    });
  }
  return {
    point: multiplyFractions(
      input.mass.point,
      decimalFraction(fraction.edibleMassFraction),
    ),
    range: multiplyRanges(
      input.mass.range,
      uncertaintyRange(fraction.uncertainty),
    ),
    path: [
      ...input.mass.path,
      { operation: "edible_mass_fraction", selection },
    ],
  };
}

function ingredientMass(input: {
  ingredient: z.infer<typeof RecipeIngredientSchema>;
  preparationState: string;
  grouped: Map<string, IngredientPropertySelection[]>;
  gaps: NutritionGap[];
}): MassCalculation | null {
  const { ingredient, gaps } = input;
  const quantity = readStructuredQuantity(ingredient, gaps);
  if (!quantity) return null;
  const mass = baseIngredientMass({
    grouped: input.grouped,
    ingredient: ingredient.ingredient,
    preparationState: input.preparationState,
    gaps,
    quantity,
  });
  if (!mass || quantity.basis === "edible") return mass;
  return applyEdibleMassFraction({
    mass,
    ingredient: ingredient.ingredient,
    preparationState: input.preparationState,
    grouped: input.grouped,
    gaps,
  });
}

function nutrientSelectionsForIngredient(input: {
  grouped: Map<string, IngredientPropertySelection[]>;
  ingredient: string;
  preparationState: string;
}): IngredientPropertySelection[] {
  const prefix = `${input.ingredient}\u0000${input.preparationState}\u0000nutrient:`;
  return [...input.grouped.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .flatMap(([, values]) => values.slice(0, 1))
    .sort((left, right) => {
      const leftValue = left.observation.value;
      const rightValue = right.observation.value;
      if (leftValue.kind !== "nutrient" || rightValue.kind !== "nutrient") return 0;
      return leftValue.nutrient.localeCompare(rightValue.nutrient);
    });
}

function nutrientContribution(input: {
  mass: MassCalculation;
  selection: IngredientPropertySelection;
  grouped: Map<string, IngredientPropertySelection[]>;
  ingredient: string;
  preparationState: string;
  decimalPlaces: number;
  gaps: NutritionGap[];
}): PreciseNutrientContribution | null {
  const value = input.selection.observation.value;
  if (value.kind !== "nutrient") return null;
  const propertyKey = ingredientPropertyKey(value);
  const identity = [
    input.ingredient,
    input.preparationState,
    propertyKey,
  ].join("\u0000");
  const duplicates = input.grouped.get(identity) ?? [];
  if (duplicates.length > 1) {
    input.gaps.push({
      code: "ambiguous_property",
      nutrient: value.nutrient,
      propertyKey,
      message: `Catalog has ${duplicates.length} selections for ${propertyKey}`,
    });
    return null;
  }

  const perEdibleGrams = decimalFraction(value.perEdibleGrams);
  const point = multiplyFractions(
    input.mass.point,
    divideFractions(decimalFraction(value.amount), perEdibleGrams),
  );
  const propertyRange = uncertaintyRange(value.uncertainty);
  const range = multiplyRanges(
    input.mass.range,
    propertyRange
      ? divideRange(propertyRange, perEdibleGrams)
      : null,
  );
  if (!value.uncertainty) {
    input.gaps.push({
      code: "missing_uncertainty",
      nutrient: value.nutrient,
      propertyKey,
      message: `${value.nutrient} selection has no source uncertainty range`,
    });
  }
  return {
    point,
    range,
    result: {
      nutrient: value.nutrient,
      category: value.category ?? "unclassified",
      amount: formatFraction(point, input.decimalPlaces),
      unit: value.unit,
      uncertainty: formatRange(range, input.decimalPlaces),
      conversionPath: [
        ...input.mass.path,
        { operation: "nutrient", selection: input.selection },
      ],
    },
  };
}

function calculatedNutrients(input: {
  mass: MassCalculation | null;
  selections: IngredientPropertySelection[];
  grouped: Map<string, IngredientPropertySelection[]>;
  ingredient: string;
  preparationState: string;
  decimalPlaces: number;
  gaps: NutritionGap[];
}): PreciseNutrientContribution[] {
  if (!input.mass) return [];
  return input.selections.flatMap((selection) => {
    const contribution = nutrientContribution({
      ...input,
      mass: input.mass as MassCalculation,
      selection,
    });
    return contribution ? [contribution] : [];
  });
}

function calculateIngredient(input: {
  ingredient: z.infer<typeof RecipeIngredientSchema>;
  groupIndex: number;
  itemIndex: number;
  grouped: Map<string, IngredientPropertySelection[]>;
  decimalPlaces: number;
}): CalculatedIngredient {
  const gaps: NutritionGap[] = [];
  const preparationState = input.ingredient.preparation?.trim() || "unspecified";
  const mass = ingredientMass({
    ingredient: input.ingredient,
    preparationState,
    grouped: input.grouped,
    gaps,
  });
  const selections = nutrientSelectionsForIngredient({
    grouped: input.grouped,
    ingredient: input.ingredient.ingredient,
    preparationState,
  });
  if (selections.length === 0) {
    gaps.push({
      code: "missing_nutrient",
      message: `No nutrients match ${input.ingredient.ingredient} (${preparationState})`,
    });
  }
  const preciseNutrients = calculatedNutrients({
    mass,
    selections,
    grouped: input.grouped,
    ingredient: input.ingredient.ingredient,
    preparationState,
    decimalPlaces: input.decimalPlaces,
    gaps,
  });
  const nutrients = preciseNutrients.map(({ result }) => result);

  const unsupported = mass === null || nutrients.length === 0;
  return {
    preciseNutrients,
    result: {
      groupIndex: input.groupIndex,
      itemIndex: input.itemIndex,
      ingredient: input.ingredient.ingredient,
      preparationState,
      quantityBasis: input.ingredient.quantityBasis ?? null,
      edibleMass: mass
        ? {
            amount: formatFraction(mass.point, input.decimalPlaces),
            unit: "g",
            uncertainty: formatRange(mass.range, input.decimalPlaces),
            conversionPath: mass.path,
          }
        : null,
      nutrients,
      gaps,
      status: unsupported
        ? "unsupported"
        : gaps.length > 0
          ? "partial"
          : "complete",
    },
  };
}

type TotalAccumulator = {
  categories: Set<NutrientCategory | "unclassified">;
  units: NutrientUnit[];
  contributions: PreciseNutrientContribution[];
};

type PreciseNutrientTotal = {
  result: NutrientTotal;
  point: Fraction;
  range: FractionRange | null;
};

function accumulateNutrients(
  ingredients: CalculatedIngredient[],
): Map<string, TotalAccumulator> {
  const accumulators = new Map<string, TotalAccumulator>();
  for (const ingredient of ingredients) {
    for (const contribution of ingredient.preciseNutrients) {
      const accumulator = accumulators.get(contribution.result.nutrient) ?? {
        categories: new Set(),
        units: [],
        contributions: [],
      };
      accumulator.categories.add(contribution.result.category);
      accumulator.units.push(contribution.result.unit);
      accumulator.contributions.push(contribution);
      accumulators.set(contribution.result.nutrient, accumulator);
    }
  }
  return accumulators;
}

function convertedContributionRange(
  contribution: PreciseNutrientContribution,
  unit: NutrientUnit,
): FractionRange | null {
  if (!contribution.range) return null;
  const lowerBound = convertNutrientFraction(
    contribution.range.lowerBound,
    contribution.result.unit,
    unit,
  );
  const upperBound = convertNutrientFraction(
    contribution.range.upperBound,
    contribution.result.unit,
    unit,
  );
  return lowerBound && upperBound ? { lowerBound, upperBound } : null;
}

function sumNutrientContributions(
  contributions: PreciseNutrientContribution[],
  unit: NutrientUnit,
): { point: Fraction; range: FractionRange | null } {
  let point = ZERO;
  let range: FractionRange | null = exactRange(ZERO);
  for (const contribution of contributions) {
    const converted = convertNutrientFraction(
      contribution.point,
      contribution.result.unit,
      unit,
    );
    if (converted) point = addFractions(point, converted);
    range = addRanges(range, convertedContributionRange(contribution, unit));
  }
  return { point, range };
}

function aggregateNutrient(input: {
  nutrient: string;
  accumulator: TotalAccumulator;
  ingredientCount: number;
  decimalPlaces: number;
}): { total?: PreciseNutrientTotal; gap?: NutritionGap } {
  const categories = [...input.accumulator.categories];
  const category = categories[0] ?? "unclassified";
  const unit = canonicalNutrientUnit(category, input.accumulator.units);
  if (categories.length !== 1 || !unit) {
    return {
      gap: {
        code: "incompatible_nutrient_definition",
        nutrient: input.nutrient,
        message: `${input.nutrient} has incompatible categories or units in the catalog`,
      },
    };
  }
  const summed = sumNutrientContributions(
    input.accumulator.contributions,
    unit,
  );
  const contributingIngredientCount = input.accumulator.contributions.length;
  const complete = contributingIngredientCount === input.ingredientCount;
  return {
    total: {
      point: summed.point,
      range: complete ? summed.range : null,
      result: {
        nutrient: input.nutrient,
        category,
        amount: formatFraction(summed.point, input.decimalPlaces),
        unit,
        uncertainty: complete
          ? formatRange(summed.range, input.decimalPlaces)
          : null,
        contributingIngredientCount,
        ingredientCount: input.ingredientCount,
        coverage:
          input.ingredientCount === 0
            ? 0
            : contributingIngredientCount / input.ingredientCount,
        complete,
      },
    },
  };
}

function aggregateTotals(input: {
  ingredients: CalculatedIngredient[];
  decimalPlaces: number;
}): { totals: PreciseNutrientTotal[]; gaps: NutritionGap[] } {
  const accumulators = accumulateNutrients(input.ingredients);
  const gaps: NutritionGap[] = [];
  const totals: PreciseNutrientTotal[] = [];
  for (const [nutrient, accumulator] of [...accumulators.entries()].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const result = aggregateNutrient({
      nutrient,
      accumulator,
      ingredientCount: input.ingredients.length,
      decimalPlaces: input.decimalPlaces,
    });
    if (result.total) totals.push(result.total);
    if (result.gap) gaps.push(result.gap);
  }
  return { totals, gaps };
}

function perServingTotals(
  totals: PreciseNutrientTotal[],
  servings: number,
  decimalPlaces: number,
): NutrientTotal[] {
  const divisor = decimalFraction(String(servings));
  return totals.map((total) => ({
    ...total.result,
    amount: formatFraction(
      divideFractions(total.point, divisor),
      decimalPlaces,
    ),
    uncertainty: total.range
      ? formatRange(
          divideRange(total.range, divisor),
          decimalPlaces,
        )
      : null,
  }));
}

export function calculateRecipeNutrition(input: {
  recipeVersion: string;
  catalogVersion: string;
  servings: number;
  ingredientGroups: IngredientGroup[];
  selections: IngredientPropertySelection[];
  decimalPlaces?: number;
}): RecipeNutritionCalculation {
  const parsed = CalculationInputSchema.parse(input);
  const catalogMismatches = parsed.selections.filter(
    ({ catalogVersion }) => catalogVersion !== parsed.catalogVersion,
  );
  if (catalogMismatches.length > 0) {
    throw new Error(
      `Catalog version ${parsed.catalogVersion} cannot use selections from another version`,
    );
  }
  const grouped = groupSelections(parsed.selections);
  const calculatedIngredients = parsed.ingredientGroups.flatMap((group, groupIndex) =>
    group.items.map((ingredient, itemIndex) =>
      calculateIngredient({
        ingredient,
        groupIndex,
        itemIndex,
        grouped,
        decimalPlaces: parsed.decimalPlaces,
      }),
    ),
  );
  const ingredients = calculatedIngredients.map(({ result }) => result);
  const expectedNutrients = [
    ...new Set(
      ingredients.flatMap(({ nutrients }) =>
        nutrients.map(({ nutrient }) => nutrient),
      ),
    ),
  ].sort((left, right) => left.localeCompare(right));
  for (const ingredient of ingredients) {
    const present = new Set(
      ingredient.nutrients.map(({ nutrient }) => nutrient),
    );
    for (const nutrient of expectedNutrients) {
      if (present.has(nutrient)) continue;
      ingredient.gaps.push({
        code: "missing_nutrient",
        nutrient,
        propertyKey: `nutrient:${nutrient}`,
        message: `No ${nutrient} selection matches ${ingredient.ingredient} (${ingredient.preparationState})`,
      });
    }
    if (
      ingredient.status === "complete" &&
      ingredient.gaps.length > 0
    ) {
      ingredient.status = "partial";
    }
  }
  const aggregate = aggregateTotals({
    ingredients: calculatedIngredients,
    decimalPlaces: parsed.decimalPlaces,
  });
  const completeIngredientCount = ingredients.filter(
    ({ status }) => status === "complete",
  ).length;
  const partialIngredientCount = ingredients.filter(
    ({ status }) => status === "partial",
  ).length;
  const unsupportedIngredientCount = ingredients.filter(
    ({ status }) => status === "unsupported",
  ).length;
  const ingredientCount = ingredients.length;
  return {
    recipeVersion: parsed.recipeVersion,
    catalogVersion: parsed.catalogVersion,
    servings: parsed.servings,
    totals: aggregate.totals.map(({ result }) => result),
    perServing: perServingTotals(
      aggregate.totals,
      parsed.servings,
      parsed.decimalPlaces,
    ),
    ingredients,
    coverage: {
      ingredientCount,
      completeIngredientCount,
      partialIngredientCount,
      unsupportedIngredientCount,
      completeIngredientRatio:
        ingredientCount === 0 ? 0 : completeIngredientCount / ingredientCount,
    },
    assumptions: [
      {
        code: "authored_quantity_is_exact",
        message: "Authored ingredient quantities are treated as exact inputs.",
      },
      {
        code: "linear_nutrient_scaling",
        message: "Catalog nutrients scale linearly with edible mass.",
      },
    ],
    gaps: [...ingredients.flatMap(({ gaps }) => gaps), ...aggregate.gaps],
  };
}
