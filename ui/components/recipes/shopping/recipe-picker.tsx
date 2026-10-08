"use client";

import { Minus, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useEquipmentReadiness } from "@/components/recipes/equipment-readiness-provider";
import { RecipeMatchCard } from "@/components/recipes/recipe-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useKitchenStock } from "@/hooks/use-kitchen-stock";
import { useShoppingList } from "@/hooks/use-shopping-list";
import type { ShoppingRecipe } from "@/lib/api/shopping";
import type { DietMatch } from "@/lib/domain/diet";
import type { IngredientSlug } from "@/lib/domain/recipe/ingredient";
import {
  getKitchenRecipeMatches,
  type KitchenRecipeView,
} from "@/lib/domain/recipe/kitchen";
import {
  setRecipeServings,
  toggleRecipe,
} from "@/lib/shopping/shoppingListStore";

function ServingsStepper({
  slug,
  servings,
}: Readonly<{
  slug: string;
  servings: number;
}>) {
  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="outline"
        size="icon-sm"
        onClick={() => setRecipeServings(slug, servings - 1)}
        disabled={servings <= 1}
        aria-label="Decrease servings"
      >
        <Minus className="h-3 w-3" />
      </Button>
      <span className="tabular-nums text-center min-w-[4.5rem]">
        <span className="rt-display text-xl text-[var(--terracotta)] align-middle">
          {servings}
        </span>{" "}
        <span className="align-middle text-xs text-[var(--ink-3)]">
          {servings === 1 ? "serving" : "servings"}
        </span>
      </span>
      <Button
        variant="outline"
        size="icon-sm"
        onClick={() => setRecipeServings(slug, servings + 1)}
        aria-label="Increase servings"
      >
        <Plus className="h-3 w-3" />
      </Button>
    </div>
  );
}

export function RecipePicker({
  recipes,
  dietMatches,
}: Readonly<{
  recipes: ShoppingRecipe[];
  dietMatches?: ReadonlyMap<string, DietMatch>;
}>) {
  const { recipes: selectedEntries } = useShoppingList();
  const stock = useKitchenStock();
  const { equipment } = useEquipmentReadiness();
  const [query, setQuery] = useState("");

  const servingsBySlug = useMemo(() => {
    const map = new Map<string, number | undefined>();
    for (const entry of selectedEntries) map.set(entry.slug, entry.servings);
    return map;
  }, [selectedEntries]);

  // The same have/need match the kitchen tab shows, computed against the shared
  // stock, so a recipe card reads identically on both tabs.
  const matchBySlug = useMemo(() => {
    const views = recipes.map(
      (recipe): KitchenRecipeView => ({
        slug: recipe.slug,
        title: recipe.title,
        cuisine: recipe.cuisine,
        totalTime: recipe.totalTime,
        image: recipe.image,
        imageAlt: recipe.imageAlt,
        ingredients: [
          ...new Map(
            recipe.ingredients.map((item) => [
              item.ingredient,
              { slug: item.ingredient, name: item.name },
            ]),
          ).values(),
        ],
        cookware: recipe.cookware ?? [],
      }),
    );
    const matches = getKitchenRecipeMatches(
      views,
      Object.keys(stock) as IngredientSlug[],
      equipment.active ? equipment.ownedSlugs : null,
    );
    return new Map(matches.map((match) => [match.slug, match]));
  }, [equipment.active, equipment.ownedSlugs, recipes, stock]);

  // Pre-compute each recipe's lowercase search string once (not per keystroke).
  const searchIndex = useMemo(
    () =>
      recipes.map((recipe) => ({
        recipe,
        haystack: [
          recipe.title,
          recipe.cuisine.join(" "),
          recipe.ingredients.map((i) => i.name).join(" "),
        ]
          .join(" ")
          .toLowerCase(),
      })),
    [recipes],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recipes;
    return searchIndex
      .filter((entry) => entry.haystack.includes(q))
      .map((entry) => entry.recipe);
  }, [recipes, searchIndex, query]);

  // Selected recipes float to the top so the current basket is always in view.
  const ordered = useMemo(() => {
    const isSelected = (slug: string) => servingsBySlug.has(slug);
    return [...filtered].sort((a, b) => {
      const sa = isSelected(a.slug) ? 0 : 1;
      const sb = isSelected(b.slug) ? 0 : 1;
      return sa - sb;
    });
  }, [filtered, servingsBySlug]);

  return (
    <div>
      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ink-3)] pointer-events-none" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${recipes.length} recipes…`}
          aria-label="Search recipes to add"
          className="pl-9 bg-[var(--card)]"
        />
      </div>

      {ordered.length === 0 ? (
        <p className="rt-body text-[var(--ink-3)] py-8 text-center">
          No recipes match “{query}”.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {ordered.map((recipe) => {
            const match = matchBySlug.get(recipe.slug);
            if (!match) return null;
            const selected = servingsBySlug.has(recipe.slug);
            const servings = servingsBySlug.get(recipe.slug) ?? recipe.servings;
            return (
              <RecipeMatchCard
                key={recipe.slug}
                recipe={match}
                inList={selected}
                onToggleList={() => toggleRecipe(recipe.slug)}
                highlight={selected}
                cardAction="toggle-list"
                dietMatch={dietMatches?.get(recipe.slug)}
                footer={
                  selected ? (
                    <ServingsStepper slug={recipe.slug} servings={servings} />
                  ) : undefined
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
