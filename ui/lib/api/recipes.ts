import { ingredients as definedIngredients } from "@/content/recipes/ingredients";
import type { IngredientCategory } from "@/lib/domain/recipe/ingredient";
import { resolveIngredientSlug } from "@/lib/domain/recipe/ingredient";
import type {
  KitchenIngredientView,
  KitchenRecipeView,
} from "@/lib/domain/recipe/kitchen";
import {
  parseSavedRecipe,
  type RecipeGridItem,
  recipePageHref,
  type SavedRecipeApiRecord,
  savedRecipeCard,
} from "@/lib/domain/recipe/recipeDraft";
import type { RecipeDetailView } from "@/lib/domain/recipe/recipeViews";

export type {
  RecipeCardView,
  RecipeDetailView,
} from "@/lib/domain/recipe/recipeViews";

export function recipeRecordsToCards(
  records: SavedRecipeApiRecord[],
): RecipeGridItem[] {
  return records
    .flatMap((record) => {
      const card = savedRecipeCard(record);
      if (!card) return [];
      const { saved: _saved, ...catalogCard } = card;
      return [catalogCard];
    })
    .sort(
      (left, right) =>
        right.date.localeCompare(left.date) ||
        left.slug.localeCompare(right.slug),
    );
}

export function recipeRecordsToDetails(
  records: SavedRecipeApiRecord[],
): RecipeDetailView[] {
  return records.flatMap((record) => {
    const recipe = parseSavedRecipe(record);
    return recipe ? [recipe] : [];
  });
}

export function buildKitchenCatalog(records: SavedRecipeApiRecord[]): {
  ingredients: KitchenIngredientView[];
  recipes: KitchenRecipeView[];
} {
  const details = records.flatMap((record) => {
    const recipe = parseSavedRecipe(record);
    return recipe ? [{ recipe, record }] : [];
  });
  const ingredientCategories = new Map(
    definedIngredients.map((ingredient) => [
      resolveIngredientSlug(ingredient),
      ingredient.category as IngredientCategory,
    ]),
  );
  const ingredients = new Map<string, KitchenIngredientView>();
  const recipes = details.map(({ recipe, record }): KitchenRecipeView => {
    const recipeIngredients = new Map<
      string,
      KitchenRecipeView["ingredients"][number]
    >();
    for (const group of recipe.ingredientGroups) {
      for (const item of group.items) {
        recipeIngredients.set(item.ingredient, {
          slug: item.ingredient,
          name: item.name,
        });
        ingredients.set(item.ingredient, {
          slug: item.ingredient,
          name: item.name,
          category: ingredientCategories.get(item.ingredient),
        });
      }
    }
    return {
      slug: recipe.slug,
      href: recipePageHref(record),
      title: recipe.title,
      cuisine: recipe.cuisine,
      totalTime: recipe.totalTime,
      image: recipe.image,
      imageAlt: recipe.imageAlt,
      ingredients: Array.from(recipeIngredients.values()).sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
      cookware: recipe.cookware,
    };
  });

  return {
    ingredients: Array.from(ingredients.values()).sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    recipes,
  };
}
