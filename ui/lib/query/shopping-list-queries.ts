import { type QueryClient, queryOptions } from "@tanstack/react-query";
import {
  getCurrentShoppingList,
  type StoredShoppingList,
} from "@/lib/api/shopping-lists";
import { recipeQueryKeys } from "@/lib/query/recipe-query-keys";

const offlineRestores = new WeakSet<StoredShoppingList>();

export function restoreOfflineShoppingListQuery(
  queryClient: QueryClient,
  userId: string,
  shoppingList: StoredShoppingList,
  savedAt: number,
): void {
  offlineRestores.add(shoppingList);
  try {
    queryClient.setQueryData(
      recipeQueryKeys.shoppingList(userId),
      shoppingList,
      { updatedAt: savedAt },
    );
  } finally {
    offlineRestores.delete(shoppingList);
  }
}

export function isOfflineShoppingListRestore(
  shoppingList: StoredShoppingList,
): boolean {
  return offlineRestores.has(shoppingList);
}

export const shoppingListQuery = (userId: string) =>
  queryOptions({
    queryKey: recipeQueryKeys.shoppingList(userId),
    queryFn: ({ signal }) => getCurrentShoppingList(signal),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
