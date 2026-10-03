import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@/tests/test-utils";

const mocks = vi.hoisted(() => ({
  buildKitchenCatalog: vi.fn(),
  ingredientCatalog: [{ slug: "milk", name: "Milk", category: "dairy" }],
  recipeBoxResult: vi.fn(),
  recipeRecordsToShoppingRecipes: vi.fn(),
  shoppingViewProps: vi.fn(),
  useSession: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: mocks.useSession },
}));

vi.mock("@/components/recipes/auth-button", () => ({
  AuthButton: () => <button type="button">Log in</button>,
}));

vi.mock("@/lib/api/recipe-bootstrap", () => ({
  getRecipeBootstrap: async () => ({
    recipeBox: await mocks.recipeBoxResult(),
    diet: { profile: {}, options: { ingredients: mocks.ingredientCatalog } },
    unreadNotificationCount: 0,
  }),
}));

vi.mock("@/lib/api/recipes", () => ({
  buildKitchenCatalog: mocks.buildKitchenCatalog,
}));

vi.mock("@/lib/api/shopping", () => ({
  recipeRecordsToShoppingRecipes: mocks.recipeRecordsToShoppingRecipes,
}));

vi.mock("@/components/recipes/kitchen/kitchen-view", () => ({
  KitchenView: () => <div>Loaded kitchen</div>,
}));

vi.mock("@/components/recipes/shopping/shopping-view", () => ({
  ShoppingView: (props: unknown) => {
    mocks.shoppingViewProps(props);
    return <div>Loaded shopping list</div>;
  },
}));

import { RecipeKitchen } from "@/components/recipes/kitchen/recipe-kitchen";
import { RecipeShopping } from "@/components/recipes/shopping/recipe-shopping";

describe("database-backed kitchen and shopping pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useSession.mockReturnValue({
      data: { user: { id: "cook-1" } },
      isPending: false,
    });
    mocks.buildKitchenCatalog.mockReturnValue({
      recipes: [],
      initialStock: [],
      pantry: [],
    });
    mocks.recipeRecordsToShoppingRecipes.mockReturnValue([]);
  });

  it("prompts signed-out visitors to log in without requesting owned recipes", () => {
    mocks.useSession.mockReturnValue({ data: null, isPending: false });

    const kitchen = render(<RecipeKitchen />);
    expect(screen.getByText("Your kitchen is waiting")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log in" })).toBeInTheDocument();
    kitchen.unmount();

    render(<RecipeShopping />);
    expect(screen.getByText("Log in to make a list")).toBeInTheDocument();
    expect(mocks.recipeBoxResult).not.toHaveBeenCalled();
  });

  it("loads recipe-box recipes into the kitchen", async () => {
    const recipes = [{ slug: "lentil-soup" }];
    mocks.recipeBoxResult.mockImplementation(async () => {
      return { recipes, box: { completed: true, recipeSlugs: [] } };
    });

    const view = render(<RecipeKitchen />);
    expect(await screen.findByText("Loaded kitchen")).toBeInTheDocument();
    expect(mocks.buildKitchenCatalog).toHaveBeenCalledWith(recipes);

    view.unmount();
  });

  it("shows a kitchen load error while ignoring abort errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.recipeBoxResult.mockRejectedValueOnce(new Error("offline"));
    const failedView = render(<RecipeKitchen />);
    expect(
      await screen.findByText("Your kitchen could not be loaded."),
    ).toBeInTheDocument();
    failedView.unmount();

    mocks.recipeBoxResult.mockRejectedValueOnce(
      new DOMException("aborted", "AbortError"),
    );
    render(<RecipeKitchen />);
    await act(async () => {});
    expect(
      screen.queryByText("Your kitchen could not be loaded."),
    ).not.toBeInTheDocument();
  });

  it("loads recipe-box recipes into the shopping view", async () => {
    const records = [{ slug: "lentil-soup" }];
    const shoppingRecipes = [{ slug: "lentil-soup", title: "Lentil Soup" }];
    mocks.recipeBoxResult.mockResolvedValue({
      recipes: records,
      box: { completed: true, recipeSlugs: [] },
    });
    mocks.recipeRecordsToShoppingRecipes.mockReturnValue(shoppingRecipes);

    render(<RecipeShopping />);

    expect(await screen.findByText("Loaded shopping list")).toBeInTheDocument();
    expect(mocks.recipeRecordsToShoppingRecipes).toHaveBeenCalledWith(records);
    expect(mocks.shoppingViewProps).toHaveBeenCalledWith({
      ingredientCatalog: mocks.ingredientCatalog,
      recipes: shoppingRecipes,
    });
  });

  it("shows a shopping load error while ignoring abort errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.recipeBoxResult.mockRejectedValueOnce(new Error("offline"));
    const failedView = render(<RecipeShopping />);
    expect(
      await screen.findByText("Your recipes could not be loaded."),
    ).toBeInTheDocument();
    failedView.unmount();

    mocks.recipeBoxResult.mockRejectedValueOnce(
      new DOMException("aborted", "AbortError"),
    );
    render(<RecipeShopping />);
    await act(async () => {});
    expect(
      screen.queryByText("Your recipes could not be loaded."),
    ).not.toBeInTheDocument();
  });
});
