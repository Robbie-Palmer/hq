"use client";

import { useEffect, useMemo, useState } from "react";
import { normalizeSlug } from "ts-base/strings";
import { useCooklangRecipe } from "@/hooks/use-cooklang-recipe";
import type { ScaledRecipeParts } from "@/lib/domain/recipe/cooklangTransform";
import type {
  IngredientGroupView,
  RecipeDetailView,
} from "@/lib/domain/recipe/recipeViews";

export interface UseScaledRecipeState {
  view: RecipeDetailView;
  /** 1 when the returned view's amounts are already scaled by cooklang-rs;
   * the requested scale when caller is responsible for multiplying. */
  scaleMultiplier: number;
  isScaling: boolean;
  error: Error | null;
}

type TransformModule = typeof import("@/lib/domain/recipe/cooklangTransform");

let transformModulePromise: Promise<TransformModule> | null = null;
function loadTransformModule(): Promise<TransformModule> {
  if (!transformModulePromise) {
    transformModulePromise = import(
      "@/lib/domain/recipe/cooklangTransform"
    ).catch((error) => {
      transformModulePromise = null;
      throw error;
    });
  }
  return transformModulePromise;
}

// Mirror buildIngredientAnnotationMap in recipe-content.tsx: index by both the
// registry slug and the name-derived slug, since buildScaledRecipeParts emits
// items keyed by normalizeSlug(ingredient.name) which can diverge from the
// registry-resolved slug stored on the SSG view (e.g. "pork-sausages" vs
// "pork-sausage").
function reconstructAnnotations(
  ingredientGroups: IngredientGroupView[],
): Record<string, { preparation?: string; note?: string }> {
  const annotations: Record<string, { preparation?: string; note?: string }> =
    {};
  for (const group of ingredientGroups) {
    for (const item of group.items) {
      if (!item.preparation && !item.note) continue;
      const ann = { preparation: item.preparation, note: item.note };
      annotations[item.ingredient] = ann;
      const normalized = normalizeSlug(item.name);
      if (normalized && normalized !== item.ingredient) {
        annotations[normalized] = ann;
      }
    }
  }
  return annotations;
}

function overlayScaledParts(
  base: RecipeDetailView,
  parts: ScaledRecipeParts,
): RecipeDetailView {
  const viewItemBySlug = new Map<
    string,
    IngredientGroupView["items"][number]
  >();
  for (const group of base.ingredientGroups) {
    for (const item of group.items) {
      viewItemBySlug.set(item.ingredient, item);
    }
  }

  return {
    ...base,
    cookware: parts.cookware,
    ingredientGroups: parts.ingredientGroups.map((group) => ({
      name: group.name,
      items: group.items.map((item) => {
        const viewItem = viewItemBySlug.get(item.ingredient);
        return {
          ingredient: item.ingredient,
          name: viewItem?.name ?? item.ingredient,
          pluralName: viewItem?.pluralName,
          category: viewItem?.category,
          amount: item.amount,
          unit: item.unit,
          preparation: item.preparation,
          note: item.note,
        };
      }),
    })),
    instructions: parts.instructions,
    instructionSdk: parts.instructionSdk,
  };
}

type ScaledPartsRecord = {
  cookBody: string;
  scale: number;
  parts: ScaledRecipeParts;
};

type TransformErrorRecord = {
  cookBody: string;
  scale: number;
  error: Error;
};

export function useScaledRecipe(
  view: RecipeDetailView,
  scale: number,
): UseScaledRecipeState {
  const isIdentity = scale === 1;
  const {
    recipe: parsedRecipe,
    source: parsedSource,
    error,
  } = useCooklangRecipe(
    isIdentity ? "" : view.cookBody,
    isIdentity ? undefined : scale,
  );

  // Reference parse without a scale parameter — this is the only way to get
  // back the units the user originally wrote, since cooklang-rs converts
  // pints to cups (etc.) the moment any scale is supplied. Used by the
  // transform to restore the written unit after scaling. Cached by cookBody
  // alone, so this fires once per recipe, not per scale change.
  const {
    recipe: parsedOriginal,
    source: parsedOriginalSource,
    error: originalError,
  } = useCooklangRecipe(isIdentity ? "" : view.cookBody, undefined);

  const annotations = useMemo(
    () => reconstructAnnotations(view.ingredientGroups),
    [view.ingredientGroups],
  );

  // Only trust the resolved recipe if it was parsed from the current request.
  // useCooklangRecipe keeps the previous resolved recipe while a new parse is
  // in flight, so without this check we'd build scaled parts from stale input
  // and overlay them onto the new view (P1 reviewer finding: soft navigation
  // between recipes, or a scale change from one non-1 value to another).
  const freshParsedRecipe =
    parsedRecipe &&
    parsedSource?.cookBody === view.cookBody &&
    parsedSource.scale === scale
      ? parsedRecipe
      : null;

  const freshParsedOriginal =
    parsedOriginal && parsedOriginalSource?.cookBody === view.cookBody
      ? parsedOriginal
      : null;

  const [scaledParts, setScaledParts] = useState<ScaledPartsRecord | null>(
    null,
  );
  const [transformError, setTransformError] =
    useState<TransformErrorRecord | null>(null);

  useEffect(() => {
    setTransformError(null);
    if (isIdentity || !freshParsedRecipe || !freshParsedOriginal) return;

    let isActive = true;
    const targetCookBody = view.cookBody;
    const targetScale = scale;
    loadTransformModule()
      .then(({ buildScaledRecipeParts }) => {
        if (!isActive) return;
        setScaledParts({
          cookBody: targetCookBody,
          scale: targetScale,
          parts: buildScaledRecipeParts(freshParsedRecipe, annotations, {
            parsedOriginal: freshParsedOriginal,
            scale: targetScale,
          }),
        });
      })
      .catch((err: unknown) => {
        if (!isActive) return;
        setTransformError({
          cookBody: targetCookBody,
          scale: targetScale,
          error:
            err instanceof Error
              ? err
              : new Error("Failed to load cooklang transform"),
        });
      });

    return () => {
      isActive = false;
    };
  }, [
    isIdentity,
    freshParsedRecipe,
    freshParsedOriginal,
    annotations,
    view.cookBody,
    scale,
  ]);

  const freshScaledParts =
    scaledParts?.cookBody === view.cookBody && scaledParts?.scale === scale
      ? scaledParts.parts
      : null;
  const freshTransformError =
    transformError?.cookBody === view.cookBody &&
    transformError?.scale === scale
      ? transformError.error
      : null;

  const scaledView = useMemo(
    () =>
      freshScaledParts ? overlayScaledParts(view, freshScaledParts) : null,
    [freshScaledParts, view],
  );

  if (isIdentity) {
    return { view, scaleMultiplier: 1, isScaling: false, error: null };
  }

  if (scaledView) {
    return {
      view: scaledView,
      scaleMultiplier: 1,
      isScaling: false,
      error: error ?? originalError ?? freshTransformError,
    };
  }

  // No fresh scaled parts yet. We're still scaling unless the transform module
  // failed to load — in which case isScaling=false lets the caller render the
  // error indicator instead of an indefinite spinner.
  return {
    view,
    scaleMultiplier: scale,
    isScaling: !freshTransformError,
    error: error ?? originalError ?? freshTransformError,
  };
}
