"use client";

import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Eye,
  ListChecks,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Timer,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AddTimerPopover } from "@/components/recipes/add-timer-popover";
import { Button } from "@/components/ui/button";
import { useCookMode } from "@/contexts/cook-mode-context";
import { useCookingTimer } from "@/hooks/use-cooking-timers";
import {
  type CookingTimer,
  dismissTimer,
  extendTimer,
  formatCountdown,
  pauseTimer,
  resumeTimer,
  startTimer,
} from "@/lib/cooking/timerStore";
import {
  isWakeLockSupported,
  releaseWakeLock,
  retainWakeLock,
} from "@/lib/cooking/wakeLock";
import {
  formatIngredient,
  formatInstructionIngredientToken,
  type IngredientAnnotation,
  resolveIngredientAnnotation,
} from "@/lib/domain/recipe/ingredientDisplay";
import type { InstructionDisplayToken } from "@/lib/domain/recipe/instructionTokens";
import type { IngredientGroupView } from "@/lib/domain/recipe/recipeViews";
import type { MeasurementPreference } from "@/lib/domain/recipe/unit";
import { normalizeSlug } from "@/lib/generic/slugs";

/** An instruction token enriched with the id of its global timer (timer tokens only). */
export type CookToken = InstructionDisplayToken & { timerId?: string };

/**
 * One method step for cook mode. `tokens` is null when the recipe has no
 * Cooklang SDK instructions and we fall back to the plain-text step.
 */
export type CookStep = {
  key: string;
  tokens: CookToken[] | null;
  text: string;
};

const WAKE_LOCK_KEY = "cook-mode";
const SWIPE_THRESHOLD_PX = 48;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Keep Tab/Shift+Tab cycling within the dialog — the covered page beneath is
 * still in the DOM and would otherwise receive focus.
 */
function trapFocus(event: KeyboardEvent, container: HTMLElement | null): void {
  if (!container) return;
  const focusables = container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (!first || !last) return;
  const active = document.activeElement;
  const inside = active instanceof HTMLElement && container.contains(active);
  if (event.shiftKey) {
    if (!inside || active === first) {
      event.preventDefault();
      last.focus();
    }
  } else if (!inside || active === last) {
    event.preventDefault();
    first.focus();
  }
}

function progressSegmentColor(index: number, currentStep: number): string {
  if (index < currentStep) return "var(--terracotta)";
  if (index === currentStep) return "var(--butter)";
  return "var(--ink-4)";
}

function timerCircleBackground(state: CookingTimer["state"] | "idle"): string {
  if (state === "running") return "var(--butter)";
  if (state === "completed") return "var(--terracotta)";
  return "var(--card)";
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
export function CookMode({
  recipeSlug,
  recipeTitle,
  servings,
  steps,
  ingredientGroups,
  annotations,
  scale,
  system,
  step,
  onStepChange,
  onExit,
  onComplete,
}: Readonly<{
  recipeSlug: string;
  recipeTitle: string;
  servings: number;
  steps: CookStep[];
  ingredientGroups: IngredientGroupView[];
  annotations: Map<string, IngredientAnnotation>;
  scale: number;
  system: MeasurementPreference;
  step: number;
  onStepChange: (step: number) => void;
  onExit: () => void;
  onComplete: () => void;
}>) {
  const { setCookModeOpen, setActiveStep } = useCookMode();
  const clampedStep = Math.min(Math.max(step, 0), steps.length - 1);
  const current = steps[clampedStep];
  const [showIngredients, setShowIngredients] = useState(false);
  const containerRef = useRef<HTMLDialogElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const completionReportedRef = useRef(false);

  const goTo = useCallback(
    (next: number) => {
      onStepChange(Math.min(Math.max(next, 0), steps.length - 1));
    },
    [onStepChange, steps.length],
  );

  // Keep the screen awake for the whole cooking session, not just while a
  // timer is running.
  useEffect(() => {
    retainWakeLock(WAKE_LOCK_KEY);
    return () => releaseWakeLock(WAKE_LOCK_KEY);
  }, []);

  // Lock page scroll behind the overlay and share the open state so the
  // timer dock can float above the cook-mode footer instead of covering it.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setCookModeOpen(true);
    containerRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      setCookModeOpen(false);
    };
  }, [setCookModeOpen]);

  useEffect(() => {
    if (!current) return;
    setActiveStep({
      recipeSlug,
      recipeTitle,
      stepIndex: clampedStep,
      stepText: current.text,
    });
    return () => setActiveStep(null);
  }, [setActiveStep, recipeSlug, recipeTitle, clampedStep, current]);

  // A non-modal <dialog> (see below) doesn't make the rest of the page inert,
  // so assistive tech could still reach the covered content. Mark every other
  // top-level element inert while cook mode is mounted — but not the timer
  // dock, which is a body-level sibling meant to stay usable during cooking.
  useEffect(() => {
    const dialog = containerRef.current;
    if (!dialog) return;
    const changed: HTMLElement[] = [];
    for (const child of Array.from(document.body.children)) {
      if (
        !(child instanceof HTMLElement) ||
        child === dialog ||
        child.classList.contains("rt-timer-dock") ||
        child.tagName === "SCRIPT" ||
        child.tagName === "STYLE" ||
        child.hasAttribute("inert")
      ) {
        continue;
      }
      child.setAttribute("inert", "");
      child.setAttribute("aria-hidden", "true");
      changed.push(child);
    }
    return () => {
      for (const el of changed) {
        el.removeAttribute("inert");
        el.removeAttribute("aria-hidden");
      }
    };
  }, []);

  // Keyboard navigation: arrows move between steps, Escape exits, and Tab is
  // trapped inside the dialog.
  useEffect(() => {
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
    const onKeyDown = (event: KeyboardEvent) => {
      // An add-timer popover (portalled to <body>, outside the dialog) is open:
      // let it own the keyboard. Otherwise our focus trap yanks Tab back into
      // the dialog — leaving the popover's fields unreachable — and Escape would
      // exit cook mode instead of closing the popover.
      if (document.querySelector('[data-slot="popover-content"]')) return;
      if (event.key === "Tab") {
        trapFocus(event, containerRef.current);
        return;
      }
      if (isEditableTarget(event.target)) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goTo(clampedStep + 1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        goTo(clampedStep - 1);
      } else if (event.key === "Escape") {
        event.preventDefault();
        if (showIngredients) {
          setShowIngredients(false);
        } else {
          onExit();
        }
      }
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => globalThis.removeEventListener("keydown", onKeyDown);
  }, [clampedStep, goTo, onExit, showIngredients]);

  const onTouchStart = useCallback((event: React.TouchEvent) => {
    const touch = event.touches[0];
    touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  }, []);

  const onTouchEnd = useCallback(
    (event: React.TouchEvent) => {
      const start = touchStart.current;
      touchStart.current = null;
      if (!start) return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (
        Math.abs(dx) < SWIPE_THRESHOLD_PX ||
        Math.abs(dx) < Math.abs(dy) * 1.5
      ) {
        return;
      }
      goTo(dx < 0 ? clampedStep + 1 : clampedStep - 1);
    },
    [clampedStep, goTo],
  );

  // Canonical names of ingredients mentioned in the current step, for
  // highlighting in the reference panel.
  const currentStepIngredients = useMemo(() => {
    const names = new Set<string>();
    if (current?.tokens) {
      for (const token of current.tokens) {
        if (token.type === "ingredient") {
          names.add(normalizeSlug(token.canonicalName));
        }
      }
    }
    return names;
  }, [current]);

  if (!current) return null;

  const currentTimers = (current.tokens ?? []).filter(
    (token): token is CookToken & { type: "timer"; timerId: string } =>
      token.type === "timer" &&
      token.timerId !== undefined &&
      token.durationSeconds !== null,
  );

  // Timer tokens with no resolved duration render as "set a timer" prompts.
  const currentPrompts = (current.tokens ?? []).filter(
    (token): token is CookToken & { type: "timer" } =>
      token.type === "timer" && token.durationSeconds === null,
  );

  // Offer the generic add-timer only when the step has no timer of its own, so
  // it never doubles up with a timer control or a prompt.
  const showAddTimer =
    currentTimers.length === 0 && currentPrompts.length === 0;

  const isLastStep = clampedStep === steps.length - 1;
  const nextStep = isLastStep ? null : steps[clampedStep + 1];

  const ingredientPanel = (
    <IngredientReference
      ingredientGroups={ingredientGroups}
      annotations={annotations}
      scale={scale}
      system={system}
      highlighted={currentStepIngredients}
    />
  );

  return (
    // Native <dialog> for semantics, kept non-modal (`open`, not showModal())
    // so the top layer doesn't paint over the floating timer dock; we manage
    // focus trapping and Escape ourselves. The size/margin/border/padding
    // classes neutralise the UA dialog stylesheet.
    <dialog
      ref={containerRef}
      open
      aria-modal="true"
      aria-label={`Cook mode: ${recipeTitle}`}
      // Programmatically focused on open so arrow-key navigation works immediately.
      tabIndex={-1}
      className="recipe-theme fixed inset-0 z-[60] m-0 flex h-full max-h-none w-full max-w-none flex-col border-0 bg-[var(--paper-warm)] p-0 text-[var(--ink)] outline-none"
    >
      {/* slim cooking-mode chrome */}
      <header className="flex items-center gap-2 border-b border-[var(--line-strong)] bg-[var(--butter-soft)] px-3 py-2 sm:gap-4 sm:px-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={onExit}
          className="shrink-0"
          aria-label="Exit cook mode"
        >
          <ArrowLeft className="size-4" />
          <span className="hidden sm:inline">Exit</span>
        </Button>
        <span className="rt-display min-w-0 flex-1 truncate text-xl text-[var(--terracotta-deep)] sm:text-2xl">
          {recipeTitle}
        </span>
        {isWakeLockSupported() && (
          <span
            className="rt-mono hidden items-center gap-1 text-[var(--ink-3)] sm:flex"
            title="The screen stays awake while cooking"
          >
            <Eye className="size-3.5" />
            awake
          </span>
        )}
        <span className="rt-mono shrink-0 text-[var(--ink-2)]">
          serves {servings}
        </span>
      </header>

      <div className="flex min-h-0 flex-1 md:grid md:grid-cols-[minmax(260px,1fr)_2.2fr]">
        {/* ingredients reference — side panel on desktop */}
        <aside className="hidden overflow-y-auto border-r border-[var(--line-strong)] bg-[var(--paper)] px-6 py-5 md:block">
          <div className="rt-mono mb-3 text-[var(--terracotta)]">
            Ingredients · reference
          </div>
          {ingredientPanel}
          {currentStepIngredients.size > 0 && (
            <div className="rt-mono mt-4 text-[var(--ink-3)]">
              highlighted = used in this step
            </div>
          )}
        </aside>

        {/* the step */}
        <main
          className="flex min-h-0 min-w-0 flex-1 flex-col"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-10 sm:py-8">
            <div className="rt-mono text-[var(--terracotta)]">
              Step {String(clampedStep + 1).padStart(2, "0")} of {steps.length}
            </div>
            <p
              aria-live="polite"
              className="rt-display mt-3 max-w-3xl text-3xl leading-[1.08] text-[var(--ink)] sm:text-4xl lg:text-5xl"
            >
              {current.tokens
                ? current.tokens.map((token, index) => (
                    <StepToken
                      key={`${index}:${token.type}:${token.value}`}
                      token={token}
                      scale={scale}
                      system={system}
                    />
                  ))
                : current.text}
            </p>

            {currentTimers.map((token) => (
              <CookModeTimer
                key={token.timerId}
                timerId={token.timerId}
                label={token.value}
                durationSeconds={token.durationSeconds ?? 0}
                recipeSlug={recipeSlug}
                recipeTitle={recipeTitle}
                stepIndex={clampedStep}
                stepText={current.text}
              />
            ))}

            {(currentPrompts.length > 0 || showAddTimer) && (
              <div className="mt-7 flex flex-wrap items-center gap-2">
                {currentPrompts.map((token, index) => {
                  const promptLabel = token.value.trim();
                  return (
                    <AddTimerPopover
                      key={`prompt-${index}:${token.value}`}
                      defaultLabel={promptLabel}
                      recipeSlug={recipeSlug}
                      recipeTitle={recipeTitle}
                      stepIndex={clampedStep}
                      stepText={current.text}
                      trigger={
                        <Button
                          size="sm"
                          className="bg-[var(--terracotta)] text-white hover:bg-[var(--terracotta-deep)]"
                        >
                          <Timer className="size-4" />
                          {promptLabel
                            ? `Set ${promptLabel} timer`
                            : "Set timer"}
                        </Button>
                      }
                    />
                  );
                })}
                {showAddTimer && (
                  <AddTimerPopover
                    recipeSlug={recipeSlug}
                    recipeTitle={recipeTitle}
                    stepIndex={clampedStep}
                    stepText={current.text}
                    trigger={
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-[var(--ink-2)]"
                      >
                        <Plus className="size-4" />
                        Add timer
                      </Button>
                    }
                  />
                )}
              </div>
            )}
          </div>

          {/* persistent muted preview of the next step; tap to advance */}
          {nextStep && (
            // No aria-label: the rendered "Up next" label and scaled token
            // content are the accessible name, so screen readers announce the
            // same amounts shown on screen at the current scale.
            <button
              type="button"
              onClick={() => goTo(clampedStep + 1)}
              className="flex w-full items-baseline gap-3 border-t border-dashed border-[var(--line-strong)] px-5 py-3 text-left transition-colors hover:bg-[var(--butter-soft)] focus-visible:bg-[var(--butter-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--terracotta)] active:bg-[var(--butter-soft)] sm:px-10"
            >
              <span className="rt-mono shrink-0 text-[var(--terracotta)]">
                Up next
              </span>
              <span className="rt-display line-clamp-2 min-w-0 flex-1 text-lg text-[var(--ink-3)] sm:text-xl">
                {nextStep.tokens
                  ? nextStep.tokens.map((token, index) => (
                      <StepToken
                        key={`${index}:${token.type}:${token.value}`}
                        token={token}
                        scale={scale}
                        system={system}
                      />
                    ))
                  : nextStep.text}
              </span>
            </button>
          )}

          {/* nav */}
          <div className="border-t border-dashed border-[var(--line-strong)] px-4 pt-1.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-8">
            <div className="mb-1 flex items-center gap-1">
              {steps.map((s, index) => (
                // The visual bar is thin, so pad the button vertically to give
                // it a tappable hit area on touch screens.
                <button
                  key={s.key}
                  type="button"
                  onClick={() => goTo(index)}
                  aria-label={`Go to step ${index + 1}`}
                  aria-current={index === clampedStep ? "step" : undefined}
                  className="flex flex-1 items-center py-3"
                >
                  <span
                    className="w-full rounded-full transition-all"
                    style={{
                      height: index === clampedStep ? 8 : 4,
                      background: progressSegmentColor(index, clampedStep),
                    }}
                  />
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowIngredients(true)}
                className="h-12 md:hidden"
                aria-label="Show ingredients"
              >
                <ListChecks className="size-5" />
              </Button>
              <Button
                variant="outline"
                disabled={clampedStep === 0}
                onClick={() => goTo(clampedStep - 1)}
                className="h-12 flex-1 text-base md:max-w-44"
              >
                <ChevronLeft className="size-5" />
                Prev
              </Button>
              <Button
                onClick={() => {
                  if (!isLastStep) {
                    goTo(clampedStep + 1);
                    return;
                  }
                  if (completionReportedRef.current) return;
                  completionReportedRef.current = true;
                  onComplete();
                }}
                className="h-12 flex-1 bg-[var(--terracotta)] text-base text-white hover:bg-[var(--terracotta-deep)] md:max-w-44"
              >
                {isLastStep ? "Finish ✓" : "Next"}
                {!isLastStep && <ChevronRight className="size-5" />}
              </Button>
            </div>
          </div>
        </main>
      </div>

      {/* mobile ingredients sheet */}
      {showIngredients && (
        <div className="absolute inset-0 z-10 md:hidden">
          <button
            type="button"
            aria-label="Close ingredients"
            onClick={() => setShowIngredients(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-black/35"
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[70%] overflow-y-auto rounded-t-2xl bg-[var(--paper)] px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_-8px_30px_rgba(31,26,20,0.25)]">
            <div className="mb-3 flex items-center justify-between">
              <span className="rt-mono text-[var(--terracotta)]">
                Ingredients · reference
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setShowIngredients(false)}
                aria-label="Close ingredients"
              >
                <X className="size-4" />
              </Button>
            </div>
            {ingredientPanel}
          </div>
        </div>
      )}
    </dialog>
  );
}

function StepToken({
  token,
  scale,
  system,
}: Readonly<{
  token: CookToken;
  scale: number;
  system: MeasurementPreference;
}>) {
  if (token.type === "ingredient") {
    return (
      <strong className="font-bold text-[var(--terracotta-deep)]">
        {formatInstructionIngredientToken(token, scale, system)}
      </strong>
    );
  }
  if (token.type === "timer") {
    return (
      <em className="not-italic text-[var(--terracotta-deep)] underline decoration-dotted underline-offset-4">
        {token.value}
      </em>
    );
  }
  return <>{token.value}</>;
}

function IngredientReference({
  ingredientGroups,
  annotations,
  scale,
  system,
  highlighted,
}: Readonly<{
  ingredientGroups: IngredientGroupView[];
  annotations: Map<string, IngredientAnnotation>;
  scale: number;
  system: MeasurementPreference;
  highlighted: Set<string>;
}>) {
  return (
    <div className="space-y-4">
      {ingredientGroups.map((group, groupIndex) => (
        <div key={group.name ?? groupIndex}>
          {group.name && (
            <div className="rt-display mb-1 text-lg text-[var(--terracotta)]">
              {group.name}
            </div>
          )}
          <ul className="space-y-0.5">
            {group.items.map((item, itemIndex) => {
              const isUsed =
                highlighted.has(item.ingredient) ||
                highlighted.has(normalizeSlug(item.name));
              return (
                <li
                  key={`${item.ingredient}:${itemIndex}`}
                  className={[
                    "flex items-center gap-2 rounded-md px-2 py-1 text-[0.9375rem]",
                    isUsed
                      ? "bg-[var(--butter-soft)] font-semibold text-[var(--ink)]"
                      : "text-[var(--ink-2)]",
                  ].join(" ")}
                >
                  <span
                    aria-hidden="true"
                    className="size-1.5 shrink-0 rounded-full"
                    style={{
                      background: isUsed ? "var(--terracotta)" : "var(--ink-4)",
                    }}
                  />
                  {formatIngredient(
                    item,
                    scale,
                    system,
                    resolveIngredientAnnotation(item, annotations),
                  )}
                  {isUsed && (
                    <span className="sr-only">(used in this step)</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Large timer control for the current step, bound to the global store. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
function CookModeTimer({
  timerId,
  label,
  durationSeconds,
  recipeSlug,
  recipeTitle,
  stepIndex,
  stepText,
}: Readonly<{
  timerId: string;
  label: string;
  durationSeconds: number;
  recipeSlug: string;
  recipeTitle: string;
  stepIndex: number;
  stepText: string;
}>) {
  const timer = useCookingTimer(timerId);
  const state: CookingTimer["state"] | "idle" = timer?.state ?? "idle";
  const remaining = timer?.remainingSeconds ?? durationSeconds;

  const circleBackground = timerCircleBackground(state);
  const circleClassName = [
    "flex size-32 shrink-0 items-center justify-center rounded-full border-[3px] border-[var(--ink)]",
    state === "completed" ? "rt-timer-attention" : "",
  ].join(" ");

  const start = useCallback(
    () =>
      startTimer({
        id: timerId,
        recipeSlug,
        recipeTitle,
        label,
        stepIndex,
        stepText,
        durationSeconds,
      }),
    [
      timerId,
      recipeSlug,
      recipeTitle,
      label,
      stepIndex,
      stepText,
      durationSeconds,
    ],
  );

  return (
    <div className="mt-7 flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
      {state === "idle" ? (
        <button
          type="button"
          onClick={start}
          aria-label={`Start ${label} timer`}
          className={[
            circleClassName,
            "cursor-pointer transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--terracotta)] focus-visible:ring-offset-2",
          ].join(" ")}
          style={{ background: circleBackground }}
        >
          <span className="rt-display text-4xl tabular-nums text-[var(--ink-3)] opacity-60">
            {formatCountdown(remaining)}
          </span>
        </button>
      ) : (
        <div
          className={circleClassName}
          style={{ background: circleBackground }}
        >
          <span
            className={[
              "rt-display text-4xl tabular-nums",
              state === "completed" ? "text-white" : "text-[var(--ink)]",
            ].join(" ")}
          >
            {state === "completed" ? "done!" : formatCountdown(remaining)}
          </span>
        </div>
      )}
      <div className="flex flex-col items-center gap-2 sm:items-start">
        <div className="rt-body text-[var(--ink-2)]">{label}</div>
        <div className="rt-mono text-[var(--ink-3)]">
          {state === "idle" && "tap start when you're ready"}
          {state === "running" && "running"}
          {state === "paused" && "paused"}
          {state === "completed" && "time's up!"}
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {state === "idle" && (
            <Button
              size="sm"
              onClick={start}
              className="bg-[var(--terracotta)] text-white hover:bg-[var(--terracotta-deep)]"
            >
              <Play className="size-4" />
              Start
            </Button>
          )}
          {(state === "running" || state === "paused") && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  state === "running"
                    ? pauseTimer(timerId)
                    : resumeTimer(timerId)
                }
              >
                {state === "running" ? (
                  <>
                    <Pause className="size-4" />
                    Pause
                  </>
                ) : (
                  <>
                    <Play className="size-4" />
                    Resume
                  </>
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => extendTimer(timerId)}
              >
                +1 min
              </Button>
            </>
          )}
          {state === "completed" && (
            <Button
              size="sm"
              onClick={() => dismissTimer(timerId)}
              className="bg-[var(--terracotta)] text-white hover:bg-[var(--terracotta-deep)]"
            >
              Dismiss
            </Button>
          )}
          {(state === "running" || state === "paused") && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => dismissTimer(timerId)}
              aria-label={`Reset ${label} timer`}
            >
              <RotateCcw className="size-4" />
              Reset
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
