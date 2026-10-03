"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { RecipeAuthRequired } from "@/components/recipes/recipe-auth-required";
import { RecipeQueryStatus } from "@/components/recipes/recipe-load-state";
import { ShoppingView } from "@/components/recipes/shopping/shopping-view";
import { recipeRecordsToShoppingRecipes } from "@/lib/api/shopping";
import { authClient } from "@/lib/auth-client";
import { recipeBootstrapQuery } from "@/lib/query/recipe-queries";

export function RecipeShopping() {
  const { data: session, isPending } = authClient.useSession();
  const recipeBox = useQuery({
    ...recipeBootstrapQuery(session?.user.id ?? "pending"),
    enabled: !isPending && Boolean(session),
    select: ({ diet, recipeBox }) => ({
      ingredients: diet.options.ingredients,
      recipes: recipeRecordsToShoppingRecipes(recipeBox.recipes),
    }),
  });

  if (isPending) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="animate-spin text-[var(--terracotta)]" />
      </div>
    );
  }
  if (!session) {
    return (
      <RecipeAuthRequired
        title="Log in to make a list"
        description="Your shopping list is built from the recipes in your box."
      />
    );
  }

  if (recipeBox.isError && recipeBox.data === undefined) {
    return (
      <p className="rt-body p-8 text-center">
        Your recipes could not be loaded.
      </p>
    );
  }
  if (recipeBox.isPending) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="animate-spin text-[var(--terracotta)]" />
      </div>
    );
  }
  return (
    <>
      <RecipeQueryStatus
        error={recipeBox.error}
        hasData
        isFetching={recipeBox.isFetching}
        isStale={recipeBox.isStale}
        subject="your shopping recipes"
      />
      <ShoppingView
        ingredientCatalog={recipeBox.data.ingredients}
        recipes={recipeBox.data.recipes}
      />
    </>
  );
}
