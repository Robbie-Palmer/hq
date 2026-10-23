"use client";

import { useQueryClient } from "@tanstack/react-query";
import { WifiOff } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { authClient } from "@/lib/auth-client";
import { clearCookingTimerStorage } from "@/lib/cooking/timerStore";
import {
  clearOfflineRecipeSnapshots,
  getOfflineCacheStatus,
  getServerOfflineCacheStatus,
  subscribeOfflineCacheStatus,
} from "@/lib/pwa/offline-recipe-cache";
import { recipeQueryKeys } from "@/lib/query/recipe-query-keys";
import { clearShoppingListStorage } from "@/lib/shopping/shoppingListStore";

const PRIVATE_RECIPE_CACHE_NAMES = ["recipe-session-v1", "recipe-images-v2"];

async function connectionIsUnavailable(): Promise<boolean> {
  if (navigator.onLine) return false;

  try {
    await fetch(`/robots.txt?online-check=${Date.now()}`, {
      cache: "no-store",
      credentials: "same-origin",
      method: "HEAD",
    });
    return false;
  } catch {
    return true;
  }
}

async function clearPrivateRecipeCaches(): Promise<void> {
  if (!("caches" in window)) return;
  await Promise.allSettled(
    PRIVATE_RECIPE_CACHE_NAMES.map((cacheName) =>
      window.caches.delete(cacheName),
    ),
  );
}

export async function clearOfflineRecipeData(): Promise<void> {
  try {
    await clearOfflineRecipeSnapshots();
  } finally {
    clearCookingTimerStorage();
    clearShoppingListStorage();
    await clearPrivateRecipeCaches();
    if ("serviceWorker" in navigator) {
      const message = { type: "CLEAR_RECIPE_OFFLINE_DATA" };
      try {
        navigator.serviceWorker.controller?.postMessage(message);
      } catch {
        // The active registration below may still receive the cleanup request.
      }
      void navigator.serviceWorker.ready
        .then((registration) => {
          registration.active?.postMessage(message);
        })
        .catch(() => {
          // The signed-out user must not be held on this page for SW cleanup.
        });
    }
  }
}

export function formatOfflineSnapshotAge(
  savedAt: number,
  now = Date.now(),
): string {
  const ageMinutes = Math.max(0, Math.floor((now - savedAt) / 60_000));
  if (ageMinutes < 1) return "less than a minute ago";
  if (ageMinutes < 60) {
    return `${ageMinutes} minute${ageMinutes === 1 ? "" : "s"} ago`;
  }
  const ageHours = Math.floor(ageMinutes / 60);
  if (ageHours < 24) {
    return `${ageHours} hour${ageHours === 1 ? "" : "s"} ago`;
  }
  const ageDays = Math.floor(ageHours / 24);
  return `${ageDays} day${ageDays === 1 ? "" : "s"} ago`;
}

function useAuthenticatedOfflineDataCleanup(
  isPending: boolean,
  userId: string | undefined,
): void {
  const previousUserId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (isPending) return;
    if (userId) {
      if (previousUserId.current && previousUserId.current !== userId) {
        clearCookingTimerStorage();
        clearShoppingListStorage();
      }
      previousUserId.current = userId;
      return;
    }
    if (!previousUserId.current) return;
    previousUserId.current = undefined;
    void clearOfflineRecipeData().catch(() => {
      // Server-side sign-out or account deletion still wins if local storage
      // is unavailable.
    });
  }, [isPending, userId]);
}

function useOfflineConnectivity(): boolean {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let disposed = false;
    let latestCheck = 0;

    const checkConnection = async () => {
      const check = ++latestCheck;
      const unavailable = await connectionIsUnavailable();
      if (!disposed && check === latestCheck) setOffline(unavailable);
    };
    const handleOnline = () => {
      latestCheck += 1;
      setOffline(false);
    };
    const handleOffline = () => void checkConnection();

    void checkConnection();
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      disposed = true;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);
  return offline;
}

function useRecipeServiceWorker(
  userId: string | undefined,
  offline: boolean,
): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    let disposed = false;
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }

    void navigator.serviceWorker
      .register("/recipes-sw.js", { scope: "/recipes" })
      .then(() => navigator.serviceWorker.ready)
      .then(async () => {
        if (disposed || !userId || offline) return;
        await fetch("/api/auth/get-session", { credentials: "same-origin" });
        if (disposed) return;
        await queryClient.invalidateQueries({
          queryKey: recipeQueryKeys.bootstrap(userId),
        });
      })
      .catch(() => {
        // The web app remains usable online when registration or priming fails.
      });

    return () => {
      disposed = true;
    };
  }, [offline, queryClient, userId]);
}

function offlineStatusMessage(
  offline: boolean,
  oldestSavedAt: number | null,
  quotaExceeded: boolean,
): string {
  const messages: string[] = [];
  if (offline) {
    messages.push(
      oldestSavedAt === null
        ? "Offline. Saved data is read-only until you reconnect."
        : `Offline. Showing saved data from ${formatOfflineSnapshotAge(oldestSavedAt)}.`,
    );
  }
  if (quotaExceeded) {
    messages.push(
      "Offline data could not be updated because browser storage is full.",
    );
  }
  return messages.join(" ");
}

export function RecipePwa() {
  const { data: session, isPending } = authClient.useSession();
  const userId = session?.user.id;
  const offline = useOfflineConnectivity();
  const cacheStatus = useSyncExternalStore(
    subscribeOfflineCacheStatus,
    getOfflineCacheStatus,
    getServerOfflineCacheStatus,
  );
  useAuthenticatedOfflineDataCleanup(isPending, userId);
  useRecipeServiceWorker(userId, offline);

  if (!offline && !cacheStatus.quotaExceeded) return null;

  return (
    <output
      aria-live="polite"
      className="rt-mono sticky top-[61px] z-40 flex items-center justify-center gap-2 border-b border-[var(--line-strong)] bg-[var(--butter-soft)] px-4 py-2 text-center text-[var(--ink-2)] sm:top-[65px]"
    >
      <WifiOff className="size-3.5" aria-hidden="true" />
      {offlineStatusMessage(
        offline,
        cacheStatus.oldestSavedAt,
        cacheStatus.quotaExceeded,
      )}
    </output>
  );
}
