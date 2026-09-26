"use client";

import { useEffect } from "react";
import { flushCookingCompletionOutbox } from "@/lib/api/cooking-insights";
import { authClient } from "@/lib/auth-client";

const INITIAL_RETRY_DELAY_MS = 5_000;
const MAX_RETRY_DELAY_MS = 60_000;

export function CookingCompletionOutbox() {
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    const userId = session?.user.id;
    if (isPending || !userId) return;

    let cancelled = false;
    let flushInProgress = false;
    let flushRequested = false;
    let retryDelay = INITIAL_RETRY_DELAY_MS;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
    const flush = async () => {
      if (flushInProgress) {
        flushRequested = true;
        return;
      }
      flushInProgress = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = undefined;
      }
      try {
        await flushCookingCompletionOutbox(userId);
        retryDelay = INITIAL_RETRY_DELAY_MS;
      } catch (error) {
        console.error(
          "[CookingCompletionOutbox] Could not flush cooked meals",
          error,
        );
        if (!cancelled) {
          retryTimer = setTimeout(flush, retryDelay);
          retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY_MS);
        }
      } finally {
        flushInProgress = false;
        if (flushRequested && !cancelled) {
          flushRequested = false;
          void flush();
        }
      }
    };

    const handleOnline = () => {
      retryDelay = INITIAL_RETRY_DELAY_MS;
      void flush();
    };

    void flush();
    globalThis.addEventListener("online", handleOnline);
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      globalThis.removeEventListener("online", handleOnline);
    };
  }, [isPending, session?.user.id]);

  return null;
}
