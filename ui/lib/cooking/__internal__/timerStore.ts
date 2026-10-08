/**
 * Global cooking-timer store.
 *
 * A module-level store (consumed via useSyncExternalStore in
 * `use-cooking-timers`) so the same timers are visible from the inline step
 * pills, cook mode, and the floating dock, and keep running as the user
 * navigates between pages. Running timers are persisted to localStorage as
 * absolute end-timestamps, so they keep counting down across reloads and
 * while the tab is away.
 */

import { captureRecipeProductActivity } from "@/lib/analytics/recipe-product";
import { ensureAudioUnlocked, playAlertTone } from "../alertTone";
import { releaseWakeLock, retainWakeLock } from "../wakeLock";

export type CookingTimerState = "running" | "paused" | "completed";

export type CookingTimer = {
  id: string;
  /** Recipe the timer belongs to; absent for free-standing custom timers. */
  recipeSlug?: string;
  recipeTitle?: string;
  label: string;
  /** Zero-based method step the timer belongs to, when known. */
  stepIndex?: number;
  /** Snippet of the instruction text, for telling similar timers apart. */
  stepText?: string;
  durationSeconds: number;
  /** Epoch ms when the countdown hits zero; null unless running. */
  endTimeMs: number | null;
  /** Authoritative while paused; refreshed from endTimeMs while running. */
  remainingSeconds: number;
  state: CookingTimerState;
};

export type StartTimerInput = {
  id: string;
  recipeSlug?: string;
  recipeTitle?: string;
  label: string;
  stepIndex?: number;
  stepText?: string;
  durationSeconds: number;
};

/** A custom timer with no parsed-recipe origin; recipe context is optional. */
export type CustomTimerInput = Omit<StartTimerInput, "id">;

const STORAGE_KEY = "cooking-timers:v1";
const WAKE_LOCK_KEY = "cooking-timers";
const TICK_MS = 250;

const EMPTY_TIMERS: readonly CookingTimer[] = [];

let timers: readonly CookingTimer[] = EMPTY_TIMERS;
let hydrated = false;
const listeners = new Set<() => void>();
let tickHandle: ReturnType<typeof setInterval> | null = null;
let globalListenersHooked = false;

export function formatCountdown(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function remainingFrom(endTimeMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((endTimeMs - nowMs) / 1000));
}

function isStoredTimer(value: unknown): value is CookingTimer {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.id === "string" &&
    (t.recipeSlug === undefined || typeof t.recipeSlug === "string") &&
    (t.recipeTitle === undefined || typeof t.recipeTitle === "string") &&
    typeof t.label === "string" &&
    typeof t.durationSeconds === "number" &&
    typeof t.remainingSeconds === "number" &&
    (t.endTimeMs === null || typeof t.endTimeMs === "number") &&
    (t.stepIndex === undefined || typeof t.stepIndex === "number") &&
    (t.stepText === undefined || typeof t.stepText === "string") &&
    (t.state === "running" || t.state === "paused" || t.state === "completed")
  );
}

function loadStored(): readonly CookingTimer[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_TIMERS;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY_TIMERS;
    const now = Date.now();
    const restored = parsed.filter(isStoredTimer).map((t): CookingTimer => {
      if (t.state !== "running" || t.endTimeMs === null) return t;
      const remaining = remainingFrom(t.endTimeMs, now);
      return remaining > 0
        ? { ...t, remainingSeconds: remaining }
        : { ...t, state: "completed", remainingSeconds: 0, endTimeMs: null };
    });
    return restored.length > 0 ? restored : EMPTY_TIMERS;
  } catch {
    return EMPTY_TIMERS;
  }
}

function persist(): void {
  try {
    if (timers.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(timers));
    }
  } catch {
    // localStorage unavailable
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

function anyRunning(): boolean {
  return timers.some((t) => t.state === "running");
}

function syncSideEffects(): void {
  if (anyRunning()) {
    retainWakeLock(WAKE_LOCK_KEY);
    tickHandle ??= setInterval(tick, TICK_MS);
  } else {
    releaseWakeLock(WAKE_LOCK_KEY);
    if (tickHandle !== null) {
      clearInterval(tickHandle);
      tickHandle = null;
    }
  }
}

function commit(next: readonly CookingTimer[]): void {
  timers = next.length > 0 ? next : EMPTY_TIMERS;
  persist();
  syncSideEffects();
  emit();
}

function tick(): void {
  const now = Date.now();
  let changed = false;
  let completedAny = false;
  const next = timers.map((t): CookingTimer => {
    if (t.state !== "running" || t.endTimeMs === null) return t;
    const remaining = remainingFrom(t.endTimeMs, now);
    if (remaining <= 0) {
      changed = true;
      completedAny = true;
      return { ...t, state: "completed", remainingSeconds: 0, endTimeMs: null };
    }
    if (remaining !== t.remainingSeconds) {
      changed = true;
      return { ...t, remainingSeconds: remaining };
    }
    return t;
  });
  if (!changed) return;
  timers = next;
  if (completedAny) {
    persist();
    playAlertTone();
  }
  syncSideEffects();
  emit();
}

function hookGlobalListeners(): void {
  if (globalListenersHooked || globalThis.window === undefined) return;
  globalListenersHooked = true;
  // Cross-tab sync: another tab mutated the timers.
  globalThis.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    timers = loadStored();
    syncSideEffects();
    emit();
  });
  // Intervals are throttled in background tabs; catch up as soon as the tab
  // becomes visible again so the display (and any missed completion) is fresh.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && anyRunning()) {
      tick();
    }
  });
}

export function getTimersSnapshot(): readonly CookingTimer[] {
  if (!hydrated && globalThis.window !== undefined) {
    hydrated = true;
    timers = loadStored();
  }
  return timers;
}

export function getServerTimersSnapshot(): readonly CookingTimer[] {
  return EMPTY_TIMERS;
}

export function subscribeTimers(callback: () => void): () => void {
  listeners.add(callback);
  hookGlobalListeners();
  getTimersSnapshot();
  syncSideEffects();
  return () => {
    listeners.delete(callback);
    if (listeners.size === 0) {
      // No UI is watching: stop ticking and let the screen sleep. Running
      // timers stay correct because remaining time derives from endTimeMs.
      if (tickHandle !== null) {
        clearInterval(tickHandle);
        tickHandle = null;
      }
      releaseWakeLock(WAKE_LOCK_KEY);
    }
  };
}

export function startTimer(input: StartTimerInput): void {
  ensureAudioUnlocked();
  getTimersSnapshot();
  const timer: CookingTimer = {
    ...input,
    state: "running",
    remainingSeconds: input.durationSeconds,
    endTimeMs: Date.now() + input.durationSeconds * 1000,
  };
  commit([...timers.filter((t) => t.id !== input.id), timer]);
  captureRecipeProductActivity("timer_started", {
    recipe_slug: input.recipeSlug,
    timer_duration_seconds: input.durationSeconds,
    timer_kind: input.id.startsWith("custom:") ? "custom" : "recipe",
  });
}

let customTimerSeq = 0;

/** Start an ad-hoc timer under a freshly minted id, which is returned. */
export function startCustomTimer(input: CustomTimerInput): string {
  // Monotonic counter (not Math.random) so the fallback stays collision-free
  // for rapid taps within the same millisecond.
  customTimerSeq += 1;
  const unique =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${customTimerSeq}`;
  const id = `custom:${unique}`;
  startTimer({ ...input, id });
  return id;
}

export function pauseTimer(id: string): void {
  const now = Date.now();
  commit(
    timers.map((t) =>
      t.id === id && t.state === "running"
        ? {
            ...t,
            state: "paused",
            remainingSeconds:
              t.endTimeMs === null
                ? t.remainingSeconds
                : remainingFrom(t.endTimeMs, now),
            endTimeMs: null,
          }
        : t,
    ),
  );
}

export function resumeTimer(id: string): void {
  ensureAudioUnlocked();
  commit(
    timers.map((t) =>
      t.id === id && t.state === "paused"
        ? {
            ...t,
            state: "running",
            endTimeMs: Date.now() + t.remainingSeconds * 1000,
          }
        : t,
    ),
  );
}

export function extendTimer(id: string, seconds = 60): void {
  ensureAudioUnlocked();
  commit(
    timers.map((t): CookingTimer => {
      if (t.id !== id) return t;
      if (t.state === "running" && t.endTimeMs !== null) {
        return {
          ...t,
          endTimeMs: t.endTimeMs + seconds * 1000,
          remainingSeconds: t.remainingSeconds + seconds,
        };
      }
      if (t.state === "paused") {
        return { ...t, remainingSeconds: t.remainingSeconds + seconds };
      }
      // Completed: "+1 min" restarts the countdown for a top-up.
      return {
        ...t,
        state: "running",
        remainingSeconds: seconds,
        endTimeMs: Date.now() + seconds * 1000,
      };
    }),
  );
}

export function dismissTimer(id: string): void {
  commit(timers.filter((t) => t.id !== id));
}

/** Test-only: reset module state (optionally keeping localStorage). */
export function __resetTimerStoreForTests(): void {
  if (tickHandle !== null) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
  releaseWakeLock(WAKE_LOCK_KEY);
  timers = EMPTY_TIMERS;
  hydrated = false;
  // Deliberately NOT resetting globalListenersHooked: the storage /
  // visibilitychange listeners are attached to the persistent jsdom globals
  // and read live module state, so they keep working after a reset. Clearing
  // the flag would re-add a duplicate listener on the next subscribe.
  listeners.clear();
}
