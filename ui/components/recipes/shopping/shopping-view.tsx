"use client";

import { Share2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { DietListNotice } from "@/components/recipes/diet-notice";
import { useDiet } from "@/components/recipes/diet-provider";
import { RecipePicker } from "@/components/recipes/shopping/recipe-picker";
import { ShareShoppingList } from "@/components/recipes/shopping/share-shopping-list";
import { ShoppingList } from "@/components/recipes/shopping/shopping-list";
import {
  ShoppingListBoundary,
  useShoppingListScope,
  useStartNewShoppingList,
} from "@/components/recipes/shopping/shopping-list-boundary";
import { useShoppingList } from "@/hooks/use-shopping-list";
import type { DietIngredientOption } from "@/lib/api/diet";
import type { ShoppingRecipe } from "@/lib/api/shopping";
import {
  applyDietRecipeVisibility,
  buildDietRecipeMatches,
} from "@/lib/domain/diet";

export function ShoppingView({
  ingredientCatalog,
  recipes,
}: Readonly<{
  ingredientCatalog: DietIngredientOption[];
  recipes: ShoppingRecipe[];
}>) {
  return (
    <ShoppingListBoundary>
      <ShoppingViewContent
        ingredientCatalog={ingredientCatalog}
        recipes={recipes}
      />
    </ShoppingListBoundary>
  );
}

function ShoppingViewContent({
  ingredientCatalog,
  recipes,
}: Readonly<{
  ingredientCatalog: DietIngredientOption[];
  recipes: ShoppingRecipe[];
}>) {
  const { diet, matchRecipe } = useDiet();
  const { recipes: selected, plan, extras } = useShoppingList();
  const [showHidden, setShowHidden] = useState(false);
  const startNewList = useStartNewShoppingList();
  const scope = useShoppingListScope();
  const selectedSlugs = useMemo(
    () => new Set(selected.map((entry) => entry.slug)),
    [selected],
  );
  const dietMatches = useMemo(
    () =>
      buildDietRecipeMatches(recipes, matchRecipe, (recipe) => ({
        ingredients: recipe.ingredients.map((ingredient) => ({
          slug: ingredient.ingredient,
          name: ingredient.name,
        })),
      })),
    [matchRecipe, recipes],
  );
  const { visibleRecipes: availableRecipes, hiddenCount } = useMemo(
    () =>
      applyDietRecipeVisibility(
        recipes,
        dietMatches,
        { active: diet.active, mode: diet.mode },
        {
          showHidden,
          alwaysVisibleSlugs: selectedSlugs,
        },
      ),
    [diet.active, diet.mode, dietMatches, recipes, selectedSlugs, showHidden],
  );
  const pickerRecipes = availableRecipes;
  const count = selected.length;
  const recipeNoun = count === 1 ? "recipe" : "recipes";
  const itemNoun = extras.length === 1 ? "item" : "items";
  const hasListContent = count > 0 || plan.length > 0 || extras.length > 0;
  let summary =
    "Add items directly, or choose recipes and we'll gather their ingredients.";
  if (count > 0) {
    summary = `${count} ${recipeNoun} selected for this list.`;
  } else if (extras.length > 0) {
    summary = `${extras.length} ${itemNoun} on the shopping list.`;
  }

  return (
    <div className="container mx-auto px-4 pt-5 pb-16 md:pt-7 max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
        <div>
          <p className="rt-mono text-[var(--terracotta)]">Shopping</p>
          <h1 className="rt-display text-5xl md:text-6xl mt-2">
            Shopping list.
          </h1>
          <p className="rt-body mt-2 text-[var(--ink-2)]">{summary}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
          {scope.type === "household" ? (
            <ShareShoppingList scope={scope} />
          ) : (
            <Link
              href="/recipes/settings?section=household"
              className="inline-flex items-center gap-1.5 rt-mono text-[var(--ink-3)] hover:text-[var(--terracotta)] transition-colors"
            >
              <Share2 className="h-3.5 w-3.5" /> share with a household
            </Link>
          )}
          {hasListContent && (
            <button
              type="button"
              onClick={startNewList.start}
              disabled={startNewList.isPending}
              className="inline-flex items-center gap-1.5 rt-mono text-[var(--ink-3)] hover:text-[var(--berry)] transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" /> start a new list
            </button>
          )}
        </div>
      </div>

      {startNewList.isError && (
        <p
          role="alert"
          className="rt-body mb-4 rounded-md border border-[var(--berry)]/30 bg-[var(--cream-dark)] px-3 py-2 text-sm text-[var(--berry)]"
        >
          A new shopping list could not be started. Your previous list has been
          restored.
        </p>
      )}

      <div className="space-y-10">
        <ShoppingList ingredientCatalog={ingredientCatalog} recipes={recipes} />

        <section aria-labelledby="recipe-picker-heading">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2 border-t border-[var(--line)] pt-8">
            <div>
              <p className="rt-mono text-[var(--terracotta)]">Recipe picker</p>
              <h2
                id="recipe-picker-heading"
                className="rt-display text-3xl text-[var(--ink)]"
              >
                Add recipes.
              </h2>
            </div>
            <p className="rt-body text-sm text-[var(--ink-3)]">
              Pick a recipe to add its ingredients to the list above.
            </p>
          </div>
          {diet.active && (
            <DietListNotice
              hiddenCount={hiddenCount}
              labels={diet.labels}
              mode={diet.mode}
              showingHidden={showHidden}
              onToggleHidden={() => setShowHidden((current) => !current)}
            />
          )}
          <RecipePicker recipes={pickerRecipes} dietMatches={dietMatches} />
        </section>
      </div>
    </div>
  );
}
