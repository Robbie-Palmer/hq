import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CookingTimerEffectAdapters } from "@/lib/cooking/cookingTimerEffects";
import { createCookingTimerPersistence } from "@/lib/cooking/cookingTimerPersistence";
import {
  cookingTimerEvents,
  selectCookingTimers,
} from "@/lib/cooking/cookingTimersSlice";
import {
  createRecipeClientStore,
  type RecipeClientStoreBundle,
} from "@/lib/cooking/recipeClientStore";
import { changeTestRecipeOwner } from "@/tests/support/recipe-client-state";

const INPUT = { id: "toast", label: "Toast", durationSeconds: 1 };

describe("cooking timer effects adapter", () => {
  let bundle: RecipeClientStoreBundle;
  let nowMs: number;
  const analytics = vi.fn();
  const playAlert = vi.fn();
  const releaseWakeLock = vi.fn();
  const retainWakeLock = vi.fn();
  const unlockAudio = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    nowMs = 10_000;
    const adapters: CookingTimerEffectAdapters = {
      analytics: { timerStarted: analytics },
      audio: { playAlert, unlock: unlockAudio },
      clock: { now: () => nowMs },
      ids: { next: () => "custom-id" },
      persistence: createCookingTimerPersistence(localStorage),
      scheduler: {
        clearInterval: (handle) => globalThis.clearInterval(handle),
        setInterval: (callback, delayMs) =>
          globalThis.setInterval(callback, delayMs),
      },
      wakeLock: { release: releaseWakeLock, retain: retainWakeLock },
    };
    bundle = createRecipeClientStore(adapters);
    bundle.runtime.start(bundle.store);
    changeTestRecipeOwner(bundle, "cook-1");
  });

  afterEach(() => {
    bundle.runtime.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("routes accepted events through audio, analytics, persistence, and wake lock adapters", () => {
    bundle.commands.start(INPUT);

    expect(unlockAudio).toHaveBeenCalledOnce();
    expect(analytics).toHaveBeenCalledWith({
      recipeSlug: undefined,
      durationSeconds: 1,
      kind: "recipe",
    });
    expect(retainWakeLock).toHaveBeenCalled();
    expect(localStorage.getItem("cooking-timers:v2:cook-1")).toContain(
      '"id":"toast"',
    );

    nowMs = 11_000;
    bundle.store.dispatch(cookingTimerEvents.clockTicked({ nowMs }));

    expect(playAlert).toHaveBeenCalledOnce();
    expect(releaseWakeLock).toHaveBeenCalled();
    expect(selectCookingTimers(bundle.store.getState())[0]?.state).toBe(
      "completed",
    );
  });

  it("does not run event effects for a rejected transition", () => {
    bundle.commands.resume("missing");
    expect(unlockAudio).not.toHaveBeenCalled();
    expect(analytics).not.toHaveBeenCalled();
    expect(localStorage.getItem("cooking-timers:v2:cook-1")).toBeNull();
  });

  it("catches up through the visibility adapter", () => {
    bundle.commands.start(INPUT);
    nowMs = 11_000;
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");

    document.dispatchEvent(new Event("visibilitychange"));

    expect(selectCookingTimers(bundle.store.getState())[0]?.state).toBe(
      "completed",
    );
    expect(playAlert).toHaveBeenCalledOnce();
  });

  it("hydrates the active identity when another tab changes its storage key", () => {
    localStorage.setItem(
      "cooking-timers:v2:cook-1",
      JSON.stringify({
        version: 2,
        userId: "cook-1",
        timers: [
          {
            ...INPUT,
            state: "paused",
            remainingSeconds: 1,
            endTimeMs: null,
          },
        ],
      }),
    );

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "cooking-timers:v2:cook-1",
      }),
    );

    expect(selectCookingTimers(bundle.store.getState())[0]).toMatchObject({
      id: "toast",
      state: "paused",
    });
  });
});
