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

/**
 * Merge an ingredient into a group accumulator, aggregating amounts when the
 * same ingredient slug appears more than once with a compatible unit.
 *
 * Throws on irreconcilable conflicts (e.g. different units with quantities,
 * different preparation annotations).
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
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
  const duplicateConflict = (reason: string): never => {
    throw new Error(
      `Conflicting duplicate ingredient "${nextItem.ingredient}" in group "${group.name ?? "unnamed"}": ${reason}`,
    );
  };

  if (existing.preparation !== nextItem.preparation) {
    duplicateConflict("preparation annotations differ");
  }

  if (existing.note !== nextItem.note) {
    duplicateConflict("notes differ");
  }

  // Repeated inline tags for the same ingredient within a group are allowed
  // when they reinforce the same ingredient or contribute an additional
  // compatible quantity we can safely sum.
  if (
    existing.unit === nextItem.unit &&
    existing.amount !== undefined &&
    nextItem.amount !== undefined
  ) {
    existing.amount += nextItem.amount;
    return;
  }

  if (existing.amount === undefined && nextItem.amount !== undefined) {
    if (
      existing.unit !== undefined &&
      nextItem.unit !== undefined &&
      existing.unit !== nextItem.unit
    ) {
      duplicateConflict("unit differs from the existing entry");
    }
    existing.amount = nextItem.amount;
    if (nextItem.unit !== undefined) {
      existing.unit = nextItem.unit;
    }
    return;
  }

  if (existing.amount !== undefined && nextItem.amount === undefined) {
    if (nextItem.unit !== undefined && nextItem.unit !== existing.unit) {
      duplicateConflict("unit differs from the existing quantified entry");
    }
    return;
  }

  if (existing.amount === undefined && nextItem.amount === undefined) {
    if (existing.unit !== nextItem.unit) {
      duplicateConflict("unit differs between unquantified duplicate entries");
    }
    return;
  }

  if (existing.unit !== nextItem.unit) {
    duplicateConflict("units differ");
  }

  duplicateConflict("duplicate quantities could not be merged safely");
}
