import { isDeepStrictEqual } from "node:util";
import type { Recipe } from "recipe-parsing/schemas/ground-truth";
import type {
  CountMetric,
  Failure,
  FailureCategory,
  FieldName,
} from "./schema.js";
import {
  FAILURE_CATEGORIES,
  FIELD_NAMES,
} from "./schema.js";

type Counts = {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
};

export type FieldMetricAccumulator = Record<FieldName, Counts>;

export function emptyFailureCounts(): Record<FailureCategory, number> {
  return Object.fromEntries(
    FAILURE_CATEGORIES.map((category) => [category, 0]),
  ) as Record<FailureCategory, number>;
}

export function emptyFieldMetricAccumulator(): FieldMetricAccumulator {
  return Object.fromEntries(
    FIELD_NAMES.map((field) => [
      field,
      { truePositives: 0, falsePositives: 0, falseNegatives: 0 },
    ]),
  ) as FieldMetricAccumulator;
}

function comparable(value: unknown): string {
  return JSON.stringify(value);
}

export function countFieldValues(
  counts: Counts,
  predicted: unknown[],
  expected: unknown[],
): void {
  const predictedCounts = new Map<string, number>();
  const expectedCounts = new Map<string, number>();
  for (const value of predicted) {
    const key = comparable(value);
    predictedCounts.set(key, (predictedCounts.get(key) ?? 0) + 1);
  }
  for (const value of expected) {
    const key = comparable(value);
    expectedCounts.set(key, (expectedCounts.get(key) ?? 0) + 1);
  }

  const keys = new Set([...predictedCounts.keys(), ...expectedCounts.keys()]);
  for (const key of keys) {
    const predictedCount = predictedCounts.get(key) ?? 0;
    const expectedCount = expectedCounts.get(key) ?? 0;
    counts.truePositives += Math.min(predictedCount, expectedCount);
    counts.falsePositives += Math.max(predictedCount - expectedCount, 0);
    counts.falseNegatives += Math.max(expectedCount - predictedCount, 0);
  }
}

function present(value: unknown): unknown[] {
  return value === undefined || value === null || value === "" ? [] : [value];
}

function normalizedInstruction(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

function flatIngredients(recipe: Recipe) {
  return recipe.ingredientGroups.flatMap(({ items }) => items);
}

export function recordRecipeFieldMetrics(
  accumulator: FieldMetricAccumulator,
  predicted: Recipe | null,
  expected: Recipe | null,
): void {
  const scalarFields = [
    "title",
    "description",
    "servings",
    "prepTime",
    "cookTime",
  ] as const;
  for (const field of scalarFields) {
    countFieldValues(
      accumulator[field],
      present(predicted?.[field]),
      present(expected?.[field]),
    );
  }

  countFieldValues(
    accumulator.cuisine,
    predicted?.cuisine.map((value) => value.toLowerCase()) ?? [],
    expected?.cuisine.map((value) => value.toLowerCase()) ?? [],
  );

  const predictedIngredients = predicted ? flatIngredients(predicted) : [];
  const expectedIngredients = expected ? flatIngredients(expected) : [];
  countFieldValues(
    accumulator.ingredientName,
    predictedIngredients.map(({ ingredient }) => ingredient),
    expectedIngredients.map(({ ingredient }) => ingredient),
  );
  countFieldValues(
    accumulator.ingredientQuantity,
    predictedIngredients.flatMap(({ amount }) => present(amount)),
    expectedIngredients.flatMap(({ amount }) => present(amount)),
  );
  countFieldValues(
    accumulator.ingredientUnit,
    predictedIngredients.flatMap(({ unit }) => present(unit)),
    expectedIngredients.flatMap(({ unit }) => present(unit)),
  );
  countFieldValues(
    accumulator.instructionText,
    predicted?.instructions.map(normalizedInstruction) ?? [],
    expected?.instructions.map(normalizedInstruction) ?? [],
  );
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

export function finalizeFieldMetrics(
  accumulator: FieldMetricAccumulator,
): Record<FieldName, CountMetric> {
  return Object.fromEntries(
    FIELD_NAMES.map((field) => {
      const counts = accumulator[field];
      return [
        field,
        {
          ...counts,
          precision: ratio(
            counts.truePositives,
            counts.truePositives + counts.falsePositives,
          ),
          recall: ratio(
            counts.truePositives,
            counts.truePositives + counts.falseNegatives,
          ),
        },
      ];
    }),
  ) as Record<FieldName, CountMetric>;
}

type FailureContext = Omit<Failure, "category" | "field" | "expected" | "actual">;

function failure(
  context: FailureContext,
  category: FailureCategory,
  details: Pick<Failure, "field" | "expected" | "actual"> = {},
): Failure {
  return { ...context, category, ...details };
}

function ingredientFields(recipe: Recipe) {
  return flatIngredients(recipe).map(({ ingredient, amount, unit }) => ({
    ingredient,
    amount,
    unit,
  }));
}

export type FailureClassificationInput = {
  context: FailureContext;
  expectedStatus: "success" | "no-recipe";
  extractionSucceeded: boolean;
  predicted: Recipe | null;
  expected: Recipe | null;
  unmatchedOntologyTerms: string[];
};

function scalarFailures(
  input: FailureClassificationInput,
  predicted: Recipe,
  expected: Recipe,
): Failure[] {
  const failures: Failure[] = [];
  for (const field of [
    "title",
    "description",
    "cuisine",
    "servings",
    "prepTime",
    "cookTime",
  ] as const) {
    if (!isDeepStrictEqual(predicted[field], expected[field])) {
      failures.push(
        failure(input.context, "scalar-field-mismatch", {
          field,
          expected: expected[field],
          actual: predicted[field],
        }),
      );
    }
  }
  return failures;
}

function ingredientFailures(
  input: FailureClassificationInput,
  predicted: Recipe,
  expected: Recipe,
): Failure[] {
  const predictedIngredients = ingredientFields(predicted);
  const expectedIngredients = ingredientFields(expected);
  const comparisons = [
    [
      "ingredient-name-mismatch",
      "ingredient",
      predictedIngredients.map(({ ingredient }) => ingredient),
      expectedIngredients.map(({ ingredient }) => ingredient),
    ],
    [
      "quantity-mismatch",
      "amount",
      predictedIngredients.map(({ amount }) => amount),
      expectedIngredients.map(({ amount }) => amount),
    ],
    [
      "unit-mismatch",
      "unit",
      predictedIngredients.map(({ unit }) => unit),
      expectedIngredients.map(({ unit }) => unit),
    ],
  ] as const;
  return comparisons.flatMap(([category, field, actual, expectedValue]) =>
    isDeepStrictEqual(actual, expectedValue)
      ? []
      : [
          failure(input.context, category, {
            field,
            expected: expectedValue,
            actual,
          }),
        ],
  );
}

function instructionFailures(
  input: FailureClassificationInput,
  predicted: Recipe,
  expected: Recipe,
): Failure[] {
  const failures: Failure[] = [];
  if (predicted.instructions.length !== expected.instructions.length) {
    failures.push(
      failure(input.context, "step-segmentation-mismatch", {
        field: "instructions.length",
        expected: expected.instructions.length,
        actual: predicted.instructions.length,
      }),
    );
  }
  if (!isDeepStrictEqual(predicted.instructions, expected.instructions)) {
    failures.push(
      failure(input.context, "step-content-mismatch", {
        field: "instructions",
        expected: expected.instructions,
        actual: predicted.instructions,
      }),
    );
  }
  return failures;
}

export function classifyFailures(input: FailureClassificationInput): Failure[] {
  const failures: Failure[] = [];
  if (input.expectedStatus === "no-recipe") {
    if (input.extractionSucceeded) {
      failures.push(
        failure(input.context, "extraction-unexpected-recipe", {
          actual: input.predicted?.title ?? "extracted",
        }),
      );
    }
    return failures;
  }

  if (!input.extractionSucceeded) {
    return [failure(input.context, "extraction-missed-recipe")];
  }
  if (!input.predicted || !input.expected) {
    return [failure(input.context, "normalization-failed")];
  }

  failures.push(
    ...scalarFailures(input, input.predicted, input.expected),
    ...ingredientFailures(input, input.predicted, input.expected),
    ...instructionFailures(input, input.predicted, input.expected),
    ...input.unmatchedOntologyTerms.map((term) =>
      failure(input.context, "ontology-unmatched", {
        field: "ingredient",
        actual: term,
      }),
    ),
  );
  return failures;
}

const NON_USABLE_FAILURES = new Set<FailureCategory>([
  "extraction-missed-recipe",
  "normalization-failed",
  "scalar-field-mismatch",
  "ingredient-name-mismatch",
  "quantity-mismatch",
  "unit-mismatch",
  "step-content-mismatch",
  "step-segmentation-mismatch",
]);

export function isUsableImport(failures: Failure[]): boolean {
  return failures.every(({ category }) => !NON_USABLE_FAILURES.has(category));
}
