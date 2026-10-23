"use client";

import { CalendarPlus, Pencil, Trash2 } from "lucide-react";
import type { ShoppingRecipe } from "@/lib/api/shopping";
import {
  addDays,
  type MealPlanEntry,
  mealKindLabel,
  mealTypeLabel,
  nextMealPlanId,
} from "@/lib/domain/meal-plan";

function entryTitle(
  meal: MealPlanEntry,
  recipes: ReadonlyMap<string, ShoppingRecipe>,
): string {
  if (meal.recipeSlug)
    return recipes.get(meal.recipeSlug)?.title ?? meal.recipeSlug;
  return meal.note || mealKindLabel(meal.kind);
}

function entrySubtitle(meal: MealPlanEntry): string {
  if (meal.status === "candidate") return "Meal idea";
  const mealLabel = meal.mealType ? mealTypeLabel(meal.mealType) : "Meal";
  if (!meal.servings) return mealLabel;
  return `${mealLabel} · ${meal.servings} servings`;
}

function EntryActions({
  meal,
  title,
  onEdit,
  onRemove,
}: Readonly<{
  meal: MealPlanEntry;
  title: string;
  onEdit: (meal: MealPlanEntry) => void;
  onRemove: (id: string) => void;
}>) {
  const repeat = () =>
    onEdit({
      ...meal,
      id: nextMealPlanId(),
      date: meal.date ? addDays(meal.date, 7) : meal.date,
      sourceMealId: meal.id,
    });
  return (
    <div className="flex shrink-0 gap-1">
      <button
        type="button"
        aria-label={
          meal.status === "candidate"
            ? `Schedule ${title}`
            : `Plan ${title} again`
        }
        onClick={
          meal.status === "candidate"
            ? () => onEdit({ ...meal, status: "committed" })
            : repeat
        }
        className="inline-flex items-center gap-1 rounded p-2 text-[var(--ink-3)] hover:bg-[var(--paper-warm)] hover:text-[var(--terracotta)]"
      >
        <CalendarPlus className="size-4" />
        {meal.status === "committed" && (
          <span className="rt-mono text-[0.65rem]">Plan again</span>
        )}
      </button>
      <button
        type="button"
        aria-label={`Edit ${title}`}
        onClick={() => onEdit(meal)}
        className="rounded p-2 text-[var(--ink-3)] hover:bg-[var(--paper-warm)] hover:text-[var(--terracotta)]"
      >
        <Pencil className="size-4" />
      </button>
      <button
        type="button"
        aria-label={`Remove ${title}`}
        onClick={() => onRemove(meal.id)}
        className="rounded p-2 text-[var(--ink-3)] hover:bg-[var(--paper-warm)] hover:text-[var(--berry)]"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}

export function MealPlanEntryCard({
  meal,
  recipes,
  onEdit,
  onRemove,
}: Readonly<{
  meal: MealPlanEntry;
  recipes: ReadonlyMap<string, ShoppingRecipe>;
  onEdit: (meal: MealPlanEntry) => void;
  onRemove: (id: string) => void;
}>) {
  const title = entryTitle(meal, recipes);
  return (
    <article className="rounded-lg border border-[var(--line)] bg-[var(--card)] p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="rt-display text-xl leading-tight">{title}</h3>
          <p className="rt-mono mt-1 text-[var(--ink-3)]">
            {entrySubtitle(meal)}
          </p>
          {meal.note && meal.recipeSlug && (
            <p className="rt-body mt-2 text-sm text-[var(--ink-2)]">
              {meal.note}
            </p>
          )}
        </div>
        <EntryActions
          meal={meal}
          title={title}
          onEdit={onEdit}
          onRemove={onRemove}
        />
      </div>
    </article>
  );
}
