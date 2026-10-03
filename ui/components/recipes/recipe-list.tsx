"use client";

import {
  Check,
  ChefHat,
  Clock,
  Globe,
  House,
  Leaf,
  Loader2,
  Plus,
  Timer,
  UserRound,
  UtensilsCrossed,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DietListNotice, DietWarning } from "@/components/recipes/diet-notice";
import { useDiet } from "@/components/recipes/diet-provider";
import {
  EquipmentListNotice,
  EquipmentWarning,
} from "@/components/recipes/equipment-readiness-notice";
import { useEquipmentReadiness } from "@/components/recipes/equipment-readiness-provider";
import { RecipePageLink } from "@/components/recipes/recipe-page-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  FilterableCardGrid,
  type MultiFilterConfig,
  type SearchConfig,
} from "@/components/ui/filterable-card-grid";
import { useFilterParams } from "@/hooks/use-filter-params";
import {
  type RecipeListShoppingRecipe,
  useRecipeListShopping,
} from "@/hooks/use-recipe-list-shopping";
import type { RecipeCardView } from "@/lib/api/recipes";
import {
  applyDietRecipeVisibility,
  buildDietRecipeMatches,
  type DietMatch,
} from "@/lib/domain/diet";
import {
  applyEquipmentRecipeVisibility,
  buildEquipmentRecipeMatches,
  type EquipmentMatch,
  MATCHING_EQUIPMENT,
} from "@/lib/domain/equipment-readiness";
import {
  type RecipeGridItem,
  recipePageHref,
} from "@/lib/domain/recipe/recipeDraft";
import { formatRecipeTime } from "@/lib/domain/recipe/time";
import { formatDate } from "@/lib/generic/date";
import { cycleFilterFromCard } from "@/lib/generic/filter-cycle";
import { getImageUrl } from "@/lib/integrations/cloudflare-images";

const TIME_RANGES = [
  { label: "Under 15 min", max: 14 },
  { label: "15–30 min", min: 15, max: 30 },
  { label: "30–60 min", min: 31, max: 60 },
  { label: "Over 60 min", min: 61 },
] as const;

const MATCHING_DIET_MATCH: DietMatch = {
  matches: true,
  excludedIngredients: [],
};

function getTimeRangeLabel(minutes: number): string {
  for (const range of TIME_RANGES) {
    const aboveMin = !("min" in range) || minutes >= range.min;
    const belowMax = !("max" in range) || minutes <= range.max;
    if (aboveMin && belowMax) return range.label;
  }
  // Fallback to last range (should never reach here given the ranges cover all values)
  return TIME_RANGES[TIME_RANGES.length - 1]?.label ?? "";
}

// These configs are static. Defining them at module scope (rather than inline
// in the JSX) keeps their references stable across renders, so FilterableCardGrid
// doesn't rebuild its Fuse index or recompute its memos on every filter toggle.
const RECIPE_FILTER_PARAMS = [
  { paramName: "cuisine", isMulti: true },
  { paramName: "ingredient", isMulti: true },
  { paramName: "equipment", isMulti: true },
  { paramName: "prepTime", isMulti: true },
  { paramName: "totalTime", isMulti: true },
];

const URL_SYNC_DEBOUNCE_MS = 300;

const RECIPE_SEARCH_CONFIG: SearchConfig<RecipeCardView> = {
  placeholder: "Search recipes…",
  ariaLabel: "Search recipes",
  keys: [
    { name: "title", weight: 3 },
    { name: "description", weight: 2 },
    { name: "cuisine", weight: 2 },
    { name: "ingredientNames", weight: 1 },
    { name: "cookware", weight: 1 },
  ],
  threshold: 0.1,
};

const RECIPE_FILTER_CONFIGS: MultiFilterConfig<RecipeCardView>[] = [
  {
    paramName: "cuisine",
    isMulti: true,
    label: "Cuisines",
    getItemValues: (recipe) => recipe.cuisine,
    icon: <Globe className="h-4 w-4" />,
    getValueLabel: (value) => value,
    getOptionIcon: () => <Globe className="h-3 w-3" />,
  },
  {
    paramName: "ingredient",
    isMulti: true,
    label: "Ingredients",
    getItemValues: (recipe) => recipe.ingredientNames,
    icon: <Leaf className="h-4 w-4" />,
    getValueLabel: (value) => value,
    getOptionIcon: () => <Leaf className="h-3 w-3" />,
  },
  {
    paramName: "equipment",
    isMulti: true,
    label: "Equipment",
    getItemValues: (recipe) => recipe.cookware,
    icon: <ChefHat className="h-4 w-4" />,
    getValueLabel: (value) => value,
    getOptionIcon: () => <ChefHat className="h-3 w-3" />,
  },
  {
    paramName: "prepTime",
    isMulti: true,
    label: "Prep Time",
    getItemValues: (recipe) =>
      recipe.prepTime != null ? [getTimeRangeLabel(recipe.prepTime)] : [],
    icon: <Timer className="h-4 w-4" />,
    getValueLabel: (value) => value,
    getOptionIcon: () => <Timer className="h-3 w-3" />,
  },
  {
    paramName: "totalTime",
    isMulti: true,
    label: "Total Time",
    getItemValues: (recipe) =>
      recipe.totalTime != null ? [getTimeRangeLabel(recipe.totalTime)] : [],
    icon: <Clock className="h-4 w-4" />,
    getOptionIcon: () => <Clock className="h-3 w-3" />,
  },
];

const RECIPE_SORT_CONFIG = {
  getDate: (recipe: RecipeCardView) => recipe.date,
};

const RECIPE_EMPTY_STATE = {
  icon: <UtensilsCrossed className="w-10 h-10 text-muted-foreground/50" />,
  message: "No recipes found matching your criteria.",
};

const VISIBILITY_INDICATORS = {
  private: {
    Icon: UserRound,
    label: "Only you can view this recipe",
  },
  household: {
    Icon: House,
    label: "Shared with your household",
  },
  public: {
    Icon: Globe,
    label: "Public recipe",
  },
} as const;

function CuisineBadge({
  cuisine,
  isActive,
  onToggle,
}: Readonly<{
  cuisine: string;
  isActive: boolean;
  onToggle: (cuisine: string) => void;
}>) {
  return (
    <Badge
      variant={isActive ? "default" : "secondary"}
      interactive
      active={isActive}
      className="gap-1 cursor-pointer"
      onClick={() => onToggle(cuisine)}
    >
      <Globe className="h-3 w-3" />
      {cuisine}
    </Badge>
  );
}

function TimeBadge({
  label,
  minutes,
  icon,
  isActive,
  onToggle,
}: Readonly<{
  label: string;
  minutes: number;
  icon: ReactNode;
  isActive: boolean;
  onToggle: (rangeLabel: string) => void;
}>) {
  const rangeLabel = getTimeRangeLabel(minutes);
  return (
    <Badge
      variant={isActive ? "default" : "secondary"}
      interactive
      active={isActive}
      className="gap-1 cursor-pointer"
      onClick={() => onToggle(rangeLabel)}
    >
      {icon}
      {label}: {formatRecipeTime(minutes)}
    </Badge>
  );
}

type RecipeCardShopping = {
  inList: boolean;
  isLoading: boolean;
  isError: boolean;
  isDisabled: boolean;
  isPending: boolean;
  onToggleList: () => void;
};

function RecipeCardShoppingActions({
  recipeTitle,
  shopping,
}: Readonly<{
  recipeTitle: string;
  shopping: RecipeCardShopping;
}>) {
  let actionLabel = `Add ${recipeTitle} to the shopping list`;
  let visibleLabel = "Add to shopping list";
  let icon = <Plus className="size-4" />;
  if (shopping.isError) {
    actionLabel = `Shopping list unavailable for ${recipeTitle}`;
    visibleLabel = "Shopping list unavailable";
  } else if (shopping.inList) {
    actionLabel = `Remove ${recipeTitle} from the shopping list`;
    visibleLabel = "On shopping list";
    icon = <Check className="size-4" />;
  }
  if (shopping.isLoading || shopping.isPending) {
    icon = <Loader2 className="size-4 animate-spin" />;
  }

  return (
    <div className="mt-4 space-y-2 border-t border-[var(--line)] pt-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={shopping.isLoading || shopping.isError || shopping.isDisabled}
        aria-busy={shopping.isPending}
        aria-pressed={shopping.inList}
        aria-label={actionLabel}
        onClick={shopping.onToggleList}
        className="w-full"
      >
        {icon}
        {visibleLabel}
      </Button>
    </div>
  );
}

interface RecipeCardProps {
  recipe: RecipeGridItem;
  index: number;
  selectedCuisines: string[];
  selectedPrepTimes: string[];
  selectedTotalTimes: string[];
  onToggleCuisine: (cuisine: string) => void;
  onTogglePrepTime: (rangeLabel: string) => void;
  onToggleTotalTime: (rangeLabel: string) => void;
  dietMatch: DietMatch;
  equipmentMatch: EquipmentMatch;
  shopping?: RecipeCardShopping;
}

// Memoized so that toggling high-cardinality filters that don't affect a card's
// appearance (ingredient, equipment) skips re-rendering all the cards. The
// selected-* arrays and toggle callbacks passed in are kept referentially stable
// by RecipeList, so memo comparison is meaningful.
const RecipeCard = memo(function RecipeCard({
  recipe,
  index,
  selectedCuisines,
  selectedPrepTimes,
  selectedTotalTimes,
  onToggleCuisine,
  onTogglePrepTime,
  onToggleTotalTime,
  dietMatch,
  equipmentMatch,
  shopping,
}: RecipeCardProps) {
  const href = recipe.href ?? recipePageHref(recipe);
  const visibility = recipe.visibility ?? "public";
  const { Icon: VisibilityIcon, label: visibilityLabel } =
    VISIBILITY_INDICATORS[visibility] ?? VISIBILITY_INDICATORS.public;
  return (
    <Card className="h-full flex flex-col overflow-hidden rounded-xl border-[1.25px] border-[var(--line-strong)] gap-0 py-0 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--paper-shadow)]">
      {recipe.image && (
        <RecipePageLink href={href} className="block">
          <div className="relative w-full h-48 bg-muted overflow-hidden">
            {/* biome-ignore lint/performance/noImgElement: Need native img for srcset control with SSG */}
            <img
              src={getImageUrl(recipe.image, null, {
                width: 400,
                format: "auto",
              })}
              alt={recipe.imageAlt || recipe.title}
              width={400}
              height={192}
              className="w-full h-full object-cover"
              loading={index < 6 ? "eager" : "lazy"}
              fetchPriority={index < 3 ? "high" : "auto"}
            />
          </div>
        </RecipePageLink>
      )}
      <CardHeader className="relative gap-1 pt-4 pb-2 pr-11">
        <span className="absolute top-4 right-4 inline-flex size-6 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--paper-warm)] text-[var(--ink-3)]">
          <VisibilityIcon aria-hidden="true" className="size-3.5" />
          <span className="sr-only">{visibilityLabel}</span>
        </span>
        <RecipePageLink href={href}>
          <CardTitle className="rt-display text-2xl leading-tight hover:text-[var(--terracotta)] transition-colors">
            {recipe.title}
          </CardTitle>
        </RecipePageLink>
        <CardDescription className="rt-body line-clamp-2">
          {recipe.description}
        </CardDescription>
        <DietWarning match={dietMatch} compact className="mt-2" />
        <EquipmentWarning match={equipmentMatch} compact className="mt-2" />
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-end pb-4">
        <div className="flex flex-wrap gap-2 mb-3">
          {recipe.cuisine.map((c) => (
            <CuisineBadge
              key={c}
              cuisine={c}
              isActive={selectedCuisines.includes(c)}
              onToggle={onToggleCuisine}
            />
          ))}
          {recipe.prepTime != null && (
            <TimeBadge
              label="Prep"
              minutes={recipe.prepTime}
              icon={<Timer className="h-3 w-3" />}
              isActive={selectedPrepTimes.includes(
                getTimeRangeLabel(recipe.prepTime),
              )}
              onToggle={onTogglePrepTime}
            />
          )}
          {recipe.totalTime != null && (
            <TimeBadge
              label="Total"
              minutes={recipe.totalTime}
              icon={<Clock className="h-3 w-3" />}
              isActive={selectedTotalTimes.includes(
                getTimeRangeLabel(recipe.totalTime),
              )}
              onToggle={onToggleTotalTime}
            />
          )}
        </div>
        <div className="text-sm text-muted-foreground">
          <time dateTime={recipe.date}>{formatDate(recipe.date)}</time>
        </div>
        {shopping && (
          <RecipeCardShoppingActions
            recipeTitle={recipe.title}
            shopping={shopping}
          />
        )}
      </CardContent>
    </Card>
  );
});

type RecipeListProps = Readonly<{
  recipes: RecipeGridItem[];
  shoppingListUserId?: string;
  onDietVisibleCountChange?: (count: number) => void;
}>;

type RecipeListShopping = ReturnType<typeof useRecipeListShopping>;

function AuthenticatedRecipeList({
  recipes,
  userId,
  onDietVisibleCountChange,
}: Readonly<{
  recipes: RecipeGridItem[];
  userId: string;
  onDietVisibleCountChange?: (count: number) => void;
}>) {
  const shopping = useRecipeListShopping(userId);
  return (
    <RecipeListContent
      recipes={recipes}
      shopping={shopping}
      onDietVisibleCountChange={onDietVisibleCountChange}
    />
  );
}

export function RecipeList({
  recipes,
  shoppingListUserId,
  onDietVisibleCountChange,
}: RecipeListProps) {
  return shoppingListUserId ? (
    <AuthenticatedRecipeList
      recipes={recipes}
      userId={shoppingListUserId}
      onDietVisibleCountChange={onDietVisibleCountChange}
    />
  ) : (
    <RecipeListContent
      recipes={recipes}
      onDietVisibleCountChange={onDietVisibleCountChange}
    />
  );
}

function RecipeListContent({
  recipes,
  shopping,
  onDietVisibleCountChange,
}: Readonly<{
  recipes: RecipeGridItem[];
  shopping?: RecipeListShopping;
  onDietVisibleCountChange?: (count: number) => void;
}>) {
  const { diet, matchRecipe } = useDiet();
  const { equipment } = useEquipmentReadiness();
  const filterParams = useFilterParams({ filters: RECIPE_FILTER_PARAMS });
  const router = useRouter();
  const [showHidden, setShowHidden] = useState(false);
  const [showEquipmentHidden, setShowEquipmentHidden] = useState(false);
  const dietMatches = useMemo(
    () =>
      buildDietRecipeMatches(recipes, matchRecipe, (recipe) => ({
        ingredients: recipe.ingredientSlugs.map((slug) => ({ slug })),
      })),
    [matchRecipe, recipes],
  );
  const { visibleRecipes, hiddenCount } = useMemo(
    () =>
      applyDietRecipeVisibility(
        recipes,
        dietMatches,
        { active: diet.active, mode: diet.mode },
        { showHidden },
      ),
    [diet.active, diet.mode, dietMatches, recipes, showHidden],
  );
  const equipmentMatches = useMemo(
    () =>
      buildEquipmentRecipeMatches(recipes, equipment, (recipe) => ({
        cookware: recipe.cookware,
      })),
    [equipment, recipes],
  );
  const {
    visibleRecipes: equipmentVisibleRecipes,
    hiddenCount: equipmentHiddenCount,
  } = useMemo(
    () =>
      applyEquipmentRecipeVisibility(
        visibleRecipes,
        equipmentMatches,
        equipment,
        showEquipmentHidden,
      ),
    [equipment, equipmentMatches, showEquipmentHidden, visibleRecipes],
  );
  useEffect(() => {
    onDietVisibleCountChange?.(equipmentVisibleRecipes.length);
  }, [equipmentVisibleRecipes.length, onDietVisibleCountChange]);

  // Derive the selected values from the raw query strings so their array
  // identities stay stable while a given filter is unchanged — this lets the
  // memoized cards skip re-rendering when an unrelated filter toggles.
  const searchParams = useSearchParams();
  const cuisineKey = searchParams.get("cuisine") ?? "";
  const prepKey = searchParams.get("prepTime") ?? "";
  const totalKey = searchParams.get("totalTime") ?? "";
  const searchParamQuery = searchParams.get("q") ?? "";
  const [searchQuery, setSearchQuery] = useState(searchParamQuery);
  const pendingUrlSearchRef = useRef<string | null>(null);
  const searchConfig = useMemo(
    () => ({
      ...RECIPE_SEARCH_CONFIG,
      placeholder: `Search ${equipmentVisibleRecipes.length} recipes…`,
    }),
    [equipmentVisibleRecipes.length],
  );
  const selectedCuisines = useMemo(
    () => (cuisineKey ? cuisineKey.split(",").filter(Boolean) : []),
    [cuisineKey],
  );
  const selectedPrepTimes = useMemo(
    () => (prepKey ? prepKey.split(",").filter(Boolean) : []),
    [prepKey],
  );
  const selectedTotalTimes = useMemo(
    () => (totalKey ? totalKey.split(",").filter(Boolean) : []),
    [totalKey],
  );
  const shoppingRecipes = useMemo(
    () =>
      recipes.map(
        (recipe): RecipeListShoppingRecipe => ({
          slug: recipe.slug,
          title: recipe.title,
          servings: recipe.servings,
        }),
      ),
    [recipes],
  );
  const shoppingRecipeBySlug = useMemo(
    () => new Map(shoppingRecipes.map((recipe) => [recipe.slug, recipe])),
    [shoppingRecipes],
  );
  // Stable toggle callbacks: useFilterParams returns fresh functions each render
  // (they close over searchParams), so route them through a ref to keep the
  // identities passed to the memoized cards constant. The ref is updated in a
  // commit-phase effect (not during render) so it always reflects committed
  // state, even under concurrent rendering.
  const pathname = usePathname();
  const filterParamsRef = useRef(filterParams);
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    filterParamsRef.current = filterParams;
    pathnameRef.current = pathname;
  });
  const onToggleCuisine = useCallback(
    (cuisine: string) =>
      cycleFilterFromCard({
        filterParams: filterParamsRef.current,
        paramName: "cuisine",
        value: cuisine,
        label: cuisine,
        page: pathnameRef.current,
      }),
    [],
  );
  const onTogglePrepTime = useCallback(
    (rangeLabel: string) =>
      cycleFilterFromCard({
        filterParams: filterParamsRef.current,
        paramName: "prepTime",
        value: rangeLabel,
        label: `prep ${rangeLabel}`,
        page: pathnameRef.current,
      }),
    [],
  );
  const onToggleTotalTime = useCallback(
    (rangeLabel: string) =>
      cycleFilterFromCard({
        filterParams: filterParamsRef.current,
        paramName: "totalTime",
        value: rangeLabel,
        label: `total ${rangeLabel}`,
        page: pathnameRef.current,
      }),
    [],
  );

  useEffect(() => {
    if (pendingUrlSearchRef.current === searchParamQuery) {
      pendingUrlSearchRef.current = null;
      return;
    }
    setSearchQuery(searchParamQuery);
  }, [searchParamQuery]);

  useEffect(() => {
    if (searchParamQuery === searchQuery) return;
    const id = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (searchQuery) {
        params.set("q", searchQuery);
      } else {
        params.delete("q");
      }
      const qs = params.toString();
      pendingUrlSearchRef.current = searchQuery;
      router.replace(qs ? `/recipes?${qs}` : "/recipes", { scroll: false });
    }, URL_SYNC_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchParamQuery, searchQuery, searchParams, router]);

  return (
    <>
      {diet.active && (
        <DietListNotice
          hiddenCount={hiddenCount}
          labels={diet.labels}
          mode={diet.mode}
          showingHidden={showHidden}
          onToggleHidden={() => setShowHidden((current) => !current)}
        />
      )}
      {equipment.active && (
        <EquipmentListNotice
          hiddenCount={equipmentHiddenCount}
          mode={equipment.mode}
          showingHidden={showEquipmentHidden}
          onToggleHidden={() => setShowEquipmentHidden((current) => !current)}
        />
      )}
      <FilterableCardGrid
        items={equipmentVisibleRecipes}
        getItemKey={(recipe) => recipe.slug}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        stackControls
        searchConfig={searchConfig}
        filterConfigs={RECIPE_FILTER_CONFIGS}
        sortConfig={RECIPE_SORT_CONFIG}
        emptyState={RECIPE_EMPTY_STATE}
        itemName="recipes"
        renderCard={(recipe, index) => (
          <RecipeCard
            recipe={recipe}
            index={index}
            selectedCuisines={selectedCuisines}
            selectedPrepTimes={selectedPrepTimes}
            selectedTotalTimes={selectedTotalTimes}
            onToggleCuisine={onToggleCuisine}
            onTogglePrepTime={onTogglePrepTime}
            onToggleTotalTime={onToggleTotalTime}
            dietMatch={dietMatches.get(recipe.slug) ?? MATCHING_DIET_MATCH}
            equipmentMatch={
              equipmentMatches.get(recipe.slug) ?? MATCHING_EQUIPMENT
            }
            shopping={
              shopping
                ? {
                    inList: shopping.recipesOnList.has(recipe.slug),
                    isLoading: shopping.isLoading,
                    isError: shopping.isError,
                    isDisabled: shopping.mutation.isPending,
                    isPending: shopping.pendingRecipeSlug === recipe.slug,
                    onToggleList: () =>
                      shopping.mutation.mutate({
                        recipes: [
                          shoppingRecipeBySlug.get(recipe.slug) ?? {
                            slug: recipe.slug,
                            title: recipe.title,
                            servings: recipe.servings,
                          },
                        ],
                        add: !shopping.recipesOnList.has(recipe.slug),
                        source: "recipe-list-card",
                      }),
                  }
                : undefined
            }
          />
        )}
      />
    </>
  );
}
