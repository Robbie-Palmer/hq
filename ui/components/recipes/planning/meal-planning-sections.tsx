"use client";

import { CalendarDays, Lightbulb, ShoppingBasket } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { captureRecipeEvent } from "@/lib/analytics/recipe-product";
import type { ShoppingRecipe } from "@/lib/api/shopping";
import { localISODate, type MealPlanEntry } from "@/lib/domain/meal-plan";
import {
  type AddCommittedMealsResult,
  addCommittedMealsToShoppingList,
  removePlannedMeal,
} from "@/lib/shopping/shoppingListStore";
import { MealPlanAgenda } from "./meal-plan-agenda";
import { MealPlanEntryCard } from "./meal-plan-entry-card";
import { MealPlanWeek } from "./meal-plan-week";

export function PlanningHeader({ onAdd }: Readonly<{ onAdd: () => void }>) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="rt-mono text-[var(--terracotta)]">Plan</p>
        <h1 className="rt-display mt-2 text-5xl md:text-6xl">Meal plan.</h1>
        <p className="rt-body mt-2 text-[var(--ink-2)]">
          Plan one meal now. A full week is optional.
        </p>
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="rounded-md bg-[var(--terracotta)] px-4 py-2 font-medium text-white hover:bg-[var(--terracotta-deep)]"
      >
        Plan one meal
      </button>
    </header>
  );
}

export function CandidateMeals({
  candidates,
  recipes,
  onEdit,
}: Readonly<{
  candidates: MealPlanEntry[];
  recipes: ReadonlyMap<string, ShoppingRecipe>;
  onEdit: (meal: Partial<MealPlanEntry>) => void;
}>) {
  if (candidates.length === 0) return null;
  return (
    <section aria-labelledby="meal-ideas-heading" className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <Lightbulb className="size-4 text-[var(--terracotta)]" />
        <h2 id="meal-ideas-heading" className="rt-display text-3xl">
          Meal ideas.
        </h2>
      </div>
      <p className="rt-body mb-3 text-sm text-[var(--ink-3)]">
        Ideas stay unscheduled and do not add anything to the shopping list.
      </p>
      <div className="grid gap-2 md:grid-cols-2">
        {candidates.map((meal) => (
          <MealPlanEntryCard
            key={meal.id}
            meal={meal}
            recipes={recipes}
            onEdit={onEdit}
            onRemove={removePlannedMeal}
          />
        ))}
      </div>
    </section>
  );
}

export function PlannedMeals({
  meals,
  recipes,
  view,
  onEdit,
  onView,
}: Readonly<{
  meals: MealPlanEntry[];
  recipes: ReadonlyMap<string, ShoppingRecipe>;
  view: "agenda" | "week";
  onEdit: (meal: Partial<MealPlanEntry>) => void;
  onView: (view: "agenda" | "week") => void;
}>) {
  const shared = {
    meals,
    recipes,
    onEdit,
    onRemove: removePlannedMeal,
  };
  return (
    <section aria-labelledby="planned-meals-heading">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-[var(--line)] pb-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="size-4 text-[var(--terracotta)]" />
          <h2 id="planned-meals-heading" className="rt-display text-3xl">
            Planned meals.
          </h2>
        </div>
        <div className="flex rounded-md border border-[var(--line)] p-1">
          {(["agenda", "week"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => onView(option)}
              className="rounded px-3 py-1 rt-mono capitalize text-[var(--ink-3)] aria-pressed:bg-[var(--paper-warm)] aria-pressed:text-[var(--ink)]"
            >
              {option === "week" ? "Next 7 days" : "Agenda"}
            </button>
          ))}
        </div>
      </div>
      {view === "agenda" ? (
        <MealPlanAgenda {...shared} />
      ) : (
        <MealPlanWeek
          {...shared}
          onPlanDate={(date) =>
            onEdit({ kind: "recipe", status: "committed", date })
          }
        />
      )}
    </section>
  );
}

function ShoppingGenerationLink({
  result,
}: Readonly<{ result: AddCommittedMealsResult }>) {
  const label =
    result.addedMealCount > 0
      ? `Added for ${result.addedMealCount} ${result.addedMealCount === 1 ? "meal" : "meals"}. Open Shop`
      : "Already on your list. Open Shop";
  return (
    <Link
      href="/recipes/shopping"
      className="text-center rt-mono text-[var(--terracotta)] underline sm:text-left"
    >
      {label}
    </Link>
  );
}

export function ShoppingPlanAction({
  meals,
  view,
}: Readonly<{
  meals: MealPlanEntry[];
  view: "agenda" | "week";
}>) {
  const [generated, setGenerated] = useState<{
    result: AddCommittedMealsResult;
    scopeKey: string;
  } | null>(null);
  const mealCount = meals.length;
  if (mealCount === 0) return null;
  const scopeKey = meals.map(({ id }) => id).join("|");
  const generate = () => {
    const result = addCommittedMealsToShoppingList(
      localISODate(new Date()),
      meals.map(({ id }) => id),
    );
    setGenerated({ result, scopeKey });
    captureRecipeEvent("meal_plan_shopping_generated", {
      added_recipe_count: result.addedRecipeCount,
      committed_meal_count: result.eligibleMealCount,
    });
  };
  const currentResult = generated?.scopeKey === scopeKey && generated.result;
  return (
    <aside className="mt-8 rounded-lg border border-[var(--line-strong)] bg-[var(--paper-warm)] p-4">
      <div className="flex items-start gap-3">
        <ShoppingBasket className="mt-0.5 size-5 shrink-0 text-[var(--terracotta)]" />
        <div className="min-w-0">
          <p className="rt-body text-sm text-[var(--ink-2)]">
            {mealCount} {view === "week" ? "meal" : "upcoming meal"}
            {mealCount === 1 ? " is" : "s are"} ready
            {view === "week" ? " in the next 7 days." : "."}
          </p>
          <p className="mt-1 rt-mono text-[0.65rem] text-[var(--ink-3)]">
            Upcoming scheduled recipes in this view only.
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={generate}
          className="w-full rounded-md border border-[var(--terracotta)] px-3 py-2 rt-mono text-[var(--terracotta)] sm:w-auto"
        >
          Add to shopping list
        </button>
        {currentResult && <ShoppingGenerationLink result={currentResult} />}
      </div>
    </aside>
  );
}
