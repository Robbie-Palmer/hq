import type { IngredientSlug } from "./ingredient";
import type { RecipeSlug } from "./recipe";

export interface RecipeContentGraph {
  edges: {
    usesIngredient: Map<RecipeSlug, Set<IngredientSlug>>;
    hasCuisine: Map<RecipeSlug, string[]>;
  };
  reverse: {
    ingredientUsedBy: Map<IngredientSlug, Set<RecipeSlug>>;
    cuisineUsedBy: Map<string, Set<RecipeSlug>>;
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
export function buildRecipeContentGraph(input: {
  ingredientSlugs: Iterable<IngredientSlug>;
  recipeIngredients: Map<RecipeSlug, IngredientSlug[]>;
  recipeCuisines: Map<RecipeSlug, string[]>;
}): RecipeContentGraph {
  const graph: RecipeContentGraph = {
    edges: {
      usesIngredient: new Map(),
      hasCuisine: new Map(),
    },
    reverse: {
      ingredientUsedBy: new Map(),
      cuisineUsedBy: new Map(),
    },
  };

  for (const slug of input.ingredientSlugs) {
    graph.reverse.ingredientUsedBy.set(slug, new Set());
  }

  for (const [recipeSlug, ingredientSlugs] of input.recipeIngredients) {
    if (ingredientSlugs.length === 0) continue;
    graph.edges.usesIngredient.set(recipeSlug, new Set(ingredientSlugs));
    for (const ingredientSlug of ingredientSlugs) {
      const reverseSet = graph.reverse.ingredientUsedBy.get(ingredientSlug);
      if (!reverseSet) {
        throw new Error(
          `Unknown ingredient "${ingredientSlug}" referenced by recipe "${recipeSlug}" was not registered via ingredientSlugs`,
        );
      }
      reverseSet.add(recipeSlug);
    }
  }

  for (const [recipeSlug, cuisines] of input.recipeCuisines) {
    if (cuisines.length === 0) continue;
    graph.edges.hasCuisine.set(recipeSlug, cuisines);
    for (const cuisine of cuisines) {
      if (!graph.reverse.cuisineUsedBy.has(cuisine)) {
        graph.reverse.cuisineUsedBy.set(cuisine, new Set());
      }
      graph.reverse.cuisineUsedBy.get(cuisine)?.add(recipeSlug);
    }
  }

  return graph;
}
