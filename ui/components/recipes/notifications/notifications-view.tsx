"use client";

import { useQueryClient } from "@tanstack/react-query";
import { isAbortError } from "browser-base/errors";
import { Bell, LoaderCircle, Lock, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { NotificationContent } from "@/components/recipes/notifications/notification-content";
import { Button } from "@/components/ui/button";
import {
  clearAllNotifications,
  getNotificationPage,
  type InAppNotification,
  markAllNotificationsRead,
  performNotificationAction,
  updateNotification,
} from "@/lib/api/notifications";
import { authClient } from "@/lib/auth-client";
import { recipeQueryKeys } from "@/lib/query/recipe-query-keys";

function bucket(date: string) {
  const age = Date.now() - new Date(date).getTime();
  if (age < 24 * 60 * 60 * 1000) return "Today";
  if (age < 7 * 24 * 60 * 60 * 1000) return "This week";
  return "Earlier";
}

function relativeTime(date: string) {
  const seconds = Math.max(
    1,
    Math.floor((Date.now() - new Date(date).getTime()) / 1000),
  );
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(date));
}

function NotificationRow({
  item,
  acting,
  onRespond,
  onDismiss,
}: Readonly<{
  item: InAppNotification;
  acting: boolean;
  onRespond: (item: InAppNotification, actionKey: string) => void;
  onDismiss: (item: InAppNotification) => void;
}>) {
  return (
    <article
      className={`group flex gap-3 rounded-xl p-3 sm:p-4 ${item.readAt ? "" : "bg-[var(--butter)]/15"}`}
    >
      <span
        className="mt-4 size-2 shrink-0 rounded-full bg-[var(--terracotta)]"
        style={{ visibility: item.readAt ? "hidden" : "visible" }}
      />
      <div className="flex min-w-0 flex-1 gap-3">
        <NotificationContent
          item={item}
          acting={acting}
          onAction={(actionKey) => onRespond(item, actionKey)}
        />
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <time className="rt-mono text-[var(--ink-4)]">
          {relativeTime(item.occurredAt)}
        </time>
        <button
          type="button"
          aria-label="Dismiss notification"
          disabled={acting}
          className="flex size-6 items-center justify-center rounded-full border border-[var(--line-strong)] text-[var(--ink-3)] opacity-100 transition-colors hover:bg-[var(--terracotta)] hover:text-white focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
          onClick={() => onDismiss(item)}
        >
          <X className="size-3" />
        </button>
      </div>
    </article>
  );
}

function NotificationGroup({
  label,
  items,
  actingId,
  onRespond,
  onDismiss,
}: Readonly<{
  label: string;
  items: InAppNotification[];
  actingId: string | null;
  onRespond: (item: InAppNotification, actionKey: string) => void;
  onDismiss: (item: InAppNotification) => void;
}>) {
  if (items.length === 0) return null;
  return (
    <section className="mt-7">
      <div className="mb-1 flex items-center gap-3">
        <h2 className="rt-mono text-[var(--ink-3)]">{label}</h2>
        <span className="h-px flex-1 bg-[var(--line)]" />
      </div>
      <div className="space-y-1">
        {items.map((item) => (
          <NotificationRow
            key={item.id}
            item={item}
            acting={actingId === item.id}
            onRespond={onRespond}
            onDismiss={onDismiss}
          />
        ))}
      </div>
    </section>
  );
}

export function NotificationsView() {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const queryClient = useQueryClient();
  const sessionUserId = session?.user.id;
  const [items, setItems] = useState<InAppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (userId: string, signal?: AbortSignal) => {
    try {
      setError(null);
      const page = await getNotificationPage(0, signal);
      if (signal?.aborted) return;
      setItems(page.items);
      setNextOffset(page.nextOffset);
      setUnreadCount(page.unreadCount);
      setLoadedUserId(userId);
    } catch (cause) {
      if (!isAbortError(cause)) {
        setLoadedUserId(userId);
        setError(
          cause instanceof Error
            ? cause.message
            : "Couldn't load notifications.",
        );
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setItems([]);
    setNextOffset(null);
    setUnreadCount(0);
    setLoadedUserId(null);
    if (!sessionUserId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    void load(sessionUserId, controller.signal);
    return () => controller.abort();
  }, [load, sessionUserId]);

  async function performAction(item: InAppNotification, actionKey: string) {
    setActing(item.id);
    try {
      setError(null);
      const updated = await performNotificationAction(item.id, actionKey);
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id ? updated : candidate,
        ),
      );
      if (!item.readAt && updated.readAt) {
        setUnreadCount((current) => Math.max(0, current - 1));
      }
      if (
        actionKey === "add_to_recipe_box" &&
        sessionUserId &&
        updated.detail?.type === "recipe_recommendation" &&
        updated.detail.saved
      ) {
        void Promise.allSettled([
          queryClient.invalidateQueries({
            queryKey: recipeQueryKeys.recipeBox(sessionUserId),
          }),
          queryClient.invalidateQueries({
            queryKey: recipeQueryKeys.bootstrap(sessionUserId),
          }),
        ]);
      }
      if (actionKey === "accept" && sessionUserId) {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: recipeQueryKeys.pantry(sessionUserId),
            exact: true,
          }),
          queryClient.invalidateQueries({
            queryKey: recipeQueryKeys.householdSettings(sessionUserId),
            exact: true,
          }),
          queryClient.invalidateQueries({
            queryKey: recipeQueryKeys.equipmentReadiness(sessionUserId),
            exact: true,
          }),
        ]);
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Couldn't complete notification action.",
      );
    } finally {
      setActing(null);
    }
  }

  async function dismiss(item: InAppNotification) {
    if (acting === item.id) return;
    setActing(item.id);
    try {
      setError(null);
      await updateNotification(item.id, { dismissed: true });
      setItems((current) => current.filter(({ id }) => id !== item.id));
      if (!item.readAt) {
        setUnreadCount((current) => Math.max(0, current - 1));
      }
      setNextOffset((current) =>
        current === null ? null : Math.max(0, current - 1),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Couldn't dismiss notification.",
      );
    } finally {
      setActing(null);
    }
  }

  async function markAllRead() {
    try {
      setError(null);
      await markAllNotificationsRead();
      const readAt = new Date().toISOString();
      setItems((current) =>
        current.map((item) => ({ ...item, readAt: item.readAt ?? readAt })),
      );
      setUnreadCount(0);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Couldn't mark notifications as read.",
      );
    }
  }

  async function clearAll() {
    setClearing(true);
    try {
      setError(null);
      await clearAllNotifications();
      setItems([]);
      setNextOffset(null);
      setUnreadCount(0);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Couldn't clear notifications.",
      );
    } finally {
      setClearing(false);
    }
  }

  async function loadMore() {
    if (nextOffset === null || loadingMore) return;
    setLoadingMore(true);
    try {
      setError(null);
      const page = await getNotificationPage(nextOffset);
      setItems((current) => {
        const existingIds = new Set(current.map(({ id }) => id));
        return [
          ...current,
          ...page.items.filter(({ id }) => !existingIds.has(id)),
        ];
      });
      setNextOffset(page.nextOffset);
      setUnreadCount(page.unreadCount);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Couldn't load more notifications.",
      );
    } finally {
      setLoadingMore(false);
    }
  }

  if (
    sessionPending ||
    (session && (loading || loadedUserId !== session.user.id))
  ) {
    return (
      <div className="flex flex-1 items-center justify-center py-24">
        <LoaderCircle className="size-6 animate-spin text-[var(--ink-3)]" />
      </div>
    );
  }
  if (!session) {
    return (
      <div className="container mx-auto max-w-lg px-4 py-16 text-center">
        <Lock className="mx-auto mb-4 size-8 text-[var(--terracotta)]" />
        <h1 className="rt-display text-4xl">Sign in to see notifications.</h1>
        <Button asChild className="mt-5">
          <Link href="/recipes">Back to recipes</Link>
        </Button>
      </div>
    );
  }

  const groups = ["Today", "This week", "Earlier"].map((label) => ({
    label,
    items: items.filter((item) => bucket(item.occurredAt) === label),
  }));

  return (
    <div className="container mx-auto w-full max-w-3xl px-4 py-8 md:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="rt-mono text-[var(--terracotta)]">
            <Bell className="mr-1 inline size-3.5" /> Notifications
          </p>
          <h1 className="rt-display mt-1 text-5xl md:text-6xl">
            Everything,{" "}
            <span className="text-[var(--terracotta)]">in one place.</span>
          </h1>
          <p className="rt-body mt-2 text-[var(--ink-2)]">
            {unreadCount} unread · activity across your recipes and account.
          </p>
        </div>
        {items.length > 0 && (
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <Button variant="outline" size="sm" onClick={markAllRead}>
                Mark all read
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={clearing}
              onClick={clearAll}
            >
              {clearing ? "Clearing…" : "Clear all"}
            </Button>
          </div>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="rt-body mt-5 rounded-xl border border-[var(--berry)]/40 bg-[var(--card)] p-3 text-[var(--berry)]"
        >
          {error}
        </p>
      )}
      {items.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-[var(--line-strong)] bg-[var(--card)] px-6 py-14 text-center">
          <Bell className="mx-auto size-9 text-[var(--sage)]" />
          <h2 className="rt-display mt-3 text-3xl">You're all caught up.</h2>
          <p className="rt-body mt-1 text-[var(--ink-3)]">
            New activity will land here.
          </p>
        </div>
      ) : (
        <>
          {groups.map((group) => (
            <NotificationGroup
              key={group.label}
              label={group.label}
              items={group.items}
              actingId={acting}
              onRespond={(item, actionKey) => performAction(item, actionKey)}
              onDismiss={(item) => dismiss(item)}
            />
          ))}
          {nextOffset !== null && (
            <div className="mt-8 text-center">
              <Button
                variant="outline"
                disabled={loadingMore}
                onClick={loadMore}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
