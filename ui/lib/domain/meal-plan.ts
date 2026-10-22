import { isRecord } from "ts-base/records";

export const MEAL_TYPES = [
  { id: "breakfast", label: "Breakfast" },
  { id: "lunch", label: "Lunch" },
  { id: "dinner", label: "Dinner" },
  { id: "snack", label: "Snack" },
] as const;

export const MEAL_KINDS = [
  { id: "recipe", label: "Cooking a recipe" },
  { id: "leftovers", label: "Leftovers" },
  { id: "eating_out", label: "Eating out" },
  { id: "decide_later", label: "Decide later" },
] as const;

export type MealType = (typeof MEAL_TYPES)[number]["id"];
export type MealKind = (typeof MEAL_KINDS)[number]["id"];
export type MealPlanStatus = "candidate" | "committed";

export type MealPlanEntry = {
  id: string;
  kind: MealKind;
  status: MealPlanStatus;
  date?: string;
  mealType?: MealType;
  recipeSlug?: string;
  servings?: number;
  note?: string;
  sourceMealId?: string;
};

const MEAL_KIND_IDS = new Set<string>(MEAL_KINDS.map(({ id }) => id));
const MEAL_TYPE_IDS = new Set<string>(MEAL_TYPES.map(({ id }) => id));
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LEGACY_DAY_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalServings(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.round(value))
    : undefined;
}

function isMealKind(value: unknown): value is MealKind {
  return typeof value === "string" && MEAL_KIND_IDS.has(value);
}

function isMealType(value: unknown): value is MealType {
  return typeof value === "string" && MEAL_TYPE_IDS.has(value);
}

function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined)
    return false;
  const parsed = new Date(0);
  parsed.setUTCHours(0, 0, 0, 0);
  parsed.setUTCFullYear(year, month - 1, day);
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function hasValidSchedule(
  status: unknown,
  kind: unknown,
  date: string | undefined,
  mealType: unknown,
): status is MealPlanStatus {
  if (status === "candidate") {
    return kind === "recipe" && date === undefined && mealType === undefined;
  }
  return status === "committed" && date !== undefined && isMealType(mealType);
}

function hasValidRecipe(
  kind: unknown,
  recipeSlug: string | undefined,
): kind is MealKind {
  return isMealKind(kind) && (kind !== "recipe" || recipeSlug !== undefined);
}

function parseCurrentMeal(value: unknown): MealPlanEntry | undefined {
  if (!isRecord(value)) return undefined;
  const id = optionalText(value.id);
  const kind = value.kind;
  const status = value.status;
  const date = optionalText(value.date);
  const mealType = value.mealType;
  const parsedMealType = isMealType(mealType) ? mealType : undefined;
  const recipeSlug = optionalText(value.recipeSlug);
  const validDate = date === undefined || isCalendarDate(date);
  if (
    !id ||
    !validDate ||
    !hasValidRecipe(kind, recipeSlug) ||
    !hasValidSchedule(status, kind, date, mealType)
  ) {
    return undefined;
  }
  return {
    id,
    kind,
    status,
    ...(date ? { date } : {}),
    ...(parsedMealType ? { mealType: parsedMealType } : {}),
    ...(recipeSlug ? { recipeSlug } : {}),
    ...(optionalServings(value.servings)
      ? { servings: optionalServings(value.servings) }
      : {}),
    ...(optionalText(value.note) ? { note: optionalText(value.note) } : {}),
    ...(optionalText(value.sourceMealId)
      ? { sourceMealId: optionalText(value.sourceMealId) }
      : {}),
  };
}

export function localISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function legacyMealDate(day: string, now: Date): string | undefined {
  const target = LEGACY_DAY_INDEX[day];
  if (target === undefined) return undefined;
  const date = new Date(now);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + ((target - date.getDay() + 7) % 7));
  return localISODate(date);
}

function parseLegacyMeal(value: unknown, now: Date): MealPlanEntry | undefined {
  if (!isRecord(value)) return undefined;
  const day = optionalText(value.day);
  const slot = value.slot;
  const recipeSlug = optionalText(value.slug);
  const date = day ? legacyMealDate(day, now) : undefined;
  if (!date || !isMealType(slot) || !recipeSlug || slot === "snack") {
    return undefined;
  }
  return {
    id: `legacy-${day}-${slot}-${recipeSlug}`,
    kind: "recipe",
    status: "committed",
    date,
    mealType: slot,
    recipeSlug,
  };
}

export function parseMealPlan(
  value: unknown,
  now = new Date(),
): MealPlanEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry) => {
    const parsed = parseCurrentMeal(entry) ?? parseLegacyMeal(entry, now);
    if (!parsed || seen.has(parsed.id)) return [];
    seen.add(parsed.id);
    return [parsed];
  });
}

export function nextMealPlanId(): string {
  return `meal-${crypto.randomUUID()}`;
}

export function addDays(date: string, days: number): string {
  const next = new Date(`${date}T12:00:00`);
  next.setDate(next.getDate() + days);
  return localISODate(next);
}

export function mealKindLabel(kind: MealKind): string {
  return MEAL_KINDS.find(({ id }) => id === kind)?.label ?? kind;
}

export function mealTypeLabel(mealType: MealType): string {
  return MEAL_TYPES.find(({ id }) => id === mealType)?.label ?? mealType;
}
