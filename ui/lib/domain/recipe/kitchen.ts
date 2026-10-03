import {
  PANTRY_LOCATIONS,
  type PantryLocation,
  PantryLocationSchema,
} from "recipe-domain/pantry";
import { normalizeSlug } from "recipe-domain/slugs";
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
  cookware?: string[];
};

export type KitchenRecipeMatch = KitchenRecipeView & {
  haveCount: number;
  missingCount: number;
  totalCount: number;
  matchRatio: number;
  missingIngredients: KitchenRecipeIngredientView[];
  equipmentHaveCount: number;
  equipmentTotalCount: number;
  missingEquipment: { slug: string; name: string }[];
  canCook: boolean;
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
  availableEquipmentSlugs: Iterable<string> | null = null,
): KitchenRecipeMatch[] {
  const available = new Set(availableIngredientSlugs);
  const availableEquipment = availableEquipmentSlugs
    ? new Set(availableEquipmentSlugs)
    : null;

  return recipes
    .map((recipe) => {
      const missingIngredients = recipe.ingredients.filter(
        (ingredient) => !available.has(ingredient.slug),
      );
      const totalCount = recipe.ingredients.length;
      const missingCount = missingIngredients.length;
      const haveCount = totalCount - missingCount;
      const requiredEquipment = new Map(
        (recipe.cookware ?? []).map((name) => [normalizeSlug(name), name]),
      );
      const missingEquipment = availableEquipment
        ? Array.from(requiredEquipment, ([slug, name]) => ({
            slug,
            name,
          })).filter(({ slug }) => !availableEquipment.has(slug))
        : [];
      const equipmentTotalCount = availableEquipment
        ? requiredEquipment.size
        : 0;
      const equipmentHaveCount = equipmentTotalCount - missingEquipment.length;
      const readinessTotal = totalCount + equipmentTotalCount;
      const readinessHave = haveCount + equipmentHaveCount;

      return {
        ...recipe,
        haveCount,
        missingCount,
        totalCount,
        matchRatio: readinessTotal > 0 ? readinessHave / readinessTotal : 0,
        missingIngredients,
        equipmentHaveCount,
        equipmentTotalCount,
        missingEquipment,
        canCook:
          totalCount > 0 && missingCount === 0 && missingEquipment.length === 0,
      };
    })
    .sort((a, b) => {
      const ratioComparison = b.matchRatio - a.matchRatio;
      if (ratioComparison !== 0) return ratioComparison;

      const missingComparison = a.missingCount - b.missingCount;
      if (missingComparison !== 0) return missingComparison;

      const equipmentComparison =
        a.missingEquipment.length - b.missingEquipment.length;
      if (equipmentComparison !== 0) return equipmentComparison;

      return a.title.localeCompare(b.title);
    });
}
