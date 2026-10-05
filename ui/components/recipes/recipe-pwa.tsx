"use client";

import { useQueryClient } from "@tanstack/react-query";
import { WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { clearOfflineRecipeSnapshots } from "@/lib/pwa/offline-recipe-cache";
import { recipeQueryKeys } from "@/lib/query/recipe-query-keys";

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

export function RecipePwa() {
  const [offline, setOffline] = useState(false);
  const { data: session } = authClient.useSession();
  const queryClient = useQueryClient();

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

  useEffect(() => {
    let disposed = false;
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }

    const userId = session?.user.id;
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
  }, [offline, queryClient, session?.user.id]);

  if (!offline) return null;

  return (
    <output
      aria-live="polite"
      className="rt-mono sticky top-[61px] z-40 flex items-center justify-center gap-2 border-b border-[var(--line-strong)] bg-[var(--butter-soft)] px-4 py-2 text-center text-[var(--ink-2)] sm:top-[65px]"
    >
      <WifiOff className="size-3.5" aria-hidden="true" />
      Offline. Saved recipes are read-only until you reconnect.
    </output>
  );
}
