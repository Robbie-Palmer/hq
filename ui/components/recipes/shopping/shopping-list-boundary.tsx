"use client";

import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { isApiError } from "@/lib/api/http";
import {
  type ShoppingListContents,
  type ShoppingListScope,
  type StoredShoppingList,
  saveCurrentShoppingList,
  startNewShoppingList,
} from "@/lib/api/shopping-lists";
import { authClient } from "@/lib/auth-client";
import { loadOfflineShoppingListSnapshot } from "@/lib/pwa/offline-recipe-cache";
import {
  listShoppingCommands,
  type ShoppingCommandOutboxRecord,
} from "@/lib/pwa/shopping-command-outbox";
import { recipeQueryKeys } from "@/lib/query/recipe-query-keys";
import {
  restoreOfflineShoppingListQuery,
  shoppingListQuery,
} from "@/lib/query/shopping-list-queries";
import {
  confirmShoppingListRevision,
  getShoppingListCacheIdentity,
  getShoppingListCacheMetadata,
  getShoppingListSnapshot,
  installShoppingListSnapshot,
  resetShoppingTripCompletion,
  type ShoppingListState,
  subscribeShoppingList,
} from "@/lib/shopping/shoppingListStore";
import { useShoppingCommandSync } from "./shopping-command-sync";

function shoppingListContents(): ShoppingListContents {
  const { recipes, checked, extras, plan } = getShoppingListSnapshot();
  return { recipes, checked, extras, plan };
}

function mergeKeyedValues<T>(
  baseline: T[],
  local: T[],
  remote: T[],
  keyFor: (value: T) => string,
): T[] {
  const baselineByKey = new Map(
    baseline.map((value) => [keyFor(value), value]),
  );
  const localByKey = new Map(local.map((value) => [keyFor(value), value]));
  const merged = new Map(remote.map((value) => [keyFor(value), value]));
  for (const value of baseline) {
    const key = keyFor(value);
    if (!localByKey.has(key)) merged.delete(key);
  }
  for (const value of local) {
    const key = keyFor(value);
    if (JSON.stringify(value) !== JSON.stringify(baselineByKey.get(key))) {
      merged.set(key, value);
    }
  }
  return [...merged.values()];
}

function mergeCheckedValues(
  baseline: string[],
  local: string[],
  remote: string[],
): string[] {
  const localValues = new Set(local);
  const baselineValues = new Set(baseline);
  const merged = new Set(remote);
  for (const value of baseline) {
    if (!localValues.has(value)) merged.delete(value);
  }
  for (const value of local) {
    if (!baselineValues.has(value)) merged.add(value);
  }
  return [...merged];
}

function mergeLocalShoppingListChanges(
  baseline: ShoppingListContents,
  local: ShoppingListContents,
  remote: ShoppingListContents,
): ShoppingListContents {
  return {
    recipes: mergeKeyedValues(
      baseline.recipes,
      local.recipes,
      remote.recipes,
      (recipe) => recipe.slug,
    ),
    checked: mergeCheckedValues(
      baseline.checked,
      local.checked,
      remote.checked,
    ),
    extras: mergeKeyedValues(
      baseline.extras,
      local.extras,
      remote.extras,
      (extra) => extra.id,
    ),
    plan: mergeKeyedValues(
      baseline.plan,
      local.plan,
      remote.plan,
      (meal) => meal.id,
    ),
  };
}

function parseSavedSnapshot(serialized: string): ShoppingListContents {
  return JSON.parse(serialized) as ShoppingListContents;
}

function restoreSavedShoppingList(
  queryClient: QueryClient,
  userId: string,
  savedList: StoredShoppingList | undefined,
): void {
  if (!savedList) return;
  queryClient.setQueryData<StoredShoppingList>(
    recipeQueryKeys.shoppingList(userId),
    savedList,
  );
}

const pendingShoppingListSaves = new Map<string, Promise<void>>();
const EMPTY_SHOPPING_LIST: ShoppingListContents = {
  recipes: [],
  checked: [],
  extras: [],
  plan: [],
};
const EMPTY_OUTBOX_COMMANDS: readonly ShoppingCommandOutboxRecord[] = [];

function recoverCachedShoppingList(
  serverList: StoredShoppingList,
): ShoppingListContents {
  const cached = shoppingListContents();
  const { listId, resourceId, revision } = getShoppingListCacheIdentity();
  const { confirmedSnapshot, hasUnsavedChanges } =
    getShoppingListCacheMetadata();
  const hasLocalOnlyPlan =
    JSON.stringify(cached.plan) !==
    JSON.stringify(confirmedSnapshot?.plan ?? []);
  if (listId !== undefined && listId !== serverList.id) {
    return serverList.snapshot;
  }
  if (resourceId !== undefined && resourceId !== serverList.resourceId) {
    return serverList.snapshot;
  }
  if (
    cached.recipes.length === 0 &&
    cached.checked.length === 0 &&
    cached.extras.length === 0 &&
    cached.plan.length === 0
  ) {
    return serverList.snapshot;
  }
  if (listId === undefined) {
    return mergeLocalShoppingListChanges(
      EMPTY_SHOPPING_LIST,
      cached,
      serverList.snapshot,
    );
  }
  if (
    revision === serverList.revision &&
    !hasUnsavedChanges &&
    !hasLocalOnlyPlan
  ) {
    return serverList.snapshot;
  }
  const baseline =
    confirmedSnapshot ?? (hasLocalOnlyPlan ? { ...cached, plan: [] } : cached);
  return mergeLocalShoppingListChanges(baseline, cached, serverList.snapshot);
}

const ShoppingListScopeContext = createContext<ShoppingListScope | null>(null);

export function useShoppingListScope(): ShoppingListScope {
  const scope = useContext(ShoppingListScopeContext);
  if (!scope) {
    throw new Error(
      "useShoppingListScope must be used inside ShoppingListBoundary",
    );
  }
  return scope;
}

type MutableValue<T> = { current: T };

interface ShoppingSyncRefs {
  installedId: MutableValue<string | undefined>;
  savedSnapshot: MutableValue<string | undefined>;
  savedRevision: MutableValue<string | undefined>;
  savedList: MutableValue<StoredShoppingList | undefined>;
  supersededRevisions: MutableValue<Set<string>>;
  pendingCacheRecovery: MutableValue<string | undefined>;
}

function installInitialShoppingList(
  serverList: StoredShoppingList,
  hasPendingCommands: boolean,
  refs: ShoppingSyncRefs,
  setInstalledId: (id: string) => void,
): void {
  const serialized = JSON.stringify(serverList.snapshot);
  const next = recoverCachedShoppingList(serverList);
  const shouldRecoverCache = JSON.stringify(next) !== serialized;
  refs.savedSnapshot.current = serialized;
  refs.savedRevision.current = serverList.revision;
  refs.savedList.current = serverList;
  refs.installedId.current = serverList.id;
  installShoppingListSnapshot(
    next,
    serverList.id,
    "install",
    true,
    serverList.revision,
    {
      confirmedSnapshot: serverList.snapshot,
      hasUnsavedChanges: shouldRecoverCache,
    },
    serverList.resourceId,
  );
  refs.pendingCacheRecovery.current =
    shouldRecoverCache && !hasPendingCommands ? serverList.id : undefined;
  setInstalledId(serverList.id);
}

function rebaseInstalledShoppingList(
  serverList: StoredShoppingList,
  refs: ShoppingSyncRefs,
  setInstalledId: (id: string) => void,
): void {
  const serialized = JSON.stringify(serverList.snapshot);
  const local = shoppingListContents();
  const baseline = refs.savedSnapshot.current;
  const hasLocalChanges =
    baseline !== undefined && JSON.stringify(local) !== baseline;
  const next =
    hasLocalChanges && baseline
      ? mergeLocalShoppingListChanges(
          parseSavedSnapshot(baseline),
          local,
          serverList.snapshot,
        )
      : serverList.snapshot;
  const hasRebasedChanges = JSON.stringify(next) !== serialized;
  refs.savedSnapshot.current = serialized;
  refs.savedRevision.current = serverList.revision;
  refs.savedList.current = serverList;
  refs.installedId.current = serverList.id;
  installShoppingListSnapshot(
    next,
    serverList.id,
    hasRebasedChanges ? "local" : "install",
    true,
    serverList.revision,
    {
      confirmedSnapshot: serverList.snapshot,
      hasUnsavedChanges: hasRebasedChanges,
    },
    serverList.resourceId,
  );
  setInstalledId(serverList.id);
}

type ShoppingListChangeSource = Parameters<
  Parameters<typeof subscribeShoppingList>[0]
>[0];

class ShoppingListSaveQueue {
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private syncTimer: ReturnType<typeof setTimeout> | undefined;
  private saving = Promise.resolve();

  constructor(
    private readonly queryClient: QueryClient,
    private readonly userId: string,
    private readonly resourceId: string | undefined,
    private readonly refs: ShoppingSyncRefs,
    private readonly setSaveFailed: (failed: boolean) => void,
  ) {}

  start(): () => void {
    const unsubscribe = subscribeShoppingList(this.handleSource);
    this.recoverPendingCache();
    return () => {
      this.clearTimers();
      unsubscribe();
    };
  }

  private readonly handleSource = (source: ShoppingListChangeSource): void => {
    if (source === "local") {
      this.scheduleSave();
      return;
    }
    if (source === "install") this.clearSaveTimer();
    if (source === "storage") this.scheduleSync();
  };

  private scheduleSave(): void {
    this.clearSaveTimer();
    this.saveTimer = setTimeout(this.enqueueCurrentSnapshot, 250);
  }

  private scheduleSync(): void {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      void this.queryClient.invalidateQueries({
        queryKey: recipeQueryKeys.shoppingList(this.userId),
      });
    }, 500);
  }

  private readonly enqueueCurrentSnapshot = (): void => {
    const snapshot = shoppingListContents();
    const serialized = JSON.stringify(snapshot);
    if (serialized === this.refs.savedSnapshot.current) return;
    const listId = this.refs.installedId.current;
    if (!listId) return;
    this.saving = this.saving
      .catch(() => undefined)
      .then(() => this.save(listId, snapshot, serialized))
      .catch(this.handleSaveError);
    this.trackPendingSave(listId, this.saving);
  };

  private async save(
    listId: string,
    snapshot: ShoppingListContents,
    serialized: string,
  ): Promise<void> {
    if (
      this.refs.installedId.current !== listId ||
      !this.refs.savedRevision.current
    ) {
      return;
    }
    const baseRevision = this.refs.savedRevision.current;
    const updated = await saveCurrentShoppingList(
      listId,
      baseRevision,
      snapshot,
    );
    if (this.refs.installedId.current !== listId) return;
    this.refs.supersededRevisions.current.add(baseRevision);
    this.refs.savedSnapshot.current = serialized;
    this.refs.savedRevision.current = updated.revision;
    this.refs.savedList.current = updated;
    this.refs.pendingCacheRecovery.current = undefined;
    confirmShoppingListRevision(updated.id, updated.revision, updated.snapshot);
    this.queryClient.setQueryData<StoredShoppingList>(
      recipeQueryKeys.shoppingList(this.userId),
      updated,
    );
    this.setSaveFailed(false);
  }

  private readonly handleSaveError = (error: unknown): void => {
    this.setSaveFailed(true);
    if (isApiError(error) && error.status === 409) {
      void this.queryClient.invalidateQueries({
        queryKey: recipeQueryKeys.shoppingList(this.userId),
      });
    }
  };

  private trackPendingSave(listId: string, pending: Promise<void>): void {
    pendingShoppingListSaves.set(listId, pending);
    void pending.then(() => {
      if (pendingShoppingListSaves.get(listId) === pending) {
        pendingShoppingListSaves.delete(listId);
      }
    });
  }

  private recoverPendingCache(): void {
    if (
      this.refs.pendingCacheRecovery.current !== this.refs.installedId.current
    ) {
      return;
    }
    installShoppingListSnapshot(
      getShoppingListSnapshot(),
      this.refs.installedId.current,
      "local",
      false,
      this.refs.savedRevision.current,
      undefined,
      this.resourceId,
    );
  }

  private clearSaveTimer(): void {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
  }

  private clearTimers(): void {
    this.clearSaveTimer();
    if (this.syncTimer) clearTimeout(this.syncTimer);
  }
}

function useShoppingListSync(
  userId: string,
  serverList: StoredShoppingList | undefined,
  pendingCommands: readonly ShoppingCommandOutboxRecord[],
): { installedId: string | undefined; saveFailed: boolean } {
  const queryClient = useQueryClient();
  const [installedId, setInstalledId] = useState<string>();
  const installedIdRef = useRef<string | undefined>(undefined);
  const savedSnapshot = useRef<string | undefined>(undefined);
  const savedRevision = useRef<string | undefined>(undefined);
  const savedList = useRef<StoredShoppingList | undefined>(undefined);
  const supersededRevisions = useRef<Set<string>>(new Set());
  const pendingCacheRecovery = useRef<string | undefined>(undefined);
  const [saveFailed, setSaveFailed] = useState(false);
  const refs = useRef<ShoppingSyncRefs>({
    installedId: installedIdRef,
    savedSnapshot,
    savedRevision,
    savedList,
    supersededRevisions,
    pendingCacheRecovery,
  }).current;

  useEffect(() => {
    if (!serverList) return;
    if (!installedId) {
      const hasPendingCommands = pendingCommands.some(
        (command) =>
          command.listId === serverList.id &&
          command.resourceId === serverList.resourceId,
      );
      installInitialShoppingList(
        serverList,
        hasPendingCommands,
        refs,
        setInstalledId,
      );
      return;
    }
    if (
      serverList.id === installedId &&
      serverList.revision === savedRevision.current
    ) {
      return;
    }

    const isInstalledList = serverList.id === installedId;
    if (
      isInstalledList &&
      supersededRevisions.current.has(serverList.revision)
    ) {
      restoreSavedShoppingList(queryClient, userId, savedList.current);
      return;
    }
    if (!isInstalledList) {
      supersededRevisions.current.clear();
    } else if (savedRevision.current) {
      supersededRevisions.current.add(savedRevision.current);
    }

    rebaseInstalledShoppingList(serverList, refs, setInstalledId);
  }, [installedId, pendingCommands, queryClient, refs, serverList, userId]);

  const hasInstalledList = Boolean(installedId);
  useLayoutEffect(() => {
    if (!hasInstalledList) return;
    return new ShoppingListSaveQueue(
      queryClient,
      userId,
      serverList?.resourceId,
      refs,
      setSaveFailed,
    ).start();
  }, [hasInstalledList, queryClient, refs, serverList?.resourceId, userId]);

  return { installedId, saveFailed };
}

function useOfflineShoppingListRestore(
  userId: string,
  enabled: boolean,
): ShoppingCommandOutboxRecord[] | undefined {
  const queryClient = useQueryClient();
  const [restored, setRestored] = useState<{
    userId: string;
    commands: ShoppingCommandOutboxRecord[];
  }>();
  useEffect(() => {
    let disposed = false;
    if (!enabled) {
      setRestored(undefined);
      return;
    }
    void Promise.all([
      loadOfflineShoppingListSnapshot(userId).catch(() => null),
      listShoppingCommands(userId).catch(() => []),
    ])
      .then(([snapshot, commands]) => {
        if (
          !disposed &&
          snapshot &&
          queryClient.getQueryData(recipeQueryKeys.shoppingList(userId)) ===
            undefined
        ) {
          restoreOfflineShoppingListQuery(
            queryClient,
            userId,
            snapshot.shoppingList,
            snapshot.savedAt,
          );
        }
        if (!disposed) setRestored({ userId, commands });
      })
      .catch(() => {
        if (!disposed) setRestored({ userId, commands: [] });
      });
    return () => {
      disposed = true;
    };
  }, [enabled, queryClient, userId]);
  return restored?.userId === userId ? restored.commands : undefined;
}

function ShoppingListSyncStatus({
  saveFailed,
  commandSync,
}: Readonly<{
  saveFailed: boolean;
  commandSync: ReturnType<typeof useShoppingCommandSync>;
}>) {
  return (
    <>
      {saveFailed ? (
        <p className="rt-body bg-[var(--cream-dark)] px-4 py-2 text-center">
          Your latest shopping-list changes have not been saved. They remain on
          this device; edit the list to try again.
        </p>
      ) : null}
      {commandSync.pending.length > 0 ? (
        <p
          role="status"
          className="rt-body bg-[var(--butter-soft)] px-4 py-2 text-center"
        >
          {commandSync.pending.length} offline shopping-list change
          {commandSync.pending.length === 1 ? " is" : "s are"} waiting to sync.
        </p>
      ) : null}
      {commandSync.failed.length > 0 ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-center gap-3 bg-[var(--cream-dark)] px-4 py-2 text-center"
        >
          <p className="rt-body text-[var(--berry)]">
            An offline shopping-list change needs attention.{" "}
            {commandSync.failed[0]?.lastError}
          </p>
          <button
            type="button"
            onClick={commandSync.useServerVersion}
            className="rt-mono underline"
          >
            Use server version
          </button>
        </div>
      ) : null}
    </>
  );
}

export function ShoppingListBoundary({
  children,
}: Readonly<{ children: ReactNode }>) {
  const { data: session } = authClient.useSession();
  const userId = session?.user.id ?? "pending";
  const restoredCommands = useOfflineShoppingListRestore(
    userId,
    Boolean(session),
  );

  const current = useQuery({
    ...shoppingListQuery(userId),
    enabled: Boolean(session) && restoredCommands !== undefined,
  });
  const { installedId, saveFailed } = useShoppingListSync(
    userId,
    current.data,
    restoredCommands ?? EMPTY_OUTBOX_COMMANDS,
  );
  const commandSync = useShoppingCommandSync(
    userId,
    current.data,
    installedId,
    restoredCommands ?? EMPTY_OUTBOX_COMMANDS,
  );

  if (current.isError && !current.data) {
    return (
      <p className="rt-body p-8 text-center">
        Your shopping list could not be loaded.
      </p>
    );
  }
  if (!current.data || !installedId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="animate-spin text-[var(--terracotta)]" />
      </div>
    );
  }
  return (
    <ShoppingListScopeContext.Provider value={current.data.scope}>
      <ShoppingListSyncStatus
        saveFailed={saveFailed}
        commandSync={commandSync}
      />
      {children}
    </ShoppingListScopeContext.Provider>
  );
}

export function useStartNewShoppingList() {
  const { data: session } = authClient.useSession();
  const userId = session?.user.id ?? "pending";
  const queryClient = useQueryClient();
  const queryKey = recipeQueryKeys.shoppingList(userId);
  const mutation = useMutation({
    mutationFn: async ({
      current,
      previous,
    }: {
      current: StoredShoppingList;
      previous: ShoppingListState;
    }) => {
      await pendingShoppingListSaves.get(current.id);
      const latest =
        queryClient.getQueryData<StoredShoppingList>(queryKey) ?? current;
      if (latest.id !== current.id) {
        throw new Error("A new shopping list has already been started");
      }
      return startNewShoppingList(latest.id, latest.revision, {
        recipes: previous.recipes,
        checked: previous.checked,
        extras: previous.extras,
        plan: previous.plan,
      });
    },
    onSuccess: (next) => {
      resetShoppingTripCompletion();
      queryClient.setQueryData<StoredShoppingList>(queryKey, next);
    },
    onError: async (_error, { current, previous }) => {
      let recoveredRevision = current.revision;
      let recoveredSnapshot = current.snapshot;
      try {
        const latest = await queryClient.fetchQuery({
          ...shoppingListQuery(userId),
          staleTime: 0,
        });
        if (latest.id !== current.id) return;
        recoveredRevision = latest.revision;
        recoveredSnapshot = latest.snapshot;
      } catch {
        // If reconciliation is also offline, restoring the browser copy is the
        // only non-destructive option. A later edit can retry persistence.
      }
      installShoppingListSnapshot(
        previous,
        current.id,
        "install",
        true,
        recoveredRevision,
        {
          confirmedSnapshot: recoveredSnapshot,
          hasUnsavedChanges:
            JSON.stringify(previous) !== JSON.stringify(recoveredSnapshot),
        },
        current.resourceId,
      );
    },
  });
  const start = () => {
    const current = queryClient.getQueryData<StoredShoppingList>(queryKey);
    if (!current || mutation.isPending) return;
    const previous = getShoppingListSnapshot();

    // An install updates the screen immediately without scheduling an empty
    // PUT against the list that the POST is about to archive.
    installShoppingListSnapshot(
      { recipes: [], checked: [], extras: [], plan: previous.plan },
      current.id,
      "install",
      false,
      current.revision,
      undefined,
      current.resourceId,
    );
    mutation.mutate({ current, previous });
  };

  return { ...mutation, start };
}
