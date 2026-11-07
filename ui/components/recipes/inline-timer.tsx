"use client";

import { BellRing, Pause, Timer, X } from "lucide-react";
import { useCallback } from "react";
import { AddTimerPopover } from "@/components/recipes/add-timer-popover";
import { badgeVariants } from "@/components/ui/badge";
import {
  useCookingTimer,
  useCookingTimerCommands,
} from "@/hooks/use-cooking-timers";
import type { CookingTimerCommands } from "@/lib/cooking/recipeClientStore";
import {
  type CookingTimerState,
  formatCountdown,
  type StartTimerInput,
} from "@/lib/cooking/timerStore";
import { cn } from "@/lib/generic/styles";

type InlineTimerState = CookingTimerState | "idle";

function runTimerAction(
  commands: CookingTimerCommands,
  state: InlineTimerState,
  input: StartTimerInput,
) {
  switch (state) {
    case "idle":
      commands.start(input);
      break;
    case "running":
      commands.pause(input.id);
      break;
    case "paused":
      commands.resume(input.id);
      break;
    case "completed":
      commands.dismiss(input.id);
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
 * in the Recipe store, so the same countdown is mirrored in cook mode
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
  const commands = useCookingTimerCommands(),
    timer = useCookingTimer(timerId);
  const state = timer?.state ?? "idle";
  const remaining = timer?.remainingSeconds ?? durationSeconds ?? 0;

  const handleClick = useCallback(() => {
    if (durationSeconds === null) return;
    runTimerAction(commands, state, {
      id: timerId,
      recipeSlug,
      recipeTitle,
      label,
      stepIndex,
      stepText,
      durationSeconds,
    });
  }, [
    commands,
    state,
    durationSeconds,
    timerId,
    recipeSlug,
    recipeTitle,
    stepIndex,
    stepText,
    label,
  ]);

  // An unresolved duration offers a custom timer with a generic fallback label.
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
        // Keep an idle timer visually inviting in the method text.
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
          onClick={() => commands.dismiss(timerId)}
          className="ml-0.5 rounded-sm opacity-60 hover:opacity-100"
          aria-label="Cancel timer"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}
