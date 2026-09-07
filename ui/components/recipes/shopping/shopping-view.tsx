"use client";

import { ArrowLeft, ArrowRight, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { DietListNotice } from "@/components/recipes/diet-notice";
import { useDiet } from "@/components/recipes/diet-provider";
import { MealPlanner } from "@/components/recipes/shopping/meal-planner";
import { RecipePicker } from "@/components/recipes/shopping/recipe-picker";
import { ShareShoppingList } from "@/components/recipes/shopping/share-shopping-list";
import { ShoppingList } from "@/components/recipes/shopping/shopping-list";
import {
  ShoppingListBoundary,
  useShoppingListScope,
  useStartNewShoppingList,
} from "@/components/recipes/shopping/shopping-list-boundary";
import { useShoppingList } from "@/hooks/use-shopping-list";
import type { ShoppingRecipe } from "@/lib/api/shopping";
import {
  applyDietRecipeVisibility,
  buildDietRecipeMatches,
} from "@/lib/domain/diet";

type Step = "plan" | "list";

const STEPS: { id: Step; label: string }[] = [
  { id: "plan", label: "Plan meals" },
  { id: "list", label: "Shopping list" },
];

export function ShoppingView({
  recipes,
}: Readonly<{ recipes: ShoppingRecipe[] }>) {
  return (
    <ShoppingListBoundary>
      <ShoppingViewContent recipes={recipes} />
    </ShoppingListBoundary>
  );
}

function ShoppingViewContent({
  recipes,
}: Readonly<{ recipes: ShoppingRecipe[] }>) {
  const { diet, matchRecipe } = useDiet();
  const { recipes: selected, plan, extras } = useShoppingList();
  const [step, setStep] = useState<Step>("plan");
  const [showHidden, setShowHidden] = useState(false);
  const startNewList = useStartNewShoppingList();
  const scope = useShoppingListScope();
  const selectedSlugs = useMemo(
    () => new Set(selected.map((entry) => entry.slug)),
    [selected],
  );
  const dietMatches = useMemo(
    () =>
      buildDietRecipeMatches(recipes, matchRecipe, (recipe) => ({
        ingredients: recipe.ingredients.map((ingredient) => ({
          slug: ingredient.ingredient,
          name: ingredient.name,
        })),
      })),
    [matchRecipe, recipes],
  );
  const { visibleRecipes: availableRecipes, hiddenCount } = useMemo(
    () =>
      applyDietRecipeVisibility(
        recipes,
        dietMatches,
        { active: diet.active, mode: diet.mode },
        {
          showHidden,
          alwaysVisibleSlugs: selectedSlugs,
        },
      ),
    [diet.active, diet.mode, dietMatches, recipes, selectedSlugs, showHidden],
  );
  const pickerRecipes = availableRecipes;
  const count = selected.length;
  const recipeNoun = count === 1 ? "recipe" : "recipes";
  const plannedCount = plan.length;
  const plannedNoun = plannedCount === 1 ? "meal" : "meals";
  const itemNoun = extras.length === 1 ? "item" : "items";
  const hasListContent = count > 0 || plannedCount > 0 || extras.length > 0;
  let summary =
    "Add items directly, or choose recipes and we'll gather their ingredients.";
  if (count > 0) {
    summary = `${count} ${recipeNoun} selected · ${plannedCount} ${plannedNoun} scheduled.`;
  } else if (plannedCount > 0) {
    summary = `${plannedCount} ${plannedNoun} scheduled.`;
  } else if (extras.length > 0) {
    summary = `${extras.length} ${itemNoun} on the shopping list.`;
  }

  return (
    <div className="container mx-auto px-4 pt-5 pb-16 md:pt-7 max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
        <div>
          <p className="rt-mono text-[var(--terracotta)]">
            {step === "plan" ? "Shopping · meal plan" : "Shopping"}
          </p>
          <h1 className="rt-display text-5xl md:text-6xl mt-2">
            {step === "plan" ? "What's the plan?" : "Shopping list."}
          </h1>
          <p className="rt-body mt-2 text-[var(--ink-2)]">{summary}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
          {scope.type === "household" && <ShareShoppingList scope={scope} />}
          {hasListContent && (
            <button
              type="button"
              onClick={startNewList.start}
              disabled={startNewList.isPending}
              className="inline-flex items-center gap-1.5 rt-mono text-[var(--ink-3)] hover:text-[var(--berry)] transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" /> start a new list
            </button>
          )}
        </div>
      </div>

      {startNewList.isError && (
        <p
          role="alert"
          className="rt-body mb-4 rounded-md border border-[var(--berry)]/30 bg-[var(--cream-dark)] px-3 py-2 text-sm text-[var(--berry)]"
        >
          A new shopping list could not be started. Your previous list has been
          restored.
        </p>
      )}

      {diet.active && (
        <DietListNotice
          hiddenCount={hiddenCount}
          labels={diet.labels}
          mode={diet.mode}
          showingHidden={showHidden}
          onToggleHidden={() => setShowHidden((current) => !current)}
        />
      )}

      {/* Step tabs — mirror the recipe read-view tabs so the two feel of a piece. */}
      <div className="flex items-center border-b border-[var(--line)] mb-6">
        {STEPS.map((s) => {
          const active = step === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setStep(s.id)}
              className={[
                "px-3.5 py-2.5 rt-body text-[0.95rem] -mb-px border-b-2 transition-colors",
                active
                  ? "border-[var(--terracotta)] text-[var(--ink)] font-bold"
                  : "border-transparent text-[var(--ink-3)] hover:text-[var(--ink-2)]",
              ].join(" ")}
              aria-current={active ? "step" : undefined}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {step === "plan" ? (
        <div className="space-y-8">
          <MealPlanner recipes={recipes} availableRecipes={availableRecipes} />
          <div>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="rt-mono text-[var(--terracotta)]">
                  Recipe picker
                </p>
                <h2 className="rt-display text-3xl text-[var(--ink)]">
                  Add anything else.
                </h2>
              </div>
              <p className="rt-body text-sm text-[var(--ink-3)]">
                Selected recipes appear in the plan pool and shopping list.
              </p>
            </div>
            <RecipePicker recipes={pickerRecipes} dietMatches={dietMatches} />
          </div>
          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={() => setStep("list")}
              className="inline-flex items-center gap-2 rounded-md bg-[var(--terracotta)] px-4 py-2 text-white font-medium hover:bg-[var(--terracotta-deep)] transition-colors"
            >
              View shopping list
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button
            type="button"
            onClick={() => setStep("plan")}
            className="inline-flex items-center gap-1.5 rt-mono text-[var(--ink-3)] hover:text-[var(--terracotta)] mb-3 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> back to plan
          </button>
          <ShoppingList recipes={recipes} />
        </div>
      )}
    </div>
  );
}
