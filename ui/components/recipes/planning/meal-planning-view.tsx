"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RecipeDestinationAnalytics } from "@/components/recipes/recipe-destination-analytics";
import { ShoppingListBoundary } from "@/components/recipes/shopping/shopping-list-boundary";
import { useShoppingList } from "@/hooks/use-shopping-list";
import { captureRecipeEvent } from "@/lib/analytics/recipe-product";
import type { ShoppingRecipe } from "@/lib/api/shopping";
import { localISODate, type MealPlanEntry } from "@/lib/domain/meal-plan";
import { savePlannedMeal } from "@/lib/shopping/shoppingListStore";
import { MealPlanForm } from "./meal-plan-form";
import {
  CandidateMeals,
  PlannedMeals,
  PlanningHeader,
  ShoppingPlanAction,
} from "./meal-planning-sections";

const DEFAULT_MEAL: Partial<MealPlanEntry> = {
  kind: "recipe",
  status: "committed",
};

function mealPlanEvent(
  previous: MealPlanEntry | undefined,
  meal: MealPlanEntry,
) {
  if (previous?.status === "candidate" && meal.status === "committed")
    return "meal_plan_queue_converted";
  if (meal.status === "candidate") return "meal_plan_meal_queued";
  return "meal_plan_meal_committed";
}

function usePlanController(plan: MealPlanEntry[], recipes: ShoppingRecipe[]) {
  const [view, setView] = useState<"agenda" | "week">("agenda");
  const [editing, setEditing] = useState<Partial<MealPlanEntry> | null>(null);
  const startedAt = useRef(Date.now());
  const dirty = useRef(false);
  const saved = useRef(false);
  const today = localISODate(new Date());
  const candidates = plan.filter((meal) => meal.status === "candidate");
  const committed = plan.filter(
    (meal) =>
      meal.status === "committed" &&
      meal.kind === "recipe" &&
      meal.date !== undefined &&
      meal.date >= today,
  );
  useEffect(() => {
    const slug = new URLSearchParams(globalThis.location.search).get("recipe");
    if (slug && recipes.some((recipe) => recipe.slug === slug))
      setEditing({ kind: "recipe", status: "committed", recipeSlug: slug });
  }, [recipes]);
  useEffect(
    () => () => {
      if (dirty.current && !saved.current)
        captureRecipeEvent("meal_plan_abandoned", {
          elapsed_ms: Date.now() - startedAt.current,
        });
    },
    [],
  );
  const start = (initial: Partial<MealPlanEntry> = DEFAULT_MEAL) => {
    saved.current = false;
    startedAt.current = Date.now();
    setEditing(initial);
  };
  const save = (meal: MealPlanEntry) => {
    const previous = plan.find(({ id }) => id === meal.id);
    savePlannedMeal(meal);
    saved.current = true;
    dirty.current = false;
    setEditing(null);
    const event = mealPlanEvent(previous, meal);
    captureRecipeEvent(event, {
      elapsed_ms: Date.now() - startedAt.current,
      first_queued_meal: meal.status === "candidate" && candidates.length === 0,
      first_committed_meal:
        meal.status === "committed" &&
        plan.every((entry) => entry.status !== "committed"),
      meal_kind: meal.kind,
    });
  };
  return {
    view,
    setView,
    editing,
    setEditing: start,
    cancel: () => setEditing(null),
    touch: () => {
      dirty.current = true;
    },
    save,
    candidates,
    committed,
  };
}

export function MealPlanningView({
  recipes,
}: Readonly<{ recipes: ShoppingRecipe[] }>) {
  return (
    <ShoppingListBoundary>
      <RecipeDestinationAnalytics destination="planning" />
      <MealPlanningContent recipes={recipes} />
    </ShoppingListBoundary>
  );
}

function MealPlanningContent({
  recipes,
}: Readonly<{ recipes: ShoppingRecipe[] }>) {
  const { plan } = useShoppingList();
  const controller = usePlanController(plan, recipes);
  const bySlug = useMemo(
    () => new Map(recipes.map((recipe) => [recipe.slug, recipe])),
    [recipes],
  );
  return (
    <div className="container mx-auto max-w-6xl px-4 pt-5 pb-24 md:pt-7">
      <PlanningHeader onAdd={() => controller.setEditing()} />
      {controller.editing && (
        <div className="mb-8">
          <MealPlanForm
            key={
              controller.editing.id ??
              `${controller.editing.recipeSlug ?? "new"}-${controller.editing.date ?? ""}`
            }
            initial={controller.editing}
            recipes={recipes}
            onCancel={controller.cancel}
            onSave={controller.save}
            onTouched={controller.touch}
          />
        </div>
      )}
      <CandidateMeals
        candidates={controller.candidates}
        recipes={bySlug}
        onEdit={controller.setEditing}
        onSave={controller.save}
      />
      <PlannedMeals
        meals={plan}
        recipes={bySlug}
        view={controller.view}
        onEdit={controller.setEditing}
        onSave={controller.save}
        onView={controller.setView}
      />
      <ShoppingPlanAction mealCount={controller.committed.length} />
    </div>
  );
}
