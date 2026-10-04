import type { UnresolvedAuthoredTerm } from "@/lib/api/authored-terms";
import { apiRequest } from "@/lib/api/http";

export type DietRecipeMatchMode = "hide" | "warn";

export type DietProfile = {
  presetDietKeys: string[];
  excludedIngredientSlugs: string[];
  excludedGroupKeys: string[];
  recipeMatchMode: DietRecipeMatchMode;
  unresolvedTerms?: UnresolvedAuthoredTerm[];
};

export type DietIngredientOption = {
  slug: string;
  name: string;
  category?: string;
};

type DietLabelOption = {
  key: string;
  label: string;
  sub: string;
};

export type DietGroupOption = DietLabelOption & {
  /** Direct classification parents. Ingredient slugs include narrower groups. */
  broaderGroupKeys: string[];
  ingredientSlugs: string[];
};

export type DietPresetOption = DietLabelOption & {
  excludedGroupKeys: string[];
  excludedIngredientSlugs: string[];
};

export type DietOptions = {
  presets: DietPresetOption[];
  groups: DietGroupOption[];
  ingredients: DietIngredientOption[];
};

export const emptyDietProfile: DietProfile = {
  presetDietKeys: [],
  excludedIngredientSlugs: [],
  excludedGroupKeys: [],
  recipeMatchMode: "hide",
  unresolvedTerms: [],
};

export const emptyDietOptions: DietOptions = {
  presets: [],
  groups: [],
  ingredients: [],
};

export async function getDietProfile(
  signal?: AbortSignal,
): Promise<DietProfile> {
  return apiRequest("/api/profile/diet", {
    signal,
    fallbackMessage: "Diet profile request failed.",
  });
}

export async function getDietOptions(
  signal?: AbortSignal,
): Promise<DietOptions> {
  return apiRequest("/api/profile/diet/options", {
    signal,
    fallbackMessage: "Diet options request failed.",
  });
}

export async function saveDietProfile(
  profile: DietProfile,
  signal?: AbortSignal,
): Promise<DietProfile> {
  const { unresolvedTerms: _unresolvedTerms, ...request } = profile;
  return apiRequest("/api/profile/diet", {
    method: "PUT",
    json: request,
    signal,
    fallbackMessage: "Diet profile request failed.",
  });
}
