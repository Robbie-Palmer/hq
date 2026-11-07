import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type CookingTimerState = "running" | "paused" | "completed";

export type CookingTimer = {
  id: string;
  recipeSlug?: string;
  recipeTitle?: string;
  label: string;
  stepIndex?: number;
  stepText?: string;
  durationSeconds: number;
  endTimeMs: number | null;
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

export type CustomTimerInput = Omit<StartTimerInput, "id">;

export type CookingTimersState = {
  timers: CookingTimer[];
};

const initialState: CookingTimersState = { timers: [] };

export function formatCountdown(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  const minuteText = String(minutes).padStart(hours > 0 ? 2 : 1, "0");
  const secondText = String(remainingSeconds).padStart(2, "0");
  return hours > 0
    ? `${hours}:${minuteText}:${secondText}`
    : `${minuteText}:${secondText}`;
}

export function remainingFrom(endTimeMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((endTimeMs - nowMs) / 1000));
}

export function isCookingTimer(value: unknown): value is CookingTimer {
  if (typeof value !== "object" || value === null) return false;
  const timer = value as Record<string, unknown>;
  return (
    typeof timer.id === "string" &&
    timer.id.length > 0 &&
    (timer.recipeSlug === undefined || typeof timer.recipeSlug === "string") &&
    (timer.recipeTitle === undefined ||
      typeof timer.recipeTitle === "string") &&
    typeof timer.label === "string" &&
    Number.isFinite(timer.durationSeconds) &&
    (timer.durationSeconds as number) > 0 &&
    Number.isFinite(timer.remainingSeconds) &&
    (timer.remainingSeconds as number) >= 0 &&
    (timer.endTimeMs === null || Number.isFinite(timer.endTimeMs)) &&
    (timer.stepIndex === undefined || Number.isFinite(timer.stepIndex)) &&
    (timer.stepText === undefined || typeof timer.stepText === "string") &&
    (timer.state === "running" ||
      timer.state === "paused" ||
      timer.state === "completed") &&
    (timer.state === "running"
      ? typeof timer.endTimeMs === "number" &&
        typeof timer.remainingSeconds === "number" &&
        timer.remainingSeconds > 0
      : timer.endTimeMs === null) &&
    (timer.state !== "completed" || timer.remainingSeconds === 0)
  );
}

function isValidStart(input: StartTimerInput, nowMs: number): boolean {
  return (
    input.id.length > 0 &&
    input.label.length > 0 &&
    Number.isFinite(input.durationSeconds) &&
    input.durationSeconds > 0 &&
    Number.isFinite(nowMs)
  );
}

export const cookingTimersSlice = createSlice({
  name: "cookingTimers",
  initialState,
  reducers: {
    timerStarted(
      state,
      { payload }: PayloadAction<{ input: StartTimerInput; nowMs: number }>,
    ) {
      if (!isValidStart(payload.input, payload.nowMs)) return;
      const timer: CookingTimer = {
        ...payload.input,
        state: "running",
        remainingSeconds: payload.input.durationSeconds,
        endTimeMs: payload.nowMs + payload.input.durationSeconds * 1000,
      };
      state.timers = [
        ...state.timers.filter((existing) => existing.id !== timer.id),
        timer,
      ];
    },
    timerPaused(
      state,
      { payload }: PayloadAction<{ id: string; nowMs: number }>,
    ) {
      if (!Number.isFinite(payload.nowMs)) return;
      const timer = state.timers.find(({ id }) => id === payload.id);
      if (!timer || timer.state !== "running" || timer.endTimeMs === null) {
        return;
      }
      timer.state = "paused";
      timer.remainingSeconds = remainingFrom(timer.endTimeMs, payload.nowMs);
      timer.endTimeMs = null;
    },
    timerResumed(
      state,
      { payload }: PayloadAction<{ id: string; nowMs: number }>,
    ) {
      if (!Number.isFinite(payload.nowMs)) return;
      const timer = state.timers.find(({ id }) => id === payload.id);
      if (!timer || timer.state !== "paused" || timer.remainingSeconds <= 0) {
        return;
      }
      timer.state = "running";
      timer.endTimeMs = payload.nowMs + timer.remainingSeconds * 1000;
    },
    timerExtended(
      state,
      {
        payload,
      }: PayloadAction<{ id: string; seconds: number; nowMs: number }>,
    ) {
      if (
        !Number.isFinite(payload.seconds) ||
        payload.seconds <= 0 ||
        !Number.isFinite(payload.nowMs)
      ) {
        return;
      }
      const timer = state.timers.find(({ id }) => id === payload.id);
      if (!timer) return;
      if (timer.state === "running" && timer.endTimeMs !== null) {
        timer.endTimeMs += payload.seconds * 1000;
        timer.remainingSeconds += payload.seconds;
        return;
      }
      if (timer.state === "paused") {
        timer.remainingSeconds += payload.seconds;
        return;
      }
      timer.state = "running";
      timer.remainingSeconds = payload.seconds;
      timer.endTimeMs = payload.nowMs + payload.seconds * 1000;
    },
    timerDismissed(state, { payload }: PayloadAction<{ id: string }>) {
      if (!state.timers.some(({ id }) => id === payload.id)) return;
      state.timers = state.timers.filter(({ id }) => id !== payload.id);
    },
    clockTicked(state, { payload }: PayloadAction<{ nowMs: number }>) {
      if (!Number.isFinite(payload.nowMs)) return;
      for (const timer of state.timers) {
        if (timer.state !== "running" || timer.endTimeMs === null) continue;
        const remainingSeconds = remainingFrom(timer.endTimeMs, payload.nowMs);
        timer.remainingSeconds = remainingSeconds;
        if (remainingSeconds === 0) {
          timer.state = "completed";
          timer.endTimeMs = null;
        }
      }
    },
    timerStateHydrated(
      state,
      { payload }: PayloadAction<{ timers: unknown[] }>,
    ) {
      const timers = payload.timers.filter(isCookingTimer);
      if (state.timers.length === 0 && timers.length === 0) return;
      state.timers = timers;
    },
    allTimersCleared(state) {
      if (state.timers.length === 0) return;
      state.timers = [];
    },
  },
});

export const cookingTimerEvents = cookingTimersSlice.actions;

export type CookingTimersRootState = {
  cookingTimers: CookingTimersState;
};

export function selectCookingTimers(
  state: CookingTimersRootState,
): readonly CookingTimer[] {
  return state.cookingTimers.timers;
}

export function selectCookingTimerById(
  state: CookingTimersRootState,
  id: string,
): CookingTimer | undefined {
  return state.cookingTimers.timers.find((timer) => timer.id === id);
}

export function selectAnyCookingTimerRunning(
  state: CookingTimersRootState,
): boolean {
  return state.cookingTimers.timers.some((timer) => timer.state === "running");
}
