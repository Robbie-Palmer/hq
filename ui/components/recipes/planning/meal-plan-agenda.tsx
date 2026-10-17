"use client";

import type { ShoppingRecipe } from "@/lib/api/shopping";
import { MEAL_TYPES, type MealPlanEntry } from "@/lib/domain/meal-plan";
import { MealPlanEntryCard } from "./meal-plan-entry-card";

const MEAL_TYPE_ORDER = new Map<string, number>(
  MEAL_TYPES.map(({ id }, index) => [id, index]),
);

function dateLabel(date: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
  }).format(new Date(`${date}T12:00:00`));
}

function groupByDate(meals: Array<MealPlanEntry & { date: string }>) {
  const grouped = new Map<string, Array<MealPlanEntry & { date: string }>>();
  for (const meal of meals) {
    grouped.set(meal.date, [...(grouped.get(meal.date) ?? []), meal]);
  }
  return grouped;
}

export function MealPlanAgenda({
  meals,
  recipes,
  onEdit,
  onRemove,
  onSave,
}: Readonly<{
  meals: MealPlanEntry[];
  recipes: ReadonlyMap<string, ShoppingRecipe>;
  onEdit: (meal: MealPlanEntry) => void;
  onRemove: (id: string) => void;
  onSave: (meal: MealPlanEntry) => void;
}>) {
  const committed = meals
    .filter(
      (meal): meal is MealPlanEntry & { date: string } =>
        meal.status === "committed" && Boolean(meal.date),
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (MEAL_TYPE_ORDER.get(a.mealType ?? "") ?? MEAL_TYPES.length) -
          (MEAL_TYPE_ORDER.get(b.mealType ?? "") ?? MEAL_TYPES.length),
    );
  const byDate = groupByDate(committed);
  if (committed.length === 0) {
    return (
      <p className="rt-body rounded-lg border border-dashed border-[var(--line-strong)] p-5 text-[var(--ink-3)]">
        No meals are scheduled. Plan one meal when you know what is next.
      </p>
    );
  }
  return (
    <div className="space-y-5">
      {[...byDate].map(([date, dateMeals]) => (
        <section key={date} aria-labelledby={`meal-plan-${date}`}>
          <h2
            id={`meal-plan-${date}`}
            className="rt-display mb-2 text-2xl text-[var(--terracotta)]"
          >
            {dateLabel(date)}
          </h2>
          <div className="grid gap-2 md:grid-cols-2">
            {dateMeals.map((meal) => (
              <MealPlanEntryCard
                key={meal.id}
                meal={meal}
                recipes={recipes}
                onEdit={onEdit}
                onRemove={onRemove}
                onSave={onSave}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
