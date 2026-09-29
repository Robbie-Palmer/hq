import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecipeList } from "@/components/recipes/recipe-list";
import { ApiError } from "@/lib/api/http";
import type { RecipeCardView } from "@/lib/api/recipes";
import type { StoredShoppingList } from "@/lib/api/shopping-lists";
import { __resetShoppingListForTests } from "@/tests/support/recipe-state";

const replaceMock = vi.fn();
const dietTestState = vi.hoisted(() => ({
  mode: "none" as "none" | "hide" | "warn",
}));
const shoppingMocks = vi.hoisted(() => ({
  getCurrentShoppingList: vi.fn(),
  saveCurrentShoppingList: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
}));

let currentSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => "/recipes",
  useRouter: () => ({
    replace: replaceMock,
  }),
  useSearchParams: () => currentSearchParams,
}));

vi.mock("posthog-js", () => ({
  default: {
    capture: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: shoppingMocks.toastError,
    info: shoppingMocks.toastInfo,
    success: shoppingMocks.toastSuccess,
  },
}));

vi.mock("@/lib/api/shopping-lists", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/shopping-lists")>()),
  getCurrentShoppingList: shoppingMocks.getCurrentShoppingList,
  saveCurrentShoppingList: shoppingMocks.saveCurrentShoppingList,
}));

vi.mock("@/lib/integrations/cloudflare-images", () => ({
  getImageUrl: (image: string) => image,
}));

vi.mock("@/components/recipes/diet-provider", () => ({
  useDiet: () => ({
    diet: {
      active: dietTestState.mode !== "none",
      labels: ["Vegetarian"],
      mode: dietTestState.mode === "warn" ? "warn" : "hide",
    },
    matchRecipe: (recipe: { ingredients: { slug: string }[] }) => {
      const excludedIngredients = recipe.ingredients
        .filter((ingredient) => ingredient.slug === "chicken-breast")
        .map((ingredient) => ({
          slug: ingredient.slug,
          name: "Chicken breast",
        }));
      return {
        matches: excludedIngredients.length === 0,
        excludedIngredients,
      };
    },
  }),
}));

const recipes: RecipeCardView[] = [
  {
    slug: "slow-cooker-mexican-chicken",
    title: "Slow Cooker Mexican Chicken",
    description: "Slow cooker chicken for tacos.",
    date: "2026-02-12",
    cuisine: ["Mexican"],
    tags: [],
    servings: 4,
    prepTime: 15,
    cookTime: 240,
    totalTime: 255,
    ingredientNames: ["chicken breast", "white onion"],
    ingredientSlugs: ["chicken-breast", "white-onion"],
    cookware: ["fork", "oven", "slow cooker"],
  },
  {
    slug: "chicken-quesadillas",
    title: "Chicken Quesadillas",
    description: "Crisp quesadillas with chipotle mayo.",
    date: "2026-02-10",
    cuisine: ["Mexican"],
    tags: [],
    servings: 4,
    prepTime: 20,
    cookTime: 30,
    totalTime: 50,
    ingredientNames: ["chicken breast", "cheddar cheese"],
    ingredientSlugs: ["chicken-breast", "cheddar-cheese"],
    cookware: ["baking tray", "bowl", "fork", "frying pan", "oven", "spoon"],
  },
  {
    slug: "creamy-pesto-risotto",
    title: "Creamy Pesto Risotto",
    description: "Creamy risotto with pesto.",
    date: "2026-02-08",
    cuisine: ["Italian"],
    tags: [],
    servings: 4,
    prepTime: 10,
    cookTime: 30,
    totalTime: 40,
    ingredientNames: ["arborio rice", "pesto"],
    ingredientSlugs: ["arborio-rice", "pesto"],
    cookware: ["bowl", "saucepan"],
  },
];

const emptyShoppingList: StoredShoppingList = {
  id: "00000000-0000-4000-8000-000000000080",
  resourceId: "user-1",
  revision: "0",
  scope: { type: "personal" },
  snapshot: { recipes: [], checked: [], extras: [] },
  createdAt: "2026-09-28T08:00:00.000Z",
  updatedAt: "2026-09-28T08:00:00.000Z",
};

function renderWithShoppingList(element: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>,
  );
}

describe("RecipeList", () => {
  beforeEach(() => {
    currentSearchParams = new URLSearchParams();
    replaceMock.mockReset();
    dietTestState.mode = "none";
    __resetShoppingListForTests();
    shoppingMocks.getCurrentShoppingList.mockReset();
    shoppingMocks.getCurrentShoppingList.mockResolvedValue(emptyShoppingList);
    shoppingMocks.saveCurrentShoppingList.mockReset();
    shoppingMocks.toastError.mockReset();
    shoppingMocks.toastInfo.mockReset();
    shoppingMocks.toastSuccess.mockReset();
  });

  it("adds a recipe to the shopping list from its card", async () => {
    const updated = {
      ...emptyShoppingList,
      revision: "1",
      snapshot: {
        ...emptyShoppingList.snapshot,
        recipes: [{ slug: recipes[0]?.slug ?? "missing", servings: 4 }],
      },
    };
    shoppingMocks.saveCurrentShoppingList.mockResolvedValue(updated);
    const user = userEvent.setup();

    renderWithShoppingList(
      <RecipeList recipes={recipes} shoppingListUserId="user-1" />,
    );

    await user.click(
      await screen.findByRole("button", {
        name: "Add Slow Cooker Mexican Chicken to the shopping list",
      }),
    );

    expect(shoppingMocks.saveCurrentShoppingList).toHaveBeenCalledWith(
      emptyShoppingList.id,
      emptyShoppingList.revision,
      updated.snapshot,
    );
    expect(
      await screen.findByRole("button", {
        name: "Remove Slow Cooker Mexican Chicken from the shopping list",
      }),
    ).toBeInTheDocument();
    expect(shoppingMocks.toastSuccess).toHaveBeenCalledWith(
      "Slow Cooker Mexican Chicken added to your shopping list.",
    );
  });

  it("keeps selected recipes while searching and adds them together", async () => {
    const updated = {
      ...emptyShoppingList,
      revision: "1",
      snapshot: {
        ...emptyShoppingList.snapshot,
        recipes: [
          { slug: "slow-cooker-mexican-chicken", servings: 4 },
          { slug: "creamy-pesto-risotto", servings: 4 },
        ],
      },
    };
    shoppingMocks.saveCurrentShoppingList.mockResolvedValue(updated);
    const user = userEvent.setup();

    renderWithShoppingList(
      <RecipeList recipes={recipes} shoppingListUserId="user-1" />,
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Select recipes for shopping list",
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Select Slow Cooker Mexican Chicken",
      }),
    );
    await user.type(
      screen.getByPlaceholderText("Search 3 recipes…"),
      "risotto",
    );
    await user.click(
      screen.getByRole("button", { name: "Select Creamy Pesto Risotto" }),
    );

    expect(screen.getByText("2 selected")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: "Add selected to shopping list",
      }),
    );

    expect(shoppingMocks.saveCurrentShoppingList).toHaveBeenCalledWith(
      emptyShoppingList.id,
      emptyShoppingList.revision,
      updated.snapshot,
    );
    expect(shoppingMocks.toastSuccess).toHaveBeenCalledWith(
      "Slow Cooker Mexican Chicken, Creamy Pesto Risotto added to your shopping list.",
    );
  });

  it("does not duplicate a recipe already on the shopping list", async () => {
    const selectedList = {
      ...emptyShoppingList,
      snapshot: {
        ...emptyShoppingList.snapshot,
        recipes: [{ slug: "slow-cooker-mexican-chicken", servings: 4 }],
      },
    };
    shoppingMocks.getCurrentShoppingList.mockResolvedValue(selectedList);
    const user = userEvent.setup();

    renderWithShoppingList(
      <RecipeList
        recipes={[recipes[0] as RecipeCardView]}
        shoppingListUserId="user-1"
      />,
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Select recipes for shopping list",
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Select Slow Cooker Mexican Chicken",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Add selected to shopping list" }),
    );

    expect(shoppingMocks.saveCurrentShoppingList).not.toHaveBeenCalled();
    expect(shoppingMocks.toastInfo).toHaveBeenCalledWith(
      "Slow Cooker Mexican Chicken is already on your shopping list.",
    );
  });

  it("removes a recipe from the shopping list through its card", async () => {
    const selectedList = {
      ...emptyShoppingList,
      snapshot: {
        ...emptyShoppingList.snapshot,
        recipes: [{ slug: "slow-cooker-mexican-chicken", servings: 4 }],
      },
    };
    const updated = {
      ...emptyShoppingList,
      revision: "1",
    };
    shoppingMocks.getCurrentShoppingList.mockResolvedValue(selectedList);
    shoppingMocks.saveCurrentShoppingList.mockResolvedValue(updated);
    const user = userEvent.setup();

    renderWithShoppingList(
      <RecipeList
        recipes={[recipes[0] as RecipeCardView]}
        shoppingListUserId="user-1"
      />,
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Remove Slow Cooker Mexican Chicken from the shopping list",
      }),
    );

    expect(shoppingMocks.saveCurrentShoppingList).toHaveBeenCalledWith(
      selectedList.id,
      selectedList.revision,
      emptyShoppingList.snapshot,
    );
    expect(shoppingMocks.toastSuccess).toHaveBeenCalledWith(
      "Slow Cooker Mexican Chicken removed from your shopping list.",
    );
  });

  it("reports a failed recipe-card addition and leaves the action available", async () => {
    shoppingMocks.saveCurrentShoppingList.mockRejectedValue(
      new Error("offline"),
    );
    const user = userEvent.setup();

    renderWithShoppingList(
      <RecipeList
        recipes={[recipes[0] as RecipeCardView]}
        shoppingListUserId="user-1"
      />,
    );
    const addButton = await screen.findByRole("button", {
      name: "Add Slow Cooker Mexican Chicken to the shopping list",
    });
    await user.click(addButton);

    await waitFor(() =>
      expect(shoppingMocks.toastError).toHaveBeenCalledWith(
        "Slow Cooker Mexican Chicken could not be added to your shopping list.",
      ),
    );
    expect(addButton).toBeEnabled();
    expect(addButton).toHaveAttribute("aria-pressed", "false");
  });

  it("refreshes the shopping list after a conflicting card update", async () => {
    shoppingMocks.saveCurrentShoppingList.mockRejectedValue(
      new ApiError("Shopping list changed", 409),
    );
    const user = userEvent.setup();

    renderWithShoppingList(
      <RecipeList
        recipes={[recipes[0] as RecipeCardView]}
        shoppingListUserId="user-1"
      />,
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Add Slow Cooker Mexican Chicken to the shopping list",
      }),
    );

    await waitFor(() =>
      expect(shoppingMocks.getCurrentShoppingList).toHaveBeenCalledTimes(3),
    );
    expect(shoppingMocks.toastError).toHaveBeenCalledWith(
      "Slow Cooker Mexican Chicken could not be added to your shopping list.",
    );
  });

  it("hides diet mismatches and lets the user temporarily show them", async () => {
    dietTestState.mode = "hide";
    const user = userEvent.setup();
    const onDietVisibleCountChange = vi.fn();

    render(
      <RecipeList
        recipes={recipes}
        onDietVisibleCountChange={onDietVisibleCountChange}
      />,
    );

    expect(screen.queryByText("Chicken Quesadillas")).not.toBeInTheDocument();
    expect(screen.getByText("Creamy Pesto Risotto")).toBeInTheDocument();
    expect(screen.getByText(/2 recipes hidden/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(onDietVisibleCountChange).toHaveBeenCalledWith(1),
    );

    await user.click(screen.getByRole("button", { name: /show anyway/i }));

    expect(screen.getByText("Chicken Quesadillas")).toBeInTheDocument();
    expect(screen.getAllByText(/doesn't match your diet/i)).toHaveLength(2);
    await waitFor(() =>
      expect(onDietVisibleCountChange).toHaveBeenCalledWith(3),
    );
  });

  it("keeps diet mismatches visible with warnings in warn mode", () => {
    dietTestState.mode = "warn";

    render(<RecipeList recipes={recipes} />);

    expect(screen.getByText("Chicken Quesadillas")).toBeInTheDocument();
    expect(screen.getAllByText(/doesn't match your diet/i)).toHaveLength(2);
    expect(screen.getByText(/marked with a warning/i)).toBeInTheDocument();
  });

  it("uses a compact icon to show who can view each recipe", () => {
    const privateRecipe = recipes.find(
      (recipe) => recipe.slug === "slow-cooker-mexican-chicken",
    );
    const householdRecipe = recipes.find(
      (recipe) => recipe.slug === "chicken-quesadillas",
    );
    const publicRecipe = recipes.find(
      (recipe) => recipe.slug === "creamy-pesto-risotto",
    );
    if (!(privateRecipe && householdRecipe && publicRecipe)) {
      throw new Error("Expected recipe fixtures");
    }

    render(
      <RecipeList
        recipes={[
          { ...privateRecipe, visibility: "private" },
          { ...householdRecipe, visibility: "household" },
          { ...publicRecipe, visibility: "public" },
        ]}
      />,
    );

    expect(screen.getByText("Only you can view this recipe")).toHaveClass(
      "sr-only",
    );
    expect(screen.getByText("Shared with your household")).toHaveClass(
      "sr-only",
    );
    expect(screen.getByText("Public recipe")).toHaveClass("sr-only");
    expect(screen.queryByText("Your recipe")).not.toBeInTheDocument();
  });

  it("uses the public visibility indicator for recipes without a visibility value", () => {
    const recipe = recipes[0];
    if (!recipe) throw new Error("Expected recipe fixture");

    render(<RecipeList recipes={[recipe]} />);

    expect(screen.getByText("Public recipe")).toHaveClass("sr-only");
  });

  it("falls back to the public visibility indicator for an unrecognized value", () => {
    const recipe = recipes[0];
    if (!recipe) throw new Error("Expected recipe fixture");
    const malformedRecipe = {
      ...recipe,
      visibility: "unrecognized",
    } as unknown as RecipeCardView;

    render(<RecipeList recipes={[malformedRecipe]} />);

    expect(screen.getByText("Public recipe")).toHaveClass("sr-only");
  });

  it("shows an equipment filter with cookware options", async () => {
    const user = userEvent.setup();

    render(<RecipeList recipes={recipes} />);

    const equipmentLabel = screen.getByText("Equipment:");
    const equipmentFilter = equipmentLabel.closest('[role="combobox"]');
    expect(equipmentFilter).not.toBeNull();
    if (!equipmentFilter) throw new Error("Equipment filter not found");

    await user.click(equipmentFilter);

    expect(screen.getByRole("button", { name: "fork" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "slow cooker" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "saucepan" }),
    ).toBeInTheDocument();
  });

  it("lets mobile users search within a filter category", () => {
    render(<RecipeList recipes={recipes} />);

    // Vaul's pointer-capture gesture handling is not implemented by jsdom, so
    // use click events here while asserting the resulting user-visible flow.
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Ingredients, 5 values" }),
    );

    const ingredientSearch = screen.getByRole("searchbox", {
      name: "Search Ingredients filter values",
    });
    const optionListId = ingredientSearch.getAttribute("aria-controls");
    expect(optionListId).not.toBeNull();
    expect(document.getElementById(optionListId ?? "")).toBeInTheDocument();
    fireEvent.change(ingredientSearch, { target: { value: "cheddar" } });

    expect(
      screen.getByRole("button", { name: "cheddar cheese" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "white onion" }),
    ).not.toBeInTheDocument();
    const resultCount = screen.getByText("1 of 5");
    expect(resultCount).toHaveAttribute("aria-atomic", "true");
    expect(ingredientSearch).toHaveAttribute(
      "aria-describedby",
      resultCount.id,
    );

    fireEvent.click(screen.getByRole("button", { name: "cheddar cheese" }));

    expect(replaceMock).toHaveBeenCalledWith(
      "/recipes?ingredient=cheddar+cheese",
      { scroll: false },
    );
  });

  it("applies the equipment filter via the equipment query param", () => {
    currentSearchParams = new URLSearchParams("equipment=slow cooker");

    render(<RecipeList recipes={recipes} />);

    expect(screen.getByText("Showing 1 of 3 recipes")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Slow Cooker Mexican Chicken" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Chicken Quesadillas" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Creamy Pesto Risotto" }),
    ).not.toBeInTheDocument();
  });

  it("cycles an included active filter chip to excluded", async () => {
    currentSearchParams = new URLSearchParams("cuisine=Mexican");
    const user = userEvent.setup();

    render(<RecipeList recipes={recipes} />);

    await user.click(screen.getByRole("button", { name: /Mexican included/i }));

    expect(replaceMock).toHaveBeenCalledWith("/recipes?cuisine=%21Mexican", {
      scroll: false,
    });
  });

  it("clears an excluded active filter chip on the next tap", async () => {
    currentSearchParams = new URLSearchParams("cuisine=!Mexican");
    const user = userEvent.setup();

    render(<RecipeList recipes={recipes} />);

    await user.click(screen.getByRole("button", { name: /Mexican excluded/i }));

    expect(replaceMock).toHaveBeenCalledWith("/recipes", { scroll: false });
  });

  it("filters recipes from the inline search field", async () => {
    const user = userEvent.setup();

    render(<RecipeList recipes={recipes} />);

    await user.type(
      screen.getByPlaceholderText("Search 3 recipes…"),
      "risotto",
    );

    expect(
      screen.getByText('Showing 1 of 3 recipes matching "risotto"'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Creamy Pesto Risotto" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Slow Cooker Mexican Chicken" }),
    ).not.toBeInTheDocument();
  });

  it("hydrates recipe search from the q query param", () => {
    currentSearchParams = new URLSearchParams("q=risotto");

    render(<RecipeList recipes={recipes} />);

    expect(screen.getByPlaceholderText("Search 3 recipes…")).toHaveValue(
      "risotto",
    );
    expect(
      screen.getByText('Showing 1 of 3 recipes matching "risotto"'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Creamy Pesto Risotto" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Slow Cooker Mexican Chicken" }),
    ).not.toBeInTheDocument();
  });

  it("keeps newer typed input when its own debounced URL update lands", async () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<RecipeList recipes={recipes} />);
      const input = screen.getByPlaceholderText("Search 3 recipes…");

      fireEvent.change(input, { target: { value: "ri" } });
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      expect(replaceMock).toHaveBeenLastCalledWith("/recipes?q=ri", {
        scroll: false,
      });

      fireEvent.change(input, { target: { value: "ris" } });
      currentSearchParams = new URLSearchParams("q=ri");
      rerender(<RecipeList recipes={recipes} />);

      expect(input).toHaveValue("ris");
    } finally {
      vi.useRealTimers();
    }
  });
});
