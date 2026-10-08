import { normalizeSlug } from "recipe-domain/slugs";
import type { EquipmentRecipeMatchMode } from "@/lib/api/households";

export type EquipmentRecipe = {
  cookware: readonly string[];
};

export type EquipmentMatch = {
  matches: boolean;
  missingEquipment: { slug: string; name: string }[];
};

export type EffectiveEquipmentReadiness = {
  active: boolean;
  householdId: string | null;
  householdName: string | null;
  mode: EquipmentRecipeMatchMode;
  ownedSlugs: ReadonlySet<string>;
  equipmentNames: ReadonlyMap<string, string>;
};

export const fallbackEquipmentReadiness: EffectiveEquipmentReadiness = {
  active: false,
  householdId: null,
  householdName: null,
  mode: "warn",
  ownedSlugs: new Set(),
  equipmentNames: new Map(),
};

export const MATCHING_EQUIPMENT: EquipmentMatch = {
  matches: true,
  missingEquipment: [],
};

export function matchRecipeToEquipment(
  recipe: EquipmentRecipe,
  equipment: EffectiveEquipmentReadiness,
): EquipmentMatch {
  if (!equipment.active) return MATCHING_EQUIPMENT;

  const required = new Map(
    recipe.cookware.map((name) => {
      const slug = normalizeSlug(name);
      return [slug, { slug, name: equipment.equipmentNames.get(slug) ?? name }];
    }),
  );
  const missingEquipment = Array.from(required.values()).filter(
    ({ slug }) => !equipment.ownedSlugs.has(slug),
  );
  return { matches: missingEquipment.length === 0, missingEquipment };
}

export function buildEquipmentRecipeMatches<T extends { slug: string }>(
  recipes: T[],
  equipment: EffectiveEquipmentReadiness,
  toEquipmentRecipe: (recipe: T) => EquipmentRecipe,
): Map<string, EquipmentMatch> {
  return new Map(
    recipes.map((recipe) => [
      recipe.slug,
      matchRecipeToEquipment(toEquipmentRecipe(recipe), equipment),
    ]),
  );
}

export function applyEquipmentRecipeVisibility<T extends { slug: string }>(
  recipes: T[],
  matches: ReadonlyMap<string, EquipmentMatch>,
  equipment: Pick<EffectiveEquipmentReadiness, "active" | "mode">,
  showHidden: boolean,
): { visibleRecipes: T[]; hiddenCount: number } {
  if (!equipment.active || equipment.mode !== "hide") {
    return { visibleRecipes: recipes, hiddenCount: 0 };
  }
  const matchingRecipes = recipes.filter(
    (recipe) => matches.get(recipe.slug)?.matches === true,
  );
  return {
    visibleRecipes: showHidden ? recipes : matchingRecipes,
    hiddenCount: recipes.length - matchingRecipes.length,
  };
}
