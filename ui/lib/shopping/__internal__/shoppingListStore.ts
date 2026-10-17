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

export type ShoppingListState = {
  /** Selected recipes, kept in the order they were added. */
  recipes: SelectedRecipeEntry[];
  /** Ticked-off ingredient slugs. */
  checked: string[];
  /** Freeform extras (milk, bread…). */
  extras: ExtraItem[];
};

export type ShoppingListChangeSource = "install" | "local" | "storage";

const LEGACY_STORAGE_KEY = "recipe-shopping-list:v1";
const STORAGE_KEY_PREFIX = "recipe-shopping-list:v2:";
const COMPLETED_TRIP_STORAGE_KEY = "recipe-shopping-trip-completed:v1";
const COMPLETED_TRIP_LOCK_NAME = "recipe-shopping-trip-completion";

const EMPTY_STATE: ShoppingListState = {
  recipes: [],
  checked: [],
  extras: [],
};

let state: ShoppingListState = EMPTY_STATE;
let hydrated = false;
let activeUserId: string | undefined;
let activeListId: string | undefined;
let activeRevision: string | undefined;
let activeResourceId: string | undefined;
let confirmedSnapshot: ShoppingListState | undefined;
let hasUnsavedChanges = false;
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

    return { recipes, checked, extras };
  } catch {
    return EMPTY_STATE;
  }
}

function storageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${encodeURIComponent(userId)}`;
}

function restoreCacheMetadata(parsed: Record<string, unknown>): void {
  activeListId = typeof parsed.listId === "string" ? parsed.listId : undefined;
  activeRevision =
    typeof parsed.revision === "string" ? parsed.revision : undefined;
  activeResourceId =
    typeof parsed.resourceId === "string" ? parsed.resourceId : undefined;
  confirmedSnapshot = isRecord(parsed.confirmedSnapshot)
    ? parseState(JSON.stringify(parsed.confirmedSnapshot))
    : undefined;
  hasUnsavedChanges = parsed.hasUnsavedChanges === true;
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    if (!activeUserId) return;
    const raw = localStorage.getItem(storageKey(activeUserId));
    state = parseState(raw);
    const parsed: unknown = raw ? JSON.parse(raw) : undefined;
    if (isRecord(parsed)) {
      if (parsed.version !== 2 || parsed.userId !== activeUserId) {
        localStorage.removeItem(storageKey(activeUserId));
        state = EMPTY_STATE;
        return;
      }
      restoreCacheMetadata(parsed);
    }
  } catch {
    // localStorage unavailable (SSR, private browsing, etc.)
  }
}

function persist(): void {
  try {
    if (!activeUserId) return;
    localStorage.setItem(
      storageKey(activeUserId),
      JSON.stringify({
        version: 2,
        userId: activeUserId,
        ...state,
        listId: activeListId,
        revision: activeRevision,
        resourceId: activeResourceId,
        confirmedSnapshot,
        hasUnsavedChanges,
      }),
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
  hasUnsavedChanges = true;
  persist();
  emit("local");
}

// A single, module-wide storage listener (hooked once on first subscribe, like
// the cooking-timer store) rather than one per subscriber — otherwise a
// cross-tab update would fan out to N handlers each calling emit() over N
// callbacks (N×N redundant notifications).
let storageListenerHooked = false;

function handleStorage(event: StorageEvent): void {
  if (
    !activeUserId ||
    event.key !== storageKey(activeUserId) ||
    !activeListId ||
    !event.newValue
  ) {
    return;
  }
  try {
    const incoming: unknown = JSON.parse(event.newValue);
    if (
      !isRecord(incoming) ||
      incoming.version !== 2 ||
      incoming.userId !== activeUserId
    ) {
      return;
    }
    if (incoming.listId !== activeListId) {
      emit("storage");
      return;
    }
    if (incoming.resourceId !== activeResourceId) {
      emit("storage");
      return;
    }
    state = parseState(event.newValue);
    activeRevision =
      typeof incoming.revision === "string" ? incoming.revision : undefined;
    confirmedSnapshot = isRecord(incoming.confirmedSnapshot)
      ? parseState(JSON.stringify(incoming.confirmedSnapshot))
      : undefined;
    hasUnsavedChanges = incoming.hasUnsavedChanges === true;
  } catch {
    return;
  }
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

export function setShoppingListOwner(userId: string | undefined): void {
  if (activeUserId === userId && hydrated) return;
  activeUserId = userId;
  state = EMPTY_STATE;
  hydrated = false;
  activeListId = undefined;
  activeRevision = undefined;
  activeResourceId = undefined;
  confirmedSnapshot = undefined;
  hasUnsavedChanges = false;
  if (userId) {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // An unscoped legacy record must never be restored into this account.
    }
    hydrate();
  }
  emit("install");
}

export function getShoppingListCacheIdentity(): {
  listId?: string;
  revision?: string;
  resourceId?: string;
} {
  hydrate();
  return {
    listId: activeListId,
    revision: activeRevision,
    resourceId: activeResourceId,
  };
}

export function getShoppingListCacheMetadata(): {
  confirmedSnapshot?: ShoppingListState;
  hasUnsavedChanges: boolean;
} {
  hydrate();
  return { confirmedSnapshot, hasUnsavedChanges };
}

export function getServerShoppingListSnapshot(): ShoppingListState {
  return EMPTY_STATE;
}

export function installShoppingListSnapshot(
  next: ShoppingListState,
  listId?: string,
  source: Extract<ShoppingListChangeSource, "install" | "local"> = "install",
  persistSnapshot = true,
  revision?: string,
  cacheMetadata?: {
    confirmedSnapshot: ShoppingListState;
    hasUnsavedChanges: boolean;
  },
  resourceId?: string,
): void {
  hydrated = true;
  activeListId = listId;
  activeRevision = revision;
  activeResourceId = resourceId;
  state = parseState(JSON.stringify(next));
  if (cacheMetadata) {
    confirmedSnapshot = parseState(
      JSON.stringify(cacheMetadata.confirmedSnapshot),
    );
    hasUnsavedChanges = cacheMetadata.hasUnsavedChanges;
  } else if (source === "local") {
    hasUnsavedChanges = true;
  } else if (persistSnapshot) {
    confirmedSnapshot = state;
    hasUnsavedChanges = false;
  }
  if (persistSnapshot) persist();
  emit(source);
}

export function confirmShoppingListRevision(
  listId: string,
  revision: string,
  snapshot: ShoppingListState,
): void {
  if (activeListId !== listId) return;
  activeRevision = revision;
  confirmedSnapshot = parseState(JSON.stringify(snapshot));
  hasUnsavedChanges = false;
  persist();
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

export function clearShoppingListStorage(): void {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(STORAGE_KEY_PREFIX)) localStorage.removeItem(key);
    }
    localStorage.removeItem(COMPLETED_TRIP_STORAGE_KEY);
  } catch {
    // Reset the live copy even when browser storage is restricted.
  }
  state = EMPTY_STATE;
  hydrated = true;
  activeListId = undefined;
  activeRevision = undefined;
  activeResourceId = undefined;
  confirmedSnapshot = undefined;
  hasUnsavedChanges = false;
  completedTripRecordedFallback = false;
  emit("install");
}

/** Reset module state between tests (mirrors the cooking-timer store). */
export function __resetShoppingListForTests(): void {
  if (storageListenerHooked) {
    globalThis.removeEventListener("storage", handleStorage);
    storageListenerHooked = false;
  }
  state = EMPTY_STATE;
  hydrated = false;
  activeUserId = "test-user";
  activeListId = undefined;
  activeRevision = undefined;
  activeResourceId = undefined;
  confirmedSnapshot = undefined;
  hasUnsavedChanges = false;
  completedTripRecordedFallback = false;
  listeners.clear();
}
