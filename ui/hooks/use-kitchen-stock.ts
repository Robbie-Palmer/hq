"use client";

import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { emptyPantryFreshness } from "recipe-domain/pantry";
import { captureRecipeProductActivity } from "@/lib/analytics/recipe-product";
import {
  installPantrySnapshot,
  type Pantry,
  type PantryRestore,
  removePantryItem,
  replacePantry,
  restorePantry,
  setPantryItem,
} from "@/lib/api/pantry";
import { authClient } from "@/lib/auth-client";
import type { IngredientSlug } from "@/lib/domain/recipe/ingredient";
import type {
  KitchenFreshness,
  KitchenItemDetails,
  KitchenLocation,
  KitchenStock,
} from "@/lib/domain/recipe/kitchen";
import { pantryQuery } from "@/lib/query/pantry-queries";
import { recipeQueryKeys } from "@/lib/query/recipe-query-keys";

const EMPTY_STOCK: KitchenStock = {};

type PantryMutation =
  | {
      kind: "set";
      operationId: string;
      ingredientSlug: IngredientSlug;
      item: Pick<KitchenItemDetails, "location"> &
        Partial<Pick<KitchenItemDetails, "quantity" | "freshness">>;
    }
  | {
      kind: "remove";
      operationId: string;
      ingredientSlug: IngredientSlug;
    }
  | {
      kind: "replace";
      operationId: string;
      stock: KitchenStock;
    }
  | {
      kind: "restore";
      operationId: string;
      snapshot: PantryRestore;
    };

function applyPantryMutation(
  stock: KitchenStock,
  operation: PantryMutation,
): KitchenStock {
  switch (operation.kind) {
    case "set":
      return {
        ...stock,
        [operation.ingredientSlug]: operation.item.location,
      };
    case "remove": {
      const next = { ...stock };
      delete next[operation.ingredientSlug];
      return next;
    }
    case "replace":
      return { ...operation.stock };
    case "restore":
      return { ...operation.snapshot.stock, ...stock };
  }
}

export function useKitchenStockQuery() {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const userId = session?.user.id;
  const userKey = userId ?? "pending";
  const query = useQuery({
    ...pantryQuery(userKey),
    enabled: !sessionPending && Boolean(userId),
  });
  const pending = useMutationState<{
    operation: PantryMutation;
    submittedAt: number;
  }>({
    filters: {
      mutationKey: [...recipeQueryKeys.pantry(userKey), "save"],
      status: "pending",
    },
    select: (mutation) => ({
      operation: mutation.state.variables as PantryMutation,
      submittedAt: mutation.state.submittedAt,
    }),
  });
  const pendingInSubmissionOrder = pending.toSorted(
    (first, second) => first.submittedAt - second.submittedAt,
  );
  const hasPendingSet = pendingInSubmissionOrder.some(
    ({ operation }) => operation.kind === "set",
  );
  const data = query.data
    ? {
        ...query.data,
        stock: pendingInSubmissionOrder.reduce(
          (stock, item) => applyPantryMutation(stock, item.operation),
          query.data.stock,
        ),
        ...(query.data.items || hasPendingSet
          ? {
              items: pendingInSubmissionOrder.reduce(
                (items, pendingItem) => {
                  const operation = pendingItem.operation;
                  if (operation.kind !== "set") return items;
                  const current = items[operation.ingredientSlug];
                  items[operation.ingredientSlug] = {
                    location: operation.item.location,
                    quantity:
                      operation.item.quantity === undefined
                        ? (current?.quantity ?? null)
                        : operation.item.quantity,
                    freshness:
                      operation.item.freshness ??
                      current?.freshness ??
                      emptyPantryFreshness(),
                    source: {
                      kind: "user" as const,
                      provenance: "Manual kitchen update",
                    },
                  };
                  return items;
                },
                { ...query.data.items },
              ),
            }
          : {}),
      }
    : query.data;
  return { ...query, data };
}

export function useKitchenStock(): KitchenStock {
  return useKitchenStockQuery().data?.stock ?? EMPTY_STOCK;
}

export function useKitchenStockActions() {
  const { data: session } = authClient.useSession();
  const userId = session?.user.id ?? "pending";
  const queryClient = useQueryClient();
  const queryKey = recipeQueryKeys.pantry(userId);
  const mutation = useMutation({
    mutationKey: [...queryKey, "save"],
    mutationFn: (operation: PantryMutation) => {
      switch (operation.kind) {
        case "set":
          return setPantryItem(
            operation.ingredientSlug,
            operation.item,
            operation.operationId,
          );
        case "remove":
          return removePantryItem(
            operation.ingredientSlug,
            operation.operationId,
          );
        case "replace":
          return replacePantry(operation.stock, operation.operationId);
        case "restore":
          return restorePantry(operation.snapshot, operation.operationId);
      }
    },
    onMutate: (operation) => {
      const previous = queryClient.getQueryData<Pantry>(queryKey);
      if (operation.kind === "set") {
        const stock = previous?.stock ?? EMPTY_STOCK;
        if (stock[operation.ingredientSlug] !== operation.item.location) {
          captureRecipeProductActivity("kitchen_ingredient_added", {
            ingredient_slug: operation.ingredientSlug,
            kitchen_location: operation.item.location,
            stocked_ingredient_count: Object.keys({
              ...stock,
              [operation.ingredientSlug]: operation.item.location,
            }).length,
          });
        }
      }
    },
    onSuccess: (pantry) => {
      queryClient.setQueryData<Pantry>(queryKey, (current) =>
        current && current.resourceId !== pantry.resourceId
          ? current
          : installPantrySnapshot(current, pantry),
      );
    },
  });

  return {
    clearStock() {
      mutation.mutate({
        kind: "replace",
        operationId: crypto.randomUUID(),
        stock: {},
      });
    },
    error: mutation.error,
    isPending: mutation.isPending,
    removeFromStock(ingredientSlug: IngredientSlug) {
      mutation.mutate({
        kind: "remove",
        ingredientSlug,
        operationId: crypto.randomUUID(),
      });
    },
    replaceStock(stock: KitchenStock) {
      mutation.mutate({
        kind: "replace",
        operationId: crypto.randomUUID(),
        stock: { ...stock },
      });
    },
    restoreStock(snapshot: PantryRestore) {
      mutation.mutate({
        kind: "restore",
        operationId: crypto.randomUUID(),
        snapshot: {
          stock: { ...snapshot.stock },
          items: { ...snapshot.items },
        },
      });
    },
    setStockLocation(
      ingredientSlug: IngredientSlug,
      location: KitchenLocation,
    ) {
      mutation.mutate({
        kind: "set",
        ingredientSlug,
        item: { location },
        operationId: crypto.randomUUID(),
      });
    },
    updateStockItem(
      ingredientSlug: IngredientSlug,
      item: {
        location: KitchenLocation;
        quantity: KitchenItemDetails["quantity"];
        freshness: KitchenFreshness;
      },
    ) {
      mutation.mutate({
        kind: "set",
        ingredientSlug,
        item,
        operationId: crypto.randomUUID(),
      });
    },
  };
}
