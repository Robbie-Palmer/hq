"use client";

import {
  ChefHat,
  Flame,
  Refrigerator,
  Repeat2,
  UtensilsCrossed,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  type CookingInsights,
  type CookingSession,
  getCookingInsights,
  type LeftoverSuggestion,
} from "@/lib/api/cooking-insights";
import { authClient } from "@/lib/auth-client";

function completedLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function Metric({
  label,
  value,
  detail,
  icon: Icon,
}: Readonly<{
  label: string;
  value: number;
  detail: string;
  icon: typeof Flame;
}>) {
  return (
    <div className="rounded-xl border border-[var(--line-strong)] bg-[var(--card)] p-5 shadow-[var(--paper-shadow)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="rt-mono text-[var(--terracotta)]">{label}</p>
          <p className="rt-display mt-2 text-5xl text-[var(--ink)]">{value}</p>
        </div>
        <span className="flex size-10 items-center justify-center rounded-full bg-[var(--butter-soft)] text-[var(--terracotta-deep)]">
          <Icon aria-hidden="true" className="size-5" />
        </span>
      </div>
      <p className="rt-body mt-2 text-sm text-[var(--ink-3)]">{detail}</p>
    </div>
  );
}

function RecentCookingItem({ session }: Readonly<{ session: CookingSession }>) {
  const servingSummary =
    session.leftoverPortions > 0
      ? `${session.servings - session.leftoverPortions} eaten · ${session.leftoverPortions} left in ${session.leftoverStorage}`
      : `Served ${session.servings}`;
  return (
    <li className="flex flex-col gap-1 py-4 first:pt-2 sm:flex-row sm:items-center sm:gap-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--paper-warm)] text-[var(--terracotta-deep)]">
        <UtensilsCrossed aria-hidden="true" className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="rt-body truncate font-semibold text-[var(--ink)]">
          {session.recipeTitle}
        </p>
        <p className="rt-mono mt-1 text-[var(--ink-3)]">{servingSummary}</p>
      </div>
      {session.repeatOfSessionId && (
        <span className="rt-mono inline-flex items-center gap-1 text-[var(--sage)]">
          <Repeat2 aria-hidden="true" className="size-3.5" /> repeat
        </span>
      )}
      <time
        dateTime={session.completedAt ?? undefined}
        className="rt-mono text-[var(--ink-3)]"
      >
        {completedLabel(session.completedAt ?? session.startedAt)}
      </time>
    </li>
  );
}

function RecentCooking({ sessions }: Readonly<{ sessions: CookingSession[] }>) {
  return (
    <section className="mt-8 rounded-xl border border-[var(--line-strong)] bg-[var(--card)] p-5 shadow-[var(--paper-shadow)] sm:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="rt-display text-3xl">Recently cooked</h2>
        <span className="rt-mono text-[var(--ink-3)]">
          What · when · how many
        </span>
      </div>
      {sessions.length === 0 ? (
        <div className="py-12 text-center">
          <p className="rt-display text-3xl text-[var(--ink-2)]">
            Nothing cooked yet.
          </p>
          <p className="rt-body mt-2 text-sm text-[var(--ink-3)]">
            Choose a recipe, start cooking, and tap Finish on the last step.
          </p>
        </div>
      ) : (
        <ol className="mt-4 divide-y divide-dashed divide-[var(--line)]">
          {sessions.map((session) => (
            <RecentCookingItem key={session.id} session={session} />
          ))}
        </ol>
      )}
    </section>
  );
}

function LeftoverSuggestions({
  insights,
}: Readonly<{ insights: CookingInsights }>) {
  const suggestions: LeftoverSuggestion[] = insights.leftoverSuggestions ?? [];
  if (suggestions.length === 0) return null;
  const scopeLabel =
    insights.leftoverScope?.type === "household"
      ? `${insights.leftoverScope.household.name} leftovers`
      : "Your leftovers";
  return (
    <section className="mt-8 rounded-xl border border-[var(--line-strong)] bg-[var(--card)] p-5 shadow-[var(--paper-shadow)] sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="rt-display text-3xl">Eat these next</h2>
        <span className="rt-mono text-[var(--ink-3)]">{scopeLabel}</span>
      </div>
      <ol className="mt-4 divide-y divide-dashed divide-[var(--line)]">
        {suggestions.map((leftover) => (
          <li
            key={leftover.id}
            className="flex items-center gap-4 py-4 first:pt-2"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--paper-warm)] text-[var(--sage)]">
              <Refrigerator aria-hidden="true" className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="rt-body truncate font-semibold text-[var(--ink)]">
                {leftover.recipeTitle}
              </p>
              <p className="rt-mono mt-1 text-[var(--ink-3)]">
                {leftover.portionsRemaining} {leftover.storage}
                {leftover.useBy ? ` · use by ${leftover.useBy}` : ""}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function CookingLog() {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const [loadedInsights, setLoadedInsights] = useState<{
    userId: string;
    data: CookingInsights;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (sessionPending || !session) return;
    const userId = session.user.id;
    const controller = new AbortController();
    setError(null);
    void getCookingInsights(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setLoadedInsights({ userId, data });
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Cooking insights could not be loaded.",
          );
        }
      });
    return () => controller.abort();
  }, [session, sessionPending]);

  const insights =
    loadedInsights && loadedInsights.userId === session?.user.id
      ? loadedInsights.data
      : null;

  if (sessionPending) {
    return (
      <div className="flex flex-1 items-center justify-center py-20">
        <p className="rt-mono text-[var(--ink-3)]">Opening your cook log…</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto max-w-xl flex-1 px-4 py-20 text-center">
        <p className="rt-mono text-[var(--terracotta)]">Cook log</p>
        <h1 className="rt-display mt-3 text-5xl">
          Log in to remember what you cooked.
        </h1>
        <p className="rt-body mt-4 text-[var(--ink-2)]">
          Meals are added when you finish a recipe in cooking mode.
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto w-full max-w-5xl flex-1 px-4 py-8 md:py-12">
      <header className="border-b border-dashed border-[var(--line-strong)] pb-8">
        <p className="rt-mono text-[var(--terracotta)]">Cook log · all time</p>
        <h1 className="rt-display mt-2 text-5xl sm:text-6xl">
          your kitchen,{" "}
          <span className="text-[var(--terracotta)]">remembered.</span>
        </h1>
        <p className="rt-body mt-3 max-w-2xl text-[var(--ink-2)]">
          Finishing cooking mode counts as a cooked meal. Starts are kept
          separately, so opening a recipe never inflates your total.
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="mt-8 rounded-xl border border-[var(--berry)]/40 bg-[var(--card)] p-5 text-[var(--berry)]"
        >
          {error}
        </div>
      )}

      {!error && !insights && (
        <p className="rt-mono py-16 text-center text-[var(--ink-3)]">
          Reading the cook log…
        </p>
      )}

      {insights && (
        <>
          <section
            aria-label="Cooking totals"
            className="mt-8 grid gap-4 sm:grid-cols-3"
          >
            <Metric
              label="Meals cooked"
              value={insights.mealsCooked}
              detail="Finished in cooking mode"
              icon={UtensilsCrossed}
            />
            <Metric
              label="Different dishes"
              value={insights.distinctRecipesCooked}
              detail="Variety across completed meals"
              icon={ChefHat}
            />
            <Metric
              label="Cook-mode starts"
              value={insights.cookModeStarts}
              detail="Including unfinished sessions"
              icon={Flame}
            />
          </section>

          <RecentCooking sessions={insights.recent} />
          <LeftoverSuggestions insights={insights} />
        </>
      )}
    </div>
  );
}
