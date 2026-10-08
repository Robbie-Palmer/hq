/**
 * Optimistic browser cache for the database-backed shopping list.
 *
 * A module-level store (consumed via useSyncExternalStore in
 * `use-shopping-list`) holding the recipes the user wants to cook, any
 * per-recipe servings override, which ingredients they've ticked off, and any
 * freeform "extra" items. Local storage keeps interaction immediate and lets
 * tabs converge; the authenticated shopping-list boundary installs and saves
 * canonical database snapshots.
 */

// Internal implementation. The public facade excludes test reset hooks.

import { isRecord } from "ts-base/records";
import { captureRecipeProductActivity } from "@/lib/analytics/recipe-product";

export type SelectedRecipeEntry = {
  slug: string;
  /** Chosen servings; when absent the recipe's own servings are used. */
  servings?: number;
};

export type ExtraItem = {
  id: string;
  text: string;
  checked: boolean;
};

export const MEAL_PLAN_DAYS = [
  { id: "mon", label: "Monday", short: "Mon" },
  { id: "tue", label: "Tuesday", short: "Tue" },
  { id: "wed", label: "Wednesday", short: "Wed" },
  { id: "thu", label: "Thursday", short: "Thu" },
  { id: "fri", label: "Friday", short: "Fri" },
  { id: "sat", label: "Saturday", short: "Sat" },
  { id: "sun", label: "Sunday", short: "Sun" },
] as const;

export const MEAL_PLAN_SLOTS = [
  { id: "breakfast", label: "Breakfast", short: "B" },
  { id: "lunch", label: "Lunch", short: "L" },
  { id: "dinner", label: "Dinner", short: "D" },
] as const;

export type MealPlanDay = (typeof MEAL_PLAN_DAYS)[number]["id"];

export type MealPlanSlot = (typeof MEAL_PLAN_SLOTS)[number]["id"];

const MEAL_PLAN_DAY_SET: ReadonlySet<MealPlanDay> = new Set(
  MEAL_PLAN_DAYS.map((day) => day.id),
);
const MEAL_PLAN_SLOT_SET: ReadonlySet<MealPlanSlot> = new Set(
  MEAL_PLAN_SLOTS.map((slot) => slot.id),
);

export type PlannedMealEntry = {
  day: MealPlanDay;
  slot: MealPlanSlot;
  slug: string;
};

export type ShoppingListState = {
  /** Selected recipes, kept in the order they were added. */
  recipes: SelectedRecipeEntry[];
  /** Weekly calendar slots that reference selected recipes. */
  plan: PlannedMealEntry[];
  /** Ticked-off ingredient slugs. */
  checked: string[];
  /** Freeform extras (milk, bread…). */
  extras: ExtraItem[];
};

export type ShoppingListChangeSource = "install" | "local" | "storage";

const STORAGE_KEY = "recipe-shopping-list:v1";
const COMPLETED_TRIP_STORAGE_KEY = "recipe-shopping-trip-completed:v1";
const COMPLETED_TRIP_LOCK_NAME = "recipe-shopping-trip-completion";

const EMPTY_STATE: ShoppingListState = {
  recipes: [],
  plan: [],
  checked: [],
  extras: [],
};

let state: ShoppingListState = EMPTY_STATE;
let hydrated = false;
let activeListId: string | undefined;
let completedTripRecordedFallback = false;
const listeners = new Set<(source: ShoppingListChangeSource) => void>();

/**
 * Persistently remember that the current checked-list cycle already produced
 * its value event. `clearChecked` starts a new cycle; merely unchecking and
 * rechecking the last item does not.
 */
function claimShoppingTripCompletion(): boolean {
  try {
    if (localStorage.getItem(COMPLETED_TRIP_STORAGE_KEY) === "true") {
      return false;
    }
    localStorage.setItem(COMPLETED_TRIP_STORAGE_KEY, "true");
    return true;
  } catch {
    if (completedTripRecordedFallback) return false;
    completedTripRecordedFallback = true;
    return true;
  }
}

export async function markShoppingTripCompleted(): Promise<boolean> {
  const locks = globalThis.navigator?.locks;
  if (locks) {
    try {
      return await locks.request(COMPLETED_TRIP_LOCK_NAME, () =>
        claimShoppingTripCompletion(),
      );
    } catch {
      // Fall through when the Web Locks API is unavailable for this origin.
    }
  }
  return claimShoppingTripCompletion();
}

export function resetShoppingTripCompletion(): void {
  completedTripRecordedFallback = false;
  try {
    localStorage.removeItem(COMPLETED_TRIP_STORAGE_KEY);
  } catch {
    // The in-memory fallback still starts a new completion cycle.
  }
}

function isMealPlanDay(value: unknown): value is MealPlanDay {
  return (
    typeof value === "string" && MEAL_PLAN_DAY_SET.has(value as MealPlanDay)
  );
}

function isMealPlanSlot(value: unknown): value is MealPlanSlot {
  return (
    typeof value === "string" && MEAL_PLAN_SLOT_SET.has(value as MealPlanSlot)
  );
}

function parseState(raw: string | null): ShoppingListState {
  if (!raw) return EMPTY_STATE;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return EMPTY_STATE;

    const recipes = Array.isArray(parsed.recipes)
      ? parsed.recipes.flatMap((entry): SelectedRecipeEntry[] => {
          if (!isRecord(entry) || typeof entry.slug !== "string") return [];
          // Normalise persisted servings the same way setRecipeServings does,
          // so stale/edited storage can't feed the UI a fractional value the
          // stepper (integer labels, servings<=1 disable) doesn't expect.
          const raw = entry.servings;
          const servings =
            typeof raw === "number" && Number.isFinite(raw) && raw > 0
              ? Math.max(1, Math.round(raw))
              : undefined;
          return [{ slug: entry.slug, ...(servings ? { servings } : {}) }];
        })
      : [];

    const seenPlanSlots = new Set<string>();
    const plan = Array.isArray(parsed.plan)
      ? parsed.plan.flatMap((entry): PlannedMealEntry[] => {
          if (
            !isRecord(entry) ||
            !isMealPlanDay(entry.day) ||
            !isMealPlanSlot(entry.slot) ||
            typeof entry.slug !== "string"
          ) {
            return [];
          }
          const key = `${entry.day}:${entry.slot}`;
          if (seenPlanSlots.has(key)) return [];
          seenPlanSlots.add(key);
          return [{ day: entry.day, slot: entry.slot, slug: entry.slug }];
        })
      : [];

    const hydratedRecipes = [...recipes];
    const recipeSlugs = new Set(hydratedRecipes.map((recipe) => recipe.slug));
    for (const meal of plan) {
      if (!recipeSlugs.has(meal.slug)) {
        hydratedRecipes.push({ slug: meal.slug });
        recipeSlugs.add(meal.slug);
      }
    }

    const checked = Array.isArray(parsed.checked)
      ? parsed.checked.filter((v): v is string => typeof v === "string")
      : [];

    const extras = Array.isArray(parsed.extras)
      ? parsed.extras.flatMap((entry): ExtraItem[] => {
          if (
            !isRecord(entry) ||
            typeof entry.id !== "string" ||
            typeof entry.text !== "string"
          ) {
            return [];
          }
          return [{ id: entry.id, text: entry.text, checked: !!entry.checked }];
        })
      : [];

    return { recipes: hydratedRecipes, plan, checked, extras };
  } catch {
    return EMPTY_STATE;
  }
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    state = parseState(localStorage.getItem(STORAGE_KEY));
  } catch {
    // localStorage unavailable (SSR, private browsing, etc.)
  }
}

function persist(): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...state, listId: activeListId }),
    );
  } catch {
    // ignore write failures (quota, private browsing)
  }
}

function emit(source: ShoppingListChangeSource): void {
  for (const listener of listeners) listener(source);
}

function setState(next: ShoppingListState): void {
  state = next;
  persist();
  emit("local");
}

// A single, module-wide storage listener (hooked once on first subscribe, like
// the cooking-timer store) rather than one per subscriber — otherwise a
// cross-tab update would fan out to N handlers each calling emit() over N
// callbacks (N×N redundant notifications).
let storageListenerHooked = false;

function handleStorage(event: StorageEvent): void {
  if (event.key !== STORAGE_KEY || !activeListId || !event.newValue) return;
  try {
    const incoming: unknown = JSON.parse(event.newValue);
    if (!isRecord(incoming)) return;
    if (incoming.listId !== activeListId) {
      emit("storage");
      return;
    }
  } catch {
    return;
  }
  state = parseState(event.newValue);
  emit("storage");
}

function hookStorageListener(): void {
  if (storageListenerHooked || globalThis.window === undefined) return;
  storageListenerHooked = true;
  globalThis.addEventListener("storage", handleStorage);
}

export function subscribeShoppingList(
  callback: (source: ShoppingListChangeSource) => void,
): () => void {
  hydrate();
  hookStorageListener();
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

export function getShoppingListSnapshot(): ShoppingListState {
  hydrate();
  return state;
}

export function getServerShoppingListSnapshot(): ShoppingListState {
  return EMPTY_STATE;
}

export function installShoppingListSnapshot(
  next: ShoppingListState,
  listId?: string,
  source: Extract<ShoppingListChangeSource, "install" | "local"> = "install",
  persistSnapshot = true,
): void {
  hydrated = true;
  activeListId = listId;
  state = parseState(JSON.stringify(next));
  if (persistSnapshot) persist();
  emit(source);
}

// ── Mutations ──────────────────────────────────────────────────────────────

export function isRecipeSelected(slug: string): boolean {
  return getShoppingListSnapshot().recipes.some((r) => r.slug === slug);
}

export function addRecipe(slug: string): void {
  if (isRecipeSelected(slug)) return;
  setState({ ...state, recipes: [...state.recipes, { slug }] });
  captureRecipeProductActivity("shopping_recipe_added", {
    recipe_slug: slug,
    shopping_recipe_count: state.recipes.length,
  });
}

export function removeRecipe(slug: string): void {
  setState({
    ...state,
    recipes: state.recipes.filter((r) => r.slug !== slug),
    plan: state.plan.filter((meal) => meal.slug !== slug),
  });
}

export function toggleRecipe(slug: string): void {
  if (isRecipeSelected(slug)) removeRecipe(slug);
  else addRecipe(slug);
}

export function setRecipeServings(slug: string, servings: number): void {
  const safe = Math.max(1, Math.round(servings));
  setState({
    ...state,
    recipes: state.recipes.map((r) =>
      r.slug === slug ? { ...r, servings: safe } : r,
    ),
  });
}

export function setPlannedMeal(
  day: MealPlanDay,
  slot: MealPlanSlot,
  slug: string | null,
): void {
  const plan = state.plan.filter(
    (meal) => meal.day !== day || meal.slot !== slot,
  );
  const recipes =
    slug && !state.recipes.some((recipe) => recipe.slug === slug)
      ? [...state.recipes, { slug }]
      : state.recipes;
  setState({
    ...state,
    recipes,
    plan: slug ? [...plan, { day, slot, slug }] : plan,
  });
  if (slug) {
    captureRecipeProductActivity("meal_planned", {
      meal_day: day,
      meal_slot: slot,
      planned_meal_count: state.plan.length,
      recipe_slug: slug,
    });
  }
}

export function clearMealPlan(): void {
  if (state.plan.length === 0) return;
  setState({ ...state, plan: [] });
}

export function toggleChecked(key: string): void {
  const wasChecked = state.checked.includes(key);
  const checked = wasChecked
    ? state.checked.filter((k) => k !== key)
    : [...state.checked, key];
  setState({ ...state, checked });
  if (!wasChecked) {
    captureRecipeProductActivity("shopping_item_checked", {
      checked_item_count: state.checked.length,
    });
  }
}

export function clearChecked(): void {
  if (state.checked.length === 0 && state.extras.every((e) => !e.checked)) {
    return;
  }
  setState({
    ...state,
    checked: [],
    extras: state.extras.map((e) => ({ ...e, checked: false })),
  });
  resetShoppingTripCompletion();
}

export function addExtra(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  // Ignore an accidental re-add of an extra that's already on the list
  // (case-insensitive); a genuine duplicate is almost always a mistake.
  const key = trimmed.toLowerCase();
  if (state.extras.some((e) => e.text.toLowerCase() === key)) return;
  // crypto.randomUUID (not Math.random) keeps this out of Sonar's PRNG hotspot;
  // addExtra only runs in the browser, where crypto is always available.
  const id = `extra-${crypto.randomUUID()}`;
  setState({
    ...state,
    extras: [...state.extras, { id, text: trimmed, checked: false }],
  });
}

export function toggleExtra(id: string): void {
  setState({
    ...state,
    extras: state.extras.map((e) =>
      e.id === id ? { ...e, checked: !e.checked } : e,
    ),
  });
}

export function removeExtra(id: string): void {
  setState({ ...state, extras: state.extras.filter((e) => e.id !== id) });
}

export function clearList(): void {
  setState({ ...EMPTY_STATE });
  resetShoppingTripCompletion();
}

/** Reset module state between tests (mirrors the cooking-timer store). */
export function __resetShoppingListForTests(): void {
  if (storageListenerHooked) {
    globalThis.removeEventListener("storage", handleStorage);
    storageListenerHooked = false;
  }
  state = EMPTY_STATE;
  hydrated = false;
  activeListId = undefined;
  completedTripRecordedFallback = false;
  listeners.clear();
}
