"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { isApiError } from "@/lib/api/http";
import {
  applyShoppingListCommand,
  type ShoppingListContents,
  type StoredShoppingList,
} from "@/lib/api/shopping-lists";
import {
  enqueueShoppingCommand,
  removeShoppingCommand,
  type ShoppingCommandOutboxRecord,
  updateShoppingCommand,
} from "@/lib/pwa/shopping-command-outbox";
import { recipeQueryKeys } from "@/lib/query/recipe-query-keys";
import {
  getShoppingListCacheIdentity,
  getShoppingListSnapshot,
  installShoppingListSnapshot,
  subscribeShoppingListCommands,
} from "@/lib/shopping/shoppingListStore";

function applyProjectedCommand(
  snapshot: ShoppingListContents,
  record: ShoppingCommandOutboxRecord,
): ShoppingListContents {
  if (record.command.itemType === "ingredient") {
    const checked = new Set(snapshot.checked);
    if (record.command.checked) checked.add(record.command.itemId);
    else checked.delete(record.command.itemId);
    return { ...snapshot, checked: [...checked] };
  }
  return {
    ...snapshot,
    extras: snapshot.extras.map((extra) =>
      extra.id === record.command.itemId
        ? { ...extra, checked: record.command.checked }
        : extra,
    ),
  };
}

function commandFailureOutcome(
  error: unknown,
): "conflict" | "dead_letter" | "retry" {
  if (!isApiError(error)) return "retry";
  if (error.status === 409) return "conflict";
  return [400, 401, 403, 422].includes(error.status) ? "dead_letter" : "retry";
}

async function recordCommandFailure(
  record: ShoppingCommandOutboxRecord,
  error: unknown,
): Promise<ShoppingCommandOutboxRecord> {
  const outcome = commandFailureOutcome(error);
  const attempts = record.attempts + 1;
  return updateShoppingCommand(record, {
    attempts,
    lastError: error instanceof Error ? error.message : "The command failed",
    nextAttemptAt:
      outcome === "retry"
        ? Date.now() + Math.min(60_000, 1_000 * 2 ** attempts)
        : Number.MAX_SAFE_INTEGER,
    outcome,
  });
}

async function replayShoppingCommandQueue({
  canonical: initialCanonical,
  commands,
  ready,
  userId,
}: {
  canonical: StoredShoppingList;
  commands: ShoppingCommandOutboxRecord[];
  ready: ShoppingCommandOutboxRecord[];
  userId: string;
}): Promise<{
  canonical: StoredShoppingList;
  remaining: ShoppingCommandOutboxRecord[];
}> {
  let canonical = initialCanonical;
  let remaining = commands;
  for (const [index, queued] of ready.entries()) {
    const record =
      index === 0 || queued.baseRevision === canonical.revision
        ? queued
        : await updateShoppingCommand(queued, {
            baseRevision: canonical.revision,
          });
    try {
      canonical = await applyShoppingListCommand({
        commandId: record.commandId,
        listId: record.listId,
        baseRevision: record.baseRevision,
        command: record.command,
      });
      await removeShoppingCommand(userId, record.commandId);
      remaining = remaining.filter(
        ({ commandId }) => commandId !== record.commandId,
      );
    } catch (error) {
      const updated = await recordCommandFailure(record, error);
      remaining = remaining.map((candidate) =>
        candidate.commandId === updated.commandId ? updated : candidate,
      );
      break;
    }
  }
  return { canonical, remaining };
}

export function useShoppingCommandSync(
  userId: string,
  serverList: StoredShoppingList | undefined,
  installedId: string | undefined,
  initialCommands: readonly ShoppingCommandOutboxRecord[],
) {
  const queryClient = useQueryClient();
  const [commands, setCommands] = useState<ShoppingCommandOutboxRecord[]>([
    ...initialCommands,
  ]);
  const [replayTick, setReplayTick] = useState(0);
  const replaying = useRef(false);

  useEffect(() => setCommands([...initialCommands]), [initialCommands]);

  useEffect(() => {
    if (!serverList || installedId !== serverList.id) return;
    return subscribeShoppingListCommands((intent) => {
      const { revision } = getShoppingListCacheIdentity();
      if (!revision) return;
      void enqueueShoppingCommand({
        ...intent,
        actorUserId: userId,
        resourceId: serverList.resourceId,
        householdId:
          serverList.scope.type === "household"
            ? serverList.scope.household.id
            : null,
        listId: serverList.id,
        baseRevision: revision,
      })
        .then((record) => setCommands((current) => [...current, record]))
        .catch(() => {
          installShoppingListSnapshot(
            getShoppingListSnapshot(),
            serverList.id,
            "local",
            true,
            revision,
            undefined,
            serverList.resourceId,
          );
        });
    });
  }, [installedId, serverList, userId]);

  useEffect(() => {
    const replay = () => setReplayTick((current) => current + 1);
    globalThis.addEventListener("online", replay);
    return () => globalThis.removeEventListener("online", replay);
  }, []);

  useEffect(() => {
    const retryAt = Math.min(
      ...commands
        .filter(({ outcome }) => outcome === "retry")
        .map(({ nextAttemptAt }) => nextAttemptAt),
    );
    if (!Number.isFinite(retryAt)) return;
    const timer = setTimeout(
      () => setReplayTick((current) => current + 1),
      Math.max(0, retryAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [commands]);

  useEffect(() => {
    if (
      !serverList ||
      installedId !== serverList.id ||
      replaying.current ||
      globalThis.navigator?.onLine === false
    ) {
      return;
    }
    const ready = commands.filter(
      (record) =>
        record.listId === serverList.id &&
        record.resourceId === serverList.resourceId &&
        (record.outcome === "pending" || record.outcome === "retry") &&
        record.nextAttemptAt <= Math.max(Date.now(), replayTick),
    );
    if (ready.length === 0) return;
    replaying.current = true;
    void replayShoppingCommandQueue({
      canonical: serverList,
      commands: [...commands],
      ready,
      userId,
    })
      .then(({ canonical, remaining }) => {
        const projected = remaining
          .filter(
            (record) =>
              record.listId === canonical.id &&
              record.resourceId === canonical.resourceId,
          )
          .reduce(applyProjectedCommand, canonical.snapshot);
        installShoppingListSnapshot(
          projected,
          canonical.id,
          "install",
          true,
          canonical.revision,
          {
            confirmedSnapshot: canonical.snapshot,
            hasUnsavedChanges:
              JSON.stringify(projected) !== JSON.stringify(canonical.snapshot),
          },
          canonical.resourceId,
        );
        queryClient.setQueryData<StoredShoppingList>(
          recipeQueryKeys.shoppingList(userId),
          canonical,
        );
        setCommands(remaining);
      })
      .finally(() => {
        replaying.current = false;
      });
  }, [commands, installedId, queryClient, replayTick, serverList, userId]);

  const failed = commands.filter(
    ({ outcome }) => outcome === "conflict" || outcome === "dead_letter",
  );
  const pending = commands.filter(
    ({ outcome }) => outcome === "pending" || outcome === "retry",
  );
  const useServerVersion = () => {
    const discarded = serverList
      ? commands.filter(
          (record) =>
            record.listId === serverList.id &&
            record.resourceId === serverList.resourceId,
        )
      : failed;
    void Promise.all(
      discarded.map((record) =>
        removeShoppingCommand(record.actorUserId, record.commandId),
      ),
    ).then(() => {
      setCommands((current) =>
        current.filter(
          ({ commandId }) =>
            !discarded.some((record) => record.commandId === commandId),
        ),
      );
      if (serverList) {
        installShoppingListSnapshot(
          serverList.snapshot,
          serverList.id,
          "install",
          true,
          serverList.revision,
          undefined,
          serverList.resourceId,
        );
      }
      void queryClient.invalidateQueries({
        queryKey: recipeQueryKeys.shoppingList(userId),
      });
    });
  };
  return { failed, pending, useServerVersion };
}
