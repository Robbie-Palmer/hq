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

  it("shows the shopping list followed by the recipe picker", () => {
    mocks.extras.splice(0);
    render(<ShoppingView ingredientCatalog={[]} recipes={[]} />);

    expect(
      screen.getByRole("heading", { name: "Shopping list." }),
    ).toBeInTheDocument();
    expect(screen.getByText("List contents")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Add recipes." }),
    ).toBeInTheDocument();
    expect(
      screen
        .getByText("List contents")
        .compareDocumentPosition(
          screen.getByRole("heading", { name: "Add recipes." }),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Plan meals" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Shopping list" }),
    ).not.toBeInTheDocument();
  });

  it("starts a new list without changing the page", async () => {
    const user = userEvent.setup();
    render(<ShoppingView ingredientCatalog={[]} recipes={[]} />);

    await user.click(screen.getByRole("button", { name: /start a new list/i }));

    expect(mocks.start).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("heading", { name: "Shopping list." }),
    ).toBeInTheDocument();
  });

  it("offers sharing for a household shopping list", () => {
    render(<ShoppingView ingredientCatalog={[]} recipes={[]} />);

    expect(screen.getByRole("button", { name: "share" })).toBeInTheDocument();
  });

  it("links personal shopping lists to household setup", () => {
    mocks.household = false;

    render(<ShoppingView ingredientCatalog={[]} recipes={[]} />);

    expect(
      screen.getByRole("link", { name: "share with a household" }),
    ).toHaveAttribute("href", "/recipes/settings?section=household");
  });
});
