import type { UnresolvedAuthoredTerm } from "@/lib/api/authored-terms";
import { apiRequest } from "@/lib/api/http";
import type { IngredientSlug } from "@/lib/domain/recipe/ingredient";
import type {
  KitchenItemDetails,
  KitchenStock,
} from "@/lib/domain/recipe/kitchen";

export type PantryScope =
  | { type: "personal" }
  | {
      type: "household";
      household: { id: string; name: string };
    };

export type Pantry = {
  resourceId: string;
  revision: string;
  operationId?: string;
  scope: PantryScope;
  stock: KitchenStock;
  items?: Record<string, KitchenItemDetails>;
  itemVersions: Record<string, string>;
  unresolvedTerms?: UnresolvedAuthoredTerm[];
};

const LEGACY_PANTRY_STORAGE_KEY = "recipe-kitchen-stock-v1";
const LEGACY_PANTRY_OWNER_KEY = "recipe-kitchen-stock-v1-owner";

function deleteLegacyBrowserPantry(): void {
  try {
    localStorage.removeItem(LEGACY_PANTRY_STORAGE_KEY);
    localStorage.removeItem(LEGACY_PANTRY_OWNER_KEY);
  } catch {
    // localStorage unavailable (SSR, private browsing, etc.)
  }
}

function pantryRequest(
  path: string,
  method: "PUT" | "PATCH" | "DELETE",
  body?: unknown,
  operationId = crypto.randomUUID(),
): Promise<Pantry> {
  return apiRequest(path, {
    method,
    json: body,
    headers: { "Idempotency-Key": operationId },
    fallbackMessage: "Pantry request failed.",
  });
}

export async function getPantry(signal?: AbortSignal): Promise<Pantry> {
  deleteLegacyBrowserPantry();
  return apiRequest("/api/pantry", {
    signal,
    fallbackMessage: "Pantry request failed.",
  });
}

export async function replacePantry(
  stock: KitchenStock,
  operationId?: string,
): Promise<Pantry> {
  return pantryRequest("/api/pantry", "PUT", { stock }, operationId);
}

export async function restorePantry(
  stock: KitchenStock,
  operationId?: string,
): Promise<Pantry> {
  return pantryRequest("/api/pantry", "PATCH", { stock }, operationId);
}

export async function setPantryItem(
  ingredientSlug: IngredientSlug,
  item: Pick<KitchenItemDetails, "location"> &
    Partial<Pick<KitchenItemDetails, "quantity" | "freshness">>,
  operationId?: string,
): Promise<Pantry> {
  return pantryRequest(
    `/api/pantry/items/${encodeURIComponent(ingredientSlug)}`,
    "PUT",
    item,
    operationId,
  );
}

export async function removePantryItem(
  ingredientSlug: IngredientSlug,
  operationId?: string,
): Promise<Pantry> {
  return pantryRequest(
    `/api/pantry/items/${encodeURIComponent(ingredientSlug)}`,
    "DELETE",
    undefined,
    operationId,
  );
}

export function installPantrySnapshot(
  current: Pantry | undefined,
  incoming: Pantry,
): Pantry {
  if (current?.resourceId !== incoming.resourceId) return incoming;
  return BigInt(incoming.revision) >= BigInt(current.revision)
    ? incoming
    : current;
}
