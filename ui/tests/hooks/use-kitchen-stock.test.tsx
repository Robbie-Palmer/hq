import {
  QueryClient,
  QueryClientProvider,
  type QueryClientProviderProps,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useKitchenStock,
  useKitchenStockActions,
  useKitchenStockQuery,
} from "@/hooks/use-kitchen-stock";
import type { Pantry } from "@/lib/api/pantry";
import { recipeQueryKeys } from "@/lib/query/recipe-query-keys";

const mocks = vi.hoisted(() => ({
  captureRecipeProductActivity: vi.fn(),
  getPantry: vi.fn(),
  removePantryItem: vi.fn(),
  replacePantry: vi.fn(),
  restorePantry: vi.fn(),
  session: {
    data: { user: { id: "user-1" } } as { user: { id: string } } | null,
    isPending: false,
  },
  setPantryItem: vi.fn(),
}));

vi.mock("@/lib/analytics/recipe-product", () => ({
  captureRecipeProductActivity: mocks.captureRecipeProductActivity,
}));

vi.mock("@/lib/api/pantry", () => ({
  getPantry: mocks.getPantry,
  removePantryItem: mocks.removePantryItem,
  replacePantry: mocks.replacePantry,
  restorePantry: mocks.restorePantry,
  setPantryItem: mocks.setPantryItem,
  installPantrySnapshot: (current: Pantry | undefined, incoming: Pantry) =>
    !current ||
    current.resourceId !== incoming.resourceId ||
    BigInt(incoming.revision) >= BigInt(current.revision)
      ? incoming
      : current,
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => mocks.session,
  },
}));

const personalPantry = (stock: Pantry["stock"], revision = "1"): Pantry => ({
  resourceId: "user-1",
  revision,
  scope: { type: "personal" },
  stock,
  itemVersions: Object.fromEntries(
    Object.keys(stock).map((ingredientSlug) => [ingredientSlug, "1"]),
  ),
});

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function wrapper(queryClient: QueryClient) {
  return function QueryWrapper({
    children,
  }: Readonly<Pick<QueryClientProviderProps, "children">>) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("useKitchenStockQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.data = { user: { id: "user-1" } };
    mocks.session.isPending = false;
  });

  it("loads persisted pantry stock for the signed-in user", async () => {
    const pantry = personalPantry({ onion: "fresh" });
    mocks.getPantry.mockResolvedValue(pantry);
    const queryClient = createQueryClient();

    const { result } = renderHook(() => useKitchenStockQuery(), {
      wrapper: wrapper(queryClient),
    });

    await waitFor(() => expect(result.current.data).toEqual(pantry));
    expect(mocks.getPantry).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it("stays disabled while the session is pending", () => {
    mocks.session.data = null;
    mocks.session.isPending = true;
    const queryClient = createQueryClient();

    const query = renderHook(() => useKitchenStockQuery(), {
      wrapper: wrapper(queryClient),
    });
    const stock = renderHook(() => useKitchenStock(), {
      wrapper: wrapper(queryClient),
    });

    expect(query.result.current.fetchStatus).toBe("idle");
    expect(stock.result.current).toEqual({});
    expect(mocks.getPantry).not.toHaveBeenCalled();
  });
});

describe("useKitchenStockActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.data = { user: { id: "user-1" } };
    mocks.session.isPending = false;
  });

  it("sets, removes, replaces, and clears stock in sequence", async () => {
    const queryClient = createQueryClient();
    const queryKey = recipeQueryKeys.pantry("user-1");
    queryClient.setQueryData(queryKey, personalPantry({ milk: "fridge" }));
    mocks.setPantryItem.mockResolvedValue(
      personalPantry({ milk: "fridge", onion: "fresh" }),
    );
    mocks.removePantryItem.mockResolvedValue(
      personalPantry({ onion: "fresh" }),
    );
    mocks.replacePantry
      .mockResolvedValueOnce(personalPantry({ egg: "cupboards" }))
      .mockResolvedValueOnce(personalPantry({}));
    mocks.restorePantry.mockResolvedValue(
      personalPantry({ milk: "fridge", onion: "fresh" }),
    );

    const { result } = renderHook(() => useKitchenStockActions(), {
      wrapper: wrapper(queryClient),
    });

    act(() => result.current.setStockLocation("onion", "fresh"));
    await waitFor(() =>
      expect(mocks.setPantryItem).toHaveBeenCalledWith(
        "onion",
        { location: "fresh" },
        expect.any(String),
      ),
    );
    await waitFor(() =>
      expect(queryClient.getQueryData(queryKey)).toEqual(
        personalPantry({ milk: "fridge", onion: "fresh" }),
      ),
    );
    expect(mocks.captureRecipeProductActivity).toHaveBeenCalledWith(
      "kitchen_ingredient_added",
      {
        ingredient_slug: "onion",
        kitchen_location: "fresh",
        stocked_ingredient_count: 2,
      },
    );

    act(() => result.current.removeFromStock("milk"));
    await waitFor(() =>
      expect(mocks.removePantryItem).toHaveBeenCalledWith(
        "milk",
        expect.any(String),
      ),
    );
    await waitFor(() =>
      expect(queryClient.getQueryData(queryKey)).toEqual(
        personalPantry({ onion: "fresh" }),
      ),
    );

    act(() => result.current.replaceStock({ egg: "cupboards" }));
    await waitFor(() =>
      expect(mocks.replacePantry).toHaveBeenCalledWith(
        { egg: "cupboards" },
        expect.any(String),
      ),
    );
    await waitFor(() =>
      expect(queryClient.getQueryData(queryKey)).toEqual(
        personalPantry({ egg: "cupboards" }),
      ),
    );

    act(() => result.current.clearStock());
    await waitFor(() =>
      expect(mocks.replacePantry).toHaveBeenCalledWith({}, expect.any(String)),
    );
    await waitFor(() =>
      expect(queryClient.getQueryData(queryKey)).toEqual(personalPantry({})),
    );

    act(() =>
      result.current.restoreStock({
        stock: { milk: "fridge", onion: "fresh" },
        items: {
          milk: {
            location: "fridge",
            quantity: { amount: 2, unit: "litres" },
            freshness: "fresh",
            source: {
              kind: "inferred",
              confidence: 0.9,
              provenance: "Receipt import",
            },
          },
          onion: {
            location: "fresh",
            quantity: null,
            freshness: "unknown",
            source: {
              kind: "user",
              confidence: 1,
              provenance: "Manual kitchen update",
            },
          },
        },
      }),
    );
    await waitFor(() =>
      expect(mocks.restorePantry).toHaveBeenCalledWith(
        {
          stock: { milk: "fridge", onion: "fresh" },
          items: {
            milk: {
              location: "fridge",
              quantity: { amount: 2, unit: "litres" },
              freshness: "fresh",
              source: {
                kind: "inferred",
                confidence: 0.9,
                provenance: "Receipt import",
              },
            },
            onion: {
              location: "fresh",
              quantity: null,
              freshness: "unknown",
              source: {
                kind: "user",
                confidence: 1,
                provenance: "Manual kitchen update",
              },
            },
          },
        },
        expect.any(String),
      ),
    );
    await waitFor(() =>
      expect(queryClient.getQueryData(queryKey)).toEqual(
        personalPantry({ milk: "fridge", onion: "fresh" }),
      ),
    );
    await waitFor(() => {
      expect(result.current.error).toBeNull();
      expect(result.current.isPending).toBe(false);
    });
  });

  it("rolls an optimistic update back when persistence fails", async () => {
    const queryClient = createQueryClient();
    const queryKey = recipeQueryKeys.pantry("user-1");
    const original = personalPantry({ milk: "fridge" });
    queryClient.setQueryData(queryKey, original);
    mocks.setPantryItem.mockRejectedValue(new Error("network unavailable"));

    const { result } = renderHook(() => useKitchenStockActions(), {
      wrapper: wrapper(queryClient),
    });

    act(() => result.current.setStockLocation("onion", "fresh"));

    await waitFor(() =>
      expect(result.current.error).toEqual(new Error("network unavailable")),
    );
    expect(queryClient.getQueryData(queryKey)).toEqual(original);
  });

  it("does not roll back over another cache writer at the same revision", async () => {
    const queryClient = createQueryClient();
    const queryKey = recipeQueryKeys.pantry("user-1");
    queryClient.setQueryData(queryKey, personalPantry({ milk: "fridge" }));
    let rejectMutation: ((error: Error) => void) | undefined;
    mocks.setPantryItem.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectMutation = reject;
        }),
    );
    const { result } = renderHook(() => useKitchenStockActions(), {
      wrapper: wrapper(queryClient),
    });

    act(() => result.current.setStockLocation("onion", "fresh"));
    await waitFor(() => expect(mocks.setPantryItem).toHaveBeenCalled());

    const independentlyInstalled = personalPantry({ egg: "cupboards" });
    act(() => queryClient.setQueryData(queryKey, independentlyInstalled));
    act(() => rejectMutation?.(new Error("network unavailable")));

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(queryClient.getQueryData(queryKey)).toEqual(independentlyInstalled);
  });

  it("sends rapid removals concurrently while canonical snapshots advance", async () => {
    const queryClient = createQueryClient();
    const queryKey = recipeQueryKeys.pantry("user-1");
    queryClient.setQueryData(
      queryKey,
      personalPantry({ egg: "cupboards", milk: "fridge", onion: "fresh" }),
    );
    const firstRemoval = deferred<Pantry>();
    const secondRemoval = deferred<Pantry>();
    mocks.removePantryItem
      .mockReturnValueOnce(firstRemoval.promise)
      .mockReturnValueOnce(secondRemoval.promise);

    const { result } = renderHook(
      () => ({
        actions: useKitchenStockActions(),
        pantry: useKitchenStockQuery(),
      }),
      { wrapper: wrapper(queryClient) },
    );

    act(() => {
      result.current.actions.removeFromStock("milk");
      result.current.actions.removeFromStock("egg");
    });

    await waitFor(() => {
      expect(result.current.pantry.data?.stock).toEqual({ onion: "fresh" });
      expect(mocks.removePantryItem).toHaveBeenCalledTimes(2);
    });
    expect(queryClient.getQueryData(queryKey)).toEqual(
      personalPantry({ egg: "cupboards", milk: "fridge", onion: "fresh" }),
    );

    act(() =>
      firstRemoval.resolve(
        personalPantry({ egg: "cupboards", onion: "fresh" }, "2"),
      ),
    );
    await waitFor(() => {
      expect(result.current.pantry.data?.stock).toEqual({ onion: "fresh" });
    });

    act(() => secondRemoval.resolve(personalPantry({ onion: "fresh" }, "3")));
    await waitFor(() => expect(result.current.actions.isPending).toBe(false));
    expect(result.current.pantry.data?.stock).toEqual({ onion: "fresh" });
  });

  it("can optimistically set stock before the pantry query has loaded", async () => {
    const queryClient = createQueryClient();
    const queryKey = recipeQueryKeys.pantry("user-1");
    mocks.setPantryItem.mockResolvedValue(personalPantry({ onion: "fresh" }));

    const { result } = renderHook(() => useKitchenStockActions(), {
      wrapper: wrapper(queryClient),
    });

    act(() => result.current.setStockLocation("onion", "fresh"));

    await waitFor(() =>
      expect(mocks.setPantryItem).toHaveBeenCalledWith(
        "onion",
        { location: "fresh" },
        expect.any(String),
      ),
    );
    await waitFor(() =>
      expect(queryClient.getQueryData(queryKey)).toEqual(
        personalPantry({ onion: "fresh" }),
      ),
    );
  });

  it("does not let a delayed mutation response replace a newer snapshot", async () => {
    const queryClient = createQueryClient();
    const queryKey = recipeQueryKeys.pantry("user-1");
    queryClient.setQueryData(queryKey, personalPantry({ milk: "fridge" }, "1"));
    let resolveMutation: ((pantry: Pantry) => void) | undefined;
    mocks.setPantryItem.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMutation = resolve;
        }),
    );
    const { result } = renderHook(() => useKitchenStockActions(), {
      wrapper: wrapper(queryClient),
    });

    act(() => result.current.setStockLocation("onion", "fresh"));
    await waitFor(() => expect(mocks.setPantryItem).toHaveBeenCalled());

    const newer = personalPantry({ egg: "cupboards" }, "3");
    act(() => queryClient.setQueryData(queryKey, newer));
    act(() => resolveMutation?.(personalPantry({ onion: "fresh" }, "2")));

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(queryClient.getQueryData(queryKey)).toEqual(newer);
  });

  it("does not install a mutation response from an obsolete pantry resource", async () => {
    const queryClient = createQueryClient();
    const queryKey = recipeQueryKeys.pantry("user-1");
    queryClient.setQueryData(queryKey, personalPantry({ milk: "fridge" }, "1"));
    let resolveMutation: ((pantry: Pantry) => void) | undefined;
    mocks.setPantryItem.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMutation = resolve;
        }),
    );
    const { result } = renderHook(() => useKitchenStockActions(), {
      wrapper: wrapper(queryClient),
    });

    act(() => result.current.setStockLocation("onion", "fresh"));
    await waitFor(() => expect(mocks.setPantryItem).toHaveBeenCalled());

    const householdPantry: Pantry = {
      ...personalPantry({ egg: "cupboards" }, "1"),
      resourceId: "household-1",
      scope: {
        type: "household",
        household: { id: "household-1", name: "Shared household" },
      },
    };
    act(() => queryClient.setQueryData(queryKey, householdPantry));
    act(() => resolveMutation?.(personalPantry({ onion: "fresh" }, "2")));

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(queryClient.getQueryData(queryKey)).toEqual(householdPantry);
  });
});
