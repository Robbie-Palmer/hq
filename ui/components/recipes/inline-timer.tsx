"use client";

import { BellRing, Pause, Timer, X } from "lucide-react";
import { useCallback } from "react";
import { AddTimerPopover } from "@/components/recipes/add-timer-popover";
import { badgeVariants } from "@/components/ui/badge";
import { useCookingTimer } from "@/hooks/use-cooking-timers";
import {
  type CookingTimerState,
  dismissTimer,
  formatCountdown,
  pauseTimer,
  resumeTimer,
  startTimer,
} from "@/lib/cooking/timerStore";
import { cn } from "@/lib/generic/styles";

type InlineTimerState = CookingTimerState | "idle";

function runTimerAction(
  state: InlineTimerState,
  input: Parameters<typeof startTimer>[0],
) {
  switch (state) {
    case "idle":
      startTimer(input);
      break;
    case "running":
      pauseTimer(input.id);
      break;
    case "paused":
      resumeTimer(input.id);
      break;
    case "completed":
      dismissTimer(input.id);
      break;
  }
}

function getTimerVariant(state: InlineTimerState) {
  if (state === "completed") return "destructive";
  if (state === "running" || state === "paused") return "default";
  return "outline";
}

function getTimerAriaLabel(
  state: InlineTimerState,
  label: string,
  remaining: number,
): string {
  switch (state) {
    case "idle":
      return `Start ${label} timer`;
    case "running":
      return `Pause timer, ${formatCountdown(remaining)} remaining`;
    case "paused":
      return `Resume timer, ${formatCountdown(remaining)} remaining`;
    case "completed":
      return `Time's up for ${label}. Dismiss timer`;
  }
}

function TimerStateIcon({ state }: Readonly<{ state: InlineTimerState }>) {
  if (state === "paused") return <Pause className="size-3" />;
  if (state === "completed") return <BellRing className="size-3" />;
  return <Timer className="size-3" />;
}

function timerDisplayText(
  state: InlineTimerState,
  label: string,
  remaining: number,
): string {
  if (state === "idle") return label;
  if (state === "completed") return "Time's up!";
  return formatCountdown(remaining);
}

/**
 * Tap-to-start countdown pill rendered inline in a method step. State lives
 * in the global timer store, so the same countdown is mirrored in cook mode
 * and the floating timer dock, and keeps running across page navigation.
 */
export function InlineTimer({
  timerId,
  recipeSlug,
  recipeTitle,
  stepIndex,
  stepText,
  durationSeconds,
  label,
}: Readonly<{
  timerId: string;
  recipeSlug: string;
  recipeTitle: string;
  stepIndex?: number;
  stepText?: string;
  durationSeconds: number | null;
  label: string;
}>) {
  const timer = useCookingTimer(timerId);
  const state = timer?.state ?? "idle";
  const remaining = timer?.remainingSeconds ?? durationSeconds ?? 0;

  const handleClick = useCallback(() => {
    if (durationSeconds === null) return;
    runTimerAction(state, {
      id: timerId,
      recipeSlug,
      recipeTitle,
      label,
      stepIndex,
      stepText,
      durationSeconds,
    });
  }, [
    state,
    durationSeconds,
    timerId,
    recipeSlug,
    recipeTitle,
    stepIndex,
    stepText,
    label,
  ]);

  // No resolved duration: offer to set a custom time. The label can be empty
  // for free-text markers, so fall back to a generic prompt.
  if (durationSeconds === null) {
    const promptLabel = label.trim() || "set timer";
    return (
      <AddTimerPopover
        defaultLabel={label.trim()}
        recipeSlug={recipeSlug}
        recipeTitle={recipeTitle}
        stepIndex={stepIndex}
        stepText={stepText}
        trigger={
          <button
            type="button"
            data-recipe-pill
            className={cn(
              badgeVariants({ variant: "outline", interactive: true }),
              "align-baseline text-[0.8125rem] font-semibold",
              "bg-[var(--butter-soft)] text-[var(--ink)]",
            )}
            aria-label={
              label.trim() ? `Set a ${label.trim()} timer` : "Set a timer"
            }
          >
            <Timer className="size-3" />
            {promptLabel}
          </button>
        }
      />
    );
  }

  const variant = getTimerVariant(state);
  const showReset = state === "running" || state === "paused";

  return (
    <span
      data-recipe-pill
      className={cn(
        badgeVariants({
          variant,
          interactive: true,
          active: state === "running",
        }),
        "align-baseline text-[0.8125rem] font-semibold",
        // The idle timer should read as an inviting, tappable control rather
        // than recede into the method text — warm fill + emphasised label.
        state === "idle" && "bg-[var(--butter-soft)] text-[var(--ink)]",
        state === "completed" && "rt-timer-attention",
      )}
    >
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex items-center gap-1"
        aria-label={getTimerAriaLabel(state, label, remaining)}
      >
        <TimerStateIcon state={state} />
        {timerDisplayText(state, label, remaining)}
      </button>
      {showReset && (
        <button
          type="button"
          onClick={() => dismissTimer(timerId)}
          className="ml-0.5 rounded-sm opacity-60 hover:opacity-100"
          aria-label="Cancel timer"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}
