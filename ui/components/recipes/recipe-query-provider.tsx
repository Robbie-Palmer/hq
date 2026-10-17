"use client";

import {
  hashKey,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { PantryRealtimeBoundary } from "@/components/recipes/pantry-realtime-boundary";
import type { RecipeBootstrap } from "@/lib/api/recipe-bootstrap";
import { authClient } from "@/lib/auth-client";
import { setCookingTimerOwner } from "@/lib/cooking/timerStore";
import {
  loadOfflineRecipeSnapshot,
  saveOfflineRecipeSnapshot,
} from "@/lib/pwa/offline-recipe-cache";
import {
  clearOtherPrivateRecipeQueries,
  createRecipeQueryClient,
} from "@/lib/query/recipe-query-client";
import { recipeQueryKeys } from "@/lib/query/recipe-query-keys";
import { setShoppingListOwner } from "@/lib/shopping/shoppingListStore";

const RecipeQueryDevtools =
  process.env.NODE_ENV === "development"
    ? dynamic(
        () =>
          import("@tanstack/react-query-devtools").then(
            (module) => module.ReactQueryDevtools,
          ),
        { ssr: false },
      )
    : null;

let browserQueryClient: ReturnType<typeof createRecipeQueryClient> | undefined;

function getRecipeQueryClient() {
  if (typeof window === "undefined") return createRecipeQueryClient();
  browserQueryClient ??= createRecipeQueryClient();
  return browserQueryClient;
}

export function RecipeAccountCacheBoundary() {
  const { data: session, isPending } = authClient.useSession();
  const queryClient = useQueryClient();
  const userId = session?.user.id ?? null;
  const activeAccount = useRef({ isPending, userId });
  activeAccount.current = { isPending, userId };

  useEffect(() => {
    if (isPending) return;
    void clearOtherPrivateRecipeQueries(queryClient, userId, () => {
      return (
        !activeAccount.current.isPending &&
        activeAccount.current.userId === userId
      );
    }).catch(() => {
      // Cache removal is best-effort; the active account guard prevents leaks.
    });
  }, [isPending, queryClient, userId]);

  return null;
}

export function OfflineRecipeCacheBoundary() {
  const { data: session, isPending } = authClient.useSession();
  const queryClient = useQueryClient();
  const userId = session?.user.id;
  const activeAccount = useRef({ isPending, userId });
  activeAccount.current = { isPending, userId };

  useEffect(() => {
    if (isPending) return;
    setCookingTimerOwner(userId);
    setShoppingListOwner(userId);
    if (!userId) return;
    let disposed = false;
    let restoring = false;
    const queryKey = recipeQueryKeys.bootstrap(userId);
    const queryHash = hashKey(queryKey);

    void loadOfflineRecipeSnapshot(userId)
      .then((snapshot) => {
        if (
          disposed ||
          !snapshot ||
          activeAccount.current.isPending ||
          activeAccount.current.userId !== userId ||
          queryClient.getQueryData(queryKey) !== undefined
        ) {
          return;
        }
        restoring = true;
        try {
          queryClient.setQueryData(queryKey, snapshot.bootstrap, {
            updatedAt: snapshot.savedAt,
          });
        } finally {
          restoring = false;
        }
      })
      .catch(() => {
        // IndexedDB can be unavailable in private browsing or restricted storage.
      });

    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (
        restoring ||
        event.type !== "updated" ||
        event.action.type !== "success" ||
        event.query.queryHash !== queryHash
      ) {
        return;
      }
      const data = queryClient.getQueryData<RecipeBootstrap>(queryKey);
      if (
        !data ||
        disposed ||
        activeAccount.current.isPending ||
        activeAccount.current.userId !== userId
      ) {
        return;
      }
      void saveOfflineRecipeSnapshot(userId, data).catch(() => {
        // A failed persistence write must not affect the live recipe query.
      });
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [isPending, queryClient, userId]);

  return null;
}

export function RecipeQueryProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const [queryClient] = useState(getRecipeQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <RecipeAccountCacheBoundary />
      <OfflineRecipeCacheBoundary />
      <PantryRealtimeBoundary />
      {children}
      {RecipeQueryDevtools ? (
        <RecipeQueryDevtools initialIsOpen={false} />
      ) : null}
    </QueryClientProvider>
  );
}
