import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dismissTimer,
  extendTimer,
  formatCountdown,
  getTimersSnapshot,
  pauseTimer,
  resumeTimer,
  startCustomTimer,
  startTimer,
  subscribeTimers,
} from "@/lib/cooking/timerStore";
import { __resetTimerStoreForTests } from "@/tests/support/recipe-state";

function firstTimer() {
  const timer = getTimersSnapshot()[0];
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

describe("timerStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    __resetTimerStoreForTests();
  });

  afterEach(() => {
    __resetTimerStoreForTests();
    vi.useRealTimers();
  });

  it("starts a running timer with the full duration", () => {
    startTimer(INPUT);
    const timers = getTimersSnapshot();
    expect(timers).toHaveLength(1);
    expect(timers[0]).toMatchObject({
      id: INPUT.id,
      state: "running",
      remainingSeconds: 600,
    });
    expect(firstTimer().endTimeMs).toBe(Date.now() + 600_000);
  });

  it("counts down while running and completes at zero", () => {
    startTimer(INPUT);
    vi.advanceTimersByTime(90_000);
    expect(firstTimer().remainingSeconds).toBe(510);

    vi.advanceTimersByTime(510_000);
    expect(firstTimer()).toMatchObject({
      state: "completed",
      remainingSeconds: 0,
      endTimeMs: null,
    });
  });

  it("pauses (freezing remaining time) and resumes", () => {
    startTimer(INPUT);
    vi.advanceTimersByTime(100_000);
    pauseTimer(INPUT.id);
    expect(firstTimer()).toMatchObject({
      state: "paused",
      remainingSeconds: 500,
      endTimeMs: null,
    });

    // Time passing while paused changes nothing.
    vi.advanceTimersByTime(60_000);
    expect(firstTimer().remainingSeconds).toBe(500);

    resumeTimer(INPUT.id);
    vi.advanceTimersByTime(10_000);
    expect(firstTimer()).toMatchObject({
      state: "running",
      remainingSeconds: 490,
    });
  });

  it("extends a running timer and restarts a completed one", () => {
    startTimer({ ...INPUT, durationSeconds: 60 });
    extendTimer(INPUT.id, 60);
    expect(firstTimer().remainingSeconds).toBe(120);

    vi.advanceTimersByTime(120_000);
    expect(firstTimer().state).toBe("completed");

    extendTimer(INPUT.id, 60);
    expect(firstTimer()).toMatchObject({
      state: "running",
      remainingSeconds: 60,
    });
  });

  it("dismisses timers", () => {
    startTimer(INPUT);
    dismissTimer(INPUT.id);
    expect(getTimersSnapshot()).toHaveLength(0);
    expect(localStorage.getItem("cooking-timers:v1")).toBeNull();
  });

  it("restarting an existing id replaces the timer", () => {
    startTimer(INPUT);
    vi.advanceTimersByTime(200_000);
    startTimer(INPUT);
    const timers = getTimersSnapshot();
    expect(timers).toHaveLength(1);
    expect(firstTimer().remainingSeconds).toBe(600);
  });

  it("persists running timers as end timestamps and restores them after a reload", () => {
    startTimer(INPUT);
    vi.advanceTimersByTime(60_000);

    // Simulate a reload: module state resets, localStorage survives, and the
    // user comes back 120s later.
    __resetTimerStoreForTests();
    vi.advanceTimersByTime(120_000);

    const timers = getTimersSnapshot();
    expect(timers).toHaveLength(1);
    expect(timers[0]).toMatchObject({
      state: "running",
      remainingSeconds: 600 - 180,
    });
  });

  it("restores a timer that expired while away as completed", () => {
    startTimer({ ...INPUT, durationSeconds: 60 });

    __resetTimerStoreForTests();
    vi.advanceTimersByTime(120_000);

    expect(firstTimer()).toMatchObject({
      state: "completed",
      remainingSeconds: 0,
      endTimeMs: null,
    });
  });

  it("ignores malformed stored data", () => {
    localStorage.setItem("cooking-timers:v1", '{"not":"an array"}');
    expect(getTimersSnapshot()).toHaveLength(0);

    __resetTimerStoreForTests();
    localStorage.setItem("cooking-timers:v1", '[{"id":42}]');
    expect(getTimersSnapshot()).toHaveLength(0);
  });

  it("notifies subscribers on mutations and each ticking second", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTimers(listener);

    startTimer(INPUT);
    expect(listener).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(3_000);
    // One notification per elapsed second (ticks that change nothing are silent).
    expect(listener).toHaveBeenCalledTimes(4);

    unsubscribe();
  });

  it("starts a custom timer with a minted id and no recipe context", () => {
    const id = startCustomTimer({ label: "Pasta", durationSeconds: 300 });
    expect(id).toMatch(/^custom:/);
    const timer = firstTimer();
    expect(timer).toMatchObject({
      id,
      label: "Pasta",
      state: "running",
      remainingSeconds: 300,
    });
    expect(timer.recipeSlug).toBeUndefined();
    expect(timer.recipeTitle).toBeUndefined();
  });

  it("mints a distinct id for each custom timer so they stack", () => {
    const first = startCustomTimer({ label: "One", durationSeconds: 60 });
    const second = startCustomTimer({ label: "Two", durationSeconds: 120 });
    expect(first).not.toBe(second);
    expect(getTimersSnapshot()).toHaveLength(2);
  });

  it("persists and restores custom timers with no recipe fields", () => {
    startCustomTimer({ label: "Rice", durationSeconds: 600 });
    vi.advanceTimersByTime(60_000);

    __resetTimerStoreForTests();
    const timers = getTimersSnapshot();
    expect(timers).toHaveLength(1);
    expect(timers[0]).toMatchObject({
      label: "Rice",
      state: "running",
      remainingSeconds: 540,
    });
    expect(timers[0]?.recipeSlug).toBeUndefined();
  });

  it("formats countdowns", () => {
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(59)).toBe("0:59");
    expect(formatCountdown(600)).toBe("10:00");
    expect(formatCountdown(3661)).toBe("1:01:01");
  });
});
