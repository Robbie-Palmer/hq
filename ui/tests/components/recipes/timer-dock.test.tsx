import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimerDock } from "@/components/recipes/timer-dock";
import { CookModeProvider, useCookMode } from "@/contexts/cook-mode-context";
import { getTimersSnapshot, startTimer } from "@/lib/cooking/timerStore";
import { __resetTimerStoreForTests } from "@/tests/support/recipe-state";

function OpenCookModeButton() {
  const { setCookModeOpen } = useCookMode();
  return (
    <button type="button" onClick={() => setCookModeOpen(true)}>
      Open cook mode
    </button>
  );
}

function EnterStepButton() {
  const { setCookModeOpen, setActiveStep } = useCookMode();
  return (
    <button
      type="button"
      onClick={() => {
        setCookModeOpen(true);
        setActiveStep({
          recipeSlug: "pasta",
          recipeTitle: "Pasta",
          stepIndex: 4,
          stepText: "Boil the pasta",
        });
      }}
    >
      Enter step
    </button>
  );
}

describe("TimerDock", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetTimerStoreForTests();
  });

  afterEach(() => {
    __resetTimerStoreForTests();
    vi.useRealTimers();
  });

  it("announces a timer that was already complete when the dock mounts", () => {
    vi.useFakeTimers();
    startTimer({
      id: "restored-timer",
      label: "restored timer",
      durationSeconds: 1,
    });
    vi.advanceTimersByTime(1_000);

    render(
      <CookModeProvider>
        <TimerDock />
      </CookModeProvider>,
    );

    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Time's up for restored timer.",
    );
  });

  it("turns a completed timer into a persistent, accessible alert", () => {
    vi.useFakeTimers();
    startTimer({
      id: "roast-timer",
      recipeSlug: "roast-vegetables",
      recipeTitle: "Roast vegetables",
      label: "roast vegetables",
      stepIndex: 1,
      stepText: "Roast until golden",
      durationSeconds: 1,
    });

    render(
      <CookModeProvider>
        <TimerDock />
      </CookModeProvider>,
    );

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Time's up for roast vegetables.",
    );

    const expandButton = screen.getByRole("button", {
      name: "Time's up for roast vegetables. Expand cooking timers (1)",
    });
    expect(expandButton).toHaveTextContent("time's up!");
    expect(expandButton.parentElement).toHaveClass("bg-[var(--berry)]");
    const firstAttentionCue = expandButton.closest(".rt-timer-attention");
    expect(firstAttentionCue).not.toBeNull();
    expect(firstAttentionCue).not.toHaveClass("animate-pulse");

    fireEvent.click(expandButton);
    expect(document.querySelector(".rt-timer-attention")).toBe(
      firstAttentionCue,
    );

    act(() => {
      startTimer({
        id: "sauce-timer",
        label: "sauce",
        durationSeconds: 1,
      });
    });
    act(() => {
      vi.advanceTimersByTime(1_250);
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    // The attention cue replays in place rather than remounting the dock, so
    // the same node keeps carrying the persistent completion state.
    expect(document.querySelector(".rt-timer-attention")).toBe(
      firstAttentionCue,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "2 cooking timers are complete.",
    );
  });

  it("keeps the add-timer popover and its typed values while another timer completes", () => {
    vi.useFakeTimers();
    startTimer({
      id: "roast-timer",
      label: "roast",
      durationSeconds: 3,
    });

    render(
      <CookModeProvider>
        <TimerDock />
      </CookModeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add a custom timer" }));

    const labelInput = screen.getByPlaceholderText("e.g. pasta");
    fireEvent.change(labelInput, { target: { value: "pasta" } });
    expect(labelInput).toHaveValue("pasta");

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Time's up for roast.");
    // The completion must not tear down the open popover or discard the label.
    expect(screen.getByPlaceholderText("e.g. pasta")).toHaveValue("pasta");
  });

  it("binds a dock-started timer to the step cook mode is showing", () => {
    render(
      <CookModeProvider>
        <EnterStepButton />
        <TimerDock />
      </CookModeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Enter step" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a custom timer" }));
    fireEvent.click(screen.getByRole("button", { name: "Start timer" }));

    expect(getTimersSnapshot()).toEqual([
      expect.objectContaining({
        recipeSlug: "pasta",
        recipeTitle: "Pasta",
        stepIndex: 4,
        stepText: "Boil the pasta",
      }),
    ]);
  });

  it("binds a collapsed-dock timer to the current step", () => {
    startTimer({
      id: "existing-timer",
      label: "existing",
      durationSeconds: 600,
    });
    render(
      <CookModeProvider>
        <EnterStepButton />
        <TimerDock />
      </CookModeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Enter step" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a custom timer" }));
    fireEvent.click(screen.getByRole("button", { name: "Start timer" }));

    expect(getTimersSnapshot()).toContainEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^custom:/),
        recipeSlug: "pasta",
        recipeTitle: "Pasta",
        stepIndex: 4,
        stepText: "Boil the pasta",
      }),
    );
  });

  it("resets a dragged position after the last timer is dismissed", () => {
    localStorage.setItem(
      "cooking-timer-dock-pos:v1",
      JSON.stringify({ right: 72, bottom: 180 }),
    );
    startTimer({
      id: "pasta-timer",
      label: "pasta",
      durationSeconds: 600,
    });

    render(
      <CookModeProvider>
        <OpenCookModeButton />
        <TimerDock />
      </CookModeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open cook mode" }));
    expect(screen.getByRole("region", { name: "Cooking timers" })).toHaveStyle({
      right: "72px",
      bottom: "180px",
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Expand cooking timers (1)" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss pasta timer" }),
    );

    expect(localStorage.getItem("cooking-timer-dock-pos:v1")).toBeNull();

    const idleDock = screen.getByRole("region", { name: "Cooking timers" });
    expect(idleDock.style.right).toBe("");
    expect(idleDock.style.bottom).toBe("116px");
  });
});
