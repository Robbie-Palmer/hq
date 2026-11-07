import {
  type CookingTimer,
  isCookingTimer,
  remainingFrom,
} from "./cookingTimersSlice";

const LEGACY_STORAGE_KEY = "cooking-timers:v1";
export const COOKING_TIMER_STORAGE_KEY_PREFIX = "cooking-timers:v2:";

type StoredCookingTimers = {
  version: 2;
  userId: string;
  timers: readonly CookingTimer[];
};

export type CookingTimerPersistence = {
  clearAll(): void;
  keyFor(userId: string): string;
  load(userId: string, nowMs: number): CookingTimer[];
  removeLegacy(): void;
  save(userId: string, timers: readonly CookingTimer[]): void;
};

function restoreTimer(timer: CookingTimer, nowMs: number): CookingTimer {
  if (timer.state !== "running" || timer.endTimeMs === null) return timer;
  const remainingSeconds = remainingFrom(timer.endTimeMs, nowMs);
  return remainingSeconds > 0
    ? { ...timer, remainingSeconds }
    : {
        ...timer,
        state: "completed",
        remainingSeconds: 0,
        endTimeMs: null,
      };
}

function isStoredCookingTimers(
  value: unknown,
  userId: string,
): value is StoredCookingTimers {
  if (typeof value !== "object" || value === null) return false;
  const stored = value as Record<string, unknown>;
  return (
    stored.version === 2 &&
    stored.userId === userId &&
    Array.isArray(stored.timers)
  );
}

export function createCookingTimerPersistence(
  storage: Pick<
    Storage,
    "getItem" | "key" | "length" | "removeItem" | "setItem"
  > = globalThis.localStorage,
): CookingTimerPersistence {
  const keyFor = (userId: string) =>
    `${COOKING_TIMER_STORAGE_KEY_PREFIX}${encodeURIComponent(userId)}`;

  return {
    clearAll() {
      try {
        storage.removeItem(LEGACY_STORAGE_KEY);
        for (let index = storage.length - 1; index >= 0; index -= 1) {
          const key = storage.key(index);
          if (key?.startsWith(COOKING_TIMER_STORAGE_KEY_PREFIX)) {
            storage.removeItem(key);
          }
        }
      } catch {
        // In-memory state can still clear when browser storage is restricted.
      }
    },
    keyFor,
    load(userId, nowMs) {
      try {
        const raw = storage.getItem(keyFor(userId));
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!isStoredCookingTimers(parsed, userId)) return [];
        return parsed.timers
          .filter(isCookingTimer)
          .map((timer) => restoreTimer(timer, nowMs));
      } catch {
        return [];
      }
    },
    removeLegacy() {
      try {
        storage.removeItem(LEGACY_STORAGE_KEY);
      } catch {
        // An unscoped legacy record must never be restored into an account.
      }
    },
    save(userId, timers) {
      try {
        const key = keyFor(userId);
        if (timers.length === 0) {
          storage.removeItem(key);
          return;
        }
        storage.setItem(
          key,
          JSON.stringify({
            version: 2,
            userId,
            timers,
          } satisfies StoredCookingTimers),
        );
      } catch {
        // A failed persistence write must not interrupt an active timer.
      }
    },
  };
}

export function clearCookingTimerStorage(): void {
  createCookingTimerPersistence().clearAll();
}
