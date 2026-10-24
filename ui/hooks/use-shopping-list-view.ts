import { useMemo, useState } from "react";
import {
  useKitchenStockActions,
  useKitchenStockQuery,
} from "@/hooks/use-kitchen-stock";
import { useShoppingList } from "@/hooks/use-shopping-list";
import { useUnitPreference } from "@/hooks/use-unit-preference";
import { captureRecipeValue } from "@/lib/analytics/recipe-product";
import type { ShoppingRecipe } from "@/lib/api/shopping";
import type { KitchenLocation } from "@/lib/domain/recipe/kitchen";
import {
  aggregateShoppingList,
  type SelectedRecipe,
  type ShoppingLine,
} from "@/lib/domain/shopping/aggregate";
import { aisleName, compareAisles } from "@/lib/domain/shopping/aisles";
import { formatShoppingName } from "@/lib/domain/shopping/display";
import {
  markShoppingTripCompleted,
  toggleChecked,
  toggleExtra,
} from "@/lib/shopping/shoppingListStore";

export type ShoppingListView = "aisle" | "recipe" | "flat";

function byName(left: ShoppingLine, right: ShoppingLine): number {
  return left.name.localeCompare(right.name);
}

function doneLast(
  lines: ShoppingLine[],
  isDone: (line: ShoppingLine) => boolean,
): ShoppingLine[] {
  return [
    ...lines.filter((line) => !isDone(line)),
    ...lines.filter((line) => isDone(line)),
  ];
}

export function useShoppingListView(recipes: ShoppingRecipe[]) {
  const state = useShoppingList();
  const pantry = useKitchenStockQuery();
  const stock = pantry.data?.stock ?? {};
  const stockActions = useKitchenStockActions();
  const [system] = useUnitPreference();
  const [view, setView] = useState<ShoppingListView>("flat");

  const bySlug = useMemo(() => {
    const map = new Map<string, ShoppingRecipe>();
    for (const recipe of recipes) map.set(recipe.slug, recipe);
    return map;
  }, [recipes]);

  const selected = useMemo<SelectedRecipe[]>(() => {
    return state.recipes.flatMap((entry) => {
      const recipe = bySlug.get(entry.slug);
      if (!recipe) return [];
      const servings = entry.servings ?? recipe.servings;
      return [{ recipe, scale: servings / recipe.servings }];
    });
  }, [state.recipes, bySlug]);
  const aggregated = useMemo(() => aggregateShoppingList(selected), [selected]);
  const checkedSet = useMemo(() => new Set(state.checked), [state.checked]);

  const locationOf = (line: ShoppingLine): KitchenLocation | undefined =>
    stock[line.ingredient];
  const inKitchen = (line: ShoppingLine): boolean =>
    Boolean(stock[line.ingredient]);
  const groupLines = (lines: ShoppingLine[]): ShoppingLine[] =>
    doneLast(
      lines.filter((line) => !inKitchen(line)),
      (line) => checkedSet.has(line.ingredient),
    );

  const flatLines = useMemo(() => [...aggregated].sort(byName), [aggregated]);
  const flatItems = useMemo(() => {
    const items = [
      ...flatLines
        .filter((line) => !stock[line.ingredient])
        .map((line) => ({
          kind: "ingredient" as const,
          id: line.ingredient,
          name: formatShoppingName(line),
          checked: checkedSet.has(line.ingredient),
          line,
        })),
      ...state.extras.map((extra) => ({
        kind: "extra" as const,
        id: extra.id,
        name: extra.text,
        checked: extra.checked,
        extra,
      })),
    ].sort((left, right) => left.name.localeCompare(right.name));
    return [
      ...items.filter((item) => !item.checked),
      ...items.filter((item) => item.checked),
    ];
  }, [flatLines, checkedSet, state.extras, stock]);

  const haveLines = useMemo(
    () => aggregated.filter((line) => stock[line.ingredient]).sort(byName),
    [aggregated, stock],
  );
  const aisleGroups = useMemo(() => {
    const groups = new Map<string, ShoppingLine[]>();
    for (const line of aggregated) {
      const list = groups.get(line.aisle) ?? [];
      list.push(line);
      groups.set(line.aisle, list);
    }
    return [...groups.entries()]
      .sort(([left], [right]) => compareAisles(left, right))
      .map(([id, lines]) => ({
        id,
        name: aisleName(id),
        lines: [...lines].sort(byName),
      }));
  }, [aggregated]);
  const recipeGroups = useMemo(
    () =>
      selected.map(({ recipe, scale }) => {
        const lines = aggregateShoppingList([{ recipe, scale }]);
        lines.sort(byName);
        return {
          recipe,
          servings: Math.round(recipe.servings * scale),
          lines,
        };
      }),
    [selected],
  );

  const tickedCount =
    aggregated.filter((line) => checkedSet.has(line.ingredient)).length +
    state.extras.filter((extra) => extra.checked).length;
  const itemCount = aggregated.length + state.extras.length;
  const handledItemCount =
    aggregated.filter(
      (line) => inKitchen(line) || checkedSet.has(line.ingredient),
    ).length + state.extras.filter((extra) => extra.checked).length;

  async function recordCompletedShop(itemWillBeChecked: boolean) {
    if (
      itemWillBeChecked &&
      itemCount > 0 &&
      handledItemCount + 1 === itemCount &&
      (await markShoppingTripCompleted())
    ) {
      captureRecipeValue("shopping_trip_completed", {
        item_count: itemCount,
        recipe_count: selected.length,
      });
    }
  }

  function handleIngredientToggle(line: ShoppingLine) {
    const itemWillBeChecked = !checkedSet.has(line.ingredient);
    toggleChecked(line.ingredient);
    void recordCompletedShop(itemWillBeChecked);
  }

  function handleExtraToggle(id: string, checked: boolean) {
    toggleExtra(id);
    void recordCompletedShop(!checked);
  }

  const servingCount = recipeGroups.reduce(
    (total, group) => total + group.servings,
    0,
  );
  const recipeLabel = selected.length === 1 ? "recipe" : "recipes";
  const servingLabel = servingCount === 1 ? "serving" : "servings";
  const stats = [
    selected.length > 0 ? `${selected.length} ${recipeLabel}` : null,
    selected.length > 0 ? `${servingCount} ${servingLabel}` : null,
    `${itemCount} ${itemCount === 1 ? "item" : "items"}`,
    haveLines.length > 0 ? `${haveLines.length} in kitchen` : null,
    `${tickedCount} ticked`,
  ]
    .filter(Boolean)
    .join(" · ");

  const aisleSections = aisleGroups
    .map((group) => {
      const lines = groupLines(group.lines);
      const done =
        lines.length > 0 &&
        lines.every((line) => checkedSet.has(line.ingredient));
      return { group, lines, done };
    })
    .filter((section) => section.lines.length > 0);
  const orderedAisleSections = [
    ...aisleSections.filter((section) => !section.done),
    ...aisleSections.filter((section) => section.done),
  ];

  return {
    checkedSet,
    extras: state.extras,
    flatItems,
    groupLines,
    handleExtraToggle,
    handleIngredientToggle,
    hasTicked: tickedCount > 0,
    haveLines,
    locationOf,
    orderedAisleSections,
    pantry,
    recipeGroups,
    selected,
    setView,
    stats,
    stockActions,
    system,
    view,
  };
}
