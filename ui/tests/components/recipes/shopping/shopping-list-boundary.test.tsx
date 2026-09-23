import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecipeShoppingListButton } from "@/components/recipes/recipe-shopping-list-button";
import {
  ShoppingListBoundary,
  useStartNewShoppingList,
} from "@/components/recipes/shopping/shopping-list-boundary";
import { ApiError } from "@/lib/api/http";
import type { StoredShoppingList } from "@/lib/api/shopping-lists";
import {
  addExtra,
  getShoppingListSnapshot,
  setPlannedMeal,
  toggleChecked,
} from "@/lib/shopping/shoppingListStore";
import { __resetShoppingListForTests } from "@/tests/support/recipe-state";

const mocks = vi.hoisted(() => ({
  captureRecipeProductActivity: vi.fn(),
  getCurrentShoppingList: vi.fn(),
  saveCurrentShoppingList: vi.fn(),
  startNewShoppingList: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

vi.mock("@/lib/analytics/recipe-product", () => ({
  captureRecipeProductActivity: mocks.captureRecipeProductActivity,
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: { user: { id: "user-1" } },
      isPending: false,
    }),
  },
}));

vi.mock("@/lib/api/shopping-lists", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/shopping-lists")>()),
  getCurrentShoppingList: mocks.getCurrentShoppingList,
  saveCurrentShoppingList: mocks.saveCurrentShoppingList,
  startNewShoppingList: mocks.startNewShoppingList,
}));

const emptySnapshot = { recipes: [], checked: [], extras: [] };
const storedList = {
  id: "00000000-0000-4000-8000-000000000080",
  resourceId: "user-1",
  revision: "0",
  scope: { type: "personal" as const },
  snapshot: emptySnapshot,
  createdAt: "2026-08-20T08:00:00.000Z",
  updatedAt: "2026-08-20T08:00:00.000Z",
};

function renderWithQueryClient(element: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>,
  );
  return { ...result, queryClient };
}

async function waitForInstalledList() {
  await waitFor(
    () => {
      const saved = JSON.parse(
        localStorage.getItem("recipe-shopping-list:v1") ?? "{}",
      ) as { listId?: string };
      expect(saved.listId).toBe(storedList.id);
    },
    { timeout: 5_000 },
  );
}

function StartNewButton() {
  const startNew = useStartNewShoppingList();
  return (
    <button type="button" onClick={startNew.start}>
      Start new
    </button>
  );
}

let statefulChildMounts = 0;

function StatefulStartNewButton() {
  const startNew = useStartNewShoppingList();
  const [view, setView] = useState("plan");
  const [mountNumber] = useState(() => {
    statefulChildMounts += 1;
    return statefulChildMounts;
  });
  return (
    <div>
      <p data-testid="current-view" data-mount={mountNumber}>
        Current view: {view}
      </p>
      <button type="button" onClick={() => setView("list")}>
        Show list
      </button>
      <button type="button" onClick={startNew.start}>
        Start new
      </button>
    </div>
  );
}

describe("ShoppingListBoundary", { timeout: 10_000 }, () => {
  beforeEach(() => {
    __resetShoppingListForTests();
    localStorage.clear();
    statefulChildMounts = 0;
    vi.clearAllMocks();
    mocks.getCurrentShoppingList.mockResolvedValue(storedList);
    mocks.saveCurrentShoppingList.mockResolvedValue(storedList);
    mocks.startNewShoppingList.mockResolvedValue({
      ...storedList,
      id: "00000000-0000-4000-8000-000000000081",
    });
  });

  it("installs the server list, keeps the local meal plan separate, and saves edits", async () => {
    mocks.saveCurrentShoppingList.mockResolvedValue({
      ...storedList,
      revision: "1",
    });
    localStorage.setItem("recipe-shopping-plan-resource", "user-1");
    setPlannedMeal("fri", "dinner", "tomato-soup");
    const { queryClient } = renderWithQueryClient(
      <ShoppingListBoundary>
        <p>List ready</p>
      </ShoppingListBoundary>,
    );

    expect(await screen.findByText("List ready")).toBeInTheDocument();
    await waitForInstalledList();
    expect(getShoppingListSnapshot().plan).toEqual([
      { day: "fri", slot: "dinner", slug: "tomato-soup" },
    ]);

    act(() => addExtra("Milk"));
    await waitFor(
      () =>
        expect(mocks.saveCurrentShoppingList).toHaveBeenCalledWith(
          storedList.id,
          storedList.revision,
          expect.objectContaining({
            extras: [expect.objectContaining({ text: "Milk" })],
          }),
        ),
      { timeout: 5_000 },
    );
    expect(mocks.saveCurrentShoppingList.mock.calls[0]?.[2]).not.toHaveProperty(
      "plan",
    );
    expect(
      queryClient.getQueryData<StoredShoppingList>([
        "recipes",
        "private",
        "user-1",
        "shopping-list",
      ])?.revision,
    ).toBe("1");
  });

  it("keeps a recipe-page addition and its servings when the shopping route mounts", async () => {
    const updatedList = {
      ...storedList,
      revision: "1",
      snapshot: {
        ...emptySnapshot,
        recipes: [{ slug: "weeknight", servings: 4 }],
      },
    };
    mocks.saveCurrentShoppingList.mockResolvedValue(updatedList);
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const recipePage = render(
      <QueryClientProvider client={queryClient}>
        <RecipeShoppingListButton
          recipeSlug="weeknight"
          servings={4}
          userId="user-1"
        />
      </QueryClientProvider>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Add to shopping list" }),
    );
    expect(
      await screen.findByRole("button", { name: "On shopping list" }),
    ).toBeInTheDocument();
    expect(mocks.saveCurrentShoppingList).toHaveBeenCalledWith(
      storedList.id,
      storedList.revision,
      updatedList.snapshot,
    );
    recipePage.unmount();

    render(
      <QueryClientProvider client={queryClient}>
        <ShoppingListBoundary>
          <p>List ready</p>
        </ShoppingListBoundary>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("List ready")).toBeInTheDocument();
    expect(getShoppingListSnapshot().recipes).toEqual([
      { slug: "weeknight", servings: 4 },
    ]);
    expect(mocks.captureRecipeProductActivity).toHaveBeenCalledWith(
      "shopping_recipe_added",
      {
        recipe_slug: "weeknight",
        shopping_recipe_count: 1,
      },
    );
  });

  it("removes a recipe through the same server-backed action", async () => {
    const selectedList = {
      ...storedList,
      snapshot: {
        ...emptySnapshot,
        recipes: [{ slug: "weeknight" }],
      },
    };
    const updatedList = {
      ...selectedList,
      revision: "1",
      snapshot: emptySnapshot,
    };
    mocks.getCurrentShoppingList.mockResolvedValue(selectedList);
    mocks.saveCurrentShoppingList.mockResolvedValue(updatedList);
    renderWithQueryClient(
      <RecipeShoppingListButton
        recipeSlug="weeknight"
        servings={2}
        userId="user-1"
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "On shopping list" }),
    );

    expect(
      await screen.findByRole("button", { name: "Add to shopping list" }),
    ).toBeInTheDocument();
    expect(mocks.saveCurrentShoppingList).toHaveBeenCalledWith(
      storedList.id,
      storedList.revision,
      emptySnapshot,
    );
    expect(mocks.captureRecipeProductActivity).not.toHaveBeenCalled();
  });

  it("accepts a concurrent add without writing a duplicate", async () => {
    const remotelyUpdatedList = {
      ...storedList,
      revision: "1",
      snapshot: {
        ...emptySnapshot,
        recipes: [{ slug: "weeknight" }],
      },
    };
    mocks.getCurrentShoppingList
      .mockResolvedValueOnce(storedList)
      .mockResolvedValue(remotelyUpdatedList);
    renderWithQueryClient(
      <RecipeShoppingListButton
        recipeSlug="weeknight"
        servings={2}
        userId="user-1"
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Add to shopping list" }),
    );

    expect(
      await screen.findByRole("button", { name: "On shopping list" }),
    ).toBeInTheDocument();
    expect(mocks.saveCurrentShoppingList).not.toHaveBeenCalled();
    expect(mocks.captureRecipeProductActivity).not.toHaveBeenCalled();
  });

  it("reports a conflicting recipe-page save and refreshes the list", async () => {
    mocks.saveCurrentShoppingList.mockRejectedValue(
      new ApiError("Shopping list changed", 409),
    );
    renderWithQueryClient(
      <RecipeShoppingListButton
        recipeSlug="weeknight"
        servings={2}
        userId="user-1"
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Add to shopping list" }),
    );

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "The recipe could not be added to your shopping list.",
      ),
    );
    expect(mocks.getCurrentShoppingList).toHaveBeenCalledTimes(3);
    expect(
      await screen.findByRole("button", { name: "Add to shopping list" }),
    ).toBeInTheDocument();
  });

  it("disables the recipe action when the shopping list cannot load", async () => {
    mocks.getCurrentShoppingList.mockRejectedValue(new Error("offline"));
    renderWithQueryClient(
      <RecipeShoppingListButton
        recipeSlug="weeknight"
        servings={2}
        userId="user-1"
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Shopping list unavailable" }),
    ).toBeDisabled();
    expect(mocks.saveCurrentShoppingList).not.toHaveBeenCalled();
  });

  it("saves a rapid check then uncheck against advancing revisions", async () => {
    mocks.saveCurrentShoppingList
      .mockResolvedValueOnce({ ...storedList, revision: "1" })
      .mockResolvedValueOnce({ ...storedList, revision: "2" });
    renderWithQueryClient(
      <ShoppingListBoundary>
        <p>List ready</p>
      </ShoppingListBoundary>,
    );
    await screen.findByText("List ready");

    act(() => toggleChecked("garlic"));
    await waitFor(() =>
      expect(mocks.saveCurrentShoppingList).toHaveBeenCalledTimes(1),
    );
    act(() => toggleChecked("garlic"));

    await waitFor(() =>
      expect(mocks.saveCurrentShoppingList).toHaveBeenNthCalledWith(
        2,
        storedList.id,
        "1",
        expect.objectContaining({ checked: [] }),
      ),
    );
    expect(getShoppingListSnapshot().checked).toEqual([]);
  });

  it("does not resave a change received from another tab", async () => {
    renderWithQueryClient(
      <ShoppingListBoundary>
        <p>List ready</p>
      </ShoppingListBoundary>,
    );
    await screen.findByText("List ready");
    await waitForInstalledList();
    mocks.saveCurrentShoppingList.mockClear();

    act(() => {
      globalThis.dispatchEvent(
        new StorageEvent("storage", {
          key: "recipe-shopping-list:v1",
          newValue: JSON.stringify({
            ...emptySnapshot,
            checked: ["garlic"],
            listId: storedList.id,
          }),
        }),
      );
    });

    await waitFor(
      () => expect(getShoppingListSnapshot().checked).toEqual(["garlic"]),
      { timeout: 5_000 },
    );
    expect(mocks.saveCurrentShoppingList).not.toHaveBeenCalled();
  });

  it("refreshes the revision before saving a cross-tab change", async () => {
    const remoteList = {
      ...storedList,
      revision: "1",
      snapshot: {
        ...emptySnapshot,
        extras: [{ id: "extra-bread", text: "Bread", checked: false }],
      },
    };
    mocks.getCurrentShoppingList
      .mockResolvedValueOnce(storedList)
      .mockResolvedValue(remoteList);
    mocks.saveCurrentShoppingList.mockResolvedValue({
      ...remoteList,
      revision: "2",
    });
    renderWithQueryClient(
      <ShoppingListBoundary>
        <p>List ready</p>
      </ShoppingListBoundary>,
    );
    await screen.findByText("List ready");

    act(() => {
      globalThis.dispatchEvent(
        new StorageEvent("storage", {
          key: "recipe-shopping-list:v1",
          newValue: JSON.stringify({
            ...remoteList.snapshot,
            listId: storedList.id,
          }),
        }),
      );
    });
    await waitFor(
      () => expect(mocks.getCurrentShoppingList).toHaveBeenCalledTimes(2),
      { timeout: 2_000 },
    );
    act(() => addExtra("Milk"));

    await waitFor(
      () =>
        expect(mocks.saveCurrentShoppingList).toHaveBeenCalledWith(
          storedList.id,
          "1",
          expect.objectContaining({
            extras: expect.arrayContaining([
              expect.objectContaining({ text: "Bread" }),
              expect.objectContaining({ text: "Milk" }),
            ]),
          }),
        ),
      { timeout: 2_000 },
    );
  });

  it("rebases a local edit and retries after a revision conflict", async () => {
    const remoteList = {
      ...storedList,
      revision: "1",
      snapshot: {
        ...emptySnapshot,
        extras: [{ id: "extra-bread", text: "Bread", checked: false }],
      },
    };
    mocks.getCurrentShoppingList
      .mockResolvedValueOnce(storedList)
      .mockResolvedValue(remoteList);
    mocks.saveCurrentShoppingList
      .mockRejectedValueOnce(new ApiError("conflict", 409))
      .mockResolvedValueOnce({ ...remoteList, revision: "2" });
    renderWithQueryClient(
      <ShoppingListBoundary>
        <p>List ready</p>
      </ShoppingListBoundary>,
    );
    await screen.findByText("List ready");

    act(() => addExtra("Milk"));

    await waitFor(
      () =>
        expect(mocks.saveCurrentShoppingList).toHaveBeenNthCalledWith(
          2,
          storedList.id,
          "1",
          expect.objectContaining({
            extras: expect.arrayContaining([
              expect.objectContaining({ text: "Bread" }),
              expect.objectContaining({ text: "Milk" }),
            ]),
          }),
        ),
      { timeout: 5_000 },
    );
  });

  it("clears a local meal plan owned by another shopping-list scope", async () => {
    localStorage.setItem("recipe-shopping-plan-resource", "other-user");
    setPlannedMeal("fri", "dinner", "private-recipe");

    renderWithQueryClient(
      <ShoppingListBoundary>
        <p>List ready</p>
      </ShoppingListBoundary>,
    );

    await screen.findByText("List ready");
    expect(getShoppingListSnapshot().plan).toEqual([]);
  });

  it("loads the server list when local plan storage is unavailable", async () => {
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementationOnce(() => {
        throw new DOMException("storage unavailable");
      });
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementationOnce(() => {
        throw new DOMException("storage unavailable");
      });

    renderWithQueryClient(
      <ShoppingListBoundary>
        <p>List ready</p>
      </ShoppingListBoundary>,
    );

    expect(await screen.findByText("List ready")).toBeInTheDocument();
    expect(getShoppingListSnapshot().plan).toEqual([]);
    getItem.mockRestore();
    setItem.mockRestore();
  });

  it("keeps failed edits local and shows that they are unsaved", async () => {
    mocks.saveCurrentShoppingList.mockRejectedValue(new Error("conflict"));
    renderWithQueryClient(
      <ShoppingListBoundary>
        <p>List ready</p>
      </ShoppingListBoundary>,
    );
    await screen.findByText("List ready");

    act(() => addExtra("Milk"));

    expect(
      await screen.findByText(
        /latest shopping-list changes have not been saved/i,
        {},
        { timeout: 3_000 },
      ),
    ).toBeInTheDocument();
    expect(getShoppingListSnapshot().extras).toEqual([
      expect.objectContaining({ text: "Milk" }),
    ]);
  });

  it("clears immediately, then archives the loaded list", async () => {
    let finishStarting: ((list: StoredShoppingList) => void) | undefined;
    mocks.startNewShoppingList.mockImplementation(
      () =>
        new Promise<StoredShoppingList>((resolve) => {
          finishStarting = resolve;
        }),
    );
    renderWithQueryClient(
      <ShoppingListBoundary>
        <StartNewButton />
      </ShoppingListBoundary>,
    );
    await screen.findByRole("button", { name: "Start new" });
    act(() => addExtra("Milk"));

    fireEvent.click(screen.getByRole("button", { name: "Start new" }));

    expect(getShoppingListSnapshot()).toEqual({
      recipes: [],
      plan: [],
      checked: [],
      extras: [],
    });
    expect(
      JSON.parse(localStorage.getItem("recipe-shopping-list:v1") ?? "{}"),
    ).toEqual(
      expect.objectContaining({
        extras: [expect.objectContaining({ text: "Milk" })],
        listId: storedList.id,
      }),
    );
    await waitFor(() =>
      expect(mocks.startNewShoppingList).toHaveBeenCalledWith(
        storedList.id,
        storedList.revision,
        expect.objectContaining({
          extras: [expect.objectContaining({ text: "Milk" })],
        }),
      ),
    );
    expect(mocks.saveCurrentShoppingList).not.toHaveBeenCalled();

    act(() =>
      finishStarting?.({
        ...storedList,
        id: "00000000-0000-4000-8000-000000000081",
      }),
    );
    await waitFor(() =>
      expect(getShoppingListSnapshot()).toEqual({
        recipes: [],
        plan: [],
        checked: [],
        extras: [],
      }),
    );
  });

  it("keeps child view state while installing the replacement list", async () => {
    const nextListId = "00000000-0000-4000-8000-000000000081";
    renderWithQueryClient(
      <ShoppingListBoundary>
        <StatefulStartNewButton />
      </ShoppingListBoundary>,
    );
    await screen.findByRole("button", { name: "Show list" });
    fireEvent.click(screen.getByRole("button", { name: "Show list" }));
    expect(screen.getByTestId("current-view")).toHaveTextContent(
      "Current view: list",
    );
    act(() => addExtra("Milk"));

    fireEvent.click(screen.getByRole("button", { name: "Start new" }));

    await waitFor(() => {
      const stored = JSON.parse(
        localStorage.getItem("recipe-shopping-list:v1") ?? "{}",
      ) as { listId?: string };
      expect(stored.listId).toBe(nextListId);
    });
    expect(screen.getByTestId("current-view")).toHaveTextContent(
      "Current view: list",
    );
    expect(screen.getByTestId("current-view")).toHaveAttribute(
      "data-mount",
      "1",
    );
  });

  it("carries unsaved edits into a replacement list without dropping remote items", async () => {
    const nextList = {
      ...storedList,
      id: "00000000-0000-4000-8000-000000000081",
      snapshot: {
        ...emptySnapshot,
        extras: [{ id: "extra-bread", text: "Bread", checked: false }],
      },
    };
    const { queryClient } = renderWithQueryClient(
      <ShoppingListBoundary>
        <p>List ready</p>
      </ShoppingListBoundary>,
    );
    await screen.findByText("List ready");
    act(() => addExtra("Milk"));

    act(() => {
      queryClient.setQueryData(
        ["recipes", "private", "user-1", "shopping-list"],
        nextList,
      );
    });

    await waitFor(
      () =>
        expect(mocks.saveCurrentShoppingList).toHaveBeenCalledWith(
          nextList.id,
          nextList.revision,
          expect.objectContaining({
            extras: expect.arrayContaining([
              expect.objectContaining({ text: "Bread" }),
              expect.objectContaining({ text: "Milk" }),
            ]),
          }),
        ),
      { timeout: 2_000 },
    );
  });

  it("archives against the revision from a save already in flight", async () => {
    let finishSaving: ((list: StoredShoppingList) => void) | undefined;
    mocks.saveCurrentShoppingList.mockImplementation(
      () =>
        new Promise<StoredShoppingList>((resolve) => {
          finishSaving = resolve;
        }),
    );
    renderWithQueryClient(
      <ShoppingListBoundary>
        <StartNewButton />
      </ShoppingListBoundary>,
    );
    await screen.findByRole("button", { name: "Start new" });
    act(() => addExtra("Milk"));
    await waitFor(
      () => expect(mocks.saveCurrentShoppingList).toHaveBeenCalledOnce(),
      { timeout: 5_000 },
    );

    fireEvent.click(screen.getByRole("button", { name: "Start new" }));

    expect(getShoppingListSnapshot().extras).toEqual([]);
    expect(mocks.startNewShoppingList).not.toHaveBeenCalled();

    act(() =>
      finishSaving?.({
        ...storedList,
        revision: "1",
        snapshot:
          mocks.saveCurrentShoppingList.mock.calls[0]?.[2] ?? emptySnapshot,
      }),
    );
    await waitFor(() =>
      expect(mocks.startNewShoppingList).toHaveBeenCalledWith(
        storedList.id,
        "1",
        expect.objectContaining({
          extras: [expect.objectContaining({ text: "Milk" })],
        }),
      ),
    );
  });

  it("keeps a replacement list when the previous list finishes saving", async () => {
    let finishSaving: ((list: StoredShoppingList) => void) | undefined;
    mocks.saveCurrentShoppingList.mockImplementation(
      () =>
        new Promise<StoredShoppingList>((resolve) => {
          finishSaving = resolve;
        }),
    );
    const { queryClient } = renderWithQueryClient(
      <ShoppingListBoundary>
        <p>List ready</p>
      </ShoppingListBoundary>,
    );
    await screen.findByText("List ready");
    act(() => addExtra("Milk"));
    await waitFor(() =>
      expect(mocks.saveCurrentShoppingList).toHaveBeenCalledOnce(),
    );

    const { recipes, checked, extras } = getShoppingListSnapshot();
    const nextList = {
      ...storedList,
      id: "00000000-0000-4000-8000-000000000081",
      snapshot: { recipes, checked, extras },
    };
    act(() => {
      queryClient.setQueryData(
        ["recipes", "private", "user-1", "shopping-list"],
        nextList,
      );
    });
    await waitFor(() =>
      expect(
        JSON.parse(localStorage.getItem("recipe-shopping-list:v1") ?? "{}"),
      ).toEqual(expect.objectContaining({ listId: nextList.id })),
    );

    act(() =>
      finishSaving?.({
        ...storedList,
        revision: "1",
        snapshot:
          mocks.saveCurrentShoppingList.mock.calls[0]?.[2] ?? emptySnapshot,
      }),
    );

    await waitFor(() =>
      expect(
        queryClient.getQueryData<StoredShoppingList>([
          "recipes",
          "private",
          "user-1",
          "shopping-list",
        ])?.id,
      ).toBe(nextList.id),
    );
  });

  it("restores the previous list when starting a new one fails", async () => {
    mocks.startNewShoppingList.mockRejectedValue(new Error("offline"));
    renderWithQueryClient(
      <ShoppingListBoundary>
        <StartNewButton />
      </ShoppingListBoundary>,
    );
    await screen.findByRole("button", { name: "Start new" });
    act(() => addExtra("Milk"));

    fireEvent.click(screen.getByRole("button", { name: "Start new" }));

    expect(getShoppingListSnapshot().extras).toEqual([]);
    await waitFor(() =>
      expect(getShoppingListSnapshot().extras).toEqual([
        expect.objectContaining({ text: "Milk" }),
      ]),
    );
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(mocks.saveCurrentShoppingList).not.toHaveBeenCalled();
  });

  it("does not overwrite local edits when the loaded list refetches", async () => {
    const { queryClient } = renderWithQueryClient(
      <ShoppingListBoundary>
        <p>List ready</p>
      </ShoppingListBoundary>,
    );
    await screen.findByText("List ready");

    act(() => addExtra("Milk"));
    act(() => {
      queryClient.setQueryData(
        ["recipes", "private", "user-1", "shopping-list"],
        { ...storedList, revision: "1" },
      );
    });

    expect(getShoppingListSnapshot().extras).toEqual([
      expect.objectContaining({ text: "Milk" }),
    ]);
  });

  it("restores the saved cache after a stale refetch", async () => {
    mocks.saveCurrentShoppingList.mockResolvedValue({
      ...storedList,
      revision: "1",
      snapshot: { ...emptySnapshot, checked: ["garlic"] },
    });
    const { queryClient } = renderWithQueryClient(
      <ShoppingListBoundary>
        <p>List ready</p>
      </ShoppingListBoundary>,
    );
    await screen.findByText("List ready");
    await waitForInstalledList();

    act(() => toggleChecked("garlic"));
    await waitFor(() =>
      expect(
        queryClient.getQueryData<StoredShoppingList>([
          "recipes",
          "private",
          "user-1",
          "shopping-list",
        ])?.revision,
      ).toBe("1"),
    );
    mocks.saveCurrentShoppingList.mockClear();

    act(() => {
      queryClient.setQueryData(
        ["recipes", "private", "user-1", "shopping-list"],
        storedList,
      );
    });

    await waitFor(() =>
      expect(
        queryClient.getQueryData<StoredShoppingList>([
          "recipes",
          "private",
          "user-1",
          "shopping-list",
        ]),
      ).toEqual(
        expect.objectContaining({
          revision: "1",
          snapshot: expect.objectContaining({ checked: ["garlic"] }),
        }),
      ),
    );

    act(() => addExtra("Milk"));

    await waitFor(() =>
      expect(mocks.saveCurrentShoppingList).toHaveBeenCalledWith(
        storedList.id,
        "1",
        expect.objectContaining({
          checked: ["garlic"],
          extras: [expect.objectContaining({ text: "Milk" })],
        }),
      ),
    );
  });

  it("shows a load error instead of an editable local list", async () => {
    mocks.getCurrentShoppingList.mockRejectedValue(new Error("offline"));

    renderWithQueryClient(
      <ShoppingListBoundary>
        <p>List ready</p>
      </ShoppingListBoundary>,
    );

    expect(
      await screen.findByText("Your shopping list could not be loaded."),
    ).toBeInTheDocument();
    expect(screen.queryByText("List ready")).not.toBeInTheDocument();
  });
});
