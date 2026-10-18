import type { RecipeBootstrap } from "@/lib/api/recipe-bootstrap";
import type { StoredShoppingList } from "@/lib/api/shopping-lists";

const DATABASE_NAME = "robbies-recipes";
const DATABASE_VERSION = 2;
const LEGACY_SNAPSHOT_STORE = "recipe-snapshots";
const SNAPSHOT_STORE = "offline-snapshots";
const SNAPSHOT_VERSION = 2;
const RECIPE_SNAPSHOT_KIND = "recipes";
const SHOPPING_SNAPSHOT_KIND = "shopping-list";
let snapshotMutationQueue = Promise.resolve();

export const OFFLINE_SNAPSHOT_POLICY = {
  recipes: {
    scope: "user",
    freshForMs: 24 * 60 * 60 * 1_000,
  },
  shoppingList: {
    scope: "user-and-resource",
    freshForMs: 15 * 60 * 1_000,
  },
  timers: {
    scope: "user",
    freshForMs: 0,
  },
  mealPlan: {
    scope: "user-and-household",
    freshForMs: 15 * 60 * 1_000,
  },
} as const;

type OfflineSnapshotKind =
  | typeof RECIPE_SNAPSHOT_KIND
  | typeof SHOPPING_SNAPSHOT_KIND;

type OfflineSnapshotScope = {
  userId: string;
  householdId: string | null;
  resourceId: string | null;
};

type OfflineSnapshotBase = {
  key: string;
  version: typeof SNAPSHOT_VERSION;
  kind: OfflineSnapshotKind;
  scope: OfflineSnapshotScope;
  savedAt: number;
};

export type OfflineRecipeSnapshot = OfflineSnapshotBase & {
  kind: typeof RECIPE_SNAPSHOT_KIND;
  bootstrap: RecipeBootstrap;
};

export type OfflineShoppingListSnapshot = OfflineSnapshotBase & {
  kind: typeof SHOPPING_SNAPSHOT_KIND;
  shoppingList: StoredShoppingList;
};

type OfflineSnapshot = OfflineRecipeSnapshot | OfflineShoppingListSnapshot;

export type OfflineSnapshotWriteResult =
  | { status: "saved"; savedAt: number }
  | { status: "quota-exceeded" }
  | { status: "unavailable" };

export type OfflineCacheStatus = {
  oldestSavedAt: number | null;
  quotaExceeded: boolean;
};

const EMPTY_CACHE_STATUS: OfflineCacheStatus = {
  oldestSavedAt: null,
  quotaExceeded: false,
};
let cacheStatus = EMPTY_CACHE_STATUS;
const cacheStatusListeners = new Set<() => void>();
const snapshotSavedAtByKind = new Map<OfflineSnapshotKind, number>();

function emitCacheStatus(next: OfflineCacheStatus): void {
  if (
    next.oldestSavedAt === cacheStatus.oldestSavedAt &&
    next.quotaExceeded === cacheStatus.quotaExceeded
  ) {
    return;
  }
  cacheStatus = next;
  for (const listener of cacheStatusListeners) listener();
}

function recordSnapshotFreshness(
  kind: OfflineSnapshotKind,
  savedAt: number,
): void {
  snapshotSavedAtByKind.set(kind, savedAt);
  emitCacheStatus({
    ...cacheStatus,
    oldestSavedAt: Math.min(...snapshotSavedAtByKind.values()),
  });
}

export function subscribeOfflineCacheStatus(listener: () => void): () => void {
  cacheStatusListeners.add(listener);
  return () => cacheStatusListeners.delete(listener);
}

export function getOfflineCacheStatus(): OfflineCacheStatus {
  return cacheStatus;
}

export function getServerOfflineCacheStatus(): OfflineCacheStatus {
  return EMPTY_CACHE_STATUS;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (database.objectStoreNames.contains(LEGACY_SNAPSHOT_STORE)) {
        database.deleteObjectStore(LEGACY_SNAPSHOT_STORE);
      }
      if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) {
        database.createObjectStore(SNAPSHOT_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open the offline cache"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Offline cache request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () =>
      reject(
        transaction.error ?? new Error("Offline cache transaction failed"),
      );
  });
}

function recipeSnapshotKey(userId: string): string {
  return `${RECIPE_SNAPSHOT_KIND}:${userId}`;
}

function shoppingSnapshotKey(userId: string): string {
  return `${SHOPPING_SNAPSHOT_KIND}:${userId}`;
}

function isSnapshotBase(
  value: unknown,
  kind: OfflineSnapshotKind,
  userId: string,
): value is OfflineSnapshotBase {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OfflineSnapshotBase>;
  return (
    candidate.version === SNAPSHOT_VERSION &&
    candidate.kind === kind &&
    candidate.scope?.userId === userId &&
    typeof candidate.savedAt === "number" &&
    Number.isFinite(candidate.savedAt)
  );
}

function isOfflineRecipeSnapshot(
  value: unknown,
  userId: string,
): value is OfflineRecipeSnapshot {
  return (
    isSnapshotBase(value, RECIPE_SNAPSHOT_KIND, userId) &&
    "bootstrap" in value &&
    value.bootstrap !== undefined
  );
}

function isOfflineShoppingListSnapshot(
  value: unknown,
  userId: string,
): value is OfflineShoppingListSnapshot {
  if (
    !isSnapshotBase(value, SHOPPING_SNAPSHOT_KIND, userId) ||
    !("shoppingList" in value) ||
    !value.shoppingList ||
    typeof value.shoppingList !== "object"
  ) {
    return false;
  }
  const list = value.shoppingList as Partial<StoredShoppingList>;
  const expectedHouseholdId =
    list.scope?.type === "household" ? list.scope.household.id : null;
  return (
    typeof list.id === "string" &&
    typeof list.resourceId === "string" &&
    value.scope.resourceId === list.resourceId &&
    value.scope.householdId === expectedHouseholdId
  );
}

async function readSnapshot<T extends OfflineSnapshot>(
  key: string,
  validate: (value: unknown) => value is T,
): Promise<T | null> {
  if (typeof indexedDB === "undefined") return null;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SNAPSHOT_STORE, "readwrite");
    const store = transaction.objectStore(SNAPSHOT_STORE);
    const value = await requestResult(store.get(key));
    if (!validate(value)) {
      if (value !== undefined) await requestResult(store.delete(key));
      return null;
    }
    recordSnapshotFreshness(value.kind, value.savedAt);
    return value;
  } finally {
    database.close();
  }
}

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "QuotaExceededError";
}

async function writeSnapshot(
  snapshot: OfflineSnapshot,
): Promise<OfflineSnapshotWriteResult> {
  const write = snapshotMutationQueue.then(async () => {
    if (typeof indexedDB === "undefined") {
      return { status: "unavailable" } as const;
    }
    try {
      const database = await openDatabase();
      try {
        const transaction = database.transaction(SNAPSHOT_STORE, "readwrite");
        await Promise.all([
          requestResult(transaction.objectStore(SNAPSHOT_STORE).put(snapshot)),
          transactionDone(transaction),
        ]);
      } finally {
        database.close();
      }
      recordSnapshotFreshness(snapshot.kind, snapshot.savedAt);
      emitCacheStatus({ ...cacheStatus, quotaExceeded: false });
      return { status: "saved", savedAt: snapshot.savedAt } as const;
    } catch (error) {
      if (isQuotaError(error)) {
        emitCacheStatus({ ...cacheStatus, quotaExceeded: true });
        return { status: "quota-exceeded" } as const;
      }
      throw error;
    }
  });
  snapshotMutationQueue = write.then(
    () => undefined,
    () => undefined,
  );
  return write;
}

export function loadOfflineRecipeSnapshot(
  userId: string,
): Promise<OfflineRecipeSnapshot | null> {
  return readSnapshot(recipeSnapshotKey(userId), (value) =>
    isOfflineRecipeSnapshot(value, userId),
  );
}

export function saveOfflineRecipeSnapshot(
  userId: string,
  bootstrap: RecipeBootstrap,
): Promise<OfflineSnapshotWriteResult> {
  const savedAt = Date.now();
  return writeSnapshot({
    key: recipeSnapshotKey(userId),
    version: SNAPSHOT_VERSION,
    kind: RECIPE_SNAPSHOT_KIND,
    scope: { userId, householdId: null, resourceId: null },
    savedAt,
    bootstrap,
  });
}

export function loadOfflineShoppingListSnapshot(
  userId: string,
): Promise<OfflineShoppingListSnapshot | null> {
  return readSnapshot(shoppingSnapshotKey(userId), (value) =>
    isOfflineShoppingListSnapshot(value, userId),
  );
}

export function saveOfflineShoppingListSnapshot(
  userId: string,
  shoppingList: StoredShoppingList,
): Promise<OfflineSnapshotWriteResult> {
  const savedAt = Date.now();
  return writeSnapshot({
    key: shoppingSnapshotKey(userId),
    version: SNAPSHOT_VERSION,
    kind: SHOPPING_SNAPSHOT_KIND,
    scope: {
      userId,
      householdId:
        shoppingList.scope.type === "household"
          ? shoppingList.scope.household.id
          : null,
      resourceId: shoppingList.resourceId,
    },
    savedAt,
    shoppingList,
  });
}

export async function clearOfflineRecipeSnapshots(): Promise<void> {
  const clear = snapshotMutationQueue.then(async () => {
    snapshotSavedAtByKind.clear();
    emitCacheStatus(EMPTY_CACHE_STATUS);
    if (typeof indexedDB === "undefined") return;
    const database = await openDatabase();
    try {
      const transaction = database.transaction(SNAPSHOT_STORE, "readwrite");
      await requestResult(transaction.objectStore(SNAPSHOT_STORE).clear());
    } finally {
      database.close();
    }
  });
  snapshotMutationQueue = clear.then(
    () => undefined,
    () => undefined,
  );
  await clear;
}
