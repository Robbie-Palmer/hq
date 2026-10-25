import type { ShoppingListContents } from "@/lib/api/shopping-lists";

function mergeKeyedValues<T>(
  baseline: T[],
  local: T[],
  remote: T[],
  keyFor: (value: T) => string,
): T[] {
  const baselineByKey = new Map(
    baseline.map((value) => [keyFor(value), value]),
  );
  const localByKey = new Map(local.map((value) => [keyFor(value), value]));
  const merged = new Map(remote.map((value) => [keyFor(value), value]));
  for (const value of baseline) {
    const key = keyFor(value);
    if (!localByKey.has(key)) merged.delete(key);
  }
  for (const value of local) {
    const key = keyFor(value);
    if (JSON.stringify(value) !== JSON.stringify(baselineByKey.get(key))) {
      merged.set(key, value);
    }
  }
  return [...merged.values()];
}

function mergeCheckedValues(
  baseline: string[],
  local: string[],
  remote: string[],
): string[] {
  const localValues = new Set(local);
  const baselineValues = new Set(baseline);
  const merged = new Set(remote);
  for (const value of baseline) {
    if (!localValues.has(value)) merged.delete(value);
  }
  for (const value of local) {
    if (!baselineValues.has(value)) merged.add(value);
  }
  return [...merged];
}

export function mergeLocalShoppingListChanges(
  baseline: ShoppingListContents,
  local: ShoppingListContents,
  remote: ShoppingListContents,
): ShoppingListContents {
  return {
    recipes: mergeKeyedValues(
      baseline.recipes,
      local.recipes,
      remote.recipes,
      (recipe) => recipe.slug,
    ),
    checked: mergeCheckedValues(
      baseline.checked,
      local.checked,
      remote.checked,
    ),
    extras: mergeKeyedValues(
      baseline.extras,
      local.extras,
      remote.extras,
      (extra) => extra.id,
    ),
    plan: mergeKeyedValues(
      baseline.plan,
      local.plan,
      remote.plan,
      (meal) => meal.id,
    ),
  };
}
