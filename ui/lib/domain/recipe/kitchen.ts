import { convertUnit } from "recipe-domain/conversion";
import {
  PANTRY_LOCATIONS,
  type PantryFreshness,
  type PantryItemDetails,
  type PantryLocation,
  PantryLocationSchema,
} from "recipe-domain/pantry";
import { normalizeSlug } from "recipe-domain/slugs";
import { normalizeUnitToken } from "recipe-domain/unit";
import type {
  Ingredient,
  IngredientCategory,
  IngredientSlug,
} from "./ingredient";

export type KitchenLocation = PantryLocation;
export type KitchenFreshness = PantryFreshness;
export type KitchenItemDetails = PantryItemDetails;

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
  freezer: {
    label: "Freezer",
    description: "Frozen meals, vegetables, proteins, ice.",
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
  amount?: number;
  unit?: string;
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

export type KitchenFreshnessStatus =
  | "past_use_by"
  | "past_best_before"
  | "estimate_elapsed"
  | "use_soon"
  | null;

export function localIsoDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function pantryEstimateEndDate(
  estimate: NonNullable<PantryFreshness["estimate"]>,
): string {
  const start = new Date(`${estimate.startingOn}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() + estimate.expectedDays);
  return start.toISOString().slice(0, 10);
}

function daysBetween(first: string, second: string): number {
  return (
    (Date.parse(`${second}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) /
    86_400_000
  );
}

export function getKitchenFreshnessStatus(
  freshness: PantryFreshness,
  today = localIsoDate(),
): KitchenFreshnessStatus {
  if (freshness.useBy && freshness.useBy < today) return "past_use_by";
  if (freshness.bestBefore && freshness.bestBefore < today) {
    return "past_best_before";
  }
  const estimatedEnd = freshness.estimate
    ? pantryEstimateEndDate(freshness.estimate)
    : null;
  if (estimatedEnd && estimatedEnd < today) return "estimate_elapsed";
  const nextDate = [freshness.useBy, freshness.bestBefore, estimatedEnd]
    .filter((date): date is string => date !== null)
    .toSorted()[0];
  return nextDate && daysBetween(today, nextDate) <= 3 ? "use_soon" : null;
}

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

function kitchenItemIsAvailable(
  ingredient: KitchenRecipeIngredientView,
  item: KitchenItemDetails | undefined,
  today: string,
): boolean {
  if (!item) return false;
  if (item.freshness.useBy && item.freshness.useBy < today) return false;
  if (
    ingredient.amount !== undefined &&
    ingredient.unit !== undefined &&
    item.quantity
  ) {
    const ingredientUnit = normalizeUnitToken(ingredient.unit);
    const stockedUnit = normalizeUnitToken(item.quantity.unit);
    if (ingredientUnit && stockedUnit) {
      const availableAmount = convertUnit(
        item.quantity.amount,
        stockedUnit,
        ingredientUnit,
      );
      if (availableAmount !== null) {
        return availableAmount >= ingredient.amount;
      }
      if (stockedUnit === ingredientUnit) {
        return item.quantity.amount >= ingredient.amount;
      }
    }
  }
  return true;
}

export function getKitchenRecipeMatches(
  recipes: KitchenRecipeView[],
  availableIngredientSlugs:
    | Iterable<IngredientSlug>
    | Record<string, KitchenItemDetails>,
  availableEquipmentSlugs: Iterable<string> | null = null,
  today = localIsoDate(),
): KitchenRecipeMatch[] {
  const itemDetails =
    Symbol.iterator in Object(availableIngredientSlugs)
      ? null
      : (availableIngredientSlugs as Record<string, KitchenItemDetails>);
  const available = itemDetails
    ? new Set(Object.keys(itemDetails))
    : new Set(availableIngredientSlugs as Iterable<IngredientSlug>);
  const availableEquipment = availableEquipmentSlugs
    ? new Set(availableEquipmentSlugs)
    : null;

  return recipes
    .map((recipe) => {
      const missingIngredients = recipe.ingredients.filter((ingredient) => {
        if (!available.has(ingredient.slug)) return true;
        return itemDetails
          ? !kitchenItemIsAvailable(
              ingredient,
              itemDetails[ingredient.slug],
              today,
            )
          : false;
      });
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
