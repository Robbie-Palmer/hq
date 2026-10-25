import {
  type ShoppingListCommandRequest,
  ShoppingListCommandRequestSchema,
} from "recipe-domain/shopping-list";
import { z } from "zod";

const DATABASE_NAME = "robbies-recipes";
const DATABASE_VERSION = 3;
const SNAPSHOT_STORE = "offline-snapshots";
const OUTBOX_STORE = "shopping-command-outbox";
let lastEnqueuedAt = 0;

export const ShoppingCommandOutcomeSchema = z.enum([
  "pending",
  "retry",
  "conflict",
  "dead_letter",
]);

export type ShoppingCommandOutcome = z.infer<
  typeof ShoppingCommandOutcomeSchema
>;

export const ShoppingCommandOutboxRecordSchema =
  ShoppingListCommandRequestSchema.extend({
    key: z.string().min(1),
    actorUserId: z.string().min(1),
    resourceId: z.string().min(1),
    householdId: z.string().min(1).nullable(),
    outcome: ShoppingCommandOutcomeSchema,
    attempts: z.number().int().nonnegative().safe(),
    nextAttemptAt: z.number().int().nonnegative().safe(),
    lastError: z.string().optional(),
    createdAt: z.number().int().nonnegative().safe(),
    updatedAt: z.number().int().nonnegative().safe(),
  }).strict();

export type ShoppingCommandOutboxRecord = z.infer<
  typeof ShoppingCommandOutboxRecordSchema
>;

export type NewShoppingCommand = ShoppingListCommandRequest & {
  actorUserId: string;
  resourceId: string;
  householdId: string | null;
};

function commandKey(actorUserId: string, commandId: string): string {
  return `${actorUserId}:${commandId}`;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) {
        database.createObjectStore(SNAPSHOT_STORE, { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains(OUTBOX_STORE)) {
        database.createObjectStore(OUTBOX_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open the command outbox"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Command outbox request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () =>
      reject(
        transaction.error ?? new Error("Command outbox transaction failed"),
      );
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  if (typeof indexedDB === "undefined") {
    throw new TypeError("IndexedDB is unavailable");
  }
  const database = await openDatabase();
  try {
    const transaction = database.transaction(OUTBOX_STORE, mode);
    const completed = transactionDone(transaction);
    const result = await operation(transaction.objectStore(OUTBOX_STORE));
    await completed;
    return result;
  } finally {
    database.close();
  }
}

export function enqueueShoppingCommand(
  command: NewShoppingCommand,
): Promise<ShoppingCommandOutboxRecord> {
  const now = Math.max(Date.now(), lastEnqueuedAt + 1);
  lastEnqueuedAt = now;
  const record: ShoppingCommandOutboxRecord = {
    ...command,
    key: commandKey(command.actorUserId, command.commandId),
    outcome: "pending",
    attempts: 0,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  };
  return withStore("readwrite", async (store) => {
    await requestResult(store.put(record));
    return record;
  });
}

export function listShoppingCommands(
  actorUserId: string,
): Promise<ShoppingCommandOutboxRecord[]> {
  return withStore("readonly", async (store) => {
    const values: unknown[] = await requestResult(store.getAll());
    return values
      .flatMap((value) => {
        const parsed = ShoppingCommandOutboxRecordSchema.safeParse(value);
        return parsed.success ? [parsed.data] : [];
      })
      .filter((record) => record.actorUserId === actorUserId)
      .sort((left, right) => left.createdAt - right.createdAt);
  });
}

export function updateShoppingCommand(
  record: ShoppingCommandOutboxRecord,
  changes: Partial<
    Pick<
      ShoppingCommandOutboxRecord,
      "attempts" | "baseRevision" | "lastError" | "nextAttemptAt" | "outcome"
    >
  >,
): Promise<ShoppingCommandOutboxRecord> {
  const updated = { ...record, ...changes, updatedAt: Date.now() };
  return withStore("readwrite", async (store) => {
    await requestResult(store.put(updated));
    return updated;
  });
}

export function removeShoppingCommand(
  actorUserId: string,
  commandId: string,
): Promise<void> {
  return withStore("readwrite", async (store) => {
    await requestResult(store.delete(commandKey(actorUserId, commandId)));
  });
}

export function clearShoppingCommandOutbox(): Promise<void> {
  if (typeof indexedDB === "undefined") return Promise.resolve();
  return withStore("readwrite", async (store) => {
    await requestResult(store.clear());
  });
}
