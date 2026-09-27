import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KitchenView } from "@/components/recipes/kitchen/kitchen-view";
import type { KitchenStock } from "@/lib/domain/recipe/kitchen";

const dietState = vi.hoisted(() => ({ mode: "hide" as "hide" | "warn" }));
const kitchenStockState = vi.hoisted(() => ({
  actions: {
    clearStock: vi.fn(),
    error: null as Error | null,
    isPending: false,
    removeFromStock: vi.fn(),
    replaceStock: vi.fn(),
    restoreStock: vi.fn(),
    setStockLocation: vi.fn(),
  },
  pantry: {
    data: {
      scope: { type: "personal" as const },
      stock: {} as KitchenStock,
    },
    error: null as Error | null,
    isPending: false,
  },
}));

vi.mock("@/components/recipes/diet-provider", () => ({
  useDiet: () => ({
    diet: {
      active: true,
      labels: ["Vegan"],
      mode: dietState.mode,
      excludedIngredientSlugs: new Set(["bacon"]),
      ingredientNames: new Map([["bacon", "Bacon"]]),
    },
    loading: false,
    matchRecipe: (recipe: {
      ingredients: { slug: string; name?: string }[];
    }) => {
      const excludedIngredients = recipe.ingredients
        .filter((ingredient) => ingredient.slug === "bacon")
        .map((ingredient) => ({
          slug: ingredient.slug,
          name: ingredient.name ?? "Bacon",
        }));
      return {
        matches: excludedIngredients.length === 0,
        excludedIngredients,
      };
    },
  }),
}));

vi.mock("@/hooks/use-kitchen-stock", () => ({
  useKitchenStockActions: () => kitchenStockState.actions,
  useKitchenStockQuery: () => kitchenStockState.pantry,
}));

vi.mock("@/hooks/use-shopping-list", () => ({
  useShoppingList: () => ({ recipes: [] }),
}));

vi.mock("@/lib/shopping/shoppingListStore", () => ({
  toggleRecipe: vi.fn(),
}));

const ingredients = [
  { slug: "bacon", name: "Bacon", category: "protein" as const },
  { slug: "chickpeas", name: "Chickpeas", category: "legume" as const },
];

const recipes = [
  {
    slug: "bacon-pasta",
    title: "Bacon Pasta",
    cuisine: [],
    ingredients: [{ slug: "bacon", name: "Bacon" }],
  },
  {
    slug: "chickpea-stew",
    title: "Chickpea Stew",
    cuisine: [],
    ingredients: [{ slug: "chickpeas", name: "Chickpeas" }],
  },
];

describe("KitchenView diet ingredient catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dietState.mode = "hide";
    kitchenStockState.pantry.data = {
      scope: { type: "personal" },
      stock: {},
    };
    kitchenStockState.pantry.error = null;
    kitchenStockState.pantry.isPending = false;
    kitchenStockState.actions.error = null;
  });

  it("shows a loading state instead of an empty pantry", () => {
    kitchenStockState.pantry.isPending = true;

    render(<KitchenView ingredients={ingredients} recipes={[]} />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading your pantry…",
    );
    expect(screen.queryByRole("button", { name: /add chickpeas/i })).toBeNull();
  });

  it("distinguishes loading failures from unsaved changes", () => {
    kitchenStockState.pantry.error = new Error("load failed");
    kitchenStockState.actions.error = new Error("save failed");

    render(<KitchenView ingredients={ingredients} recipes={[]} />);

    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(
      screen.getByText(
        "Your pantry could not be loaded. Refresh the page to try again.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Your latest pantry change could not be saved. Please try again.",
      ),
    ).toBeInTheDocument();
  });

  it("hides excluded ingredients and supports a temporary override", async () => {
    const user = userEvent.setup();
    render(<KitchenView ingredients={ingredients} recipes={[]} />);

    expect(screen.queryByRole("button", { name: /add bacon/i })).toBeNull();
    expect(
      screen.getByRole("button", { name: /add chickpeas/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show anyway" }));

    expect(
      screen.getByRole("button", { name: /add bacon — diet warning/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Diet warning")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Hide diet exclusions" }),
    ).toBeInTheDocument();
  });

  it("restores only cleared entries through the merge-safe pantry operation", async () => {
    kitchenStockState.pantry.data = {
      scope: { type: "personal" },
      stock: { chickpeas: "cupboards" },
    };
    const user = userEvent.setup();
    const view = render(<KitchenView ingredients={ingredients} recipes={[]} />);

    await user.click(screen.getByRole("button", { name: "clear all" }));
    expect(kitchenStockState.actions.clearStock).toHaveBeenCalled();

    // Replace the stock object so the view retains the cleared snapshot by reference.
    kitchenStockState.pantry.data = {
      scope: { type: "personal" },
      stock: {},
    };
    view.rerender(<KitchenView ingredients={ingredients} recipes={[]} />);
    await user.click(screen.getByRole("button", { name: "undo clear" }));

    expect(kitchenStockState.actions.restoreStock).toHaveBeenCalledWith({
      chickpeas: "cupboards",
    });
    expect(kitchenStockState.actions.replaceStock).not.toHaveBeenCalled();
  });

  it("hides mismatched recipes until the user chooses to show them", async () => {
    const user = userEvent.setup();
    render(<KitchenView ingredients={ingredients} recipes={recipes} />);

    expect(screen.queryByText("Bacon Pasta")).toBeNull();
    expect(screen.getByText("Chickpea Stew")).toBeInTheDocument();

    const [showHiddenRecipes] = screen.getAllByRole("button", {
      name: /show anyway/i,
    });
    expect(showHiddenRecipes).toBeDefined();
    if (!showHiddenRecipes) throw new Error("Missing recipe override button.");
    await user.click(showHiddenRecipes);

    expect(screen.getByText("Bacon Pasta")).toBeInTheDocument();
    expect(
      screen.getByText(/Doesn't match your diet: Bacon/),
    ).toBeInTheDocument();
  });

  it("shows excluded ingredients with warnings in warn mode", () => {
    dietState.mode = "warn";
    render(<KitchenView ingredients={ingredients} recipes={recipes} />);

    expect(
      screen.getByRole("button", { name: /add bacon — diet warning/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show anyway" })).toBeNull();
    expect(screen.getByText("Bacon Pasta")).toBeInTheDocument();
    expect(
      screen.getByText(/Doesn't match your diet: Bacon/),
    ).toBeInTheDocument();
  });
});
