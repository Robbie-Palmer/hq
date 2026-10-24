"use client";

import posthog from "posthog-js";
import { useEffect, useRef } from "react";
import { authClient } from "@/lib/auth-client";
import {
  readBrowserStorage,
  removeBrowserStorage,
  writeBrowserStorage,
} from "@/lib/browser/storage";

const IDENTIFIED_USER_STORAGE_KEY = "recipe-posthog-identified-user:v1";

function readPersistedUserId(): string | null {
  return readBrowserStorage("localStorage", IDENTIFIED_USER_STORAGE_KEY);
}

function persistUserId(userId: string | null): void {
  if (userId) {
    writeBrowserStorage("localStorage", IDENTIFIED_USER_STORAGE_KEY, userId);
  } else {
    removeBrowserStorage("localStorage", IDENTIFIED_USER_STORAGE_KEY);
  }
}

/**
 * Joins pre-auth recipe activity to the authenticated user without sending
 * names or email addresses to product analytics.
 */
export function RecipeAnalyticsIdentity() {
  const { data: session, isPending } = authClient.useSession();
  const identifiedUserId = useRef<string | null>(null);

  useEffect(() => {
    if (isPending) return;

    const userId = session?.user.id ?? null;
    const persistedUserId = readPersistedUserId();
    if (userId && identifiedUserId.current !== userId) {
      if (persistedUserId && persistedUserId !== userId) {
        posthog.reset();
      }
      posthog.identify(userId, {
        recipe_user_role: session?.user.role ?? "user",
      });
      identifiedUserId.current = userId;
      persistUserId(userId);
      return;
    }

    if (!userId && (identifiedUserId.current || persistedUserId)) {
      posthog.reset();
      identifiedUserId.current = null;
      persistUserId(null);
    }
  }, [isPending, session?.user.id, session?.user.role]);

  return null;
}
