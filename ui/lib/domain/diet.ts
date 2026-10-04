import type {
  DietOptions,
  DietProfile,
  DietRecipeMatchMode,
} from "@/lib/api/diet";

export type DietRecipe = {
  ingredients: readonly { slug: string; name?: string }[];
};

export type DietMatch = {
  matches: boolean;
  excludedIngredients: { slug: string; name: string }[];
};

export type EffectiveDiet = {
  active: boolean;
  labels: string[];
  mode: DietRecipeMatchMode;
  excludedIngredientSlugs: ReadonlySet<string>;
  ingredientNames: ReadonlyMap<string, string>;
};

export type DietVisibilityResult<T> = {
  visibleRecipes: T[];
  /**
   * Recipes the active hide policy would suppress. It remains the baseline
   * count while temporarily showing hidden recipes, and is zero in warn mode.
   */
  hiddenCount: number;
};

export function buildDietRecipeMatches<T extends { slug: string }>(
  recipes: T[],
  matchRecipe: (recipe: DietRecipe) => DietMatch,
  toDietRecipe: (recipe: T) => DietRecipe,
): Map<string, DietMatch> {
  return new Map(
    recipes.map((recipe) => [recipe.slug, matchRecipe(toDietRecipe(recipe))]),
  );
}

function labelFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

export function buildEffectiveDiet(
  profile: DietProfile,
  options: DietOptions,
): EffectiveDiet {
  const presetByKey = new Map(
    options.presets.map((preset) => [preset.key, preset]),
  );
  const groupByKey = new Map(options.groups.map((group) => [group.key, group]));
  const ingredientNames = new Map(
    options.ingredients.map((ingredient) => [ingredient.slug, ingredient.name]),
  );
  const unresolvedIngredientSlugs = new Set(
    (profile.unresolvedTerms ?? [])
      .filter((term) => term.kind === "ingredient")
      .map((term) => term.normalizedText),
  );
  const presetGroups = profile.presetDietKeys.flatMap(
    (key) => presetByKey.get(key)?.excludedGroupKeys ?? [],
  );
  const presetGroupKeys = new Set(presetGroups);
  const groupKeys = new Set([...presetGroupKeys, ...profile.excludedGroupKeys]);
  const presetExcludedIngredientSlugs = new Set([
    ...profile.presetDietKeys.flatMap(
      (key) => presetByKey.get(key)?.excludedIngredientSlugs ?? [],
    ),
    ...Array.from(presetGroupKeys).flatMap(
      (key) => groupByKey.get(key)?.ingredientSlugs ?? [],
    ),
  ]);
  const excludedIngredientSlugs = new Set([
    ...profile.excludedIngredientSlugs.filter(
      (slug) => !unresolvedIngredientSlugs.has(slug),
    ),
    ...presetExcludedIngredientSlugs,
    ...Array.from(groupKeys).flatMap(
      (key) => groupByKey.get(key)?.ingredientSlugs ?? [],
    ),
  ]);
  const labels = [
    ...profile.presetDietKeys.map(
      (key) => presetByKey.get(key)?.label ?? labelFromSlug(key),
    ),
    ...profile.excludedGroupKeys
      .filter((key) => !presetGroupKeys.has(key))
      .map((key) => `no ${groupByKey.get(key)?.label ?? labelFromSlug(key)}`),
    ...profile.excludedIngredientSlugs
      .filter((slug) => !presetExcludedIngredientSlugs.has(slug))
      .map((slug) => `no ${ingredientNames.get(slug) ?? labelFromSlug(slug)}`),
  ];

  return {
    active: excludedIngredientSlugs.size > 0,
    labels: Array.from(new Set(labels)),
    mode: profile.recipeMatchMode,
    excludedIngredientSlugs,
    ingredientNames,
  };
}

export function matchRecipeToDiet(
  recipe: DietRecipe,
  diet: EffectiveDiet,
): DietMatch {
  const excludedIngredients = Array.from(
    new Map(
      recipe.ingredients
        .filter((ingredient) =>
          diet.excludedIngredientSlugs.has(ingredient.slug),
        )
        .map((ingredient) => [
          ingredient.slug,
          {
            slug: ingredient.slug,
            name:
              ingredient.name ??
              diet.ingredientNames.get(ingredient.slug) ??
              labelFromSlug(ingredient.slug),
          },
        ]),
    ).values(),
  );

  return {
    matches: excludedIngredients.length === 0,
    excludedIngredients,
  };
}

export function filterRecipesForDiet<T>(
  recipes: T[],
  diet: EffectiveDiet,
  toDietRecipe: (recipe: T) => DietRecipe,
): T[] {
  return recipes.filter(
    (recipe) => matchRecipeToDiet(toDietRecipe(recipe), diet).matches,
  );
}

export function applyDietRecipeVisibility<T extends { slug: string }>(
  recipes: T[],
  matches: ReadonlyMap<string, DietMatch>,
  diet: Pick<EffectiveDiet, "active" | "mode">,
  options: Readonly<{
    showHidden: boolean;
    alwaysVisibleSlugs?: ReadonlySet<string>;
  }>,
): DietVisibilityResult<T> {
  if (!diet.active || diet.mode !== "hide") {
    return { visibleRecipes: recipes, hiddenCount: 0 };
  }

  const dietVisibleRecipes = recipes.filter(
    (recipe) =>
      matches.get(recipe.slug)?.matches === true ||
      options.alwaysVisibleSlugs?.has(recipe.slug),
  );

  return {
    visibleRecipes: options.showHidden ? recipes : dietVisibleRecipes,
    hiddenCount: recipes.length - dietVisibleRecipes.length,
  };
}
