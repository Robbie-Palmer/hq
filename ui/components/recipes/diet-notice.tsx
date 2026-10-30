"use client";

import { Leaf, TriangleAlert } from "lucide-react";
import type { DietMatch } from "@/lib/domain/diet";
import { cn } from "@/lib/generic/styles";

function summariseDietLabels(labels: string[]): string {
  if (labels.length === 0) return "your saved exclusions";

  const displayedLabels = labels.slice(0, 2);
  const remainingLabelCount = labels.length - displayedLabels.length;
  const remainingSummary =
    remainingLabelCount > 0 ? ` +${remainingLabelCount} more` : "";
  return `${displayedLabels.join(", ")}${remainingSummary}`;
}

function getDietStatusText(mode: "hide" | "warn", hiddenCount: number) {
  if (mode === "warn") {
    return "Recipes that don't match are marked with a warning.";
  }
  if (hiddenCount === 0) return "No recipes hidden.";

  const recipeNoun = hiddenCount === 1 ? "recipe" : "recipes";
  return `${hiddenCount} ${recipeNoun} hidden.`;
}

export function DietListNotice({
  hiddenCount,
  labels,
  mode,
  showingHidden,
  onToggleHidden,
}: Readonly<{
  hiddenCount: number;
  labels: string[];
  mode: "hide" | "warn";
  showingHidden: boolean;
  onToggleHidden?: () => void;
}>) {
  const summary = summariseDietLabels(labels);
  const statusText = getDietStatusText(mode, hiddenCount);
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-[var(--sage)] bg-[var(--sage)]/10 px-3 py-2.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--sage)] text-white">
        <Leaf className="size-3.5" />
      </span>
      <p className="rt-body min-w-0 flex-1 text-sm text-[var(--ink-2)]">
        <b className="text-[var(--ink)]">Your diet</b> · {summary}.{" "}
        <span className="text-[var(--ink-3)]">{statusText}</span>
      </p>
      <a
        href="/recipes/settings?section=diet"
        className="rt-mono text-[var(--sage)] hover:underline"
      >
        edit diet →
      </a>
      {mode === "hide" && hiddenCount > 0 && onToggleHidden && (
        <button
          type="button"
          onClick={onToggleHidden}
          className="rt-mono text-[var(--ink-3)] hover:text-[var(--ink)]"
        >
          {showingHidden ? "respect diet" : "show anyway"}
        </button>
      )}
    </div>
  );
}

export function DietWarning({
  match,
  compact = false,
  className,
}: Readonly<{
  match: DietMatch;
  compact?: boolean;
  className?: string;
}>) {
  if (match.matches) return null;
  const names = match.excludedIngredients.map((ingredient) => ingredient.name);
  return (
    <output
      className={cn(
        "flex items-start gap-2 rounded-md border border-[var(--butter)] bg-[var(--butter-soft)] text-[var(--terracotta-deep)]",
        compact ? "px-2 py-1 text-xs" : "px-3 py-2 text-sm",
        className,
      )}
    >
      <TriangleAlert
        className={cn("shrink-0", compact ? "size-3.5" : "size-4")}
      />
      <span className="rt-body leading-tight">
        Doesn't match your diet: {names.join(", ")}.
      </span>
    </output>
  );
}

export function DietLoadErrorNotice() {
  return (
    <div className="container mx-auto max-w-7xl px-4 pt-5">
      <div
        role="alert"
        className="flex items-start gap-2 rounded-lg border border-[var(--berry)] bg-[var(--berry)]/10 px-3 py-2.5 text-[var(--berry)]"
      >
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        <p className="rt-body text-sm">
          <b>Diet preferences are unavailable.</b> Refresh before relying on
          recipe filtering, or check your{" "}
          <a href="/recipes/settings?section=diet" className="underline">
            diet settings
          </a>
          {"."}
        </p>
      </div>
    </div>
  );
}
