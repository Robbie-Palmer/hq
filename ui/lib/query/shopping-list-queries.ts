import { queryOptions } from "@tanstack/react-query";
import { getCurrentShoppingList } from "@/lib/api/shopping-lists";
import { saveOfflineShoppingListSnapshot } from "@/lib/pwa/offline-recipe-cache";
import { recipeQueryKeys } from "@/lib/query/recipe-query-keys";

export const shoppingListQuery = (userId: string) =>
  queryOptions({
    queryKey: recipeQueryKeys.shoppingList(userId),
    queryFn: async ({ signal }) => {
      const shoppingList = await getCurrentShoppingList(signal);
      void saveOfflineShoppingListSnapshot(userId, shoppingList).catch(() => {
        // Browser persistence must never turn a successful API read into an
        // application error.
      });
      return shoppingList;
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
