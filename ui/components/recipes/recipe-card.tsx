import { Check, ChefHat, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { DietWarning } from "@/components/recipes/diet-notice";
import { RecipePageLink } from "@/components/recipes/recipe-page-link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { DietMatch } from "@/lib/domain/diet";
import type { KitchenRecipeMatch } from "@/lib/domain/recipe/kitchen";
import { recipePageHref } from "@/lib/domain/recipe/recipeDraft";
import { cn } from "@/lib/generic/styles";
import { getImageUrl } from "@/lib/integrations/cloudflare-images";

export function formatRecipeTime(
  minutes: number | null | undefined,
): string | null {
  if (minutes == null) return null;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/** The one-line cuisine · time meta shown under a recipe title everywhere. */
export function recipeMetaLabel(recipe: {
  cuisine: string[];
  totalTime?: number | null;
}): string {
  return [
    recipe.cuisine.join(" · ").toLowerCase(),
    formatRecipeTime(recipe.totalTime),
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The square recipe thumbnail shared by every recipe card and picker row, so a
 * recipe looks the same wherever it's chosen. Falls back to a warm chef-hat
 * block when a recipe has no image.
 */
export function RecipeThumb({
  recipe,
  size = 64,
  className,
}: Readonly<{
  recipe: { title: string; image?: string; imageAlt?: string };
  size?: number;
  className?: string;
}>) {
  const box = cn("rounded-lg flex-shrink-0", className);
  if (!recipe.image) {
    return (
      <div
        className={cn(
          box,
          "flex items-center justify-center bg-[var(--paper-warm)] text-[var(--terracotta)]",
        )}
        style={{ width: size, height: size }}
      >
        <ChefHat className="size-5" />
      </div>
    );
  }
  return (
    // biome-ignore lint/performance/noImgElement: native img for SSG srcset control
    <img
      src={getImageUrl(recipe.image, null, { width: size * 2, format: "auto" })}
      alt={recipe.imageAlt || recipe.title}
      width={size}
      height={size}
      loading="lazy"
      className={cn(box, "object-cover bg-muted")}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * The recipe card shared by the kitchen's ready/close-match sections and the
 * shopping picker: thumbnail, kitchen-match progress against the shared stock,
 * what's still needed, and an add/remove shopping-list toggle. The card body is
 * a stretched link to the recipe; interactive children sit above it (z-10).
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
export function RecipeMatchCard({
  recipe,
  inList,
  onToggleList,
  highlight = false,
  footer,
  cardAction = "open-recipe",
  dietMatch,
}: Readonly<{
  recipe: KitchenRecipeMatch;
  inList: boolean;
  onToggleList: () => void;
  highlight?: boolean;
  footer?: ReactNode;
  /** What tapping the card body does: open the recipe, or toggle the list. */
  cardAction?: "open-recipe" | "toggle-list";
  dietMatch?: DietMatch;
}>) {
  const timeLabel = formatRecipeTime(recipe.totalTime);
  const canCook = recipe.totalCount > 0 && recipe.missingCount === 0;
  const progress = Math.round(recipe.matchRatio * 100);

  return (
    <Card
      className={cn(
        "group relative overflow-hidden rounded-lg border-[1.25px] bg-[var(--card)] py-0 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--paper-shadow)]",
        highlight
          ? "border-[var(--terracotta)] ring-1 ring-[var(--terracotta)]"
          : "border-[var(--line-strong)]",
      )}
    >
      {cardAction === "toggle-list" ? (
        <button
          type="button"
          aria-pressed={inList}
          aria-label={
            inList
              ? `Remove ${recipe.title} from the shopping list`
              : `Add ${recipe.title} to the shopping list`
          }
          onClick={onToggleList}
          className="absolute inset-0 cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[var(--ring)]/50"
        />
      ) : (
        <RecipePageLink
          href={recipe.href ?? recipePageHref(recipe)}
          aria-label={`Open ${recipe.title}`}
          className="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[var(--ring)]/50"
        />
      )}
      <CardContent className="p-3">
        <div className="flex min-w-0 items-start gap-3">
          <RecipeThumb recipe={recipe} size={48} />
          <div className="min-w-0 flex-1">
            <div className="rt-display text-2xl leading-none transition-colors group-hover:text-[var(--terracotta)]">
              {recipe.title}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-[var(--ink-3)]">
              {timeLabel && <span>{timeLabel}</span>}
              {recipe.cuisine.slice(0, 2).map((cuisine) => (
                <span key={cuisine}>{cuisine}</span>
              ))}
              <span>
                {recipe.haveCount}/{recipe.totalCount} ingredients
              </span>
            </div>
          </div>
          <Badge
            variant={canCook ? "default" : "outline"}
            className={cn(
              "shrink-0",
              canCook
                ? "bg-[var(--sage)] text-white"
                : "text-[var(--terracotta)]",
            )}
          >
            {canCook ? "cook" : `+${recipe.missingCount}`}
          </Badge>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--paper-warm)]">
          <div
            className={cn(
              "h-full rounded-full",
              canCook ? "bg-[var(--sage)]" : "bg-[var(--terracotta)]",
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
        {recipe.missingIngredients.length > 0 && (
          <p className="rt-body mt-2 line-clamp-2 text-sm text-[var(--ink-2)]">
            Need:{" "}
            <span className="text-[var(--terracotta)]">
              {recipe.missingIngredients
                .slice(0, 5)
                .map((ingredient) => ingredient.name)
                .join(", ")}
              {recipe.missingIngredients.length > 5 ? "..." : ""}
            </span>
          </p>
        )}
        {dietMatch && (
          <DietWarning match={dietMatch} compact className="mt-2" />
        )}
        <button
          type="button"
          onClick={onToggleList}
          aria-pressed={inList}
          className={cn(
            "relative z-10 mt-3 flex w-full items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors",
            inList
              ? "border-[var(--sage)] bg-[var(--sage)]/10 text-[var(--sage)] hover:bg-[var(--sage)]/15"
              : "border-[var(--line-strong)] text-[var(--ink-2)] hover:border-[var(--terracotta)] hover:text-[var(--terracotta)]",
          )}
        >
          {inList ? (
            <>
              <Check className="size-4" /> On shopping list
            </>
          ) : (
            <>
              <Plus className="size-4" /> Add to shopping list
            </>
          )}
        </button>
      </CardContent>
      {footer && (
        <div className="relative z-10 border-t border-[var(--line)] bg-[var(--paper-warm)]/50 px-3 py-2">
          {footer}
        </div>
      )}
    </Card>
  );
}
