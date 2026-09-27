import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShoppingList } from "@/components/recipes/shopping/shopping-list";
import type { ShoppingRecipe } from "@/lib/api/shopping";
import type { KitchenStock } from "@/lib/domain/recipe/kitchen";
import {
  addExtra,
  addRecipe,
  toggleChecked,
} from "@/lib/shopping/shoppingListStore";
import { __resetShoppingListForTests } from "@/tests/support/recipe-state";

const mocks = vi.hoisted(() => ({
  captureRecipeProductActivity: vi.fn(),
  captureRecipeValue: vi.fn(),
}));

const pantryState = vi.hoisted(() => ({
  actionError: null as Error | null,
  error: null as Error | null,
  hasData: true,
  isPending: false,
  stock: {} as KitchenStock,
}));

vi.mock("@/lib/analytics/recipe-product", () => ({
  captureRecipeProductActivity: mocks.captureRecipeProductActivity,
  captureRecipeValue: mocks.captureRecipeValue,
}));

vi.mock("@/hooks/use-kitchen-stock", () => ({
  useKitchenStockActions: () => ({
    error: pantryState.actionError,
    isPending: false,
    removeFromStock: vi.fn(),
  }),
  useKitchenStockQuery: () => ({
    data: pantryState.hasData
      ? { scope: { type: "personal" }, stock: pantryState.stock }
      : undefined,
    error: pantryState.error,
    isPending: pantryState.isPending,
  }),
}));

vi.mock("@/hooks/use-unit-preference", async () => {
  const { preferenceForSystem } = await vi.importActual<
    typeof import("@/lib/domain/recipe/unit")
  >("@/lib/domain/recipe/unit");
  return {
    useUnitPreference: () => [preferenceForSystem("uk"), vi.fn()],
  };
});

type Slug = ShoppingRecipe["ingredients"][number]["ingredient"];

const recipes: ShoppingRecipe[] = [
  {
    slug: "garlic-pasta",
    title: "Garlic pasta",
    servings: 2,
    cuisine: [],
    ingredients: [
      {
        ingredient:
          "garlic" as ShoppingRecipe["ingredients"][number]["ingredient"],
        name: "garlic",
        amount: 1,
        unit: "clove",
      },
    ],
  },
];

const butterRecipes: ShoppingRecipe[] = [
  {
    slug: "salted-butter-dish",
    title: "Salted butter dish",
    servings: 2,
    cuisine: [],
    ingredients: [
      {
        ingredient: "salted-butter" as Slug,
        name: "salted butter",
        amount: 100,
        unit: "g",
        category: "dairy",
      },
    ],
  },
  {
    slug: "unsalted-butter-dish",
    title: "Unsalted butter dish",
    servings: 2,
    cuisine: [],
    ingredients: [
      {
        ingredient: "unsalted-butter" as Slug,
        name: "unsalted butter",
        amount: 200,
        unit: "g",
        category: "dairy",
      },
    ],
  },
];

describe("ShoppingList value analytics", () => {
  beforeEach(() => {
    pantryState.actionError = null;
    pantryState.error = null;
    pantryState.hasData = true;
    pantryState.isPending = false;
    pantryState.stock = {};
    localStorage.clear();
    __resetShoppingListForTests();
    addRecipe("garlic-pasta");
    mocks.captureRecipeProductActivity.mockClear();
    mocks.captureRecipeValue.mockClear();
  });

  afterEach(() => {
    __resetShoppingListForTests();
  });

  it("records an assisted shop when the final item is checked", async () => {
    const user = userEvent.setup();
    render(<ShoppingList recipes={recipes} />);

    expect(mocks.captureRecipeValue).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /garlic/i }));

    await waitFor(() =>
      expect(mocks.captureRecipeValue).toHaveBeenCalledWith(
        "shopping_trip_completed",
        {
          item_count: 1,
          recipe_count: 1,
        },
      ),
    );
  });

  it("does not re-record an already completed persisted shop on mount", () => {
    toggleChecked("garlic");
    mocks.captureRecipeValue.mockClear();

    render(<ShoppingList recipes={recipes} />);

    expect(mocks.captureRecipeValue).not.toHaveBeenCalled();
  });

  it("counts pantry items toward shopping-list completion", async () => {
    __resetShoppingListForTests();
    addRecipe("veg-and-chicken");
    pantryState.stock = { "chicken-breast": "fridge" };
    const user = userEvent.setup();
    render(<ShoppingList recipes={twoAisleRecipes} />);

    await user.click(screen.getByRole("button", { name: /garlic/i }));

    await waitFor(() =>
      expect(mocks.captureRecipeValue).toHaveBeenCalledWith(
        "shopping_trip_completed",
        {
          item_count: 2,
          recipe_count: 1,
        },
      ),
    );
  });

  it("records one value event when the final item is unchecked and rechecked", async () => {
    const user = userEvent.setup();
    render(<ShoppingList recipes={recipes} />);
    const garlic = screen.getByRole("button", { name: /garlic/i });

    await user.click(garlic);
    await user.click(garlic);
    await user.click(garlic);

    expect(mocks.captureRecipeValue).toHaveBeenCalledTimes(1);
  });
});

const twoAisleRecipes: ShoppingRecipe[] = [
  {
    slug: "veg-and-chicken",
    title: "Veg and chicken",
    servings: 2,
    cuisine: [],
    ingredients: [
      {
        ingredient: "garlic" as Slug,
        name: "garlic",
        amount: 1,
        unit: "clove",
        category: "vegetable",
      },
      {
        ingredient: "chicken-breast" as Slug,
        name: "chicken breast",
        amount: 200,
        unit: "g",
        category: "protein",
      },
    ],
  },
];

const aisleHeadings = () =>
  screen
    .getAllByRole("heading", { level: 3 })
    .filter((h) => /fruit & veg|meat & fish/i.test(h.textContent ?? ""));

describe("ShoppingList aisle view section completion", () => {
  beforeEach(() => {
    pantryState.actionError = null;
    pantryState.error = null;
    pantryState.hasData = true;
    pantryState.isPending = false;
    pantryState.stock = {};
    localStorage.clear();
    __resetShoppingListForTests();
    addRecipe("veg-and-chicken");
  });

  afterEach(() => {
    __resetShoppingListForTests();
  });

  it("sinks a fully-checked aisle below aisles still to buy and strikes its header", async () => {
    const user = userEvent.setup();
    render(<ShoppingList recipes={twoAisleRecipes} />);

    const [first, second] = aisleHeadings();
    expect(first).toHaveTextContent("Fruit & veg");
    expect(second).toHaveTextContent("Meat & fish");
    expect(first).not.toHaveClass("line-through");

    // Tick off the only produce item, completing the Fruit & veg aisle.
    await user.click(screen.getByRole("button", { name: /garlic/i }));

    const [newFirst, newSecond] = aisleHeadings();
    // Meat & fish (still to buy) rises above the completed Fruit & veg aisle.
    expect(newFirst).toHaveTextContent("Meat & fish");
    expect(newSecond).toHaveTextContent("Fruit & veg");
    // The completed aisle's header is scored off.
    expect(newSecond).toHaveClass("line-through");
    expect(newFirst).not.toHaveClass("line-through");
  });
});

describe("ShoppingList pantry state", () => {
  beforeEach(() => {
    pantryState.actionError = null;
    pantryState.error = null;
    pantryState.hasData = true;
    pantryState.isPending = false;
    pantryState.stock = {};
    localStorage.clear();
    __resetShoppingListForTests();
    addRecipe("garlic-pasta");
  });

  afterEach(() => {
    __resetShoppingListForTests();
  });

  it("keeps the local list visible while pantry classification is pending", () => {
    pantryState.isPending = true;

    render(<ShoppingList recipes={recipes} />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking your pantry before sorting the shopping list…",
    );
    expect(screen.getByText("garlic")).toBeInTheDocument();
    const pendingList = screen.getByText("garlic").closest("[aria-busy]");
    expect(pendingList).toHaveAttribute("aria-busy", "true");
    expect(pendingList).toHaveAttribute("inert");
  });

  it("shows the full local list when pantry loading fails", () => {
    pantryState.error = new Error("load failed");
    pantryState.hasData = false;

    render(<ShoppingList recipes={recipes} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "full shopping list without kitchen filtering",
    );
    expect(screen.getByText("garlic")).toBeInTheDocument();
  });

  it("uses the last pantry snapshot when a refresh fails", () => {
    pantryState.stock = { garlic: "fridge" };
    pantryState.error = new Error("refresh failed");

    render(<ShoppingList recipes={recipes} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "using the last pantry data that loaded",
    );
    expect(
      screen.getByRole("heading", { name: /already have/i }),
    ).toBeInTheDocument();
  });

  it("keeps the refresh notice below the buy list so it cannot reflow the rows", () => {
    pantryState.error = new Error("refresh failed");

    render(<ShoppingList recipes={recipes} />);

    const garlicRow = screen.getByRole("button", { name: /garlic/i });
    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent("using the last pantry data that loaded");
    expect(
      garlicRow.compareDocumentPosition(notice) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("explains why an optimistic pantry removal was restored", () => {
    pantryState.stock = { garlic: "fridge" };
    pantryState.actionError = new Error("delete failed");

    render(<ShoppingList recipes={recipes} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "pantry change was not saved",
    );
  });

  it("does not let stocked salted butter hide unsalted butter", () => {
    __resetShoppingListForTests();
    addRecipe("salted-butter-dish");
    addRecipe("unsalted-butter-dish");
    pantryState.stock = { "salted-butter": "fridge" };

    render(<ShoppingList recipes={butterRecipes} />);

    expect(
      screen.getByRole("button", { name: /200g unsalted butter/i }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", {
        name: /remove salted butter from the kitchen/i,
      }),
    ).toBeInTheDocument();
  });
});

describe("ShoppingList extras", () => {
  beforeEach(() => {
    pantryState.actionError = null;
    pantryState.error = null;
    pantryState.hasData = true;
    pantryState.isPending = false;
    pantryState.stock = {};
    localStorage.clear();
    __resetShoppingListForTests();
    addRecipe("garlic-pasta");
    addExtra("bread");
  });

  afterEach(() => {
    __resetShoppingListForTests();
  });

  it("can start an empty list with a manually entered item", async () => {
    __resetShoppingListForTests();
    const user = userEvent.setup();
    render(<ShoppingList recipes={recipes} />);

    const input = screen.getByRole("textbox", {
      name: "Add a shopping-list item",
    });
    await user.type(input, "milk");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByText("milk")).toBeInTheDocument();
  });

  it("mixes extras into the ingredient-only list", async () => {
    const user = userEvent.setup();
    render(<ShoppingList recipes={recipes} />);

    await user.click(screen.getByText("just ingredients"));

    expect(
      screen.queryByRole("heading", { name: /extras/i }),
    ).not.toBeInTheDocument();
    const uncheckedRows = screen.getAllByRole("button", { pressed: false });
    expect(uncheckedRows.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/bread/i),
      expect.stringMatching(/garlic/i),
    ]);

    await user.click(screen.getByRole("button", { name: "bread" }));

    expect(
      screen
        .getAllByRole("button", { pressed: false })
        .map((row) => row.textContent),
    ).toEqual([expect.stringMatching(/garlic/i)]);
    expect(
      screen
        .getAllByRole("button", { pressed: true })
        .map((row) => row.textContent),
    ).toEqual([expect.stringMatching(/bread/i)]);
  });

  it("keeps kitchen-stocked ingredients out of the flat list", async () => {
    pantryState.stock = { garlic: "fridge" };
    const user = userEvent.setup();
    render(<ShoppingList recipes={recipes} />);

    await user.click(screen.getByText("just ingredients"));

    expect(
      screen
        .getAllByRole("button", { pressed: false })
        .map((row) => row.textContent),
    ).toEqual([expect.stringMatching(/bread/i)]);
    expect(
      screen.getByRole("heading", { name: /already have/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("garlic")).toBeInTheDocument();
  });

  it("keeps the extra input focused after adding an item", async () => {
    const user = userEvent.setup();
    render(<ShoppingList recipes={recipes} />);

    const input = screen.getByRole("textbox", {
      name: "Add a shopping-list item",
    });
    await user.clear(input);
    await user.type(input, "milk");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(input).toHaveFocus();
    expect(input).toHaveValue("");
    expect(screen.getByText("milk")).toBeInTheDocument();
  });
});
