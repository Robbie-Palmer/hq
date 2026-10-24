import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isAbortError } from "browser-base/errors";
import { useEffect, useMemo, useRef, useState } from "react";
import { isRecipeSlug } from "recipe-domain/slugs";
import { captureRecipeEvent } from "@/lib/analytics/recipe-product";
import {
  type DietOptions,
  type DietProfile,
  emptyDietOptions,
  emptyDietProfile,
  getDietOptions,
  getDietProfile,
} from "@/lib/api/diet";
import { getRecipeBoxProfile } from "@/lib/api/recipe-box";
import type { RecipeCardView } from "@/lib/api/recipes";
import { recipeRecordsToCards } from "@/lib/api/recipes";
import { fetchAllSavedRecipes } from "@/lib/api/saved-recipes";
import { authClient } from "@/lib/auth-client";
import { readBrowserStorage, writeBrowserStorage } from "@/lib/browser/storage";
import { buildEffectiveDiet, filterRecipesForDiet } from "@/lib/domain/diet";
import {
  buildRecipeAuthoringHref,
  resolveOnboardingRecipeSelection,
} from "@/lib/domain/recipe/onboarding";
import { savedRecipeCard } from "@/lib/domain/recipe/recipeDraft";
import {
  saveDietProfileMutation,
  saveRecipeBoxMutation,
} from "@/lib/query/recipe-mutations";

const ONBOARDING_STARTED_STORAGE_PREFIX = "recipe-onboarding-started:v1:";

function recordOnboardingStart(userId: string): boolean {
  const key = `${ONBOARDING_STARTED_STORAGE_PREFIX}${userId}`;
  if (readBrowserStorage("localStorage", key)) return false;
  writeBrowserStorage("localStorage", key, "1");
  return true;
}

async function fetchOwnedRecipes(signal: AbortSignal) {
  try {
    return await fetchAllSavedRecipes({ scope: "owned", signal });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new Error("Your authored recipes could not be loaded.");
  }
}

function toggleValue(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((current) => current !== value)
    : [...values, value];
}

function authenticatedOnboardingStep(
  completed: boolean,
  requestedBoxStep: boolean,
): number {
  if (completed) return 3;
  return requestedBoxStep ? 2 : 1;
}

export function useRecipeOnboarding() {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const userId = session?.user.id;
  const queryClient = useQueryClient();
  const dietMutation = useMutation(
    saveDietProfileMutation(queryClient, userId ?? "pending"),
  );
  const recipeBoxMutation = useMutation(
    saveRecipeBoxMutation(queryClient, userId ?? "pending"),
  );
  const [step, setStep] = useState(0);
  const [diet, setDiet] = useState<DietProfile>(emptyDietProfile);
  const [dietOptions, setDietOptions] = useState<DietOptions>(emptyDietOptions);
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>([]);
  const [authoredRecipeSlugs, setAuthoredRecipeSlugs] = useState<string[]>([]);
  const [recipes, setRecipes] = useState<RecipeCardView[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const onboardingStartedUserId = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    const searchParams = new URLSearchParams(window.location.search);
    const requestedBoxStep = searchParams.get("step") === "box";
    const returnedAuthoredSlug = searchParams.get("authored");
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void Promise.all([
      getDietProfile(controller.signal),
      getDietOptions(controller.signal),
      getRecipeBoxProfile(controller.signal),
      fetchOwnedRecipes(controller.signal),
      fetchAllSavedRecipes({ signal: controller.signal }),
    ])
      .then(([profile, options, box, owned, readable]) => {
        const ownedSlugs = owned.flatMap((record) =>
          savedRecipeCard(record) ? [record.slug] : [],
        );
        const authoredDuringOnboarding: string[] = [];
        if (isRecipeSlug(returnedAuthoredSlug)) {
          ownedSlugs.push(returnedAuthoredSlug);
          authoredDuringOnboarding.push(returnedAuthoredSlug);
        }
        const ownedSlugSet = new Set(ownedSlugs);
        const publicRecipes = recipeRecordsToCards(
          readable.filter(
            (record) =>
              record.visibility === "public" && !ownedSlugSet.has(record.slug),
          ),
        );
        setRecipes(publicRecipes);
        setStep(authenticatedOnboardingStep(box.completed, requestedBoxStep));
        setDiet(profile);
        setDietOptions(options);
        setSelectedSlugs(
          resolveOnboardingRecipeSelection(
            window.location.search,
            box.recipeSlugs,
            new Set(publicRecipes.map((recipe) => recipe.slug)),
          ),
        );
        setAuthoredRecipeSlugs(authoredDuringOnboarding);
        if (!box.completed && onboardingStartedUserId.current !== userId) {
          onboardingStartedUserId.current = userId;
          if (recordOnboardingStart(userId)) {
            captureRecipeEvent("recipe_onboarding_started");
          }
        }
      })
      .catch((loadError: unknown) => {
        if (isAbortError(loadError)) return;
        console.error(
          `Recipe onboarding load attempt ${loadAttempt + 1} failed`,
          loadError,
        );
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Setup could not be loaded.",
        );
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [loadAttempt, userId]);

  const effectiveDiet = useMemo(
    () => buildEffectiveDiet(diet, dietOptions),
    [diet, dietOptions],
  );
  const compatibleRecipes = useMemo(
    () =>
      filterRecipesForDiet(recipes, effectiveDiet, (recipe) => ({
        ingredients: recipe.ingredientSlugs.map((slug, index) => ({
          slug,
          name: recipe.ingredientNames[index],
        })),
      })),
    [effectiveDiet, recipes],
  );
  const compatibleRecipeSlugs = useMemo(
    () => new Set(compatibleRecipes.map((recipe) => recipe.slug)),
    [compatibleRecipes],
  );
  const compatibleSelectedSlugs = useMemo(
    () => selectedSlugs.filter((slug) => compatibleRecipeSlugs.has(slug)),
    [compatibleRecipeSlugs, selectedSlugs],
  );
  const selectedSet = useMemo(
    () => new Set(compatibleSelectedSlugs),
    [compatibleSelectedSlugs],
  );
  const boxCount = new Set([...compatibleSelectedSlugs, ...authoredRecipeSlugs])
    .size;

  function toggleDietPreset(key: string) {
    setDiet((current) => ({
      ...current,
      presetDietKeys: toggleValue(current.presetDietKeys, key),
    }));
  }

  function toggleSelectedRecipe(slug: string) {
    setSelectedSlugs((current) => toggleValue(current, slug));
  }

  function goBackToStep(nextStep: number) {
    if (nextStep <= 0 || nextStep >= step || loading || saving) return;
    setError(null);
    setStep(nextStep);
  }

  async function continueFromDiet() {
    setSaving(true);
    setError(null);
    try {
      setDiet(await dietMutation.mutateAsync(diet));
      setStep(2);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Your diet could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function finishBox() {
    setSaving(true);
    setError(null);
    try {
      await recipeBoxMutation.mutateAsync(compatibleSelectedSlugs);
      captureRecipeEvent("recipe_onboarding_completed", {
        authored_recipe_count: authoredRecipeSlugs.length,
        recipe_box_size: boxCount,
        selected_recipe_count: compatibleSelectedSlugs.length,
      });
      setStep(3);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Your recipe box could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  return {
    authoredRecipeSlugs,
    authorRecipeHref: buildRecipeAuthoringHref(compatibleSelectedSlugs),
    boxCount,
    compatibleRecipes,
    continueFromDiet,
    diet,
    dietOptions,
    error,
    finishBox,
    goBackToStep,
    loading,
    retryLoad: () => setLoadAttempt((current) => current + 1),
    saving,
    selectedSet,
    session,
    sessionPending,
    setStep,
    step,
    toggleDietPreset,
    toggleSelectedRecipe,
    userId,
  };
}
