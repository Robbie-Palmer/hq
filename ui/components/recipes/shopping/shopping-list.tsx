"use client";

import {
  ArrowRight,
  Layers,
  Plus,
  Refrigerator,
  RotateCcw,
  ShoppingBasket,
  Sprout,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { ShoppingCheckbox } from "@/components/recipes/shopping/shopping-checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  useKitchenStockActions,
  useKitchenStockQuery,
} from "@/hooks/use-kitchen-stock";
import { useShoppingList } from "@/hooks/use-shopping-list";
import { useUnitPreference } from "@/hooks/use-unit-preference";
import { captureRecipeValue } from "@/lib/analytics/recipe-product";
import type { ShoppingRecipe } from "@/lib/api/shopping";
import type { MeasurementPreference } from "@/lib/domain/recipe";
import type { IngredientSlug } from "@/lib/domain/recipe/ingredient";
import type { KitchenLocation } from "@/lib/domain/recipe/kitchen";
import {
  aggregateShoppingList,
  type SelectedRecipe,
  type ShoppingLine,
} from "@/lib/domain/shopping/aggregate";
import { aisleName, compareAisles } from "@/lib/domain/shopping/aisles";
import {
  formatShoppingName,
  formatShoppingQuantities,
} from "@/lib/domain/shopping/display";
import {
  addExtra,
  clearChecked,
  markShoppingTripCompleted,
  removeExtra,
  toggleChecked,
  toggleExtra,
} from "@/lib/shopping/shoppingListStore";

type ListView = "aisle" | "recipe" | "flat";

const LOCATION_META: Record<
  KitchenLocation,
  { label: string; icon: typeof Refrigerator }
> = {
  fridge: { label: "fridge", icon: Refrigerator },
  cupboards: { label: "cupboards", icon: ShoppingBasket },
  fresh: { label: "fresh", icon: Sprout },
};

const VIEWS: { id: ListView; label: string }[] = [
  { id: "aisle", label: "by aisle" },
  { id: "recipe", label: "by recipe" },
  { id: "flat", label: "just ingredients" },
];

function byName(a: ShoppingLine, b: ShoppingLine): number {
  return a.name.localeCompare(b.name);
}

/**
 * Sink handled items (ticked off, or already in the kitchen) to the bottom of a
 * list (keeping each partition's existing order), like a notes app — so
 * attention stays on what's still to buy. Un-handling returns an item to its
 * sorted place.
 */
function doneLast(
  lines: ShoppingLine[],
  isDone: (line: ShoppingLine) => boolean,
): ShoppingLine[] {
  const todo = lines.filter((line) => !isDone(line));
  const done = lines.filter((line) => isDone(line));
  return [...todo, ...done];
}

/**
 * Marks a line whose quantity was summed across several recipes. The layers
 * icon + count reads as "combined from N recipes" (the old ↻ glyph looked like
 * a refresh control).
 */
function MergedBadge({ count }: Readonly<{ count: number }>) {
  return (
    <span
      className="ml-1.5 align-middle inline-flex items-center gap-0.5 rounded border border-[var(--butter)] bg-[var(--butter-soft)] px-1 py-px text-[0.625rem] text-[var(--ink-2)]"
      title={`Quantity combined from ${count} recipes`}
    >
      <Layers className="h-2.5 w-2.5" />
      {count}
    </span>
  );
}

/**
 * A line whose ingredient is already stocked in the kitchen. Distinct from a
 * manual tick: a sage location chip marks it as "have it, didn't buy it", and a
 * one-tap remove pulls it back out of the kitchen (the undo) if we don't
 * actually have it after all.
 */
function KitchenItemRow({
  line,
  system,
  location,
  checked,
  onRemoveFromStock,
}: Readonly<{
  line: ShoppingLine;
  system: MeasurementPreference;
  location: KitchenLocation;
  checked: boolean;
  onRemoveFromStock: (ingredientSlug: IngredientSlug) => void;
}>) {
  const quantity = formatShoppingQuantities(line.quantities, system);
  const name = formatShoppingName(line);
  const { label, icon: Icon } = LOCATION_META[location];
  const returnToList = () => {
    onRemoveFromStock(line.ingredient);
    // A tick from before the item entered the kitchen would bring it back
    // struck through — clear it so "put back on the list" means exactly that.
    if (checked) toggleChecked(line.ingredient);
  };
  return (
    <div className="w-full flex items-center gap-2.5 py-1.5 border-b border-dashed border-[var(--line)] last:border-0">
      <span
        className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-[3px] bg-[var(--sage)] text-white"
        aria-hidden="true"
      >
        <Icon className="h-2.5 w-2.5" />
      </span>
      <span className="rt-body flex-1 leading-snug text-[var(--ink-3)] line-through">
        {quantity && <b className="font-semibold">{quantity}</b>}
        {quantity ? " " : ""}
        {name}
        {line.recipes.length > 1 && <MergedBadge count={line.recipes.length} />}
      </span>
      <span className="rt-mono text-[var(--sage)] hidden sm:inline">
        in {label}
      </span>
      <button
        type="button"
        onClick={returnToList}
        aria-label={`Remove ${name} from the kitchen`}
        title="Not in the kitchen after all — put back on the list"
        className="inline-flex items-center gap-1 rt-mono text-[var(--ink-4)] hover:text-[var(--berry)] transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ItemRow({
  line,
  system,
  checked,
  kitchenLocation,
  onToggle,
  showRecipes,
  onRemoveFromStock,
}: Readonly<{
  line: ShoppingLine;
  system: MeasurementPreference;
  checked: boolean;
  kitchenLocation?: KitchenLocation;
  onToggle: (line: ShoppingLine) => void;
  showRecipes: boolean;
  onRemoveFromStock: (ingredientSlug: IngredientSlug) => void;
}>) {
  if (kitchenLocation) {
    return (
      <KitchenItemRow
        line={line}
        system={system}
        location={kitchenLocation}
        checked={checked}
        onRemoveFromStock={onRemoveFromStock}
      />
    );
  }

  const quantity = formatShoppingQuantities(line.quantities, system);
  const name = formatShoppingName(line);
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={() => onToggle(line)}
      className="w-full flex items-center gap-2.5 py-1.5 text-left border-b border-dashed border-[var(--line)] last:border-0"
    >
      <ShoppingCheckbox checked={checked} />
      <span
        className={[
          "rt-body flex-1 leading-snug",
          checked ? "line-through text-[var(--ink-3)]" : "text-[var(--ink)]",
        ].join(" ")}
      >
        {quantity && <b className="font-semibold">{quantity}</b>}
        {quantity ? " " : ""}
        {name}
        {line.recipes.length > 1 && <MergedBadge count={line.recipes.length} />}
      </span>
      {showRecipes && (
        <span className="rt-mono text-[var(--ink-4)] hidden sm:block max-w-[45%] truncate text-right">
          {line.recipes.map((r) => r.title).join(" · ")}
        </span>
      )}
    </button>
  );
}

function SectionHeading({
  title,
  hint,
  done = false,
}: Readonly<{ title: string; hint?: string; done?: boolean }>) {
  return (
    <div className="flex items-baseline justify-between border-b border-[var(--line)] pb-1 mt-5 first:mt-0">
      <h3
        className={[
          "rt-display text-2xl transition-colors",
          done
            ? "text-[var(--ink-3)] line-through"
            : "text-[var(--terracotta)]",
        ].join(" ")}
      >
        · {title}
      </h3>
      {hint && <span className="rt-mono text-[var(--ink-3)]">{hint}</span>}
    </div>
  );
}

function ExtrasSection({
  extras,
  onToggle,
  showItems = true,
}: Readonly<{
  extras: { id: string; text: string; checked: boolean }[];
  onToggle: (id: string, checked: boolean) => void;
  showItems?: boolean;
}>) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const submit = () => {
    addExtra(text);
    setText("");
    inputRef.current?.focus();
  };
  // Ticked extras sink to the bottom too, matching the ingredient rows.
  const ordered = [
    ...extras.filter((e) => !e.checked),
    ...extras.filter((e) => e.checked),
  ];
  return (
    <div className="mt-6">
      {showItems && <SectionHeading title="added items" />}
      {showItems && extras.length > 0 && (
        <div className="mt-1">
          {ordered.map((extra) => (
            <ExtraItemRow key={extra.id} extra={extra} onToggle={onToggle} />
          ))}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="mt-3 flex gap-2 max-w-sm"
      >
        <Input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add an item (milk, bread…)"
          aria-label="Add a shopping-list item"
          className="bg-[var(--card)]"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--line-strong)] px-3 text-sm text-[var(--ink-2)] hover:border-[var(--terracotta)] hover:text-[var(--terracotta)] disabled:opacity-40 transition-colors"
        >
          <Plus className="h-4 w-4" /> Add
        </button>
      </form>
    </div>
  );
}

function ExtraItemRow({
  extra,
  onToggle,
}: Readonly<{
  extra: { id: string; text: string; checked: boolean };
  onToggle: (id: string, checked: boolean) => void;
}>) {
  return (
    <div className="flex items-center gap-2.5 py-1.5 border-b border-dashed border-[var(--line)] last:border-0">
      <button
        type="button"
        aria-pressed={extra.checked}
        onClick={() => onToggle(extra.id, extra.checked)}
        className="flex items-center gap-2.5 flex-1 text-left"
      >
        <ShoppingCheckbox checked={extra.checked} />
        <span
          className={[
            "rt-body leading-snug",
            extra.checked
              ? "line-through text-[var(--ink-3)]"
              : "text-[var(--ink)]",
          ].join(" ")}
        >
          {extra.text}
        </span>
      </button>
      <button
        type="button"
        onClick={() => removeExtra(extra.id)}
        aria-label={`Remove ${extra.text}`}
        className="text-[var(--ink-4)] hover:text-[var(--berry)] transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
export function ShoppingList({
  recipes,
}: Readonly<{ recipes: ShoppingRecipe[] }>) {
  const state = useShoppingList();
  const pantry = useKitchenStockQuery();
  const stock = pantry.data?.stock ?? {};
  const stockActions = useKitchenStockActions();
  const [system] = useUnitPreference();
  const [view, setView] = useState<ListView>("aisle");

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

  // An ingredient already in the kitchen (any location) is pulled out of the
  // aisle/recipe groups and gathered into the "already have" section, so the
  // main list stays focused on what's still to buy. Ticked items just sink.
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
    ].sort((a, b) => a.name.localeCompare(b.name));

    return [
      ...items.filter((item) => !item.checked),
      ...items.filter((item) => item.checked),
    ];
  }, [flatLines, checkedSet, state.extras, stock]);

  const haveLines = useMemo(
    () => aggregated.filter((line) => stock[line.ingredient]).sort(byName),
    [aggregated, stock],
  );
  const inKitchenCount = haveLines.length;

  const aisleGroups = useMemo(() => {
    const groups = new Map<string, ShoppingLine[]>();
    for (const line of aggregated) {
      const list = groups.get(line.aisle) ?? [];
      list.push(line);
      groups.set(line.aisle, list);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => compareAisles(a, b))
      .map(([id, lines]) => ({
        id,
        name: aisleName(id),
        lines: [...lines].sort(byName),
      }));
  }, [aggregated]);

  const recipeGroups = useMemo(() => {
    return selected.map(({ recipe, scale }) => {
      const lines = aggregateShoppingList([{ recipe, scale }]);
      lines.sort(byName);
      return {
        recipe,
        servings: Math.round(recipe.servings * scale),
        lines,
      };
    });
  }, [selected]);

  const tickedCount =
    aggregated.filter((l) => checkedSet.has(l.ingredient)).length +
    state.extras.filter((e) => e.checked).length;
  const itemCount = aggregated.length + state.extras.length;
  const handledItemCount =
    aggregated.filter(
      (line) => inKitchen(line) || checkedSet.has(line.ingredient),
    ).length + state.extras.filter((extra) => extra.checked).length;
  const recordCompletedShop = async (itemWillBeChecked: boolean) => {
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
  };
  const handleIngredientToggle = (line: ShoppingLine) => {
    const itemWillBeChecked = !checkedSet.has(line.ingredient);
    toggleChecked(line.ingredient);
    void recordCompletedShop(itemWillBeChecked);
  };
  const handleExtraToggle = (id: string, checked: boolean) => {
    toggleExtra(id);
    void recordCompletedShop(!checked);
  };

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
    inKitchenCount > 0 ? `${inKitchenCount} in kitchen` : null,
    `${tickedCount} ticked`,
  ]
    .filter(Boolean)
    .join(" · ");
  const hasTicked = tickedCount > 0;

  // In aisle view, once every (still-to-buy) item in a section is ticked off,
  // the whole section is done: its header gets struck through and the section
  // sinks below the aisles that still have shopping left, keeping attention on
  // what remains. Ordering is stable within each partition.
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

  if (selected.length === 0 && state.extras.length === 0) {
    return (
      <div className="rounded-xl border-[1.25px] border-dashed border-[var(--line-strong)] bg-[var(--card)] p-6 sm:p-10">
        <div className="text-center">
          <p className="rt-display text-3xl text-[var(--ink-2)]">
            Nothing on the list yet
          </p>
          <p className="rt-body text-[var(--ink-3)] mt-2">
            Add anything you need below. Recipes can add their ingredients too,
            whenever you want them.
          </p>
        </div>
        <div className="flex justify-center">
          <ExtrasSection
            extras={state.extras}
            onToggle={handleExtraToggle}
            showItems={false}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border-[1.25px] border-[var(--line-strong)] bg-[var(--card)] p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="rt-mono text-[var(--ink-3)]">{stats}</p>
        <div className="flex flex-wrap gap-1.5">
          {VIEWS.map((v) => (
            <Badge
              key={v.id}
              variant={view === v.id ? "default" : "secondary"}
              interactive
              active={view === v.id}
              className="cursor-pointer"
              onClick={() => setView(v.id)}
            >
              {v.label}
            </Badge>
          ))}
        </div>
      </div>

      {pantry.isPending && (
        <output className="rt-body mt-3 block rounded-md border border-[var(--line)] bg-[var(--paper-warm)] px-3 py-2 text-sm text-[var(--ink-3)]">
          Checking your pantry before sorting the shopping list…
        </output>
      )}

      {pantry.error && !pantry.data && (
        <p
          className="rt-body mt-3 rounded-md border border-[var(--berry)]/35 bg-[var(--berry)]/8 px-3 py-2 text-sm text-[var(--berry)]"
          role="alert"
        >
          Your pantry could not be loaded, so this is the full shopping list
          without kitchen filtering.
        </p>
      )}

      {stockActions.error && (
        <p
          className="rt-body mt-3 rounded-md border border-[var(--berry)]/35 bg-[var(--berry)]/8 px-3 py-2 text-sm text-[var(--berry)]"
          role="alert"
        >
          That pantry change was not saved, so the ingredient was restored. Try
          again or refresh the page.
        </p>
      )}

      {hasTicked && (
        <button
          type="button"
          onClick={clearChecked}
          className="mt-2 inline-flex items-center gap-1 rt-mono text-[var(--ink-3)] hover:text-[var(--terracotta)] transition-colors"
        >
          <RotateCcw className="h-3 w-3" /> uncheck all
        </button>
      )}

      <div
        className={`mt-3 ${pantry.isPending ? "pointer-events-none opacity-50" : ""}`}
        aria-busy={pantry.isPending}
        inert={pantry.isPending ? true : undefined}
      >
        {view === "flat" && (
          <div>
            <div className="rt-mono text-[var(--ink-3)] mb-1">
              Just ingredients · A–Z
            </div>
            {flatItems.map((item) =>
              item.kind === "ingredient" ? (
                <ItemRow
                  key={item.id}
                  line={item.line}
                  system={system}
                  checked={item.checked}
                  kitchenLocation={locationOf(item.line)}
                  onToggle={handleIngredientToggle}
                  showRecipes
                  onRemoveFromStock={stockActions.removeFromStock}
                />
              ) : (
                <ExtraItemRow
                  key={item.id}
                  extra={item.extra}
                  onToggle={handleExtraToggle}
                />
              ),
            )}
          </div>
        )}

        {view === "aisle" &&
          orderedAisleSections.map(({ group, lines, done }) => (
            <div key={group.id}>
              <SectionHeading title={group.name} done={done} />
              <div className="mt-1">
                {lines.map((line) => (
                  <ItemRow
                    key={line.ingredient}
                    line={line}
                    system={system}
                    checked={checkedSet.has(line.ingredient)}
                    kitchenLocation={locationOf(line)}
                    onToggle={handleIngredientToggle}
                    showRecipes
                    onRemoveFromStock={stockActions.removeFromStock}
                  />
                ))}
              </div>
            </div>
          ))}

        {view === "recipe" &&
          recipeGroups.map((group) => {
            const lines = groupLines(group.lines);
            if (lines.length === 0) return null;
            return (
              <div key={group.recipe.slug}>
                <SectionHeading
                  title={group.recipe.title}
                  hint={`${group.servings} ${group.servings === 1 ? "serving" : "servings"}`}
                />
                <div className="mt-1">
                  {lines.map((line) => (
                    <ItemRow
                      key={line.ingredient}
                      line={line}
                      system={system}
                      checked={checkedSet.has(line.ingredient)}
                      kitchenLocation={locationOf(line)}
                      onToggle={handleIngredientToggle}
                      showRecipes={false}
                      onRemoveFromStock={stockActions.removeFromStock}
                    />
                  ))}
                </div>
              </div>
            );
          })}
      </div>

      {pantry.error && pantry.data && (
        <p
          className="rt-body mt-4 rounded-md border border-[var(--berry)]/35 bg-[var(--berry)]/8 px-3 py-2 text-sm text-[var(--berry)]"
          role="alert"
        >
          Your pantry could not be refreshed. This list is using the last pantry
          data that loaded.
        </p>
      )}

      {haveLines.length > 0 && (
        <div className="mt-6">
          <div className="mt-5 flex items-baseline justify-between border-b border-[var(--line)] pb-1">
            <h3 className="rt-display text-2xl text-[var(--terracotta)]">
              · already have
            </h3>
            <Link
              href="/recipes/kitchen"
              className="inline-flex items-center gap-1 rt-mono text-[var(--ink-3)] transition-colors hover:text-[var(--terracotta)]"
            >
              {haveLines.length} in the kitchen
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <p className="rt-body mt-1 text-sm text-[var(--ink-3)]">
            Skipped because they're in your kitchen. Tap ✕ to put one back on
            the list if you don't actually have it.
          </p>
          <div className="mt-1">
            {haveLines.map((line) => (
              <ItemRow
                key={line.ingredient}
                line={line}
                system={system}
                checked={checkedSet.has(line.ingredient)}
                kitchenLocation={locationOf(line)}
                onToggle={handleIngredientToggle}
                showRecipes={false}
                onRemoveFromStock={stockActions.removeFromStock}
              />
            ))}
          </div>
        </div>
      )}

      <ExtrasSection
        extras={state.extras}
        onToggle={handleExtraToggle}
        showItems={view !== "flat"}
      />
    </div>
  );
}
