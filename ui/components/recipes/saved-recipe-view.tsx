"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, LockKeyhole, Pencil } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { isRecipeSlug, recipeSlugFromPathname } from "recipe-domain/slugs";
import { errorMessage } from "ts-base/errors";
import { RecipeContent } from "@/components/recipes/recipe-content";
import {
  RecipeLoadError,
  RecipeLoading,
  RecipeQueryStatus,
} from "@/components/recipes/recipe-load-state";
import { ShareRecipeButton } from "@/components/recipes/share-recipe-button";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import {
  parseSavedRecipe,
  recipePageHref,
} from "@/lib/domain/recipe/recipeDraft";
import { savedRecipeQuery } from "@/lib/query/recipe-queries";
import { cachedRecipeFromBootstrap } from "@/lib/query/recipe-query-client";
import { recipeQueryKeys } from "@/lib/query/recipe-query-keys";

export function SavedRecipeView() {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const searchSlug = useSearchParams().get("slug");
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const pathSlug = recipeSlugFromPathname(pathname);
  const slug =
    pathname === "/recipes/saved" ? searchSlug : (searchSlug ?? pathSlug);
  const validSlug = isRecipeSlug(slug);
  const result = useQuery({
    ...savedRecipeQuery(session?.user.id ?? null, slug ?? "invalid"),
    enabled: !sessionPending && validSlug,
    initialData: () =>
      session?.user.id && slug
        ? cachedRecipeFromBootstrap(queryClient, session.user.id, slug)
        : undefined,
    initialDataUpdatedAt: () =>
      session?.user.id
        ? queryClient.getQueryState(recipeQueryKeys.bootstrap(session.user.id))
            ?.dataUpdatedAt
        : undefined,
  });

  useEffect(() => {
    if (pathname === "/recipes/saved" && searchSlug && validSlug) {
      window.history.replaceState(
        window.history.state,
        "",
        recipePageHref({ slug: searchSlug }),
      );
    }
  }, [pathname, searchSlug, validSlug]);

  if (!validSlug) {
    return (
      <RecipeLoadError
        title="Recipe not found"
        message="No saved recipe was selected."
      />
    );
  }
  if (sessionPending || result.isPending) {
    return <RecipeLoading />;
  }
  if (result.isError && result.data === undefined) {
    return (
      <RecipeLoadError
        title="Recipe not found"
        message={errorMessage(result.error, "The recipe could not be loaded.")}
      />
    );
  }
  const recipe = parseSavedRecipe(result.data);
  if (!recipe) {
    return (
      <RecipeLoadError
        title="Recipe not found"
        message="The saved recipe is not in a supported format."
      />
    );
  }

  return (
    <>
      <RecipeQueryStatus
        error={result.error}
        hasData
        isFetching={result.isFetching}
        isStale={result.isStale}
        subject="this recipe"
      />
      <div className="container mx-auto min-h-screen max-w-5xl px-4 py-5 md:py-8">
        <div className="mb-5 flex items-center justify-between gap-4">
          <Link
            href="/recipes"
            className="rt-mono inline-flex items-center gap-1 text-[var(--ink-3)] hover:text-[var(--terracotta)]"
          >
            <ArrowLeft className="size-3.5" /> All recipes
          </Link>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {result.data.visibility !== "private" && (
              <ShareRecipeButton
                recipeSlug={recipe.slug}
                recipeTitle={recipe.title}
              />
            )}
            {result.data.owned === true && (
              <Button
                asChild
                variant="outline"
                size="sm"
                className="rounded-full"
              >
                <Link
                  href={`/recipes/edit?slug=${encodeURIComponent(recipe.slug)}`}
                >
                  <Pencil /> Edit recipe
                </Link>
              </Button>
            )}
            <span className="rt-mono inline-flex items-center gap-1.5 rounded-full border border-[var(--line-strong)] bg-[var(--paper-warm)] px-3 py-1 text-[var(--ink-3)]">
              <LockKeyhole className="size-3" /> {result.data.visibility}
            </span>
          </div>
        </div>
        <RecipeContent recipe={recipe} recipeVersion={result.data.updatedAt} />
      </div>
    </>
  );
}
