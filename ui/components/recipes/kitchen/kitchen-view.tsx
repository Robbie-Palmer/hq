"use client";

import {
  CirclePlus,
  Pencil,
  Refrigerator,
  Search,
  ShoppingBasket,
  Snowflake,
  Sprout,
  Trash2,
  TriangleAlert,
  Undo2,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { DietListNotice } from "@/components/recipes/diet-notice";
import { useDiet } from "@/components/recipes/diet-provider";
import { EquipmentListNotice } from "@/components/recipes/equipment-readiness-notice";
import { useEquipmentReadiness } from "@/components/recipes/equipment-readiness-provider";
import { RecipeMatchCard } from "@/components/recipes/recipe-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  useKitchenStockActions,
  useKitchenStockQuery,
} from "@/hooks/use-kitchen-stock";
import { useShoppingList } from "@/hooks/use-shopping-list";
import type { UnresolvedAuthoredTerm } from "@/lib/api/authored-terms";
import {
  applyDietRecipeVisibility,
  buildDietRecipeMatches,
} from "@/lib/domain/diet";
import {
  applyEquipmentRecipeVisibility,
  buildEquipmentRecipeMatches,
} from "@/lib/domain/equipment-readiness";
import type { IngredientSlug } from "@/lib/domain/recipe/ingredient";
import {
  getDietRelevantKitchenIngredients,
  getKitchenRecipeMatches,
  KITCHEN_LOCATIONS,
  type KitchenIngredientView,
  type KitchenItemDetails,
  type KitchenLocation,
  type KitchenRecipeView,
  type KitchenStock,
} from "@/lib/domain/recipe/kitchen";
import { cn } from "@/lib/generic/styles";
import { toggleRecipe } from "@/lib/shopping/shoppingListStore";

const CATALOG_RESULT_LIMIT = 18;

const LOCATION_ICONS = {
  fridge: Refrigerator,
  freezer: Snowflake,
  cupboards: ShoppingBasket,
  fresh: Sprout,
} satisfies Record<KitchenLocation, typeof Refrigerator>;

function normalizeQuery(value: string) {
  return value.trim().toLowerCase();
}

function LocationIcon({ location }: Readonly<{ location: KitchenLocation }>) {
  const Icon = LOCATION_ICONS[location];
  return <Icon className="size-4" />;
}

const FRESHNESS_LABELS = {
  fresh: "Fresh",
  use_soon: "Use soon",
  past_best_before: "Past best before",
  unknown: "Not recorded",
} as const;

function defaultItemDetails(location: KitchenLocation): KitchenItemDetails {
  return {
    location,
    quantity: null,
    freshness: "unknown",
    source: {
      kind: "user",
      confidence: 1,
      provenance: "Manual kitchen update",
    },
  };
}

function KitchenItemEditor({
  ingredient,
  item,
  onCancel,
  onSave,
}: Readonly<{
  ingredient: KitchenIngredientView;
  item: KitchenItemDetails;
  onCancel: () => void;
  onSave: (
    item: Pick<KitchenItemDetails, "location" | "quantity" | "freshness">,
  ) => void;
}>) {
  const [location, setLocation] = useState(item.location);
  const [amount, setAmount] = useState(
    item.quantity ? String(item.quantity.amount) : "",
  );
  const [unit, setUnit] = useState(item.quantity?.unit ?? "");
  const [freshness, setFreshness] = useState(item.freshness);
  const parsedAmount = Number(amount);
  const quantityIsValid =
    amount === "" ||
    (Number.isFinite(parsedAmount) &&
      parsedAmount > 0 &&
      unit.trim().length > 0);

  return (
    <form
      className="grid gap-3 rounded-md border border-[var(--line-strong)] bg-[var(--paper)] p-3 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!quantityIsValid) return;
        onSave({
          location,
          quantity:
            amount === "" ? null : { amount: parsedAmount, unit: unit.trim() },
          freshness,
        });
      }}
    >
      <p className="rt-body font-medium text-[var(--ink)] sm:col-span-2">
        Correct {ingredient.name}
      </p>
      <label className="rt-body grid gap-1 text-sm text-[var(--ink-2)]">
        Location
        <select
          value={location}
          onChange={(event) =>
            setLocation(event.target.value as KitchenLocation)
          }
          className="h-10 rounded-md border border-[var(--line-strong)] bg-[var(--card)] px-3"
        >
          {KITCHEN_LOCATIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="rt-body grid gap-1 text-sm text-[var(--ink-2)]">
        Freshness
        <select
          value={freshness}
          onChange={(event) =>
            setFreshness(event.target.value as KitchenItemDetails["freshness"])
          }
          className="h-10 rounded-md border border-[var(--line-strong)] bg-[var(--card)] px-3"
        >
          {Object.entries(FRESHNESS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label
        htmlFor="kitchen-item-quantity"
        className="rt-body grid gap-1 text-sm text-[var(--ink-2)]"
      >
        Quantity
        <Input
          id="kitchen-item-quantity"
          inputMode="decimal"
          min="0"
          step="any"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="Optional"
        />
      </label>
      <label
        htmlFor="kitchen-item-unit"
        className="rt-body grid gap-1 text-sm text-[var(--ink-2)]"
      >
        Unit
        <Input
          id="kitchen-item-unit"
          maxLength={32}
          value={unit}
          onChange={(event) => setUnit(event.target.value)}
          placeholder="g, ml, tins..."
        />
      </label>
      {!quantityIsValid && (
        <p
          role="alert"
          className="rt-body text-sm text-[var(--berry)] sm:col-span-2"
        >
          Enter a positive quantity and a unit, or leave both blank.
        </p>
      )}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!quantityIsValid}>
          Save correction
        </Button>
      </div>
    </form>
  );
}

function canSaveCustomIngredient(
  rawText: string,
  ingredients: KitchenIngredientView[],
  stock: KitchenStock,
): boolean {
  const normalized = normalizeQuery(rawText);
  return (
    normalized.length > 0 &&
    !ingredients.some(
      (ingredient) =>
        normalizeQuery(ingredient.name) === normalized ||
        normalizeQuery(ingredient.slug) === normalized,
    ) &&
    !Object.keys(stock).some((slug) => normalizeQuery(slug) === normalized)
  );
}

function UnresolvedStockSection({
  terms,
  onRemove,
}: Readonly<{
  terms: UnresolvedAuthoredTerm[];
  onRemove: (slug: IngredientSlug) => void;
}>) {
  if (terms.length === 0) return null;
  return (
    <section className="rounded-lg border border-dashed border-[var(--line-strong)] bg-[var(--paper-warm)] p-3">
      <p className="rt-mono text-[var(--terracotta)]">Saved as written</p>
      <p className="rt-body mt-1 text-sm text-[var(--ink-3)]">
        These items stay in your pantry, but recipe matching and nutrition
        remain unavailable until each term is linked to the ingredient catalog.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {terms.map((term) => (
          <Badge
            key={term.id}
            variant="outline"
            className="gap-1.5 bg-[var(--card)]"
          >
            <span>{term.rawText}</span>
            <button
              type="button"
              onClick={() => onRemove(term.normalizedText as IngredientSlug)}
              aria-label={`Remove ${term.rawText}`}
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}
      </div>
    </section>
  );
}

function KitchenCatalogFooter({
  canAddCustom,
  customIngredient,
  filteredCount,
  matchCount,
  onAddCustom,
}: Readonly<{
  canAddCustom: boolean;
  customIngredient: string;
  filteredCount: number;
  matchCount: number;
  onAddCustom: () => void;
}>) {
  return (
    <>
      {canAddCustom && (
        <>
          <Button
            type="button"
            variant="outline"
            onClick={onAddCustom}
            className="mt-3 h-auto w-full max-w-full justify-start whitespace-normal text-left sm:w-auto"
          >
            <CirclePlus className="size-4" />
            <span className="min-w-0 break-words">
              Save "{customIngredient}" as written
            </span>
          </Button>
          <p className="rt-body mt-2 text-sm text-[var(--ink-3)]">
            It will stay in your pantry, but recipe matching and nutrition will
            ignore it until it is linked to the ingredient catalog.
          </p>
        </>
      )}
      {matchCount > filteredCount && (
        <p className="rt-body mt-3 text-sm text-[var(--ink-3)]">
          Showing {filteredCount} of {matchCount} matching ingredients.
        </p>
      )}
      {filteredCount === 0 && (
        <p className="rt-body text-sm text-[var(--ink-3)]">
          No matching ingredients left to add.
        </p>
      )}
    </>
  );
}

function KitchenHeader({
  householdName,
}: Readonly<{ householdName: string | null }>) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="rt-mono text-[var(--terracotta)]">
          Kitchen · stock match
        </p>
        <h1 className="rt-display mt-2 text-5xl sm:text-6xl lg:text-7xl">
          What can I <span className="text-[var(--terracotta)]">make?</span>
        </h1>
        <p className="rt-body mt-3 max-w-2xl text-[var(--ink-2)]">
          Add ingredients from the recipe catalog or save your own wording,
          split them across fridge, cupboards and fresh, then compare{" "}
          {householdName ? `${householdName}'s shared kitchen` : "your kitchen"}{" "}
          against the recipe box.
        </p>
      </div>
    </div>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
export function KitchenView({
  ingredients,
  recipes,
}: Readonly<{
  ingredients: KitchenIngredientView[];
  recipes: KitchenRecipeView[];
}>) {
  const { diet, matchRecipe } = useDiet();
  const { equipment } = useEquipmentReadiness();
  const [showHidden, setShowHidden] = useState(false);
  const [showEquipmentHidden, setShowEquipmentHidden] = useState(false);
  const [showDietExcludedIngredients, setShowDietExcludedIngredients] =
    useState(false);
  const ingredientBySlug = useMemo(
    () =>
      new Map(ingredients.map((ingredient) => [ingredient.slug, ingredient])),
    [ingredients],
  );
  const knownIngredientSlugs = useMemo(
    () => new Set<string>(ingredients.map((ingredient) => ingredient.slug)),
    [ingredients],
  );
  const pantry = useKitchenStockQuery();
  const stock = pantry.data?.stock ?? {};
  const pantryItems = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(stock).map(([slug, location]) => [
          slug,
          pantry.data?.items?.[slug] ?? defaultItemDetails(location),
        ]),
      ),
    [pantry.data?.items, stock],
  );
  const unresolvedStock = pantry.data?.unresolvedTerms ?? [];
  const stockActions = useKitchenStockActions();
  const shoppingList = useShoppingList();
  const selectedRecipeSlugs = useMemo(
    () => new Set(shoppingList.recipes.map((entry) => entry.slug)),
    [shoppingList.recipes],
  );
  const [stockQuery, setStockQuery] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [lastClearedStock, setLastClearedStock] = useState<KitchenStock | null>(
    null,
  );
  const [targetLocation, setTargetLocation] =
    useState<KitchenLocation>("cupboards");
  const [editingIngredientSlug, setEditingIngredientSlug] =
    useState<IngredientSlug | null>(null);
  const catalogCardRef = useRef<HTMLDivElement>(null);
  const catalogSearchRef = useRef<HTMLInputElement>(null);

  const dietRelevantIngredients = useMemo(
    () =>
      getDietRelevantKitchenIngredients(
        ingredients,
        diet.excludedIngredientSlugs,
        diet.mode === "warn" || showDietExcludedIngredients,
      ),
    [
      diet.excludedIngredientSlugs,
      diet.mode,
      ingredients,
      showDietExcludedIngredients,
    ],
  );
  const dietExcludedIngredientCount = useMemo(
    () =>
      ingredients.filter((ingredient) =>
        diet.excludedIngredientSlugs.has(ingredient.slug),
      ).length,
    [diet.excludedIngredientSlugs, ingredients],
  );

  const stockedSlugs = useMemo(
    () =>
      Object.keys(stock).filter((slug): slug is IngredientSlug =>
        knownIngredientSlugs.has(slug),
      ),
    [knownIngredientSlugs, stock],
  );

  const dietMatches = useMemo(
    () =>
      buildDietRecipeMatches(recipes, matchRecipe, (recipe) => ({
        ingredients: recipe.ingredients,
      })),
    [matchRecipe, recipes],
  );
  const { visibleRecipes: dietFilteredRecipes, hiddenCount } = useMemo(
    () =>
      applyDietRecipeVisibility(
        recipes,
        dietMatches,
        { active: diet.active, mode: diet.mode },
        { showHidden },
      ),
    [diet.active, diet.mode, dietMatches, recipes, showHidden],
  );
  const equipmentMatches = useMemo(
    () =>
      buildEquipmentRecipeMatches(recipes, equipment, (recipe) => ({
        cookware: recipe.cookware ?? [],
      })),
    [equipment, recipes],
  );
  const {
    visibleRecipes: readinessFilteredRecipes,
    hiddenCount: equipmentHiddenCount,
  } = useMemo(
    () =>
      applyEquipmentRecipeVisibility(
        dietFilteredRecipes,
        equipmentMatches,
        equipment,
        showEquipmentHidden,
      ),
    [dietFilteredRecipes, equipment, equipmentMatches, showEquipmentHidden],
  );
  const matches = useMemo(
    () =>
      getKitchenRecipeMatches(
        readinessFilteredRecipes,
        pantryItems,
        equipment.active ? equipment.ownedSlugs : null,
      ),
    [
      equipment.active,
      equipment.ownedSlugs,
      pantryItems,
      readinessFilteredRecipes,
    ],
  );
  const cookNow = matches.filter((recipe) => recipe.canCook).slice(0, 4);
  const closeMatches = matches.filter((recipe) => !recipe.canCook).slice(0, 5);

  const catalogMatches = useMemo(() => {
    const query = normalizeQuery(catalogQuery);
    return dietRelevantIngredients
      .filter((ingredient) => !(ingredient.slug in stock))
      .filter((ingredient) => {
        if (!query) return true;
        return `${ingredient.name} ${ingredient.category ?? ""}`
          .toLowerCase()
          .includes(query);
      });
  }, [catalogQuery, dietRelevantIngredients, stock]);
  const filteredCatalog = catalogMatches.slice(0, CATALOG_RESULT_LIMIT);
  const customIngredient = catalogQuery.trim();
  const canAddCustomIngredient = canSaveCustomIngredient(
    customIngredient,
    ingredients,
    stock,
  );

  const stockQueryNormalized = normalizeQuery(stockQuery);
  const groupedStock = useMemo(
    () =>
      KITCHEN_LOCATIONS.map((location) => ({
        id: location.id,
        label: location.label,
        description: location.description,
        icon: LOCATION_ICONS[location.id],
        items: stockedSlugs
          .filter((slug) => stock[slug] === location.id)
          .map((slug) => ingredientBySlug.get(slug))
          .filter((ingredient): ingredient is KitchenIngredientView =>
            Boolean(ingredient),
          )
          .filter((ingredient) => {
            if (!stockQueryNormalized) return true;
            return ingredient.name.toLowerCase().includes(stockQueryNormalized);
          })
          .sort((a, b) => a.name.localeCompare(b.name)),
      })),
    [ingredientBySlug, stock, stockQueryNormalized, stockedSlugs],
  );

  const addIngredient = (
    ingredient: KitchenIngredientView,
    location = targetLocation,
  ) => {
    stockActions.setStockLocation(ingredient.slug, location);
    setLastClearedStock(null);
  };

  const addCustomIngredient = () => {
    if (!canAddCustomIngredient) return;
    stockActions.setStockLocation(
      customIngredient as IngredientSlug,
      targetLocation,
    );
    setCatalogQuery("");
    setLastClearedStock(null);
  };

  const removeIngredient = (slug: IngredientSlug) => {
    stockActions.removeFromStock(slug);
  };

  const focusAddIngredients = (location: KitchenLocation) => {
    setTargetLocation(location);
    window.requestAnimationFrame(() => {
      catalogCardRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      catalogSearchRef.current?.focus({ preventScroll: true });
    });
  };

  const clearStock = () => {
    setLastClearedStock(stock);
    stockActions.clearStock();
  };

  const undoClear = () => {
    if (!lastClearedStock) return;
    stockActions.restoreStock(lastClearedStock);
    setLastClearedStock(null);
  };

  const stockedCount = Object.keys(stock).length;
  const householdName =
    pantry.data?.scope.type === "household"
      ? pantry.data.scope.household.name
      : null;
  const editingIngredient = editingIngredientSlug
    ? ingredientBySlug.get(editingIngredientSlug)
    : undefined;
  const editingItem = editingIngredientSlug
    ? pantryItems[editingIngredientSlug]
    : undefined;

  return (
    <div className="container mx-auto min-h-screen max-w-7xl px-4 pt-5 pb-16 md:pt-7">
      <KitchenHeader householdName={householdName} />

      {pantry.error && (
        <div
          role="alert"
          className="rt-body mb-6 rounded-md border border-[var(--berry)]/35 bg-[var(--berry)]/8 px-4 py-3 text-sm text-[var(--berry)]"
        >
          Your pantry could not be loaded. Refresh the page to try again.
        </div>
      )}

      {stockActions.error && (
        <div
          role="alert"
          className="rt-body mb-6 rounded-md border border-[var(--berry)]/35 bg-[var(--berry)]/8 px-4 py-3 text-sm text-[var(--berry)]"
        >
          Your latest pantry change could not be saved. Please try again.
        </div>
      )}

      {diet.active && (
        <DietListNotice
          hiddenCount={hiddenCount}
          labels={diet.labels}
          mode={diet.mode}
          showingHidden={showHidden}
          onToggleHidden={() => setShowHidden((current) => !current)}
        />
      )}

      {equipment.active && (
        <EquipmentListNotice
          hiddenCount={equipmentHiddenCount}
          mode={equipment.mode}
          showingHidden={showEquipmentHidden}
          onToggleHidden={() => setShowEquipmentHidden((current) => !current)}
        />
      )}

      {pantry.isPending && (
        <Card
          role="status"
          aria-live="polite"
          className="rounded-lg border-[1.25px] border-[var(--line-strong)] bg-[var(--card)]"
        >
          <CardContent className="rt-body py-8 text-[var(--ink-3)]">
            Loading your pantry…
          </CardContent>
        </Card>
      )}

      <div
        hidden={pantry.isPending}
        className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.85fr)]"
      >
        <div className="min-w-0 space-y-6">
          <Card className="rounded-lg border-[1.25px] border-[var(--line-strong)] bg-[var(--card)]">
            <CardHeader className="gap-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="rt-mono text-[var(--terracotta)]">In stock</p>
                  <CardTitle className="rt-display text-4xl">
                    {householdName
                      ? `${householdName}'s kitchen.`
                      : "Your kitchen."}
                  </CardTitle>
                  {householdName && (
                    <p className="rt-body mt-1 text-sm text-[var(--ink-3)]">
                      Shared with everyone in your household.
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {stockedCount > 0 && (
                    <button
                      type="button"
                      onClick={clearStock}
                      className="inline-flex items-center gap-1 rt-mono text-[var(--ink-3)] transition-colors hover:text-[var(--berry)]"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> clear all
                    </button>
                  )}
                  {lastClearedStock && stockedCount === 0 && (
                    <button
                      type="button"
                      onClick={undoClear}
                      className="inline-flex items-center gap-1 rt-mono text-[var(--ink-3)] transition-colors hover:text-[var(--terracotta)]"
                    >
                      <Undo2 className="h-3.5 w-3.5" /> undo clear
                    </button>
                  )}
                  <Badge variant="outline" className="text-[var(--ink-2)]">
                    {stockedCount} {stockedCount === 1 ? "item" : "items"}
                  </Badge>
                </div>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--ink-3)]" />
                <Input
                  value={stockQuery}
                  onChange={(event) => setStockQuery(event.target.value)}
                  placeholder="Search what you have..."
                  className="h-10 border-[var(--line-strong)] bg-[var(--paper)] pl-9"
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <UnresolvedStockSection
                terms={unresolvedStock}
                onRemove={removeIngredient}
              />
              {editingIngredientSlug && editingIngredient && editingItem && (
                <KitchenItemEditor
                  key={editingIngredientSlug}
                  ingredient={editingIngredient}
                  item={editingItem}
                  onCancel={() => setEditingIngredientSlug(null)}
                  onSave={(item) => {
                    stockActions.updateStockItem(editingIngredientSlug, item);
                    setEditingIngredientSlug(null);
                  }}
                />
              )}
              {groupedStock.map((group) => {
                const Icon = group.icon;
                return (
                  <section key={group.id} className="min-w-0">
                    <div className="mb-3 flex flex-wrap items-end justify-between gap-2 border-b border-[var(--line)] pb-2">
                      <div className="min-w-0">
                        <h2 className="rt-display flex items-center gap-2 text-3xl text-[var(--terracotta)]">
                          <Icon className="size-5" />
                          {group.label}
                        </h2>
                        <p className="rt-body text-sm text-[var(--ink-3)]">
                          {group.description}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-[var(--terracotta)]"
                        onClick={() => focusAddIngredients(group.id)}
                        aria-label={`Add ingredients to ${group.label}`}
                      >
                        <CirclePlus className="size-4" />
                        Add here
                      </Button>
                    </div>
                    {group.items.length > 0 ? (
                      <div className="flex min-w-0 flex-wrap gap-2">
                        {group.items.map((ingredient) => {
                          const item = pantryItems[ingredient.slug];
                          if (!item) return null;
                          return (
                            <Badge
                              key={ingredient.slug}
                              variant="outline"
                              className="max-w-full gap-1.5 bg-[var(--paper-warm)] px-2 py-1 text-sm text-[var(--ink)]"
                            >
                              <span className="truncate">
                                {ingredient.name}
                              </span>
                              {item.quantity && (
                                <span className="rt-mono text-[var(--ink-3)]">
                                  {item.quantity.amount} {item.quantity.unit}
                                </span>
                              )}
                              {item.freshness !== "unknown" && (
                                <span className="rt-mono text-[var(--ink-3)]">
                                  {FRESHNESS_LABELS[item.freshness]}
                                </span>
                              )}
                              {item.source.kind === "inferred" && (
                                <span
                                  className="max-w-48 truncate rt-mono text-[var(--ink-3)]"
                                  title={item.source.provenance}
                                >
                                  {Math.round(item.source.confidence * 100)}%
                                  inferred · {item.source.provenance}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  setEditingIngredientSlug(ingredient.slug)
                                }
                                className="rounded-sm p-0.5 text-[var(--ink-3)] transition-colors hover:bg-[var(--paper)] hover:text-[var(--terracotta)]"
                                aria-label={`Edit ${ingredient.name}`}
                              >
                                <Pencil className="size-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  removeIngredient(ingredient.slug)
                                }
                                className="rounded-sm p-0.5 text-[var(--ink-3)] transition-colors hover:bg-[var(--paper)] hover:text-[var(--berry)]"
                                aria-label={`Remove ${ingredient.name}`}
                              >
                                <X className="size-3" />
                              </button>
                            </Badge>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="rt-body text-sm text-[var(--ink-3)]">
                        Nothing here yet.
                      </p>
                    )}
                  </section>
                );
              })}
            </CardContent>
          </Card>

          <Card
            ref={catalogCardRef}
            className="scroll-mt-24 rounded-lg border-[1.25px] border-[var(--line-strong)] bg-[var(--card)]"
          >
            <CardHeader className="gap-3">
              <div>
                <p className="rt-mono text-[var(--terracotta)]">
                  Ingredient catalog
                </p>
                <CardTitle className="rt-display text-4xl">
                  Add to your kitchen.
                </CardTitle>
                {dietExcludedIngredientCount > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <p className="rt-body text-sm text-[var(--ink-3)]">
                      {dietExcludedIngredientCount} diet-excluded ingredient
                      {dietExcludedIngredientCount === 1 ? " is" : "s are"}{" "}
                      {diet.mode === "warn" || showDietExcludedIngredients
                        ? "shown with warnings."
                        : "hidden from this catalog."}
                    </p>
                    {diet.mode === "hide" && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setShowDietExcludedIngredients((current) => !current)
                        }
                      >
                        {showDietExcludedIngredients
                          ? "Hide diet exclusions"
                          : "Show anyway"}
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <div className="relative min-w-0">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--ink-3)]" />
                  <Input
                    ref={catalogSearchRef}
                    value={catalogQuery}
                    onChange={(event) => setCatalogQuery(event.target.value)}
                    placeholder="Search ingredients..."
                    className="h-10 border-[var(--line-strong)] bg-[var(--paper)] pl-9"
                  />
                </div>
                <div className="grid grid-cols-4 rounded-md border border-[var(--line-strong)] bg-[var(--paper-warm)] p-1">
                  {KITCHEN_LOCATIONS.map((location) => (
                    <button
                      key={location.id}
                      type="button"
                      onClick={() => setTargetLocation(location.id)}
                      aria-label={`Add ingredients to ${location.label}`}
                      className={cn(
                        "inline-flex items-center justify-center gap-1 rounded-sm px-2 py-1.5 text-sm transition-colors",
                        targetLocation === location.id
                          ? "bg-[var(--card)] text-[var(--ink)] shadow-xs"
                          : "text-[var(--ink-3)] hover:text-[var(--ink)]",
                      )}
                    >
                      <LocationIcon location={location.id} />
                      <span className="hidden sm:inline">{location.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {filteredCatalog.map((ingredient) => {
                  const isDietExcluded = diet.excludedIngredientSlugs.has(
                    ingredient.slug,
                  );
                  return (
                    <button
                      key={ingredient.slug}
                      type="button"
                      onClick={() => addIngredient(ingredient)}
                      aria-label={`Add ${ingredient.name}${
                        isDietExcluded ? " — diet warning" : ""
                      }`}
                      className={cn(
                        "flex min-w-0 items-center justify-between gap-3 rounded-md border bg-[var(--paper)] px-3 py-2 text-left transition-colors hover:border-[var(--terracotta)] hover:bg-[var(--butter-soft)]",
                        isDietExcluded
                          ? "border-[var(--berry)]"
                          : "border-[var(--line)]",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-[var(--ink)]">
                          {ingredient.name}
                        </span>
                        <span
                          className={cn(
                            "rt-mono flex items-center gap-1 truncate",
                            isDietExcluded
                              ? "text-[var(--berry)]"
                              : "text-[var(--ink-3)]",
                          )}
                        >
                          {isDietExcluded && (
                            <TriangleAlert className="size-3 shrink-0" />
                          )}
                          {isDietExcluded
                            ? "Diet warning"
                            : (ingredient.category ?? "ingredient")}
                        </span>
                      </span>
                      <CirclePlus className="size-4 shrink-0 text-[var(--terracotta)]" />
                    </button>
                  );
                })}
              </div>
              <KitchenCatalogFooter
                canAddCustom={canAddCustomIngredient}
                customIngredient={customIngredient}
                filteredCount={filteredCatalog.length}
                matchCount={catalogMatches.length}
                onAddCustom={addCustomIngredient}
              />
            </CardContent>
          </Card>
        </div>

        <aside className="min-w-0 space-y-6 lg:sticky lg:top-24 lg:self-start">
          <Card className="rounded-lg border-[1.25px] border-[var(--line-strong)] bg-[var(--card)]">
            <CardHeader>
              <p className="rt-mono text-[var(--sage)]">Cook now</p>
              <CardTitle className="rt-display text-4xl">
                Ready recipes.
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {cookNow.length > 0 ? (
                cookNow.map((recipe) => (
                  <RecipeMatchCard
                    key={recipe.slug}
                    recipe={recipe}
                    inList={selectedRecipeSlugs.has(recipe.slug)}
                    onToggleList={() => toggleRecipe(recipe.slug)}
                    dietMatch={dietMatches.get(recipe.slug)}
                  />
                ))
              ) : (
                <p className="rt-body text-sm text-[var(--ink-3)]">
                  Add a few more staples to see fully stocked recipes.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-lg border-[1.25px] border-[var(--line-strong)] bg-[var(--card)]">
            <CardHeader>
              <p className="rt-mono text-[var(--terracotta)]">
                Just need a few
              </p>
              <CardTitle className="rt-display text-4xl">
                Close matches.
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {closeMatches.length > 0 ? (
                closeMatches.map((recipe) => (
                  <RecipeMatchCard
                    key={recipe.slug}
                    recipe={recipe}
                    inList={selectedRecipeSlugs.has(recipe.slug)}
                    onToggleList={() => toggleRecipe(recipe.slug)}
                    dietMatch={dietMatches.get(recipe.slug)}
                  />
                ))
              ) : (
                <p className="rt-body text-sm text-[var(--ink-3)]">
                  No close matches right now.
                </p>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
