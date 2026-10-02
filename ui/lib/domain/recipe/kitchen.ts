import {
  PANTRY_LOCATIONS,
  type PantryLocation,
  PantryLocationSchema,
} from "recipe-domain/pantry";
import type {
  Ingredient,
  IngredientCategory,
  IngredientSlug,
} from "./ingredient";

export type KitchenLocation = PantryLocation;

export type KitchenStock = Record<string, KitchenLocation>;

export type KitchenLocationView = {
  id: KitchenLocation;
  label: string;
  description: string;
};

const KITCHEN_LOCATION_DETAILS = {
  fridge: {
    label: "Fridge",
    description: "Dairy, eggs, proteins, opened jars.",
  },
  cupboards: {
    label: "Cupboards",
    description: "Pasta, tins, oils, spices, dry goods.",
  },
  fresh: {
    label: "Fresh",
    description: "Fruit, vegetables, herbs.",
  },
} satisfies Record<KitchenLocation, Omit<KitchenLocationView, "id">>;

export const KITCHEN_LOCATIONS: KitchenLocationView[] = PANTRY_LOCATIONS.map(
  (id) => ({ id, ...KITCHEN_LOCATION_DETAILS[id] }),
);

export type KitchenIngredientView = {
  slug: IngredientSlug;
  name: string;
  category?: IngredientCategory;
};

export type KitchenRecipeIngredientView = {
  slug: IngredientSlug;
  name: string;
};

export type KitchenRecipeView = {
  slug: string;
  href?: string;
  title: string;
  cuisine: string[];
  totalTime?: number;
  image?: string;
  imageAlt?: string;
  ingredients: KitchenRecipeIngredientView[];
};

export type KitchenRecipeMatch = KitchenRecipeView & {
  haveCount: number;
  missingCount: number;
  totalCount: number;
  matchRatio: number;
  missingIngredients: KitchenRecipeIngredientView[];
};

export function isKitchenLocation(value: unknown): value is KitchenLocation {
  return PantryLocationSchema.safeParse(value).success;
}

export function toKitchenIngredientView(
  ingredient: Ingredient,
): KitchenIngredientView {
  return {
    slug: ingredient.slug,
    name: ingredient.name,
    category: ingredient.category,
  };
}

export function getDietRelevantKitchenIngredients(
  ingredients: readonly KitchenIngredientView[],
  excludedIngredientSlugs: ReadonlySet<string>,
  includeExcluded = false,
): KitchenIngredientView[] {
  if (includeExcluded || excludedIngredientSlugs.size === 0) {
    return [...ingredients];
  }
  return ingredients.filter(
    (ingredient) => !excludedIngredientSlugs.has(ingredient.slug),
  );
}

export function getKitchenRecipeMatches(
  recipes: KitchenRecipeView[],
  availableIngredientSlugs: Iterable<IngredientSlug>,
): KitchenRecipeMatch[] {
  const available = new Set(availableIngredientSlugs);

  return recipes
    .map((recipe) => {
      const missingIngredients = recipe.ingredients.filter(
        (ingredient) => !available.has(ingredient.slug),
      );
      const totalCount = recipe.ingredients.length;
      const missingCount = missingIngredients.length;
      const haveCount = totalCount - missingCount;

      return {
        ...recipe,
        haveCount,
        missingCount,
        totalCount,
        matchRatio: totalCount > 0 ? haveCount / totalCount : 0,
        missingIngredients,
      };
    })
    .sort((a, b) => {
      const ratioComparison = b.matchRatio - a.matchRatio;
      if (ratioComparison !== 0) return ratioComparison;

      const missingComparison = a.missingCount - b.missingCount;
      if (missingComparison !== 0) return missingComparison;

      return a.title.localeCompare(b.title);
    });
}
