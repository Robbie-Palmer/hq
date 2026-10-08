import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addExtra,
  addRecipe,
  clearChecked,
  clearList,
  clearMealPlan,
  getShoppingListSnapshot,
  installShoppingListSnapshot,
  markShoppingTripCompleted,
  removeExtra,
  removeRecipe,
  setPlannedMeal,
  setRecipeServings,
  subscribeShoppingList,
  toggleChecked,
  toggleExtra,
  toggleRecipe,
} from "@/lib/shopping/shoppingListStore";
import { __resetShoppingListForTests } from "@/tests/support/recipe-state";

// Mirrors the module's private persistence key.
const STORAGE_KEY = "recipe-shopping-list:v1";

describe("shoppingListStore", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetShoppingListForTests();
  });
  afterEach(() => {
    __resetShoppingListForTests();
  });

  it("adds recipes without duplicating and applies servings overrides", () => {
    addRecipe("risotto");
    addRecipe("risotto");
    setRecipeServings("risotto", 6);
    expect(getShoppingListSnapshot().recipes).toEqual([
      { slug: "risotto", servings: 6 },
    ]);
  });

  it("ignores a case-insensitive duplicate extra", () => {
    addExtra("Milk");
    addExtra("milk");
    addExtra("  MILK  ");
    const { extras } = getShoppingListSnapshot();
    expect(extras).toHaveLength(1);
    expect(extras[0]!.text).toBe("Milk");
  });

  it("adds genuinely different extras", () => {
    addExtra("milk");
    addExtra("bread");
    expect(getShoppingListSnapshot().extras.map((e) => e.text)).toEqual([
      "milk",
      "bread",
    ]);
  });

  it("keeps ingredient ticks and extra ticks independent", () => {
    // An extra that shares an ingredient's name is a separate row with its own
    // checked state — ticking one must not tick the other.
    addExtra("garlic");
    toggleChecked("garlic"); // ticks the *ingredient* slug
    const { checked, extras } = getShoppingListSnapshot();
    expect(checked).toContain("garlic");
    expect(extras[0]!.checked).toBe(false);

    toggleExtra(extras[0]!.id); // ticks the *extra*
    expect(getShoppingListSnapshot().extras[0]!.checked).toBe(true);
    // ingredient tick unchanged
    expect(getShoppingListSnapshot().checked).toContain("garlic");
  });

  it("removes an extra by id", () => {
    addExtra("napkins");
    const id = getShoppingListSnapshot().extras[0]!.id;
    removeExtra(id);
    expect(getShoppingListSnapshot().extras).toHaveLength(0);
  });

  it("normalises fractional persisted servings to an integer on hydration", () => {
    // Simulate stale/edited localStorage carrying a non-integer servings value.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        recipes: [{ slug: "risotto", servings: 2.6 }],
        checked: [],
        extras: [],
      }),
    );
    __resetShoppingListForTests(); // force re-hydration from storage
    expect(getShoppingListSnapshot().recipes).toEqual([
      { slug: "risotto", servings: 3 },
    ]);
    expect(getShoppingListSnapshot().plan).toEqual([]);
  });

  it("adds scheduled meals and auto-adds the recipe to the shopping pool", () => {
    setPlannedMeal("mon", "dinner", "risotto");
    expect(getShoppingListSnapshot()).toMatchObject({
      recipes: [{ slug: "risotto" }],
      plan: [{ day: "mon", slot: "dinner", slug: "risotto" }],
    });
  });

  it("replaces one calendar slot without duplicating recipes", () => {
    setPlannedMeal("mon", "dinner", "risotto");
    setPlannedMeal("mon", "dinner", "paella");
    expect(getShoppingListSnapshot().recipes).toEqual([
      { slug: "risotto" },
      { slug: "paella" },
    ]);
    expect(getShoppingListSnapshot().plan).toEqual([
      { day: "mon", slot: "dinner", slug: "paella" },
    ]);
  });

  it("clears a slot while keeping the recipe in the shopping pool", () => {
    setPlannedMeal("mon", "dinner", "risotto");
    setPlannedMeal("mon", "dinner", null);
    expect(getShoppingListSnapshot().recipes).toEqual([{ slug: "risotto" }]);
    expect(getShoppingListSnapshot().plan).toEqual([]);
  });

  it("clears only the calendar plan", () => {
    setPlannedMeal("mon", "dinner", "risotto");
    addExtra("foil");
    clearMealPlan();
    expect(getShoppingListSnapshot().recipes).toEqual([{ slug: "risotto" }]);
    expect(getShoppingListSnapshot().plan).toEqual([]);
    expect(getShoppingListSnapshot().extras).toHaveLength(1);
  });

  it("installs a single shared storage listener regardless of subscriber count", () => {
    const addSpy = vi.spyOn(globalThis, "addEventListener");
    const unsub = [
      subscribeShoppingList(() => {}),
      subscribeShoppingList(() => {}),
      subscribeShoppingList(() => {}),
    ];
    const storageListeners = addSpy.mock.calls.filter(
      ([type]) => type === "storage",
    );
    expect(storageListeners).toHaveLength(1);
    for (const u of unsub) u();
    addSpy.mockRestore();
  });

  it("toggles a recipe on and off", () => {
    toggleRecipe("paella");
    expect(getShoppingListSnapshot().recipes).toEqual([{ slug: "paella" }]);
    toggleRecipe("paella");
    expect(getShoppingListSnapshot().recipes).toEqual([]);
  });

  it("removes a recipe by slug", () => {
    addRecipe("a");
    addRecipe("b");
    setPlannedMeal("mon", "dinner", "a");
    removeRecipe("a");
    expect(getShoppingListSnapshot().recipes).toEqual([{ slug: "b" }]);
    expect(getShoppingListSnapshot().plan).toEqual([]);
  });

  it("clearChecked unticks ingredients and extras but keeps them", () => {
    addExtra("foil");
    toggleChecked("garlic");
    toggleExtra(getShoppingListSnapshot().extras[0]!.id);
    clearChecked();
    const snap = getShoppingListSnapshot();
    expect(snap.checked).toEqual([]);
    expect(snap.extras[0]!.checked).toBe(false);
    expect(snap.extras).toHaveLength(1); // extra itself is retained
  });

  it("starts a new shopping-trip completion cycle only after clearing checks", async () => {
    toggleChecked("garlic");
    await expect(markShoppingTripCompleted()).resolves.toBe(true);
    await expect(markShoppingTripCompleted()).resolves.toBe(false);

    clearChecked();

    await expect(markShoppingTripCompleted()).resolves.toBe(true);
  });

  it("clearList wipes everything", () => {
    addRecipe("a");
    addExtra("foil");
    toggleChecked("garlic");
    clearList();
    expect(getShoppingListSnapshot()).toEqual({
      recipes: [],
      plan: [],
      checked: [],
      extras: [],
    });
  });

  it("syncs state from a cross-tab storage event", () => {
    installShoppingListSnapshot(getShoppingListSnapshot(), "list-1");
    const seen: Array<{ count: number; source: string }> = [];
    const unsub = subscribeShoppingList((source) =>
      seen.push({
        count: getShoppingListSnapshot().recipes.length,
        source,
      }),
    );
    globalThis.dispatchEvent(
      new StorageEvent("storage", {
        key: STORAGE_KEY,
        newValue: JSON.stringify({
          recipes: [{ slug: "x" }, { slug: "y" }],
          plan: [{ day: "tue", slot: "lunch", slug: "z" }],
          checked: [],
          extras: [],
          listId: "list-1",
        }),
      }),
    );
    expect(getShoppingListSnapshot().recipes).toHaveLength(3);
    expect(getShoppingListSnapshot().recipes).toContainEqual({ slug: "z" });
    expect(getShoppingListSnapshot().plan).toHaveLength(1);
    expect(seen).toContainEqual({ count: 3, source: "storage" });
    unsub();
  });

  it("ignores storage events until the active list is installed", () => {
    addRecipe("current");
    const unsub = subscribeShoppingList(() => {});

    globalThis.dispatchEvent(
      new StorageEvent("storage", {
        key: STORAGE_KEY,
        newValue: JSON.stringify({
          recipes: [{ slug: "foreign" }],
          plan: [],
          checked: [],
          extras: [],
          listId: "list-2",
        }),
      }),
    );

    expect(getShoppingListSnapshot().recipes).toEqual([{ slug: "current" }]);
    unsub();
  });

  it("ignores browser storage from another shopping list", () => {
    addRecipe("current");
    installShoppingListSnapshot(getShoppingListSnapshot(), "list-1");
    const seen: string[] = [];
    const unsub = subscribeShoppingList((source) => seen.push(source));
    globalThis.dispatchEvent(
      new StorageEvent("storage", {
        key: STORAGE_KEY,
        newValue: JSON.stringify({
          recipes: [{ slug: "other" }],
          plan: [],
          checked: [],
          extras: [],
          listId: "list-2",
        }),
      }),
    );
    expect(getShoppingListSnapshot().recipes).toEqual([{ slug: "current" }]);
    expect(seen).toEqual(["storage"]);
    unsub();
  });
});
