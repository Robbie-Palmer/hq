import type { IngredientSlug } from "./ingredient";
import type { RecipeIngredient } from "./recipe";

export type IngredientGroupAccumulator = {
  name: string | undefined;
  items: RecipeIngredient[];
  itemIndexByIngredient: Map<IngredientSlug, number>;
};

export function createIngredientGroupAccumulator(
  name?: string,
): IngredientGroupAccumulator {
  return {
    name,
    items: [],
    itemIndexByIngredient: new Map(),
  };
}

function duplicateIngredientConflict(
  group: IngredientGroupAccumulator,
  nextItem: RecipeIngredient,
  reason: string,
): never {
  throw new Error(
    `Conflicting duplicate ingredient "${nextItem.ingredient}" in group "${group.name ?? "unnamed"}": ${reason}`,
  );
}

function assertMatchingAnnotations(
  group: IngredientGroupAccumulator,
  existing: RecipeIngredient,
  nextItem: RecipeIngredient,
): void {
  if (existing.preparation !== nextItem.preparation) {
    duplicateIngredientConflict(
      group,
      nextItem,
      "preparation annotations differ",
    );
  }
  if (existing.note !== nextItem.note) {
    duplicateIngredientConflict(group, nextItem, "notes differ");
  }
}

function mergeIntoUnquantifiedIngredient(
  group: IngredientGroupAccumulator,
  existing: RecipeIngredient,
  nextItem: RecipeIngredient,
): void {
  if (nextItem.amount === undefined) {
    if (existing.unit !== nextItem.unit) {
      duplicateIngredientConflict(
        group,
        nextItem,
        "unit differs between unquantified duplicate entries",
      );
    }
    return;
  }
  if (
    existing.unit !== undefined &&
    nextItem.unit !== undefined &&
    existing.unit !== nextItem.unit
  ) {
    duplicateIngredientConflict(
      group,
      nextItem,
      "unit differs from the existing entry",
    );
  }
  existing.amount = nextItem.amount;
  if (nextItem.unit !== undefined) existing.unit = nextItem.unit;
}

function mergeIntoQuantifiedIngredient(
  group: IngredientGroupAccumulator,
  existing: RecipeIngredient,
  existingAmount: number,
  nextItem: RecipeIngredient,
): void {
  if (nextItem.amount === undefined) {
    if (nextItem.unit !== undefined && nextItem.unit !== existing.unit) {
      duplicateIngredientConflict(
        group,
        nextItem,
        "unit differs from the existing quantified entry",
      );
    }
    return;
  }
  if (existing.unit !== nextItem.unit) {
    duplicateIngredientConflict(group, nextItem, "units differ");
  }
  existing.amount = existingAmount + nextItem.amount;
}

/**
 * Merge an ingredient into a group accumulator, aggregating amounts when the
 * same ingredient slug appears more than once with a compatible unit.
 *
 * Throws on irreconcilable conflicts (e.g. different units with quantities,
 * different preparation annotations).
 */
export function mergeIngredientIntoGroup(
  group: IngredientGroupAccumulator,
  nextItem: RecipeIngredient,
): void {
  const existingIndex = group.itemIndexByIngredient.get(nextItem.ingredient);
  if (existingIndex === undefined) {
    group.items.push({ ...nextItem });
    group.itemIndexByIngredient.set(
      nextItem.ingredient,
      group.items.length - 1,
    );
    return;
  }

  const existing = group.items[existingIndex]!;
  assertMatchingAnnotations(group, existing, nextItem);

  // Repeated inline tags for the same ingredient within a group are allowed
  // when they reinforce the same ingredient or contribute an additional
  // compatible quantity we can safely sum.
  if (existing.amount === undefined) {
    mergeIntoUnquantifiedIngredient(group, existing, nextItem);
  } else {
    mergeIntoQuantifiedIngredient(group, existing, existing.amount, nextItem);
  }
}
