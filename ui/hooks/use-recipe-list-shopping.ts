"use client";

import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { CircleMinus, CirclePlus } from "lucide-react";
import { createElement, useMemo } from "react";
import { toast } from "sonner";
import { captureRecipeProductActivity } from "@/lib/analytics/recipe-product";
import { isApiError } from "@/lib/api/http";
import {
  type StoredShoppingList,
  saveCurrentShoppingList,
} from "@/lib/api/shopping-lists";
import { recipeQueryKeys } from "@/lib/query/recipe-query-keys";
import { shoppingListQuery } from "@/lib/query/shopping-list-queries";
import {
  getShoppingListSnapshot,
  installShoppingListSnapshot,
} from "@/lib/shopping/shoppingListStore";

export type RecipeListShoppingRecipe = {
  slug: string;
  title: string;
  servings: number;
};

type RecipeListShoppingRequest = {
  recipes: RecipeListShoppingRecipe[];
  add: boolean;
  source: "recipe-list-card" | "recipe-list-selection";
};

function recipeNames(recipes: RecipeListShoppingRecipe[]): string {
  return recipes.map((recipe) => recipe.title).join(", ");
}

function changedRecipes(
  request: RecipeListShoppingRequest,
  current: StoredShoppingList,
): RecipeListShoppingRecipe[] {
  const existingSlugs = new Set(
    current.snapshot.recipes.map((recipe) => recipe.slug),
  );
  return request.recipes.filter((recipe) =>
    request.add
      ? !existingSlugs.has(recipe.slug)
      : existingSlugs.has(recipe.slug),
  );
}

function nextRecipeEntries(
  request: RecipeListShoppingRequest,
  current: StoredShoppingList,
  changed: RecipeListShoppingRecipe[],
) {
  if (request.add) {
    return [
      ...current.snapshot.recipes,
      ...changed.map((recipe) => ({
        slug: recipe.slug,
        servings: Math.max(1, Math.round(recipe.servings)),
      })),
    ];
  }
  const requestedSlugs = new Set(request.recipes.map((recipe) => recipe.slug));
  return current.snapshot.recipes.filter(
    (recipe) => !requestedSlugs.has(recipe.slug),
  );
}

async function updateShoppingListRecipes(
  queryClient: QueryClient,
  userId: string,
  request: RecipeListShoppingRequest,
) {
  const queryKey = recipeQueryKeys.shoppingList(userId);
  const latest =
    queryClient.getQueryData<StoredShoppingList>(queryKey) ??
    (await queryClient.fetchQuery(shoppingListQuery(userId)));
  const changed = changedRecipes(request, latest);
  if (changed.length === 0) {
    return { updated: latest, changed, request };
  }
  const recipes = nextRecipeEntries(request, latest, changed);
  const updated = await saveCurrentShoppingList(latest.id, latest.revision, {
    ...latest.snapshot,
    recipes,
  });
  return { updated, changed, request };
}

type ShoppingListRecipeUpdate = Awaited<
  ReturnType<typeof updateShoppingListRecipes>
>;

function installUpdatedShoppingList(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  updated: StoredShoppingList,
) {
  queryClient.setQueryData(queryKey, updated);
  installShoppingListSnapshot(
    {
      ...updated.snapshot,
      plan: getShoppingListSnapshot().plan,
    },
    updated.id,
  );
}

function recordAddedRecipes({
  updated,
  changed,
  request,
}: ShoppingListRecipeUpdate) {
  if (!request.add) return;
  for (const recipe of changed) {
    captureRecipeProductActivity("shopping_recipe_added", {
      recipe_slug: recipe.slug,
      shopping_recipe_count: updated.snapshot.recipes.length,
      source: request.source,
      selection_size: request.recipes.length,
    });
  }
}

function notifyRecipeUpdate({ changed, request }: ShoppingListRecipeUpdate) {
  if (changed.length === 0) {
    toast.info(
      `${recipeNames(request.recipes)} ${request.recipes.length === 1 ? "is" : "are"} already ${request.add ? "on" : "off"} your shopping list.`,
    );
    return;
  }
  const names = recipeNames(changed);
  toast.success(
    request.add
      ? `${names} added to your shopping list.`
      : `${names} removed from your shopping list.`,
    {
      icon: createElement(request.add ? CirclePlus : CircleMinus, {
        "aria-hidden": true,
        className: "size-4",
      }),
    },
  );
}

function handleRecipeUpdateSuccess(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  result: ShoppingListRecipeUpdate,
) {
  installUpdatedShoppingList(queryClient, queryKey, result.updated);
  recordAddedRecipes(result);
  notifyRecipeUpdate(result);
}

function handleRecipeUpdateError(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  error: unknown,
  request: RecipeListShoppingRequest,
) {
  if (isApiError(error) && error.status === 409) {
    void queryClient.invalidateQueries({ queryKey });
  }
  toast.error(
    `${recipeNames(request.recipes)} could not be ${request.add ? "added to" : "removed from"} your shopping list.`,
  );
}

export function useRecipeListShopping(userId: string) {
  const queryClient = useQueryClient();
  const queryKey = recipeQueryKeys.shoppingList(userId);
  const current = useQuery(shoppingListQuery(userId));
  const mutation = useMutation({
    mutationFn: (request: RecipeListShoppingRequest) =>
      updateShoppingListRecipes(queryClient, userId, request),
    onSuccess: (result) =>
      handleRecipeUpdateSuccess(queryClient, queryKey, result),
    onError: (error, request) =>
      handleRecipeUpdateError(queryClient, queryKey, error, request),
  });
  const recipesOnList = useMemo(() => {
    const slugs = new Set(
      current.data?.snapshot.recipes.map((recipe) => recipe.slug) ?? [],
    );
    if (mutation.isPending && mutation.variables) {
      for (const recipe of mutation.variables.recipes) {
        if (mutation.variables.add) slugs.add(recipe.slug);
        else slugs.delete(recipe.slug);
      }
    }
    return slugs;
  }, [current.data?.snapshot.recipes, mutation.isPending, mutation.variables]);

  return {
    recipesOnList,
    isLoading: current.isPending,
    isError: current.isError,
    pendingRecipeSlug:
      mutation.isPending && mutation.variables?.recipes.length === 1
        ? mutation.variables.recipes[0]?.slug
        : undefined,
    mutation,
  };
}
