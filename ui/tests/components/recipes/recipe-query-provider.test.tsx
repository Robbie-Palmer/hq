import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OfflineRecipeCacheBoundary,
  RecipeAccountCacheBoundary,
  RecipeQueryProvider,
} from "@/components/recipes/recipe-query-provider";
import type { RecipeBootstrap } from "@/lib/api/recipe-bootstrap";
import type { StoredShoppingList } from "@/lib/api/shopping-lists";
import { recipeQueryKeys } from "@/lib/query/recipe-query-keys";
import { restoreOfflineShoppingListQuery } from "@/lib/query/shopping-list-queries";

const authMocks = vi.hoisted(() => ({
  session: {
    data: { user: { id: "user-1" } },
    isPending: false,
  } as {
    data: { user: { id: string } } | null;
    isPending: boolean;
  },
}));

const offlineMocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  saveShopping: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => authMocks.session,
  },
}));

vi.mock("@/lib/pwa/offline-recipe-cache", () => ({
  loadOfflineRecipeSnapshot: offlineMocks.load,
  saveOfflineRecipeSnapshot: offlineMocks.save,
  saveOfflineShoppingListSnapshot: offlineMocks.saveShopping,
}));

const shoppingList = {
  id: "list-1",
  resourceId: "user-1",
  revision: "1",
  scope: { type: "personal" as const },
  snapshot: { recipes: [], checked: [], extras: [] },
  createdAt: "2026-10-18T00:00:00.000Z",
  updatedAt: "2026-10-18T00:00:00.000Z",
} satisfies StoredShoppingList;

describe("RecipeAccountCacheBoundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.session = {
      data: { user: { id: "user-1" } },
      isPending: false,
    };
    offlineMocks.load.mockResolvedValue(null);
    offlineMocks.save.mockResolvedValue(undefined);
    offlineMocks.saveShopping.mockResolvedValue(undefined);
  });

  it("keeps only the current account's private cache", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      recipeQueryKeys.recipeBoxRecipes("user-1"),
      "first",
    );
    queryClient.setQueryData(
      recipeQueryKeys.recipeBoxRecipes("user-2"),
      "second",
    );
    queryClient.setQueryData(recipeQueryKeys.publicRecipes(), "public");
    const view = render(
      <QueryClientProvider client={queryClient}>
        <RecipeAccountCacheBoundary />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(
        queryClient.getQueryData(recipeQueryKeys.recipeBoxRecipes("user-2")),
      ).toBeUndefined();
    });
    expect(
      queryClient.getQueryData(recipeQueryKeys.recipeBoxRecipes("user-1")),
    ).toBe("first");
    expect(queryClient.getQueryData(recipeQueryKeys.publicRecipes())).toBe(
      "public",
    );

    authMocks.session = {
      data: { user: { id: "user-2" } },
      isPending: false,
    };
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <RecipeAccountCacheBoundary />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(
        queryClient.getQueryData(recipeQueryKeys.recipeBoxRecipes("user-1")),
      ).toBeUndefined();
    });
    expect(queryClient.getQueryData(recipeQueryKeys.publicRecipes())).toBe(
      "public",
    );
  });

  it("retains the browser cache when the recipe layout remounts", () => {
    let firstClient: QueryClient | undefined;
    let secondClient: QueryClient | undefined;

    function FirstProbe() {
      firstClient = useQueryClient();
      return null;
    }

    function SecondProbe() {
      secondClient = useQueryClient();
      return null;
    }

    const firstView = render(
      <RecipeQueryProvider>
        <FirstProbe />
      </RecipeQueryProvider>,
    );
    firstClient?.setQueryData(recipeQueryKeys.publicRecipes(), "cached");
    firstView.unmount();

    render(
      <RecipeQueryProvider>
        <SecondProbe />
      </RecipeQueryProvider>,
    );

    expect(secondClient).toBe(firstClient);
    expect(secondClient?.getQueryData(recipeQueryKeys.publicRecipes())).toBe(
      "cached",
    );
  });

  it("restores the current user's offline recipe snapshot", async () => {
    const queryClient = new QueryClient();
    const bootstrap = {
      recipeBox: {
        recipes: [{ slug: "lentil-soup" }],
        box: { completed: true, recipeSlugs: [] },
      },
      diet: { profile: {}, options: {} },
      unreadNotificationCount: 0,
    } as unknown as RecipeBootstrap;
    offlineMocks.load.mockResolvedValue({
      version: 2,
      key: "recipes:user-1",
      kind: "recipes",
      scope: {
        userId: "user-1",
        householdId: null,
        resourceId: null,
      },
      savedAt: 123,
      bootstrap,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <OfflineRecipeCacheBoundary />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(
        queryClient.getQueryData(recipeQueryKeys.bootstrap("user-1")),
      ).toBe(bootstrap);
    });
    expect(
      queryClient.getQueryState(recipeQueryKeys.bootstrap("user-1"))
        ?.dataUpdatedAt,
    ).toBe(123);
    expect(offlineMocks.save).not.toHaveBeenCalled();
  });

  it("persists a fresh bootstrap result for the active account", async () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <OfflineRecipeCacheBoundary />
      </QueryClientProvider>,
    );
    const bootstrap = {
      recipeBox: { recipes: [] },
    } as unknown as RecipeBootstrap;

    queryClient.setQueryData(recipeQueryKeys.bootstrap("user-1"), bootstrap);

    await waitFor(() => {
      expect(offlineMocks.save).toHaveBeenCalledWith("user-1", bootstrap);
    });
  });

  it("persists shopping-list cache updates for the active account", async () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <OfflineRecipeCacheBoundary />
      </QueryClientProvider>,
    );
    queryClient.setQueryData(
      recipeQueryKeys.shoppingList("user-1"),
      shoppingList,
    );

    await waitFor(() => {
      expect(offlineMocks.saveShopping).toHaveBeenCalledWith(
        "user-1",
        shoppingList,
      );
    });
  });

  it("does not refresh persistence when restoring an offline shopping list", async () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <OfflineRecipeCacheBoundary />
      </QueryClientProvider>,
    );
    restoreOfflineShoppingListQuery(queryClient, "user-1", shoppingList, 123);

    await waitFor(() => {
      expect(
        queryClient.getQueryState(recipeQueryKeys.shoppingList("user-1"))
          ?.dataUpdatedAt,
      ).toBe(123);
    });
    expect(offlineMocks.saveShopping).not.toHaveBeenCalled();
  });

  it("ignores late shopping updates after the active account signs out", async () => {
    const queryClient = new QueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <OfflineRecipeCacheBoundary />
      </QueryClientProvider>,
    );
    queryClient.setQueryData(
      recipeQueryKeys.shoppingList("user-1"),
      shoppingList,
    );
    await waitFor(() => {
      expect(offlineMocks.saveShopping).toHaveBeenCalledTimes(1);
    });
    offlineMocks.saveShopping.mockClear();

    authMocks.session = { data: null, isPending: false };
    await act(async () => {
      view.rerender(
        <QueryClientProvider client={queryClient}>
          <OfflineRecipeCacheBoundary />
        </QueryClientProvider>,
      );
    });
    queryClient.setQueryData(recipeQueryKeys.shoppingList("user-1"), {
      ...shoppingList,
      revision: "2",
    });

    expect(offlineMocks.saveShopping).not.toHaveBeenCalled();
  });
});
