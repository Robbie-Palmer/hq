import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CookMode, type CookStep } from "@/components/recipes/cook-mode";
import { CookModeProvider, useCookMode } from "@/contexts/cook-mode-context";
import { useCookingTimer } from "@/hooks/use-cooking-timers";
import { startTimer } from "@/lib/cooking/timerStore";
import { preferenceForSystem } from "@/lib/domain/recipe/unit";

vi.mock("@/hooks/use-cooking-timers", () => ({
  useCookingTimer: vi.fn(),
  useCookingTimers: vi.fn(() => []),
}));

vi.mock("@/lib/cooking/timerStore", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/cooking/timerStore")>();
  return { ...original, startTimer: vi.fn() };
});

const mockUseCookingTimer = vi.mocked(useCookingTimer);

const steps: CookStep[] = [
  {
    key: "0:boil",
    tokens: [
      { type: "text", value: "Boil for " },
      {
        type: "timer",
        value: "10 min",
        durationSeconds: 600,
        timerId: "pasta:s0:t1",
      },
    ],
    text: "Boil for 10 min",
  },
];

const navigationSteps: CookStep[] = [
  { key: "0:prepare", tokens: null, text: "Prepare the ingredients" },
  { key: "1:cook", tokens: null, text: "Cook until tender" },
];

function renderCookMode(onComplete = vi.fn()) {
  return render(
    <CookModeProvider>
      <CookMode
        recipeSlug="pasta"
        recipeTitle="Pasta"
        servings={2}
        steps={steps}
        ingredientGroups={[]}
        annotations={new Map()}
        scale={1}
        system={preferenceForSystem("metric")}
        step={0}
        onStepChange={() => {}}
        onExit={() => {}}
        onComplete={onComplete}
      />
      <ActiveStepProbe />
    </CookModeProvider>,
    { container: document.body },
  );
}

function renderNavigableCookMode({
  onExit = vi.fn(),
  onStepChange = vi.fn(),
}: {
  onExit?: () => void;
  onStepChange?: (step: number) => void;
} = {}) {
  return render(
    <CookModeProvider>
      <CookMode
        recipeSlug="vegetables"
        recipeTitle="Vegetables"
        servings={2}
        steps={navigationSteps}
        ingredientGroups={[]}
        annotations={new Map()}
        scale={1}
        system={preferenceForSystem("metric")}
        step={0}
        onStepChange={onStepChange}
        onExit={onExit}
        onComplete={vi.fn()}
      />
    </CookModeProvider>,
    { container: document.body },
  );
}

function ActiveStepProbe() {
  const { activeStep } = useCookMode();
  return (
    <output data-testid="active-step">{JSON.stringify(activeStep)}</output>
  );
}

describe("CookMode timer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCookingTimer.mockReturnValue(undefined);
  });

  it("starts the timer when the countdown circle itself is tapped", async () => {
    const user = userEvent.setup();
    renderCookMode();

    await user.click(
      screen.getByRole("button", { name: "Start 10 min timer" }),
    );

    expect(startTimer).toHaveBeenCalledWith({
      id: "pasta:s0:t1",
      recipeSlug: "pasta",
      recipeTitle: "Pasta",
      label: "10 min",
      stepIndex: 0,
      stepText: "Boil for 10 min",
      durationSeconds: 600,
    });
  });

  it("publishes the current step for dock timers", () => {
    renderCookMode();

    expect(screen.getByTestId("active-step")).toHaveTextContent(
      JSON.stringify({
        recipeSlug: "pasta",
        recipeTitle: "Pasta",
        stepIndex: 0,
        stepText: "Boil for 10 min",
      }),
    );
  });

  it("dims the idle full duration so it does not read as a live countdown", () => {
    renderCookMode();

    const idleDuration = screen.getByText("10:00");
    expect(idleDuration).toHaveClass("opacity-60");
  });

  it("shows a live countdown at full opacity once running", () => {
    mockUseCookingTimer.mockReturnValue({
      id: "pasta:s0:t1",
      label: "10 min",
      durationSeconds: 600,
      remainingSeconds: 600,
      endTimeMs: Date.now() + 600_000,
      state: "running",
    });
    renderCookMode();

    const liveCountdown = screen.getByText("10:00");
    expect(liveCountdown).not.toHaveClass("opacity-60");
    expect(screen.getByRole("button", { name: /pause/i })).toBeInTheDocument();
  });

  it("finishes without collecting optional meal details", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    renderCookMode(onComplete);

    await user.click(screen.getByRole("button", { name: "Finish ✓" }));

    expect(onComplete).toHaveBeenCalledWith(null);
    expect(
      screen.queryByRole("dialog", { name: /save leftovers/i }),
    ).toBeNull();
  });

  it("opens leftover tracking only when the cook asks for it", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    renderCookMode(onComplete);

    await user.click(screen.getByRole("button", { name: "Track leftovers" }));

    expect(
      screen.getByRole("dialog", { name: "Save leftovers from Pasta" }),
    ).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe("CookMode navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCookingTimer.mockReturnValue(undefined);
  });

  it("moves between steps with arrow keys and horizontal swipes", async () => {
    const user = userEvent.setup();
    const onStepChange = vi.fn();
    renderNavigableCookMode({ onStepChange });

    await user.keyboard("{ArrowRight}");
    expect(onStepChange).toHaveBeenLastCalledWith(1);

    await user.keyboard("{ArrowLeft}");
    expect(onStepChange).toHaveBeenLastCalledWith(0);

    const main = screen.getByText("Prepare the ingredients").closest("main");
    if (!main) throw new Error("Cook mode main content was not rendered.");
    fireEvent.touchStart(main, {
      touches: [{ clientX: 200, clientY: 20 }],
    });
    fireEvent.touchEnd(main, {
      changedTouches: [{ clientX: 100, clientY: 24 }],
    });

    expect(onStepChange).toHaveBeenLastCalledWith(1);
  });

  it("closes the ingredient sheet before Escape exits cook mode", async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    renderNavigableCookMode({ onExit });

    await user.click(screen.getByRole("button", { name: "Show ingredients" }));
    expect(
      screen.getAllByRole("button", { name: "Close ingredients" }),
    ).not.toHaveLength(0);

    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("button", { name: "Close ingredients" }),
    ).toBeNull();
    expect(onExit).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(onExit).toHaveBeenCalledOnce();
  });

  it("wraps focus from the last control to the first control", async () => {
    const user = userEvent.setup();
    renderNavigableCookMode();
    const dialog = screen.getByRole("dialog", {
      name: "Cook mode: Vegetables",
    });
    const buttons = dialog.querySelectorAll<HTMLButtonElement>(
      "button:not([disabled])",
    );
    buttons[buttons.length - 1]?.focus();

    await user.tab();

    expect(
      screen.getByRole("button", { name: "Exit cook mode" }),
    ).toHaveFocus();
  });
});
