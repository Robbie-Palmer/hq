import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecipeContent } from "@/components/recipes/recipe-content";
import { CookModeProvider } from "@/contexts/cook-mode-context";
import type { RecipeDetailView } from "@/lib/domain/recipe/recipeViews";
import { preferenceForSystem } from "@/lib/domain/recipe/unit";
import { getShoppingListSnapshot } from "@/lib/shopping/shoppingListStore";
import { __resetShoppingListForTests } from "@/tests/support/recipe-state";

const mocks = vi.hoisted(() => ({
  captureRecipeProductActivity: vi.fn(),
  captureRecipeValue: vi.fn(),
  setUnitPreference: vi.fn(),
  tokenizeInstructionSdk: vi.fn(),
  recordCookingSession: vi.fn().mockResolvedValue({}),
  recordCookingCompletionReliably: vi.fn().mockResolvedValue({}),
  authState: {
    data: { user: { id: "cook-1" } } as {
      user: { id: string };
    } | null,
    isPending: false,
  },
}));

const customPreference = {
  ...preferenceForSystem("uk"),
  preset: "custom" as const,
};

vi.mock("@/components/recipes/diet-provider", () => ({
  useDiet: () => ({
    diet: { active: false },
    matchRecipe: () => ({ matches: true, excludedIngredients: [] }),
  }),
}));

vi.mock("@/hooks/use-scaled-recipe", () => ({
  useScaledRecipe: (recipe: RecipeDetailView) => ({
    view: recipe,
    scaleMultiplier: 1,
    isScaling: false,
    error: null,
  }),
}));

vi.mock("@/hooks/use-unit-preference", () => ({
  useUnitPreference: () => [customPreference, mocks.setUnitPreference],
}));

vi.mock("@/lib/domain/recipe/instructionTokens", () => ({
  tokenizeInstructionSdk: mocks.tokenizeInstructionSdk,
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => mocks.authState,
  },
}));

vi.mock("@/lib/api/cooking-insights", () => ({
  recordCookingCompletionReliably: mocks.recordCookingCompletionReliably,
  recordCookingSession: mocks.recordCookingSession,
}));

vi.mock("@/lib/analytics/recipe-product", () => ({
  captureRecipeProductActivity: mocks.captureRecipeProductActivity,
  captureRecipeValue: mocks.captureRecipeValue,
}));

const recipe: RecipeDetailView = {
  slug: "weeknight",
  title: "Weeknight pasta",
  description: "A quick test recipe.",
  date: "2026-07-14",
  cuisine: [],
  tags: [],
  servings: 2,
  cookBody: "Cook for ~{10%minutes}.",
  cookware: [],
  ingredientGroups: [],
  instructions: ["Cook for 10 minutes."],
  instructionSdk: {} as NonNullable<RecipeDetailView["instructionSdk"]>,
};

describe("RecipeContent", () => {
  beforeEach(() => {
    __resetShoppingListForTests();
    localStorage.clear();
    mocks.captureRecipeProductActivity.mockClear();
    mocks.captureRecipeValue.mockClear();
    mocks.setUnitPreference.mockClear();
    mocks.recordCookingSession.mockReset().mockResolvedValue({});
    mocks.recordCookingCompletionReliably.mockReset().mockResolvedValue({});
    mocks.authState.data = { user: { id: "cook-1" } };
    mocks.authState.isPending = false;
    window.history.replaceState(null, "", "/recipes/saved?slug=weeknight");
    mocks.tokenizeInstructionSdk.mockReturnValue({
      ok: true,
      steps: [
        [
          { type: "text", value: "Cook for " },
          { type: "timer", value: "10 minutes", durationSeconds: 600 },
          { type: "text", value: "." },
        ],
      ],
    });
  });

  it("previews a preset without overwriting the saved custom ladder", async () => {
    const user = userEvent.setup();
    render(<RecipeContent recipe={recipe} />);

    expect(screen.getByRole("button", { name: "Custom" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Metric" }));

    expect(screen.getByRole("button", { name: "Metric" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(mocks.setUnitPreference).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Custom" }));
    expect(screen.getByRole("button", { name: "Custom" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("renders timers as disabled in an unsaved recipe preview", () => {
    render(
      <RecipeContent
        recipe={recipe}
        timersEnabled={false}
        shoppingListEnabled={false}
      />,
    );

    expect(screen.getByRole("button", { name: "10 minutes" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Add to shopping list" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /start 10 minutes timer/i }),
    ).not.toBeInTheDocument();
  });

  it("adds and removes the recipe from the shopping list", async () => {
    const user = userEvent.setup();
    render(<RecipeContent recipe={recipe} />);

    await user.click(
      screen.getByRole("button", { name: "Add to shopping list" }),
    );

    expect(getShoppingListSnapshot().recipes).toEqual([{ slug: "weeknight" }]);
    expect(
      screen.getByRole("button", { name: "On shopping list" }),
    ).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "On shopping list" }));

    expect(getShoppingListSnapshot().recipes).toEqual([]);
  });

  it("retains native list markers for Safari accessibility", () => {
    const { container } = render(<RecipeContent recipe={recipe} />);

    const method = container.querySelector(".rt-method-steps");
    expect(method).toHaveClass("list-decimal", "marker:text-transparent");
    expect(method).not.toHaveClass("list-none");
  });

  it("tracks a cook-mode start but only counts the meal when Finish is clicked", async () => {
    const user = userEvent.setup();
    render(
      <CookModeProvider>
        <RecipeContent recipe={recipe} />
      </CookModeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Start cooking" }));
    expect(mocks.captureRecipeValue).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(mocks.recordCookingSession).toHaveBeenCalledWith(
        expect.objectContaining({
          recipeSlug: "weeknight",
          servings: 2,
          event: "started",
        }),
      ),
    );

    const started = mocks.recordCookingSession.mock.calls[0]?.[0];
    await user.click(screen.getByRole("button", { name: "Finish ✓" }));

    expect(mocks.recordCookingCompletionReliably).toHaveBeenCalledWith(
      "cook-1",
      expect.objectContaining({
        sessionId: started.sessionId,
        event: "completed",
      }),
    );
    expect(mocks.captureRecipeValue).toHaveBeenCalledWith("recipe_cooked", {
      recipe_slug: "weeknight",
      serving_count: 2,
      step_count: 1,
    });
  });

  it("keeps cooking usable when activity tracking fails", async () => {
    const user = userEvent.setup();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.recordCookingSession.mockRejectedValue(new Error("offline"));
    mocks.recordCookingCompletionReliably.mockRejectedValue(
      new Error("offline"),
    );
    render(
      <CookModeProvider>
        <RecipeContent recipe={recipe} />
      </CookModeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Start cooking" }));
    await waitFor(() => expect(consoleError).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Finish ✓" }));
    await waitFor(() => expect(consoleError).toHaveBeenCalledTimes(2));
  });

  it("preserves tracking while the browser session is hydrating", async () => {
    const user = userEvent.setup();
    mocks.authState.data = null;
    mocks.authState.isPending = true;
    render(
      <CookModeProvider>
        <RecipeContent recipe={recipe} />
      </CookModeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Start cooking" }));
    await waitFor(() =>
      expect(mocks.recordCookingSession).toHaveBeenCalledWith(
        expect.objectContaining({ event: "started" }),
      ),
    );

    const started = mocks.recordCookingSession.mock.calls[0]?.[0];
    await user.click(screen.getByRole("button", { name: "Finish ✓" }));

    expect(mocks.recordCookingSession).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sessionId: started.sessionId,
        event: "completed",
      }),
    );
  });
});
