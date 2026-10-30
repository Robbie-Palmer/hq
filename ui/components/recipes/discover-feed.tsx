"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import {
  LoaderCircle,
  Sparkles,
  UsersRound,
  UtensilsCrossed,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { RecipeThumb } from "@/components/recipes/recipe-card";
import { RecipeQueryStatus } from "@/components/recipes/recipe-load-state";
import { RecipePageLink } from "@/components/recipes/recipe-page-link";
import { Button } from "@/components/ui/button";
import type {
  DiscoverFeedItem,
  DiscoverFeedScope,
} from "@/lib/api/discover-feed";
import { authClient } from "@/lib/auth-client";
import { savedRecipeCard } from "@/lib/domain/recipe/recipeDraft";
import { cn } from "@/lib/generic/styles";
import {
  followingDiscoverFeedQuery,
  publicDiscoverFeedQuery,
} from "@/lib/query/discover-queries";

function authorInitials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function relativeDate(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.floor(elapsed / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

function FeedCard({ item }: Readonly<{ item: DiscoverFeedItem }>) {
  const recipe = savedRecipeCard(item.recipe);
  return (
    <article className="overflow-hidden rounded-xl border border-[var(--line-strong)] bg-[var(--card)] shadow-[var(--paper-shadow)]">
      <header className="flex items-center gap-3 px-4 py-3 sm:px-5">
        <Link
          href={`/recipes/cooks?cook=${encodeURIComponent(item.author.id)}`}
          className="group/author flex min-w-0 flex-1 items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[var(--terracotta)]"
        >
          <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--line-strong)] bg-[var(--butter-soft)]">
            {item.author.image ? (
              // biome-ignore lint/performance/noImgElement: remote auth avatars do not have a stable image host.
              <img
                src={item.author.image}
                alt=""
                className="size-full object-cover"
              />
            ) : (
              <span className="rt-display text-lg text-[var(--terracotta-deep)]">
                {authorInitials(item.author.name)}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="rt-body truncate text-sm text-[var(--ink)]">
              <span className="font-bold underline-offset-2 group-hover/author:underline">
                {item.author.name}
              </span>{" "}
              added a recipe
            </p>
            <time
              dateTime={item.createdAt}
              className="rt-mono text-[0.68rem] uppercase tracking-wide text-[var(--ink-3)]"
            >
              {relativeDate(item.createdAt)}
            </time>
          </div>
        </Link>
      </header>
      <RecipePageLink
        href={`/recipes/${encodeURIComponent(item.recipe.slug)}`}
        className="group flex gap-4 border-t border-[var(--line)] p-4 transition-colors hover:bg-[var(--paper-warm)]/60 sm:p-5"
      >
        {recipe ? (
          <RecipeThumb recipe={recipe} size={88} className="sm:!size-28" />
        ) : (
          <div className="flex size-[88px] shrink-0 items-center justify-center rounded-lg bg-[var(--paper-warm)] text-[var(--terracotta)] sm:size-28">
            <UtensilsCrossed className="size-6" />
          </div>
        )}
        <div className="min-w-0 self-center">
          <p className="rt-mono text-[0.68rem] uppercase tracking-wide text-[var(--terracotta)]">
            New recipe
          </p>
          <h2 className="rt-display mt-1 text-3xl leading-none transition-colors group-hover:text-[var(--terracotta)] sm:text-4xl">
            {item.recipe.title}
          </h2>
          {item.recipe.description ? (
            <p className="rt-body mt-2 line-clamp-2 text-sm text-[var(--ink-2)]">
              {item.recipe.description}
            </p>
          ) : null}
        </div>
      </RecipePageLink>
    </article>
  );
}

function FeedScopeTabs({
  scope,
  followingEnabled,
  showSignedOutMessage,
  onScopeChange,
}: Readonly<{
  scope: DiscoverFeedScope;
  followingEnabled: boolean;
  showSignedOutMessage: boolean;
  onScopeChange: (scope: DiscoverFeedScope) => void;
}>) {
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-2 rounded-xl border border-[var(--line)] bg-[var(--paper-warm)] p-1.5">
        <button
          type="button"
          aria-pressed={scope === "public"}
          onClick={() => onScopeChange("public")}
          className={cn(
            "rt-body flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-bold transition-colors",
            scope === "public"
              ? "bg-[var(--card)] text-[var(--terracotta-deep)] shadow-sm"
              : "text-[var(--ink-3)] hover:text-[var(--ink)]",
          )}
        >
          <Sparkles className="size-4" /> For you
        </button>
        <button
          type="button"
          aria-pressed={scope === "following"}
          disabled={!followingEnabled}
          onClick={() => onScopeChange("following")}
          className={cn(
            "rt-body flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-45",
            scope === "following"
              ? "bg-[var(--card)] text-[var(--terracotta-deep)] shadow-sm"
              : "text-[var(--ink-3)] hover:text-[var(--ink)]",
          )}
        >
          <UsersRound className="size-4" /> Following
        </button>
      </div>
      {showSignedOutMessage ? (
        <p className="rt-body mb-5 text-center text-sm text-[var(--ink-3)]">
          You’re seeing public additions. Sign in to see your household and
          cooks you follow.
        </p>
      ) : null}
    </>
  );
}

function FeedResults({
  items,
  loading,
  error,
  hasMore,
  scope,
  onRetry,
}: Readonly<{
  items: DiscoverFeedItem[];
  loading: boolean;
  error: unknown;
  hasMore: boolean;
  scope: DiscoverFeedScope;
  onRetry: () => void;
}>) {
  return (
    <>
      <div className="space-y-4">
        {items.map((item) => (
          <FeedCard key={`${item.recipe.slug}-${item.createdAt}`} item={item} />
        ))}
      </div>
      {!loading && !error && items.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-[var(--line-strong)] px-6 py-12 text-center">
          <UtensilsCrossed className="mx-auto size-8 text-[var(--terracotta)]" />
          <p className="rt-display mt-3 text-3xl">Nothing here yet.</p>
          <p className="rt-body mt-1 text-sm text-[var(--ink-3)]">
            {scope === "following"
              ? "Follow a cook to see their public recipes here, alongside your household."
              : "New recipe additions will show up here."}
          </p>
          {scope === "following" ? (
            <Button asChild variant="outline" className="mt-5">
              <Link href="/recipes/cooks">Find cooks to follow</Link>
            </Button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <div className="mt-6 text-center">
          <p className="rt-body text-sm text-[var(--terracotta-deep)]">
            {error instanceof Error
              ? error.message
              : "The feed could not be loaded."}
          </p>
          <Button variant="outline" className="mt-3" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : null}
      {loading ? (
        <output
          className="flex justify-center py-8"
          aria-label="Loading more recipes"
        >
          <LoaderCircle className="size-6 animate-spin text-[var(--terracotta)]" />
        </output>
      ) : null}
      {!hasMore && items.length > 0 ? (
        <p className="rt-mono py-8 text-center text-xs text-[var(--ink-3)]">
          · you’re all caught up ·
        </p>
      ) : null}
    </>
  );
}

export function DiscoverFeed() {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const [scope, setScope] = useState<DiscoverFeedScope>("public");
  const [mounted, setMounted] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const signedIn = Boolean(session);
  const publicFeed = useInfiniteQuery({
    ...publicDiscoverFeedQuery(),
    enabled: scope === "public",
  });
  const followingFeed = useInfiniteQuery({
    ...followingDiscoverFeedQuery(session?.user.id ?? "pending"),
    enabled: scope === "following" && signedIn && !sessionPending,
  });
  const feed = scope === "following" ? followingFeed : publicFeed;
  const items = feed.data?.pages.flatMap((page) => page.items) ?? [];
  const hasMore = Boolean(feed.hasNextPage);
  const loading = feed.isPending || feed.isFetchingNextPage;
  const error = feed.error;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!signedIn && scope === "following") {
      setScope("public");
    }
  }, [scope, signedIn]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore || loading || error) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void feed.fetchNextPage();
      },
      { rootMargin: "300px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [error, feed.fetchNextPage, hasMore, loading]);

  function retryFeed() {
    if (items.length > 0 && feed.hasNextPage) {
      void feed.fetchNextPage();
      return;
    }
    void feed.refetch();
  }

  return (
    <>
      <RecipeQueryStatus
        error={error}
        hasData={items.length > 0}
        isFetching={feed.isFetching && !feed.isFetchingNextPage}
        isStale={feed.isStale}
        subject={`${scope} recipes`}
      />
      <div className="container mx-auto w-full max-w-3xl px-4 py-7 sm:py-10">
        <div className="mb-7 sm:mb-9">
          <p className="rt-mono text-[var(--terracotta)]">
            Discover{" "}
            {mounted && session ? "· your feed" : "· no account needed"}
          </p>
          <h1 className="rt-display mt-2 text-5xl leading-none sm:text-6xl">
            Fresh from other{" "}
            <span className="text-[var(--terracotta)]">kitchens.</span>
          </h1>
          <p className="rt-body mt-3 max-w-2xl text-base text-[var(--ink-2)] sm:text-lg">
            Explore what everyone is cooking, or catch up with your household
            and the cooks you follow.
          </p>
        </div>

        <FeedScopeTabs
          scope={scope}
          followingEnabled={mounted && signedIn}
          showSignedOutMessage={mounted && !signedIn && !sessionPending}
          onScopeChange={setScope}
        />
        <FeedResults
          items={items}
          loading={loading}
          error={error}
          hasMore={hasMore}
          scope={scope}
          onRetry={retryFeed}
        />
        <div ref={sentinel} className="h-px" aria-hidden="true" />
      </div>
    </>
  );
}
