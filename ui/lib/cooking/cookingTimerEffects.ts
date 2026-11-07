import type { ListenerMiddlewareInstance } from "@reduxjs/toolkit";
import { isAnyOf, type UnknownAction } from "@reduxjs/toolkit";
import { captureRecipeProductActivity } from "@/lib/analytics/recipe-product";
import { ensureAudioUnlocked, playAlertTone } from "./alertTone";
import type { CookingTimerPersistence } from "./cookingTimerPersistence";
import {
  cookingTimerEvents,
  remainingFrom,
  selectAnyCookingTimerRunning,
  selectCookingTimers,
} from "./cookingTimersSlice";
import { releaseWakeLock, retainWakeLock } from "./wakeLock";

const TICK_MS = 250;
const WAKE_LOCK_KEY = "cooking-timers";

export type CookingTimerEffectAdapters = {
  analytics: {
    timerStarted(input: {
      recipeSlug?: string;
      durationSeconds: number;
      kind: "custom" | "recipe";
    }): void;
  };
  audio: { playAlert(): void; unlock(): void };
  clock: { now(): number };
  ids: { next(): string };
  persistence: CookingTimerPersistence;
  scheduler: {
    clearInterval(handle: ReturnType<typeof setInterval>): void;
    setInterval(
      callback: () => void,
      delayMs: number,
    ): ReturnType<typeof setInterval>;
  };
  wakeLock: { release(): void; retain(): void };
};

export function createBrowserCookingTimerEffectAdapters(
  persistence: CookingTimerPersistence,
): CookingTimerEffectAdapters {
  let fallbackSequence = 0;
  return {
    analytics: {
      timerStarted(input) {
        captureRecipeProductActivity("timer_started", {
          recipe_slug: input.recipeSlug,
          timer_duration_seconds: input.durationSeconds,
          timer_kind: input.kind,
        });
      },
    },
    audio: { playAlert: playAlertTone, unlock: ensureAudioUnlocked },
    clock: { now: () => Date.now() },
    ids: {
      next() {
        fallbackSequence += 1;
        return (
          globalThis.crypto?.randomUUID?.() ??
          `${Date.now()}-${fallbackSequence}`
        );
      },
    },
    persistence,
    scheduler: {
      clearInterval: (handle) => globalThis.clearInterval(handle),
      setInterval: (callback, delayMs) =>
        globalThis.setInterval(callback, delayMs),
    },
    wakeLock: {
      release: () => releaseWakeLock(WAKE_LOCK_KEY),
      retain: () => retainWakeLock(WAKE_LOCK_KEY),
    },
  };
}

type TimerRootState = Parameters<typeof selectCookingTimers>[0] & {
  recipeSession: { userId: string | null };
};

export type CookingTimerRuntimeStore = {
  dispatch(action: UnknownAction): unknown;
  getState(): TimerRootState;
};

export class CookingTimerRuntime {
  private interval: ReturnType<typeof setInterval> | null = null;
  private store: CookingTimerRuntimeStore | null = null;
  private readonly handleStorage = (event: StorageEvent) => {
    const store = this.store;
    const userId = store?.getState().recipeSession.userId;
    if (
      !store ||
      !userId ||
      event.key !== this.adapters.persistence.keyFor(userId)
    ) {
      return;
    }
    store.dispatch(
      cookingTimerEvents.timerStateHydrated({
        timers: this.adapters.persistence.load(
          userId,
          this.adapters.clock.now(),
        ),
      }),
    );
  };
  private readonly handleVisibility = () => {
    const store = this.store;
    if (
      !store ||
      globalThis.document?.visibilityState !== "visible" ||
      !selectAnyCookingTimerRunning(store.getState())
    ) {
      return;
    }
    store.dispatch(
      cookingTimerEvents.clockTicked({ nowMs: this.adapters.clock.now() }),
    );
  };

  constructor(private readonly adapters: CookingTimerEffectAdapters) {}

  start(store: CookingTimerRuntimeStore): void {
    if (this.store) return;
    this.store = store;
    globalThis.addEventListener?.("storage", this.handleStorage);
    globalThis.document?.addEventListener(
      "visibilitychange",
      this.handleVisibility,
    );
    this.sync(store);
  }

  stop(): void {
    globalThis.removeEventListener?.("storage", this.handleStorage);
    globalThis.document?.removeEventListener(
      "visibilitychange",
      this.handleVisibility,
    );
    this.stopInterval();
    this.adapters.wakeLock.release();
    this.store = null;
  }

  sync(store: CookingTimerRuntimeStore): void {
    if (selectAnyCookingTimerRunning(store.getState())) {
      this.adapters.wakeLock.retain();
      this.interval ??= this.adapters.scheduler.setInterval(() => {
        this.tick(store);
      }, TICK_MS);
      return;
    }
    this.stopInterval();
    this.adapters.wakeLock.release();
  }

  private stopInterval(): void {
    if (this.interval === null) return;
    this.adapters.scheduler.clearInterval(this.interval);
    this.interval = null;
  }

  private tick(store: CookingTimerRuntimeStore): void {
    const nowMs = this.adapters.clock.now();
    const secondChanged = selectCookingTimers(store.getState()).some(
      (timer) =>
        timer.state === "running" &&
        timer.endTimeMs !== null &&
        remainingFrom(timer.endTimeMs, nowMs) !== timer.remainingSeconds,
    );
    if (secondChanged) {
      store.dispatch(cookingTimerEvents.clockTicked({ nowMs }));
    }
  }
}

export function registerCookingTimerListeners(
  listener: ListenerMiddlewareInstance<TimerRootState>,
  adapters: CookingTimerEffectAdapters,
  runtime: CookingTimerRuntime,
  ownerChanged: { type: string; match(action: unknown): boolean },
): void {
  listener.startListening({
    predicate: ownerChanged.match,
    effect(_action, api) {
      const userId = api.getState().recipeSession.userId;
      adapters.persistence.removeLegacy();
      api.dispatch(
        cookingTimerEvents.timerStateHydrated({
          timers: userId
            ? adapters.persistence.load(userId, adapters.clock.now())
            : [],
        }),
      );
      runtime.sync(api as unknown as CookingTimerRuntimeStore);
    },
  });

  listener.startListening({
    matcher: cookingTimerEvents.timerStarted.match,
    effect(action, api) {
      if (!timerStateChanged(api)) return;
      adapters.audio.unlock();
      adapters.analytics.timerStarted({
        recipeSlug: action.payload.input.recipeSlug,
        durationSeconds: action.payload.input.durationSeconds,
        kind: action.payload.input.id.startsWith("custom:")
          ? "custom"
          : "recipe",
      });
      persistAndSync(api.getState(), adapters, runtime, api);
    },
  });

  listener.startListening({
    matcher: isAnyOf(
      cookingTimerEvents.timerResumed,
      cookingTimerEvents.timerExtended,
    ),
    effect(_action, api) {
      if (!timerStateChanged(api)) return;
      adapters.audio.unlock();
      persistAndSync(api.getState(), adapters, runtime, api);
    },
  });

  listener.startListening({
    matcher: isAnyOf(
      cookingTimerEvents.timerPaused,
      cookingTimerEvents.timerDismissed,
    ),
    effect(_action, api) {
      if (!timerStateChanged(api)) return;
      persistAndSync(api.getState(), adapters, runtime, api);
    },
  });

  listener.startListening({
    matcher: cookingTimerEvents.clockTicked.match,
    effect(_action, api) {
      const before = selectCookingTimers(api.getOriginalState());
      const after = selectCookingTimers(api.getState());
      const previouslyCompleted = new Set(
        before.filter(({ state }) => state === "completed").map(({ id }) => id),
      );
      const completedNow = after.some(
        ({ id, state }) =>
          state === "completed" && !previouslyCompleted.has(id),
      );
      if (completedNow) {
        const userId = api.getState().recipeSession.userId;
        if (userId) adapters.persistence.save(userId, after);
        adapters.audio.playAlert();
      }
      runtime.sync(api as unknown as CookingTimerRuntimeStore);
    },
  });

  listener.startListening({
    matcher: cookingTimerEvents.timerStateHydrated.match,
    effect(_action, api) {
      runtime.sync(api as unknown as CookingTimerRuntimeStore);
    },
  });

  listener.startListening({
    matcher: cookingTimerEvents.allTimersCleared.match,
    effect(_action, api) {
      adapters.persistence.clearAll();
      runtime.sync(api as unknown as CookingTimerRuntimeStore);
    },
  });
}

function timerStateChanged(api: {
  getOriginalState(): TimerRootState;
  getState(): TimerRootState;
}): boolean {
  return api.getOriginalState().cookingTimers !== api.getState().cookingTimers;
}

function persistAndSync(
  state: TimerRootState,
  adapters: CookingTimerEffectAdapters,
  runtime: CookingTimerRuntime,
  store: CookingTimerRuntimeStore,
): void {
  const userId = state.recipeSession.userId;
  if (userId) adapters.persistence.save(userId, selectCookingTimers(state));
  runtime.sync(store);
}
