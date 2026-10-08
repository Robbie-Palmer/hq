"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo } from "react";
import { useDiet } from "@/components/recipes/diet-provider";
import { RecipeList } from "@/components/recipes/recipe-list";
import { RecipeQueryStatus } from "@/components/recipes/recipe-load-state";
import { CardGridSkeleton } from "@/components/ui/card-grid-skeleton";
import { authClient } from "@/lib/auth-client";
import { savedRecipeCard } from "@/lib/domain/recipe/recipeDraft";
import type { RecipeCatalogStats } from "@/lib/domain/recipe/recipeViews";
import { recipeBoxRecipesQuery } from "@/lib/query/recipe-queries";

export function RecipeCollection({
  onCatalogStatsChange,
  onDietVisibleCountChange,
}: Readonly<{
  onCatalogStatsChange?: (stats: RecipeCatalogStats) => void;
  onDietVisibleCountChange?: (count: number) => void;
}>) {
  const { data: session, isPending } = authClient.useSession();
  const { loading: dietLoading } = useDiet();
  const sessionUserId = session?.user.id;
  const recipeBox = useQuery({
    ...recipeBoxRecipesQuery(sessionUserId ?? "pending"),
    enabled: !isPending && Boolean(sessionUserId),
  });
  const personalizationLoading = Boolean(
    sessionUserId && (recipeBox.isPending || dietLoading),
  );
  const saved = recipeBox.data?.recipes ?? [];
  const box = recipeBox.data?.box ?? null;

  const combined = useMemo(
    () =>
      saved.flatMap((record) => {
        const card = savedRecipeCard(record);
        return card ? [card] : [];
      }),
    [saved],
  );
  const catalogStats = useMemo(
    () => ({
      cuisineCount: new Set(combined.flatMap((recipe) => recipe.cuisine)).size,
      ingredientCount: new Set(
        combined.flatMap((recipe) => recipe.ingredientNames),
      ).size,
      equipmentCount: new Set(combined.flatMap((recipe) => recipe.cookware))
        .size,
    }),
    [combined],
  );

  useEffect(() => {
    if (!sessionUserId || recipeBox.isPending) {
      return;
    }
    onCatalogStatsChange?.(catalogStats);
  }, [catalogStats, onCatalogStatsChange, sessionUserId, recipeBox.isPending]);

  if (isPending || personalizationLoading) {
    return (
      <div>
        <CardGridSkeleton variant="filters" />
        <output aria-label="Loading personalized recipes" className="sr-only">
          Loading personalized recipes…
        </output>
      </div>
    );
  }

  return (
    <>
      <RecipeQueryStatus
        error={recipeBox.error}
        hasData={recipeBox.data !== undefined}
        isFetching={recipeBox.isFetching}
        isStale={recipeBox.isStale}
        subject="your recipe box"
      />
      {session && box && !box.completed ? (
        <div className="rt-body mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--terracotta)]/30 bg-[var(--butter-soft)] px-4 py-3 text-sm text-[var(--ink-2)]">
          <span>
            Make this box yours with a diet and a few starter recipes.
          </span>
          <Link
            href="/recipes/onboarding"
            className="font-bold text-[var(--terracotta-deep)] hover:underline"
          >
            Set up my box →
          </Link>
        </div>
      ) : null}
      <RecipeList
        recipes={combined}
        shoppingListUserId={sessionUserId}
        onDietVisibleCountChange={onDietVisibleCountChange}
      />
    </>
  );
}
