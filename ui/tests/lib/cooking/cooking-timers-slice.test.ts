import type { UnknownAction } from "@reduxjs/toolkit";
import { describe, expect, it, vi } from "vitest";
import {
  cookingTimerEvents,
  cookingTimersSlice,
  selectAnyCookingTimerRunning,
  selectCookingTimerById,
  selectCookingTimers,
} from "@/lib/cooking/cookingTimersSlice";
import { dispatchRequiredCookingTimerEvent } from "@/lib/cooking/recipeClientStore";
import { createTestRecipeClientStore } from "@/tests/support/recipe-client-state";

const INPUT = {
  id: "bread:proof",
  label: "Proof bread",
  durationSeconds: 60,
};

describe("cookingTimersSlice", () => {
  it("reduces a replayable event sequence without reading the clock", () => {
    const started = cookingTimersSlice.reducer(
      undefined,
      cookingTimerEvents.timerStarted({ input: INPUT, nowMs: 1_000 }),
    );
    const paused = cookingTimersSlice.reducer(
      started,
      cookingTimerEvents.timerPaused({ id: INPUT.id, nowMs: 11_000 }),
    );
    const resumed = cookingTimersSlice.reducer(
      paused,
      cookingTimerEvents.timerResumed({ id: INPUT.id, nowMs: 20_000 }),
    );
    const completed = cookingTimersSlice.reducer(
      resumed,
      cookingTimerEvents.clockTicked({ nowMs: 70_000 }),
    );

    expect(completed.timers[0]).toEqual({
      ...INPUT,
      state: "completed",
      remainingSeconds: 0,
      endTimeMs: null,
    });
  });

  it("rejects events that violate timer invariants", () => {
    const initial = cookingTimersSlice.getInitialState();
    const invalidStart = cookingTimersSlice.reducer(
      initial,
      cookingTimerEvents.timerStarted({
        input: { ...INPUT, durationSeconds: 0 },
        nowMs: 1_000,
      }),
    );
    expect(invalidStart).toBe(initial);

    const started = cookingTimersSlice.reducer(
      initial,
      cookingTimerEvents.timerStarted({ input: INPUT, nowMs: 1_000 }),
    );
    const invalidExtension = cookingTimersSlice.reducer(
      started,
      cookingTimerEvents.timerExtended({
        id: INPUT.id,
        seconds: -1,
        nowMs: 2_000,
      }),
    );
    expect(invalidExtension).toBe(started);
  });

  it("rejects a transition that is invalid for the current state", () => {
    const started = cookingTimersSlice.reducer(
      undefined,
      cookingTimerEvents.timerStarted({ input: INPUT, nowMs: 1_000 }),
    );
    const resumedWhileRunning = cookingTimersSlice.reducer(
      started,
      cookingTimerEvents.timerResumed({ id: INPUT.id, nowMs: 2_000 }),
    );
    expect(resumedWhileRunning).toBe(started);
  });

  it("selects the collection, one timer, and the running invariant", () => {
    const cookingTimers = cookingTimersSlice.reducer(
      undefined,
      cookingTimerEvents.timerStarted({ input: INPUT, nowMs: 1_000 }),
    );
    const state = { cookingTimers };
    expect(selectCookingTimers(state)).toBe(cookingTimers.timers);
    expect(selectCookingTimerById(state, INPUT.id)).toBe(
      cookingTimers.timers[0],
    );
    expect(selectCookingTimerById(state, "missing")).toBeUndefined();
    expect(selectAnyCookingTimerRunning(state)).toBe(true);
  });

  it("prints the full replayable sequence when a required transition fails", () => {
    const bundle = createTestRecipeClientStore();
    bundle.commands.start(INPUT);
    let failure: Error | undefined;

    try {
      dispatchRequiredCookingTimerEvent(
        bundle,
        cookingTimerEvents.timerResumed({ id: INPUT.id, nowMs: 2_000 }),
        (state) => state.cookingTimers.timers[0]?.state === "paused",
      );
    } catch (cause) {
      if (cause instanceof Error) failure = cause;
    }

    expect(failure?.message).toMatch(
      /Replayable action sequence:[\s\S]*cookingTimers\/timerStarted[\s\S]*cookingTimers\/timerResumed/,
    );
    const json = failure?.message.split("Replayable action sequence:\n")[1];
    if (!json) throw new Error("expected a replayable JSON action sequence");
    const replay = JSON.parse(json) as UnknownAction[];
    const replayed = createTestRecipeClientStore();
    for (const action of replay) replayed.store.dispatch(action);
    expect(replayed.store.getState().cookingTimers).toEqual(
      bundle.store.getState().cookingTimers,
    );
  });

  it("keeps a bounded replay log by compacting to serializable state events", () => {
    const bundle = createTestRecipeClientStore();
    for (let index = 0; index < 501; index += 1) {
      bundle.store.dispatch(
        cookingTimerEvents.timerResumed({ id: "missing", nowMs: index }),
      );
    }

    const actionLog = bundle.actionLog.read();
    expect(actionLog).toHaveLength(3);
    expect(actionLog.map(({ type }) => type)).toEqual([
      "recipeSession/ownerChanged",
      "cookingTimers/timerStateHydrated",
      "cookingTimers/timerResumed",
    ]);
    expect(() => JSON.stringify(actionLog)).not.toThrow();
  });

  it("keeps Redux Toolkit mutation and serializability checks enabled", () => {
    const bundle = createTestRecipeClientStore();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    bundle.store.dispatch({
      type: "test/nonSerializableValue",
      payload: new Date(0),
    });

    expect(consoleError.mock.calls[0]?.[0]).toEqual(
      expect.stringContaining("non-serializable value"),
    );
    expect(Object.isFrozen(bundle.store.getState().cookingTimers)).toBe(true);
    expect(Object.isFrozen(bundle.store.getState().cookingTimers.timers)).toBe(
      true,
    );
    consoleError.mockRestore();
  });
});
