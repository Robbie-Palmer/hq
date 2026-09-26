"use client";

import {
  CirclePlus,
  Refrigerator,
  Search,
  ShoppingBasket,
  Sprout,
  Trash2,
  TriangleAlert,
  Undo2,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { DietListNotice } from "@/components/recipes/diet-notice";
import { useDiet } from "@/components/recipes/diet-provider";
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
import {
  applyDietRecipeVisibility,
  buildDietRecipeMatches,
} from "@/lib/domain/diet";
import type { IngredientSlug } from "@/lib/domain/recipe/ingredient";
import {
  getDietRelevantKitchenIngredients,
  getKitchenRecipeMatches,
  KITCHEN_LOCATIONS,
  type KitchenIngredientView,
  type KitchenLocation,
  type KitchenRecipeView,
  type KitchenStock,
} from "@/lib/domain/recipe/kitchen";
import { cn } from "@/lib/generic/styles";
import { toggleRecipe } from "@/lib/shopping/shoppingListStore";

const CATALOG_RESULT_LIMIT = 18;

const LOCATION_ICONS = {
  fridge: Refrigerator,
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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
export function KitchenView({
  ingredients,
  recipes,
}: Readonly<{
  ingredients: KitchenIngredientView[];
  recipes: KitchenRecipeView[];
}>) {
  const { diet, matchRecipe } = useDiet();
  const [showHidden, setShowHidden] = useState(false);
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
  const matches = useMemo(
    () => getKitchenRecipeMatches(dietFilteredRecipes, stockedSlugs),
    [dietFilteredRecipes, stockedSlugs],
  );
  const cookNow = matches
    .filter((recipe) => recipe.totalCount > 0 && recipe.missingCount === 0)
    .slice(0, 4);
  const closeMatches = matches
    .filter((recipe) => recipe.missingCount > 0)
    .slice(0, 5);

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
  const isCatalogTruncated = catalogMatches.length > filteredCatalog.length;

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

  const stockedCount = stockedSlugs.length;
  const householdName =
    pantry.data?.scope.type === "household"
      ? pantry.data.scope.household.name
      : null;

  return (
    <div className="container mx-auto min-h-screen max-w-7xl px-4 pt-5 pb-16 md:pt-7">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="rt-mono text-[var(--terracotta)]">
            Kitchen · stock match
          </p>
          <h1 className="rt-display mt-2 text-5xl sm:text-6xl lg:text-7xl">
            What can I <span className="text-[var(--terracotta)]">make?</span>
          </h1>
          <p className="rt-body mt-3 max-w-2xl text-[var(--ink-2)]">
            Add ingredients from the canonical recipe catalog, split them across
            fridge, cupboards and fresh, then compare{" "}
            {householdName
              ? `${householdName}'s shared kitchen`
              : "your kitchen"}{" "}
            against the recipe box.
          </p>
        </div>
      </div>

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
                        {group.items.map((ingredient) => (
                          <Badge
                            key={ingredient.slug}
                            variant="outline"
                            className="max-w-full gap-1.5 bg-[var(--paper-warm)] px-2 py-1 text-sm text-[var(--ink)]"
                          >
                            <span className="truncate">{ingredient.name}</span>
                            <button
                              type="button"
                              onClick={() => removeIngredient(ingredient.slug)}
                              className="rounded-sm p-0.5 text-[var(--ink-3)] transition-colors hover:bg-[var(--paper)] hover:text-[var(--berry)]"
                              aria-label={`Remove ${ingredient.name}`}
                            >
                              <X className="size-3" />
                            </button>
                          </Badge>
                        ))}
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
                  Canonical ingredients
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
                <div className="grid grid-cols-3 rounded-md border border-[var(--line-strong)] bg-[var(--paper-warm)] p-1">
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
              {isCatalogTruncated && (
                <p className="rt-body mt-3 text-sm text-[var(--ink-3)]">
                  Showing {filteredCatalog.length} of {catalogMatches.length}{" "}
                  matching ingredients.
                </p>
              )}
              {filteredCatalog.length === 0 && (
                <p className="rt-body text-sm text-[var(--ink-3)]">
                  No matching ingredients left to add.
                </p>
              )}
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
