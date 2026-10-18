import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecipeBootstrap } from "@/lib/api/recipe-bootstrap";
import type { StoredShoppingList } from "@/lib/api/shopping-lists";
import {
  clearOfflineRecipeSnapshots,
  getOfflineCacheStatus,
  loadOfflineRecipeSnapshot,
  loadOfflineShoppingListSnapshot,
  saveOfflineRecipeSnapshot,
  saveOfflineShoppingListSnapshot,
} from "@/lib/pwa/offline-recipe-cache";

type MutableRequest<T> = Omit<IDBRequest<T>, "error" | "result"> & {
  error: DOMException | null;
  result: T;
};

type FakeTransaction = {
  error: DOMException | null;
  onabort: ((event: Event) => void) | null;
  oncomplete: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
};

function finishFakeTransaction(
  transaction: FakeTransaction | undefined,
  quotaExceeded: boolean | undefined,
  rollback: () => void,
): void {
  queueMicrotask(() => {
    if (!transaction) return;
    if (quotaExceeded) {
      rollback();
      transaction.error = new DOMException(
        "Storage is full",
        "QuotaExceededError",
      );
      transaction.onabort?.call(
        transaction as unknown as IDBTransaction,
        new Event("abort"),
      );
      return;
    }
    transaction.oncomplete?.call(
      transaction as unknown as IDBTransaction,
      new Event("complete"),
    );
  });
}

function successfulRequest<T>(action: () => T): IDBRequest<T> {
  const request = {
    error: null,
    onerror: null,
    onsuccess: null,
    result: undefined,
  } as unknown as MutableRequest<T>;
  queueMicrotask(() => {
    request.result = action();
    request.onsuccess?.call(request, new Event("success"));
  });
  return request;
}

function failingRequest<T>(error?: DOMException): IDBRequest<T> {
  const request = {
    error: error ?? null,
    onerror: null,
    onsuccess: null,
    result: undefined,
  } as unknown as MutableRequest<T>;
  queueMicrotask(() => {
    request.onerror?.call(request, new Event("error"));
  });
  return request;
}

function delayedSuccessfulRequest<T>(
  action: () => T,
  waitFor: Promise<void>,
): IDBRequest<T> {
  const request = {
    error: null,
    onerror: null,
    onsuccess: null,
    result: undefined,
  } as unknown as MutableRequest<T>;
  void waitFor.then(() => {
    request.result = action();
    request.onsuccess?.call(request, new Event("success"));
  });
  return request;
}

function fakeIndexedDb(
  options: {
    failOpen?: boolean;
    failRead?: boolean;
    quotaExceeded?: boolean;
    writeGate?: Promise<void>;
    withLegacyStore?: boolean;
  } = {},
) {
  const stores = new Map<string, Map<string, unknown>>();
  if (options.withLegacyStore) {
    stores.set(
      "recipe-snapshots",
      new Map([["user-1", { version: 1, userId: "user-1" }]]),
    );
  }

  const objectStore = (name: string, transaction?: FakeTransaction) => {
    const records = stores.get(name);
    if (!records) throw new Error(`Missing object store ${name}`);
    return {
      clear: () =>
        successfulRequest(() => {
          records.clear();
        }),
      delete: (key: IDBValidKey) =>
        successfulRequest(() => {
          records.delete(String(key));
        }),
      get: (key: IDBValidKey) =>
        options.failRead
          ? failingRequest()
          : successfulRequest(() => records.get(String(key))),
      put: (value: { key: string }) => {
        const hadPreviousValue = records.has(value.key);
        const previousValue = records.get(value.key);
        const write = () => {
          records.set(value.key, value);
          return value.key;
        };
        const request = options.writeGate
          ? delayedSuccessfulRequest(write, options.writeGate)
          : successfulRequest(write);
        const finishTransaction = () => {
          finishFakeTransaction(transaction, options.quotaExceeded, () => {
            if (hadPreviousValue) records.set(value.key, previousValue);
            else records.delete(value.key);
          });
        };
        if (options.writeGate) {
          void options.writeGate.then(finishTransaction);
        } else {
          queueMicrotask(finishTransaction);
        }
        return request;
      },
    } as unknown as IDBObjectStore;
  };

  const database = {
    close: vi.fn(),
    createObjectStore: vi.fn((name: string) => {
      stores.set(name, new Map());
      return objectStore(name);
    }),
    deleteObjectStore: vi.fn((name: string) => {
      stores.delete(name);
    }),
    objectStoreNames: {
      contains: (name: string) => stores.has(name),
    },
    transaction: vi.fn((name: string) => {
      const transaction: FakeTransaction & {
        objectStore: () => IDBObjectStore;
      } = {
        error: null,
        onabort: null,
        oncomplete: null,
        onerror: null,
        objectStore: () => objectStore(name, transaction),
      };
      return transaction;
    }),
  } as unknown as IDBDatabase;
  const indexedDb = {
    open: vi.fn(() => {
      if (options.failOpen) return failingRequest() as IDBOpenDBRequest;
      const request = {
        error: null,
        onerror: null,
        onsuccess: null,
        onupgradeneeded: null,
        result: database,
      } as unknown as IDBOpenDBRequest;
      queueMicrotask(() => {
        if (!stores.has("offline-snapshots")) {
          request.onupgradeneeded?.call(
            request,
            new Event("upgradeneeded") as IDBVersionChangeEvent,
          );
        }
        request.onsuccess?.call(request, new Event("success"));
      });
      return request;
    }),
  } as unknown as IDBFactory;

  return { database, indexedDb, stores };
}

const bootstrap = {
  recipeBox: {
    box: { completed: true, recipeSlugs: ["lentil-soup"] },
    recipes: [{ slug: "lentil-soup", title: "Lentil soup" }],
  },
} as unknown as RecipeBootstrap;

const shoppingList = {
  id: "list-1",
  resourceId: "household-1",
  revision: "1",
  scope: {
    type: "household",
    household: { id: "household-1", name: "Home" },
  },
  snapshot: { recipes: [], checked: [], extras: [] },
  createdAt: "2026-10-17T00:00:00.000Z",
  updatedAt: "2026-10-17T00:00:00.000Z",
} satisfies StoredShoppingList;

describe("offline recipe cache", () => {
  let harness: ReturnType<typeof fakeIndexedDb>;

  beforeEach(() => {
    harness = fakeIndexedDb();
    vi.stubGlobal("indexedDB", harness.indexedDb);
  });

  afterEach(async () => {
    await clearOfflineRecipeSnapshots().catch(() => undefined);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps a user-scoped recipe snapshot regardless of its age", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1);
    await saveOfflineRecipeSnapshot("user-1", bootstrap);
    vi.mocked(Date.now).mockReturnValue(Number.MAX_SAFE_INTEGER);

    await expect(loadOfflineRecipeSnapshot("user-1")).resolves.toMatchObject({
      version: 2,
      key: "recipes:user-1",
      kind: "recipes",
      scope: {
        userId: "user-1",
        householdId: null,
        resourceId: null,
      },
      savedAt: 1,
      bootstrap,
    });
  });

  it("stores the shopping list with both user and household scope", async () => {
    await saveOfflineShoppingListSnapshot("user-1", shoppingList);

    await expect(
      loadOfflineShoppingListSnapshot("user-1"),
    ).resolves.toMatchObject({
      version: 2,
      key: "shopping-list:user-1",
      kind: "shopping-list",
      scope: {
        userId: "user-1",
        householdId: "household-1",
        resourceId: "household-1",
      },
      shoppingList,
    });
  });

  it("keeps accounts separate and clears all snapshots on sign-out", async () => {
    await saveOfflineRecipeSnapshot("user-1", bootstrap);
    await saveOfflineRecipeSnapshot("user-2", bootstrap);

    expect(await loadOfflineRecipeSnapshot("user-1")).toMatchObject({
      scope: { userId: "user-1" },
    });
    expect(await loadOfflineRecipeSnapshot("user-2")).toMatchObject({
      scope: { userId: "user-2" },
    });

    await clearOfflineRecipeSnapshots();
    expect(harness.stores.get("offline-snapshots")).toHaveLength(0);
  });

  it("tracks the oldest current snapshot after a data class is refreshed", async () => {
    vi.spyOn(Date, "now").mockReturnValue(10);

    await saveOfflineRecipeSnapshot("user-1", bootstrap);
    vi.mocked(Date.now).mockReturnValue(20);
    await saveOfflineShoppingListSnapshot("user-1", shoppingList);
    vi.mocked(Date.now).mockReturnValue(30);
    await saveOfflineRecipeSnapshot("user-1", bootstrap);

    expect(getOfflineCacheStatus().oldestSavedAt).toBe(20);
  });

  it("waits for an in-flight snapshot write before clearing", async () => {
    let releaseWrite: (() => void) | undefined;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    harness = fakeIndexedDb({ writeGate });
    vi.stubGlobal("indexedDB", harness.indexedDb);

    const save = saveOfflineRecipeSnapshot("user-1", bootstrap);
    const clear = clearOfflineRecipeSnapshots();
    releaseWrite?.();

    await Promise.all([save, clear]);
    expect(harness.stores.get("offline-snapshots")?.size).toBe(0);
  });

  it("drops the legacy unscoped store during the database upgrade", async () => {
    harness = fakeIndexedDb({ withLegacyStore: true });
    vi.stubGlobal("indexedDB", harness.indexedDb);

    await saveOfflineRecipeSnapshot("user-1", bootstrap);

    expect(harness.database.deleteObjectStore).toHaveBeenCalledWith(
      "recipe-snapshots",
    );
    expect(harness.stores.has("recipe-snapshots")).toBe(false);
    expect(harness.stores.has("offline-snapshots")).toBe(true);
  });

  it("deletes an incompatible snapshot", async () => {
    await saveOfflineRecipeSnapshot("user-1", bootstrap);
    harness.stores.get("offline-snapshots")?.set("recipes:user-1", {
      version: 1,
      key: "recipes:user-1",
    });

    await expect(loadOfflineRecipeSnapshot("user-1")).resolves.toBeNull();
    expect(harness.stores.get("offline-snapshots")?.has("recipes:user-1")).toBe(
      false,
    );
  });

  it("degrades safely when IndexedDB is unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined);

    await expect(loadOfflineRecipeSnapshot("user-1")).resolves.toBeNull();
    await expect(
      saveOfflineRecipeSnapshot("user-1", bootstrap),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(clearOfflineRecipeSnapshots()).resolves.toBeUndefined();
  });

  it("reports quota exhaustion when the write transaction aborts", async () => {
    harness = fakeIndexedDb({ quotaExceeded: true });
    vi.stubGlobal("indexedDB", harness.indexedDb);

    await expect(
      saveOfflineRecipeSnapshot("user-1", bootstrap),
    ).resolves.toEqual({ status: "quota-exceeded" });
    expect(harness.stores.get("offline-snapshots")).toHaveLength(0);
    expect(getOfflineCacheStatus()).toEqual({
      oldestSavedAt: null,
      quotaExceeded: true,
    });
  });

  it("rejects with an Error when opening IndexedDB fails without one", async () => {
    harness = fakeIndexedDb({ failOpen: true });
    vi.stubGlobal("indexedDB", harness.indexedDb);

    await expect(loadOfflineRecipeSnapshot("user-1")).rejects.toThrow(
      "Could not open the offline cache",
    );
  });

  it("rejects with an Error when an IndexedDB request fails without one", async () => {
    harness = fakeIndexedDb({ failRead: true });
    vi.stubGlobal("indexedDB", harness.indexedDb);

    await expect(loadOfflineRecipeSnapshot("user-1")).rejects.toThrow(
      "Offline cache request failed",
    );
  });
});
