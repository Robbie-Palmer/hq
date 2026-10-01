import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShoppingView } from "@/components/recipes/shopping/shopping-view";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  extras: [{ id: "extra-milk", text: "Milk", checked: false }],
  household: true,
}));

vi.mock("@/components/recipes/shopping/shopping-list-boundary", () => ({
  ShoppingListBoundary: ({ children }: { children: React.ReactNode }) =>
    children,
  useStartNewShoppingList: () => ({
    start: mocks.start,
    isPending: false,
    isError: false,
  }),
  useShoppingListScope: () =>
    mocks.household
      ? {
          type: "household",
          household: { id: "household-1", name: "Park Road" },
        }
      : { type: "personal" },
}));

vi.mock("@/components/recipes/shopping/share-shopping-list", () => ({
  ShareShoppingList: () => <button type="button">share</button>,
}));

vi.mock("@/hooks/use-shopping-list", () => ({
  useShoppingList: () => ({
    recipes: [],
    plan: [],
    extras: mocks.extras,
  }),
}));

vi.mock("@/components/recipes/diet-provider", () => ({
  useDiet: () => ({
    diet: { active: false, mode: "exclude", labels: [] },
    matchRecipe: vi.fn(),
  }),
}));

vi.mock("@/components/recipes/shopping/meal-planner", () => ({
  MealPlanner: () => <div>Meal planner</div>,
}));

vi.mock("@/components/recipes/shopping/recipe-picker", () => ({
  RecipePicker: () => <div>Recipe picker</div>,
}));

vi.mock("@/components/recipes/shopping/shopping-list", () => ({
  ShoppingList: () => <div>List contents</div>,
}));

describe("ShoppingView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.household = true;
    mocks.extras.splice(0, mocks.extras.length, {
      id: "extra-milk",
      text: "Milk",
      checked: false,
    });
  });

  it("opens an empty shopping list without requiring a meal plan", async () => {
    mocks.extras.splice(0);
    const user = userEvent.setup();
    render(<ShoppingView recipes={[]} />);

    const viewList = screen.getByRole("button", {
      name: "View shopping list",
    });
    expect(viewList).toBeEnabled();
    await user.click(viewList);

    expect(
      screen.getByRole("heading", { name: "Shopping list." }),
    ).toBeInTheDocument();
    expect(screen.getByText("List contents")).toBeInTheDocument();
  });

  it("stays on the shopping-list screen when starting a new list", async () => {
    const user = userEvent.setup();
    render(<ShoppingView recipes={[]} />);

    await user.click(screen.getByRole("button", { name: "Shopping list" }));
    expect(
      screen.getByRole("heading", { name: "Shopping list." }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /start a new list/i }));

    expect(mocks.start).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("heading", { name: "Shopping list." }),
    ).toBeInTheDocument();
  });

  it("offers sharing for a household shopping list", () => {
    render(<ShoppingView recipes={[]} />);

    expect(screen.getByRole("button", { name: "share" })).toBeInTheDocument();
  });

  it("does not offer a shared link for a personal shopping list", () => {
    mocks.household = false;

    render(<ShoppingView recipes={[]} />);

    expect(
      screen.queryByRole("button", { name: "share" }),
    ).not.toBeInTheDocument();
  });
});
