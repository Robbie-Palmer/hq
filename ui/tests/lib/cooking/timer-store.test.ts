import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatCountdown,
  selectCookingTimers,
} from "@/lib/cooking/cookingTimersSlice";
import type { RecipeClientStoreBundle } from "@/lib/cooking/recipeClientStore";
import {
  changeTestRecipeOwner,
  createTestRecipeClientStore,
} from "@/tests/support/recipe-client-state";

function firstTimer(bundle: RecipeClientStoreBundle) {
  const timer = selectCookingTimers(bundle.store.getState())[0];
  if (!timer) throw new Error("expected at least one timer");
  return timer;
}

const INPUT = {
  id: "shakshuka:s0:t1",
  recipeSlug: "shakshuka",
  recipeTitle: "Shakshuka",
  label: "10 minutes",
  durationSeconds: 600,
};
const STORAGE_KEY = "cooking-timers:v2:test-user";

describe("Recipe Site cooking timer store", () => {
  let bundle: RecipeClientStoreBundle;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    bundle = createTestRecipeClientStore();
    bundle.runtime.start(bundle.store);
    changeTestRecipeOwner(bundle, "test-user");
  });

  afterEach(() => {
    bundle.runtime.stop();
    vi.useRealTimers();
  });

  it("starts a running timer with the full duration", () => {
    bundle.commands.start(INPUT);
    expect(selectCookingTimers(bundle.store.getState())).toHaveLength(1);
    expect(firstTimer(bundle)).toMatchObject({
      id: INPUT.id,
      state: "running",
      remainingSeconds: 600,
      endTimeMs: Date.now() + 600_000,
    });
  });

  it("counts down while running and completes at zero", () => {
    bundle.commands.start(INPUT);
    vi.advanceTimersByTime(90_000);
    expect(firstTimer(bundle).remainingSeconds).toBe(510);
    vi.advanceTimersByTime(510_000);
    expect(firstTimer(bundle)).toMatchObject({
      state: "completed",
      remainingSeconds: 0,
      endTimeMs: null,
    });
  });

  it("pauses and resumes without counting paused time", () => {
    bundle.commands.start(INPUT);
    vi.advanceTimersByTime(100_000);
    bundle.commands.pause(INPUT.id);
    expect(firstTimer(bundle)).toMatchObject({
      state: "paused",
      remainingSeconds: 500,
      endTimeMs: null,
    });
    vi.advanceTimersByTime(60_000);
    expect(firstTimer(bundle).remainingSeconds).toBe(500);
    bundle.commands.resume(INPUT.id);
    vi.advanceTimersByTime(10_000);
    expect(firstTimer(bundle)).toMatchObject({
      state: "running",
      remainingSeconds: 490,
    });
  });

  it("extends a running timer and restarts a completed one", () => {
    bundle.commands.start({ ...INPUT, durationSeconds: 60 });
    bundle.commands.extend(INPUT.id, 60);
    expect(firstTimer(bundle).remainingSeconds).toBe(120);
    vi.advanceTimersByTime(120_000);
    expect(firstTimer(bundle).state).toBe("completed");
    bundle.commands.extend(INPUT.id, 60);
    expect(firstTimer(bundle)).toMatchObject({
      state: "running",
      remainingSeconds: 60,
    });
  });

  it("dismisses timers and removes empty persistence", () => {
    bundle.commands.start(INPUT);
    bundle.commands.dismiss(INPUT.id);
    expect(selectCookingTimers(bundle.store.getState())).toHaveLength(0);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("restarting an existing id replaces the timer", () => {
    bundle.commands.start(INPUT);
    vi.advanceTimersByTime(200_000);
    bundle.commands.start(INPUT);
    expect(selectCookingTimers(bundle.store.getState())).toHaveLength(1);
    expect(firstTimer(bundle).remainingSeconds).toBe(600);
  });

  it("persists end timestamps and restores them after a reload", () => {
    bundle.commands.start(INPUT);
    vi.advanceTimersByTime(60_000);
    bundle.runtime.stop();
    vi.advanceTimersByTime(120_000);
    bundle = createTestRecipeClientStore();
    bundle.runtime.start(bundle.store);
    changeTestRecipeOwner(bundle, "test-user");
    expect(firstTimer(bundle)).toMatchObject({
      state: "running",
      remainingSeconds: 420,
    });
  });

  it("restores a timer that expired while away as completed", () => {
    bundle.commands.start({ ...INPUT, durationSeconds: 60 });
    bundle.runtime.stop();
    vi.advanceTimersByTime(120_000);
    bundle = createTestRecipeClientStore();
    bundle.runtime.start(bundle.store);
    changeTestRecipeOwner(bundle, "test-user");
    expect(firstTimer(bundle)).toMatchObject({
      state: "completed",
      remainingSeconds: 0,
      endTimeMs: null,
    });
  });

  it("ignores malformed stored data", () => {
    bundle.runtime.stop();
    localStorage.setItem(STORAGE_KEY, '{"not":"an envelope"}');
    bundle = createTestRecipeClientStore();
    changeTestRecipeOwner(bundle, "test-user");
    expect(selectCookingTimers(bundle.store.getState())).toHaveLength(0);
    localStorage.setItem(
      STORAGE_KEY,
      '{"version":2,"userId":"test-user","timers":[{"id":42}]}',
    );
    changeTestRecipeOwner(bundle, undefined);
    changeTestRecipeOwner(bundle, "test-user");
    expect(selectCookingTimers(bundle.store.getState())).toHaveLength(0);
  });

  it("keeps persisted timer snapshots isolated by user", () => {
    changeTestRecipeOwner(bundle, "user-1");
    bundle.commands.start(INPUT);
    changeTestRecipeOwner(bundle, "user-2");
    expect(selectCookingTimers(bundle.store.getState())).toHaveLength(0);
    bundle.commands.start({ ...INPUT, id: "user-2-timer", label: "User two" });
    changeTestRecipeOwner(bundle, "user-1");
    expect(
      selectCookingTimers(bundle.store.getState()).map(({ id }) => id),
    ).toEqual([INPUT.id]);
  });

  it("keeps a timer selector reference stable until a displayed second changes", () => {
    bundle.commands.start(INPUT);
    const initial = firstTimer(bundle);
    vi.advanceTimersByTime(750);
    expect(firstTimer(bundle)).toBe(initial);
    vi.advanceTimersByTime(250);
    expect(firstTimer(bundle)).not.toBe(initial);
    expect(firstTimer(bundle).remainingSeconds).toBe(599);
  });

  it("notifies store subscribers on mutations and each ticking second", () => {
    const listener = vi.fn();
    const unsubscribe = bundle.store.subscribe(listener);
    bundle.commands.start(INPUT);
    expect(listener).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(3_000);

    expect(listener).toHaveBeenCalledTimes(4);
    unsubscribe();
  });

  it("starts a custom timer with a minted id and no recipe context", () => {
    const id = bundle.commands.startCustom({
      label: "Pasta",
      durationSeconds: 300,
    });
    expect(id).toMatch(/^custom:/);
    expect(firstTimer(bundle)).toMatchObject({
      id,
      label: "Pasta",
      state: "running",
      remainingSeconds: 300,
    });
    expect(firstTimer(bundle).recipeSlug).toBeUndefined();
    expect(firstTimer(bundle).recipeTitle).toBeUndefined();
  });

  it("starts custom timers with distinct minted ids", () => {
    const first = bundle.commands.startCustom({
      label: "One",
      durationSeconds: 60,
    });
    const second = bundle.commands.startCustom({
      label: "Two",
      durationSeconds: 120,
    });
    expect(first).toMatch(/^custom:/);
    expect(second).not.toBe(first);
    expect(selectCookingTimers(bundle.store.getState())).toHaveLength(2);
  });

  it("persists and restores custom timers without recipe fields", () => {
    bundle.commands.startCustom({ label: "Rice", durationSeconds: 600 });
    vi.advanceTimersByTime(60_000);
    bundle.runtime.stop();
    bundle = createTestRecipeClientStore();
    changeTestRecipeOwner(bundle, "test-user");
    expect(firstTimer(bundle)).toMatchObject({
      label: "Rice",
      state: "running",
      remainingSeconds: 540,
    });
    expect(firstTimer(bundle).recipeSlug).toBeUndefined();
  });

  it("clears every identity-scoped timer record", () => {
    bundle.commands.start(INPUT);
    changeTestRecipeOwner(bundle, "another-user");
    bundle.commands.start({ ...INPUT, id: "another" });
    bundle.commands.clearAll();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem("cooking-timers:v2:another-user")).toBeNull();
    expect(selectCookingTimers(bundle.store.getState())).toHaveLength(0);
  });

  it("formats countdowns", () => {
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(59)).toBe("0:59");
    expect(formatCountdown(600)).toBe("10:00");
    expect(formatCountdown(3661)).toBe("1:01:01");
  });
});
