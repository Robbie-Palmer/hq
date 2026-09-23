"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, ShoppingBasket } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { captureRecipeProductActivity } from "@/lib/analytics/recipe-product";
import { isApiError } from "@/lib/api/http";
import { saveCurrentShoppingList } from "@/lib/api/shopping-lists";
import { recipeQueryKeys } from "@/lib/query/recipe-query-keys";
import { shoppingListQuery } from "@/lib/query/shopping-list-queries";
import {
  getShoppingListSnapshot,
  installShoppingListSnapshot,
} from "@/lib/shopping/shoppingListStore";

export function RecipeShoppingListButton({
  recipeSlug,
  userId,
}: Readonly<{ recipeSlug: string; userId: string }>) {
  const queryClient = useQueryClient();
  const queryKey = recipeQueryKeys.shoppingList(userId);
  const current = useQuery(shoppingListQuery(userId));
  const isOnShoppingList =
    current.data?.snapshot.recipes.some(
      (recipe) => recipe.slug === recipeSlug,
    ) ?? false;
  const mutation = useMutation({
    mutationFn: async ({ add }: { add: boolean }) => {
      const latest = await queryClient.fetchQuery({
        ...shoppingListQuery(userId),
        staleTime: 0,
      });
      const isAlreadySelected = latest.snapshot.recipes.some(
        (recipe) => recipe.slug === recipeSlug,
      );
      if (isAlreadySelected === add) {
        return { updated: latest, changed: false };
      }
      const recipes = add
        ? [...latest.snapshot.recipes, { slug: recipeSlug }]
        : latest.snapshot.recipes.filter(
            (recipe) => recipe.slug !== recipeSlug,
          );
      return {
        updated: await saveCurrentShoppingList(latest.id, latest.revision, {
          ...latest.snapshot,
          recipes,
        }),
        changed: true,
      };
    },
    onSuccess: ({ updated, changed }, { add }) => {
      queryClient.setQueryData(queryKey, updated);
      installShoppingListSnapshot(
        {
          ...updated.snapshot,
          plan: getShoppingListSnapshot().plan,
        },
        updated.id,
      );
      if (add && changed) {
        captureRecipeProductActivity("shopping_recipe_added", {
          recipe_slug: recipeSlug,
          shopping_recipe_count: updated.snapshot.recipes.length,
        });
      }
    },
    onError: (error, { add }) => {
      if (isApiError(error) && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey });
      }
      toast.error(
        add
          ? "The recipe could not be added to your shopping list."
          : "The recipe could not be removed from your shopping list.",
      );
    },
  });

  const isLoading = current.isPending || mutation.isPending;
  const label = (() => {
    if (current.isError) return "Shopping list unavailable";
    if (current.isPending) return "Loading shopping list";
    if (mutation.isPending) {
      return isOnShoppingList ? "Removing..." : "Adding...";
    }
    return isOnShoppingList ? "On shopping list" : "Add to shopping list";
  })();

  return (
    <Button
      type="button"
      size="lg"
      variant="outline"
      disabled={isLoading || current.isError}
      aria-pressed={isOnShoppingList}
      onClick={() => mutation.mutate({ add: !isOnShoppingList })}
      className={
        isOnShoppingList
          ? "w-full border-[var(--sage)] bg-[var(--sage)]/10 text-[var(--sage)] hover:bg-[var(--sage)]/15 sm:w-auto"
          : "w-full border-[var(--line-strong)] text-[var(--ink-2)] hover:border-[var(--terracotta)] hover:text-[var(--terracotta)] sm:w-auto"
      }
    >
      {isLoading ? (
        <Loader2 className="size-5 animate-spin" />
      ) : isOnShoppingList ? (
        <Check className="size-5" />
      ) : (
        <ShoppingBasket className="size-5" />
      )}
      {label}
    </Button>
  );
}
