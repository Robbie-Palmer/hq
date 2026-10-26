"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { MealPlanningView } from "@/components/recipes/planning/meal-planning-view";
import { RecipeAuthRequired } from "@/components/recipes/recipe-auth-required";
import { RecipeQueryStatus } from "@/components/recipes/recipe-load-state";
import { recipeRecordsToShoppingRecipes } from "@/lib/api/shopping";
import { authClient } from "@/lib/auth-client";
import { recipeBootstrapQuery } from "@/lib/query/recipe-queries";

export function RecipePlanning() {
  const { data: session, isPending } = authClient.useSession();
  const recipeBox = useQuery({
    ...recipeBootstrapQuery(session?.user.id ?? "pending"),
    enabled: !isPending && Boolean(session),
    select: ({ recipeBox }) =>
      recipeRecordsToShoppingRecipes(recipeBox.recipes),
  });

  if (isPending) {
    return <PlanningLoader />;
  }
  if (!session) {
    return (
      <RecipeAuthRequired
        title="Log in to plan a meal"
        description="Your meal plan follows you and your household across devices."
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
    return <PlanningLoader />;
  }
  return (
    <>
      <RecipeQueryStatus
        error={recipeBox.error}
        hasData
        isFetching={recipeBox.isFetching}
        isStale={recipeBox.isStale}
        subject="your meal-planning recipes"
      />
      <MealPlanningView recipes={recipeBox.data} />
    </>
  );
}

function PlanningLoader() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Loader2 className="animate-spin text-[var(--terracotta)]" />
    </div>
  );
}
