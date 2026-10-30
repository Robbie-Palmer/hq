import { ArrowLeft, ArrowRight } from "lucide-react";
import { RecipePageLink } from "@/components/recipes/recipe-page-link";
import type { RecipeCardView } from "@/lib/api/recipes";
import { recipePageHref } from "@/lib/domain/recipe/recipeDraft";
import { cn } from "@/lib/generic/styles";

interface RecipePaginationProps {
  prevRecipe?: RecipeCardView;
  nextRecipe?: RecipeCardView;
  className?: string;
}

export function RecipePagination({
  prevRecipe,
  nextRecipe,
  className,
}: Readonly<RecipePaginationProps>) {
  if (!prevRecipe && !nextRecipe) return null;

  const hasBothDirections = Boolean(prevRecipe && nextRecipe);

  return (
    <nav
      aria-label="Recipe navigation"
      className={cn("border-t border-border/60 pt-8", className)}
    >
      <div className="mb-4 text-sm font-medium text-muted-foreground">
        More recipes
      </div>

      <div
        className={cn(
          "grid w-full gap-3",
          hasBothDirections ? "sm:grid-cols-2" : "sm:grid-cols-1",
        )}
      >
        {prevRecipe ? (
          <RecipePageLink
            href={recipePageHref(prevRecipe)}
            className="block min-w-0"
          >
            <div className="flex h-full min-w-0 items-center gap-3 rounded-lg border border-border/60 bg-muted/20 px-4 py-3 transition-colors hover:bg-muted/40">
              <ArrowLeft
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-muted-foreground"
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Previous
                </div>
                <div className="overflow-hidden text-sm font-medium break-words">
                  {prevRecipe.title}
                </div>
              </div>
            </div>
          </RecipePageLink>
        ) : null}

        {nextRecipe ? (
          <RecipePageLink
            href={recipePageHref(nextRecipe)}
            className="block min-w-0"
          >
            <div className="flex h-full min-w-0 items-center gap-3 rounded-lg border border-border/60 bg-muted/20 px-4 py-3 transition-colors hover:bg-muted/40">
              <ArrowRight
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-muted-foreground sm:order-2"
              />
              <div className="min-w-0 flex-1 sm:text-right">
                <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Next
                </div>
                <div className="overflow-hidden text-sm font-medium break-words">
                  {nextRecipe.title}
                </div>
              </div>
            </div>
          </RecipePageLink>
        ) : null}
      </div>
    </nav>
  );
}
