"use client";

import { useEffect } from "react";
import { flushCookingCompletionOutbox } from "@/lib/api/cooking-insights";
import { authClient } from "@/lib/auth-client";

const INITIAL_RETRY_DELAY_MS = 5_000;
const MAX_RETRY_DELAY_MS = 60_000;

class CookingCompletionFlusher {
  private cancelled = false;
  private inProgress = false;
  private requested = false;
  private retryDelay = INITIAL_RETRY_DELAY_MS;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly userId: string) {}

  flush = async (): Promise<void> => {
    if (this.inProgress) {
      this.requested = true;
      return;
    }
    this.inProgress = true;
    this.clearRetry();
    try {
      await flushCookingCompletionOutbox(this.userId);
      this.retryDelay = INITIAL_RETRY_DELAY_MS;
    } catch (error) {
      console.error(
        "[CookingCompletionOutbox] Could not flush cooked meals",
        error,
      );
      this.scheduleRetry();
    } finally {
      this.inProgress = false;
      if (this.requested && !this.cancelled) {
        this.requested = false;
        void this.flush();
      }
    }
  };

  online = (): void => {
    this.retryDelay = INITIAL_RETRY_DELAY_MS;
    void this.flush();
  };

  dispose(): void {
    this.cancelled = true;
    this.clearRetry();
  }

  private clearRetry(): void {
    if (!this.retryTimer) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  private scheduleRetry(): void {
    if (this.cancelled) return;
    this.retryTimer = setTimeout(this.flush, this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, MAX_RETRY_DELAY_MS);
  }
}

function useCookingCompletionOutbox() {
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    const userId = session?.user.id;
    if (isPending || !userId) return;

    const flusher = new CookingCompletionFlusher(userId);
    void flusher.flush();
    globalThis.addEventListener("online", flusher.online);
    return () => {
      flusher.dispose();
      globalThis.removeEventListener("online", flusher.online);
    };
  }, [isPending, session?.user.id]);
}

export function CookingCompletionOutbox() {
  useCookingCompletionOutbox();
  return null;
}
