"use client";

import type { ShoppingRecipe } from "@/lib/api/shopping";
import { addDays, type MealPlanEntry } from "@/lib/domain/meal-plan";
import { MealPlanEntryCard } from "./meal-plan-entry-card";

function today(): string {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function dayLabel(date: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

export function MealPlanWeek({
  meals,
  recipes,
  onEdit,
  onPlanDate,
  onRemove,
}: Readonly<{
  meals: MealPlanEntry[];
  recipes: ReadonlyMap<string, ShoppingRecipe>;
  onEdit: (meal: MealPlanEntry) => void;
  onPlanDate: (date: string) => void;
  onRemove: (id: string) => void;
}>) {
  const dates = Array.from({ length: 7 }, (_, index) =>
    addDays(today(), index),
  );
  return (
    <div className="grid gap-2 lg:grid-cols-7">
      {dates.map((date) => {
        const dateMeals = meals.filter(
          (meal) => meal.status === "committed" && meal.date === date,
        );
        return (
          <section key={date} className="min-w-0">
            <h2 className="rt-mono mb-2 text-[var(--terracotta)]">
              {dayLabel(date)}
            </h2>
            <div className="space-y-2">
              {dateMeals.map((meal) => (
                <MealPlanEntryCard
                  key={meal.id}
                  meal={meal}
                  recipes={recipes}
                  onEdit={onEdit}
                  onRemove={onRemove}
                />
              ))}
              <button
                type="button"
                onClick={() => onPlanDate(date)}
                className="w-full rounded-lg border border-dashed border-[var(--line-strong)] px-2 py-3 rt-mono text-[var(--ink-3)] hover:border-[var(--terracotta)] hover:text-[var(--terracotta)]"
              >
                Plan meal
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
