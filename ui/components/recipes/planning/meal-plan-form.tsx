"use client";

import { useEffect, useState } from "react";
import type { ShoppingRecipe } from "@/lib/api/shopping";
import {
  MEAL_KINDS,
  MEAL_TYPES,
  type MealKind,
  type MealPlanEntry,
  type MealPlanStatus,
  type MealType,
  nextMealPlanId,
} from "@/lib/domain/meal-plan";

type FormState = {
  status: MealPlanStatus;
  kind: MealKind;
  recipeSlug: string;
  date: string;
  mealType: MealType;
  servings: number;
  note: string;
};

function today(): string {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function useMealPlanForm(initial?: Partial<MealPlanEntry>) {
  const [status, setStatus] = useState(initial?.status ?? "committed");
  const [kind, setKind] = useState(initial?.kind ?? "recipe");
  const [recipeSlug, setRecipeSlug] = useState(initial?.recipeSlug ?? "");
  const [date, setDate] = useState(initial?.date ?? today());
  const [mealType, setMealType] = useState(initial?.mealType ?? "dinner");
  const [servings, setServings] = useState(initial?.servings ?? 2);
  const [note, setNote] = useState(initial?.note ?? "");
  useEffect(() => {
    if (status === "candidate") setKind("recipe");
  }, [status]);
  return {
    state: { status, kind, recipeSlug, date, mealType, servings, note },
    setStatus,
    setKind,
    setRecipeSlug,
    setDate,
    setMealType,
    setServings,
    setNote,
  };
}

function PlanSelectors({
  form,
  recipes,
}: Readonly<{
  form: ReturnType<typeof useMealPlanForm>;
  recipes: ShoppingRecipe[];
}>) {
  const { state } = form;
  return (
    <>
      <label className="grid gap-1 rt-body text-sm text-[var(--ink-2)]">
        Commitment
        <select
          value={state.status}
          onChange={(event) =>
            form.setStatus(event.target.value as MealPlanStatus)
          }
          className="h-10 rounded-md border border-[var(--line-strong)] bg-[var(--paper)] px-3 text-[var(--ink)]"
        >
          <option value="committed">Plan for a day</option>
          <option value="candidate">Save as a meal idea</option>
        </select>
      </label>
      {state.status === "committed" && (
        <label className="grid gap-1 rt-body text-sm text-[var(--ink-2)]">
          What is happening?
          <select
            value={state.kind}
            onChange={(event) => form.setKind(event.target.value as MealKind)}
            className="h-10 rounded-md border border-[var(--line-strong)] bg-[var(--paper)] px-3 text-[var(--ink)]"
          >
            {MEAL_KINDS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {state.kind === "recipe" && (
        <RecipeSelect form={form} recipes={recipes} />
      )}
    </>
  );
}

function RecipeSelect({
  form,
  recipes,
}: Readonly<{
  form: ReturnType<typeof useMealPlanForm>;
  recipes: ShoppingRecipe[];
}>) {
  return (
    <label className="grid gap-1 rt-body text-sm text-[var(--ink-2)] md:col-span-2">
      Recipe
      <select
        required
        value={form.state.recipeSlug}
        onChange={(event) => form.setRecipeSlug(event.target.value)}
        className="h-10 rounded-md border border-[var(--line-strong)] bg-[var(--paper)] px-3 text-[var(--ink)]"
      >
        <option value="">Choose a recipe</option>
        {[...recipes]
          .sort((a, b) => a.title.localeCompare(b.title))
          .map((recipe) => (
            <option key={recipe.slug} value={recipe.slug}>
              {recipe.title}
            </option>
          ))}
      </select>
    </label>
  );
}

function ScheduleFields({
  form,
}: Readonly<{ form: ReturnType<typeof useMealPlanForm> }>) {
  if (form.state.status !== "committed") return null;
  return (
    <>
      <label className="grid gap-1 rt-body text-sm text-[var(--ink-2)]">
        Day
        <input
          required
          type="date"
          value={form.state.date}
          onChange={(event) => form.setDate(event.target.value)}
          className="h-10 rounded-md border border-[var(--line-strong)] bg-[var(--paper)] px-3 text-[var(--ink)]"
        />
      </label>
      <label className="grid gap-1 rt-body text-sm text-[var(--ink-2)]">
        Meal
        <select
          value={form.state.mealType}
          onChange={(event) => form.setMealType(event.target.value as MealType)}
          className="h-10 rounded-md border border-[var(--line-strong)] bg-[var(--paper)] px-3 text-[var(--ink)]"
        >
          {MEAL_TYPES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

function DetailFields({
  form,
}: Readonly<{ form: ReturnType<typeof useMealPlanForm> }>) {
  return (
    <>
      {form.state.kind === "recipe" && (
        <label className="grid gap-1 rt-body text-sm text-[var(--ink-2)]">
          Servings
          <input
            required
            min={1}
            max={1000}
            type="number"
            value={form.state.servings}
            onChange={(event) => form.setServings(Number(event.target.value))}
            className="h-10 rounded-md border border-[var(--line-strong)] bg-[var(--paper)] px-3 text-[var(--ink)]"
          />
        </label>
      )}
      <label className="grid gap-1 rt-body text-sm text-[var(--ink-2)] md:col-span-2">
        Note <span className="sr-only">optional</span>
        <input
          maxLength={500}
          value={form.state.note}
          onChange={(event) => form.setNote(event.target.value)}
          placeholder={
            form.state.kind === "leftovers" ? "What is left?" : "Optional"
          }
          className="h-10 rounded-md border border-[var(--line-strong)] bg-[var(--paper)] px-3 text-[var(--ink)]"
        />
      </label>
    </>
  );
}

function toMeal(
  initial: Partial<MealPlanEntry> | undefined,
  state: FormState,
): MealPlanEntry {
  return {
    id: initial?.id ?? nextMealPlanId(),
    status: state.status,
    kind: state.kind,
    ...(state.status === "committed"
      ? { date: state.date, mealType: state.mealType }
      : {}),
    ...(state.kind === "recipe"
      ? { recipeSlug: state.recipeSlug, servings: state.servings }
      : {}),
    ...(state.note.trim() ? { note: state.note.trim() } : {}),
    ...(initial?.sourceMealId ? { sourceMealId: initial.sourceMealId } : {}),
  };
}

export function MealPlanForm({
  initial,
  recipes,
  onCancel,
  onSave,
  onTouched,
}: Readonly<{
  initial?: Partial<MealPlanEntry>;
  recipes: ShoppingRecipe[];
  onCancel: () => void;
  onSave: (meal: MealPlanEntry) => void;
  onTouched: () => void;
}>) {
  const form = useMealPlanForm(initial);
  return (
    <form
      className="grid gap-4 rounded-xl border border-[var(--line-strong)] bg-[var(--card)] p-4 md:grid-cols-2"
      onChange={onTouched}
      onSubmit={(event) => {
        event.preventDefault();
        onSave(toMeal(initial, form.state));
      }}
    >
      <PlanSelectors form={form} recipes={recipes} />
      <ScheduleFields form={form} />
      <DetailFields form={form} />
      <div className="flex justify-end gap-3 md:col-span-2">
        <button type="button" onClick={onCancel} className="rt-mono px-3 py-2">
          Cancel
        </button>
        <button
          type="submit"
          className="rounded-md bg-[var(--terracotta)] px-4 py-2 font-medium text-white hover:bg-[var(--terracotta-deep)]"
        >
          {form.state.status === "candidate" ? "Save idea" : "Save meal"}
        </button>
      </div>
    </form>
  );
}
