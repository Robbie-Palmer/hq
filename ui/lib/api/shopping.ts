import { ingredients as definedIngredients } from "@/content/recipes/ingredients";
import type { IngredientCategory } from "@/lib/domain/recipe/ingredient";
import { resolveIngredientSlug } from "@/lib/domain/recipe/ingredient";
import {
  parseSavedRecipe,
  type SavedRecipeApiRecord,
} from "@/lib/domain/recipe/recipeDraft";
import type { RecipeIngredientView } from "@/lib/domain/recipe/recipeViews";

export type ShoppingRecipe = {
  slug: string;
  title: string;
  servings: number;
  image?: string;
  imageAlt?: string;
  cuisine: string[];
  totalTime?: number;
  ingredients: RecipeIngredientView[];
  cookware?: string[];
};

export function recipeRecordsToShoppingRecipes(
  records: SavedRecipeApiRecord[],
): ShoppingRecipe[] {
  const ingredientCategories = new Map(
    definedIngredients.map((ingredient) => [
      resolveIngredientSlug(ingredient),
      ingredient.category as IngredientCategory,
    ]),
  );

  return records.flatMap((record) => {
    const recipe = parseSavedRecipe(record);
    if (!recipe) return [];
    return [
      {
        slug: recipe.slug,
        title: recipe.title,
        servings: Math.max(1, recipe.servings),
        image: recipe.image,
        imageAlt: recipe.imageAlt,
        cuisine: recipe.cuisine,
        totalTime: recipe.totalTime,
        ingredients: recipe.ingredientGroups.flatMap((group) =>
          group.items.map((item) => ({
            ...item,
            category: ingredientCategories.get(item.ingredient),
          })),
        ),
        cookware: recipe.cookware,
      },
    ];
  });
}
