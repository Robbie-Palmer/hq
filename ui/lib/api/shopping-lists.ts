import { apiRequest } from "@/lib/api/http";
import type {
  ExtraItem,
  SelectedRecipeEntry,
} from "@/lib/shopping/shoppingListStore";

export type ShoppingListContents = {
  recipes: SelectedRecipeEntry[];
  checked: string[];
  extras: ExtraItem[];
};

export type ShoppingListScope =
  | { type: "personal" }
  | { type: "household"; household: { id: string; name: string } };

export type StoredShoppingList = {
  id: string;
  resourceId: string;
  revision: string;
  scope: ShoppingListScope;
  snapshot: ShoppingListContents;
  createdAt: string;
  updatedAt: string;
};

export function getCurrentShoppingList(
  signal?: AbortSignal,
): Promise<StoredShoppingList> {
  return apiRequest("/api/shopping-lists/current", {
    signal,
    fallbackMessage: "Shopping list could not be loaded.",
  });
}

export function saveCurrentShoppingList(
  listId: string,
  revision: string,
  snapshot: ShoppingListContents,
): Promise<StoredShoppingList> {
  return apiRequest("/api/shopping-lists/current", {
    method: "PUT",
    json: { listId, revision, snapshot },
    fallbackMessage: "Shopping list could not be saved.",
  });
}

export function startNewShoppingList(
  previousListId: string,
  previousRevision: string,
  snapshot: ShoppingListContents,
): Promise<StoredShoppingList> {
  return apiRequest("/api/shopping-lists", {
    method: "POST",
    json: { previousListId, previousRevision, snapshot },
    fallbackMessage: "A new shopping list could not be started.",
  });
}

export async function shareCurrentShoppingList(
  recipientUserId: string,
): Promise<void> {
  await apiRequest<{ shared: true }>("/api/shopping-lists/current/shares", {
    method: "POST",
    json: { recipientUserId },
    fallbackMessage: "The shopping list could not be shared.",
  });
}
