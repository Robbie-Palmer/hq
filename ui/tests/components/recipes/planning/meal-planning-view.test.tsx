import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MealPlanningView } from "@/components/recipes/planning/meal-planning-view";
import type { ShoppingRecipe } from "@/lib/api/shopping";
import { addDays } from "@/lib/domain/meal-plan";
import {
  getShoppingListSnapshot,
  installShoppingListSnapshot,
} from "@/lib/shopping/shoppingListStore";
import { __resetShoppingListForTests } from "@/tests/support/recipe-state";

const mocks = vi.hoisted(() => ({ captureRecipeEvent: vi.fn() }));

vi.mock("@/components/recipes/shopping/shopping-list-boundary", () => ({
  ShoppingListBoundary: ({ children }: { children: React.ReactNode }) =>
    children,
}));

vi.mock("@/lib/analytics/recipe-product", () => ({
  captureRecipeEvent: mocks.captureRecipeEvent,
}));

const recipes: ShoppingRecipe[] = [
  {
    slug: "risotto",
    title: "Mushroom risotto",
    servings: 2,
    cuisine: ["Italian"],
    ingredients: [],
  },
  {
    slug: "soup",
    title: "Tomato soup",
    servings: 4,
    cuisine: [],
    ingredients: [],
  },
];

function localDate(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

describe("MealPlanningView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    __resetShoppingListForTests();
    installShoppingListSnapshot({
      recipes: [],
      checked: [],
      extras: [],
      plan: [],
    });
    window.history.replaceState({}, "", "/recipes/planning");
  });

  it("commits one meal without requiring a full week", async () => {
    const user = userEvent.setup();
    render(<MealPlanningView recipes={recipes} />);

    expect(
      screen.getByText(
        "No meals are scheduled. Plan one meal when you know what is next.",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Plan one meal" }));
    await user.selectOptions(screen.getByLabelText("Recipe"), "risotto");
    await user.clear(screen.getByLabelText("Day"));
    await user.type(screen.getByLabelText("Day"), "2026-10-19");
    await user.click(screen.getByRole("button", { name: "Save meal" }));

    expect(screen.getByText("Mushroom risotto")).toBeInTheDocument();
    expect(getShoppingListSnapshot().plan).toEqual([
      expect.objectContaining({
        status: "committed",
        recipeSlug: "risotto",
        date: "2026-10-19",
        mealType: "dinner",
      }),
    ]);
    expect(mocks.captureRecipeEvent).toHaveBeenCalledWith(
      "meal_plan_meal_committed",
      expect.objectContaining({ first_committed_meal: true }),
    );
  });

  it("keeps candidates out of shopping until they are committed", async () => {
    const user = userEvent.setup();
    render(<MealPlanningView recipes={recipes} />);

    await user.click(screen.getByRole("button", { name: "Plan one meal" }));
    await user.selectOptions(screen.getByLabelText("Commitment"), "candidate");
    await user.selectOptions(screen.getByLabelText("Recipe"), "soup");
    await user.click(screen.getByRole("button", { name: "Save idea" }));

    expect(
      screen.getByRole("heading", { name: "Meal ideas." }),
    ).toBeInTheDocument();
    expect(screen.getByText("Tomato soup")).toBeInTheDocument();
    expect(getShoppingListSnapshot().recipes).toEqual([]);
    expect(
      screen.queryByRole("button", { name: "Add to shopping list" }),
    ).not.toBeInTheDocument();
    expect(mocks.captureRecipeEvent).toHaveBeenCalledWith(
      "meal_plan_meal_queued",
      expect.objectContaining({ first_queued_meal: true }),
    );

    await user.click(
      screen.getByRole("button", { name: "Schedule Tomato soup" }),
    );
    await user.click(screen.getByRole("button", { name: "Save meal" }));
    await user.click(
      screen.getByRole("button", { name: "Add to shopping list" }),
    );

    expect(getShoppingListSnapshot().recipes).toEqual([
      { slug: "soup", servings: 2 },
    ]);
    expect(mocks.captureRecipeEvent).toHaveBeenCalledWith(
      "meal_plan_queue_converted",
      expect.objectContaining({ first_committed_meal: true }),
    );
  });

  it("records a candidate edit as queued rather than converted", async () => {
    const user = userEvent.setup();
    installShoppingListSnapshot({
      recipes: [],
      checked: [],
      extras: [],
      plan: [
        {
          id: "candidate",
          kind: "recipe",
          status: "candidate",
          recipeSlug: "soup",
        },
      ],
    });
    render(<MealPlanningView recipes={recipes} />);

    await user.click(screen.getByRole("button", { name: "Edit Tomato soup" }));
    await user.type(screen.getByLabelText(/Note/), "Make it spicy");
    await user.click(screen.getByRole("button", { name: "Save idea" }));

    expect(mocks.captureRecipeEvent).toHaveBeenCalledWith(
      "meal_plan_meal_queued",
      expect.objectContaining({ first_queued_meal: false }),
    );
    expect(mocks.captureRecipeEvent).not.toHaveBeenCalledWith(
      "meal_plan_queue_converted",
      expect.anything(),
    );
  });

  it("does not mark a new commitment as first when an older one exists", async () => {
    const user = userEvent.setup();
    installShoppingListSnapshot({
      recipes: [],
      checked: [],
      extras: [],
      plan: [
        {
          id: "past-meal-out",
          kind: "eating_out",
          status: "committed",
          date: addDays(localDate(), -1),
          mealType: "dinner",
        },
      ],
    });
    render(<MealPlanningView recipes={recipes} />);

    await user.click(screen.getByRole("button", { name: "Plan one meal" }));
    await user.selectOptions(screen.getByLabelText("Recipe"), "risotto");
    await user.click(screen.getByRole("button", { name: "Save meal" }));

    expect(mocks.captureRecipeEvent).toHaveBeenCalledWith(
      "meal_plan_meal_committed",
      expect.objectContaining({ first_committed_meal: false }),
    );
  });

  it("handles non-recipe commitments and week actions without empty slots", async () => {
    const user = userEvent.setup();
    const date = localDate();
    render(<MealPlanningView recipes={recipes} />);

    await user.click(screen.getByRole("button", { name: "Plan one meal" }));
    expect(
      screen.getByRole("option", { name: "Leftovers" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Decide later" }),
    ).toBeInTheDocument();
    await user.selectOptions(
      screen.getByLabelText("What is happening?"),
      "eating_out",
    );
    await user.clear(screen.getByLabelText("Day"));
    await user.type(screen.getByLabelText("Day"), date);
    await user.type(screen.getByLabelText(/Note/), "Dinner with friends");
    await user.click(screen.getByRole("button", { name: "Save meal" }));

    expect(getShoppingListSnapshot().plan[0]).toEqual(
      expect.objectContaining({
        kind: "eating_out",
        status: "committed",
        date,
        note: "Dinner with friends",
      }),
    );
    expect(getShoppingListSnapshot().plan[0]).not.toHaveProperty("recipeSlug");

    await user.click(screen.getByRole("button", { name: "Next 7 days" }));
    expect(screen.getByText("Dinner with friends")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Plan meal" })).toHaveLength(
      7,
    );
    await user.click(
      screen.getByRole("button", {
        name: "Plan Dinner with friends again",
      }),
    );
    expect(getShoppingListSnapshot().plan).toHaveLength(1);
    expect(
      screen.getByRole("heading", { name: "Plan this meal again." }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Choose the day and meal slot before saving."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Day")).toHaveValue(addDays(date, 7));
    expect(screen.getByLabelText("Meal slot")).toHaveValue("dinner");
    await user.click(screen.getByRole("button", { name: "Save meal" }));
    expect(getShoppingListSnapshot().plan).toEqual([
      expect.objectContaining({ date }),
      expect.objectContaining({
        date: addDays(date, 7),
        sourceMealId: getShoppingListSnapshot().plan[0]?.id,
      }),
    ]);

    await user.click(
      screen.getByRole("button", { name: "Remove Dinner with friends" }),
    );
    const [firstPlanButton] = screen.getAllByRole("button", {
      name: "Plan meal",
    });
    if (!firstPlanButton) throw new Error("Expected a week planning action");
    await user.click(firstPlanButton);
    await user.selectOptions(
      screen.getByLabelText("What is happening?"),
      "decide_later",
    );
    await user.click(screen.getByRole("button", { name: "Save meal" }));
    expect(getShoppingListSnapshot().plan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "decide_later", status: "committed" }),
      ]),
    );
  });

  it("orders meals by date and meal sequence", () => {
    const date = localDate();
    installShoppingListSnapshot({
      recipes: [],
      checked: [],
      extras: [],
      plan: [
        {
          id: "dinner",
          kind: "eating_out",
          status: "committed",
          date,
          mealType: "dinner",
          note: "Dinner plans",
        },
        {
          id: "breakfast",
          kind: "eating_out",
          status: "committed",
          date,
          mealType: "breakfast",
          note: "Breakfast plans",
        },
        {
          id: "lunch",
          kind: "eating_out",
          status: "committed",
          date,
          mealType: "lunch",
          note: "Lunch plans",
        },
      ],
    });

    render(<MealPlanningView recipes={recipes} />);

    expect(
      screen
        .getAllByRole("heading", { level: 3 })
        .map(({ textContent }) => textContent?.trim()),
    ).toEqual(["Breakfast plans", "Lunch plans", "Dinner plans"]);
  });

  it("offers shopping generation only for meals dated today or later", async () => {
    const user = userEvent.setup();
    const date = localDate();
    installShoppingListSnapshot({
      recipes: [],
      checked: [],
      extras: [],
      plan: [
        {
          id: "past",
          kind: "recipe",
          status: "committed",
          date: addDays(date, -1),
          mealType: "dinner",
          recipeSlug: "risotto",
          servings: 2,
        },
        {
          id: "current",
          kind: "recipe",
          status: "committed",
          date,
          mealType: "dinner",
          recipeSlug: "soup",
          servings: 4,
        },
      ],
    });

    render(<MealPlanningView recipes={recipes} />);

    expect(screen.getByText("1 upcoming meal is ready.")).toBeInTheDocument();
    expect(
      screen.getByText("Upcoming scheduled recipes in this view only."),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Add to shopping list" }),
    );
    expect(getShoppingListSnapshot().recipes).toEqual([
      { slug: "soup", servings: 4 },
    ]);
  });

  it("limits next-seven-days shopping to meals visible in that view", async () => {
    const user = userEvent.setup();
    const date = localDate();
    installShoppingListSnapshot({
      recipes: [],
      checked: [],
      extras: [],
      plan: [
        {
          id: "visible",
          kind: "recipe",
          status: "committed",
          date,
          mealType: "dinner",
          recipeSlug: "risotto",
          servings: 2,
        },
        {
          id: "later",
          kind: "recipe",
          status: "committed",
          date: addDays(date, 7),
          mealType: "dinner",
          recipeSlug: "risotto",
          servings: 3,
        },
      ],
    });

    render(<MealPlanningView recipes={recipes} />);

    expect(screen.getByText("2 upcoming meals are ready.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next 7 days" }));
    expect(
      screen.getByText("1 meal is ready in the next 7 days."),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Add to shopping list" }),
    );

    expect(getShoppingListSnapshot().recipes).toEqual([
      { slug: "risotto", servings: 2 },
    ]);
    expect(
      screen.getByRole("link", { name: "Added for 1 meal. Open Shop" }),
    ).toBeInTheDocument();
  });

  it("confirms repeated recipes by planned meal count", async () => {
    const user = userEvent.setup();
    const date = localDate();
    installShoppingListSnapshot({
      recipes: [],
      checked: [],
      extras: [],
      plan: [
        {
          id: "risotto-1",
          kind: "recipe",
          status: "committed",
          date,
          mealType: "dinner",
          recipeSlug: "risotto",
          servings: 2,
        },
        {
          id: "risotto-2",
          kind: "recipe",
          status: "committed",
          date: addDays(date, 1),
          mealType: "dinner",
          recipeSlug: "risotto",
          servings: 3,
        },
      ],
    });

    render(<MealPlanningView recipes={recipes} />);
    await user.click(screen.getByRole("button", { name: "Next 7 days" }));
    expect(
      screen.getByText("2 meals are ready in the next 7 days."),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Add to shopping list" }),
    );

    expect(getShoppingListSnapshot().recipes).toEqual([
      { slug: "risotto", servings: 5 },
    ]);
    expect(
      screen.getByRole("link", { name: "Added for 2 meals. Open Shop" }),
    ).toBeInTheDocument();
    expect(mocks.captureRecipeEvent).toHaveBeenCalledWith(
      "meal_plan_shopping_generated",
      { added_recipe_count: 1, committed_meal_count: 2 },
    );
  });

  it("records an abandoned plan after the form is changed", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<MealPlanningView recipes={recipes} />);

    await user.click(screen.getByRole("button", { name: "Plan one meal" }));
    await user.selectOptions(screen.getByLabelText("Recipe"), "risotto");
    unmount();

    expect(mocks.captureRecipeEvent).toHaveBeenCalledWith(
      "meal_plan_abandoned",
      expect.objectContaining({ elapsed_ms: expect.any(Number) }),
    );
  });
});
