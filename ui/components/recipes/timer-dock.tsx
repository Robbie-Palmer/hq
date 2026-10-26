"use client";

import {
  BellRing,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Pause,
  Play,
  Plus,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { AddTimerPopover } from "@/components/recipes/add-timer-popover";
import {
  type CookModeActiveStep,
  useCookMode,
} from "@/contexts/cook-mode-context";
import { useCookingTimers } from "@/hooks/use-cooking-timers";
import {
  readBrowserStorageJson,
  removeBrowserStorage,
  writeBrowserStorageJson,
} from "@/lib/browser/storage";
import {
  type CookingTimer,
  dismissTimer,
  extendTimer,
  formatCountdown,
  pauseTimer,
  resumeTimer,
} from "@/lib/cooking/timerStore";

const POSITION_KEY = "cooking-timer-dock-pos:v1";
const EDGE_MARGIN = 8;

/**
 * Minimum bottom offset while cook mode is open, so the dock clears the
 * cook-mode footer (progress bar + prev/next). Applied on top of any dragged
 * position without persisting it, so the dock drops back once cooking ends.
 */
function cookModeFooterClearance(): number {
  return globalThis.innerWidth >= 640 ? 116 : 140;
}

/** Offsets from the bottom-right corner, so the dock hugs its default anchor. */
type DockPosition = { right: number; bottom: number };

function isDockPosition(value: unknown): value is DockPosition {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as DockPosition).right === "number" &&
    typeof (value as DockPosition).bottom === "number"
  );
}

function loadPosition(): DockPosition | null {
  return readBrowserStorageJson("localStorage", POSITION_KEY, isDockPosition);
}

function savePosition(position: DockPosition): void {
  writeBrowserStorageJson("localStorage", POSITION_KEY, position);
}

function clearPosition(): void {
  removeBrowserStorage("localStorage", POSITION_KEY);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** Completed timers first (they need attention), then soonest-ending. */
function byUrgency(a: CookingTimer, b: CookingTimer): number {
  if ((a.state === "completed") !== (b.state === "completed")) {
    return a.state === "completed" ? -1 : 1;
  }
  return a.remainingSeconds - b.remainingSeconds;
}

function dotColor(timer: CookingTimer): string {
  if (timer.state === "paused") return "var(--ink-4)";
  return "var(--butter)";
}

function completionAnnouncement(timers: readonly CookingTimer[]): string {
  if (timers.length === 0) return "";
  if (timers.length === 1) return `Time's up for ${timers[0]?.label}.`;
  return `${timers.length} cooking timers are complete.`;
}

function completedTimerIdsKey(timers: readonly CookingTimer[]): string {
  return JSON.stringify(
    timers
      .filter((timer) => timer.state === "completed")
      .map((timer) => timer.id)
      .sort((a, b) => a.localeCompare(b)),
  );
}

/**
 * Link back to the timer's recipe, deep-linking straight into cook mode at the
 * step that started it when we know which step that was. Slug is encoded as
 * defense-in-depth even though recipe slugs are API-validated. Null for
 * free-standing custom timers, which have no recipe to return to.
 */
function timerHref(timer: CookingTimer): string | null {
  if (!timer.recipeSlug) return null;
  const base = `/recipes/${encodeURIComponent(timer.recipeSlug)}`;
  return timer.stepIndex === undefined
    ? base
    : `${base}?cook=1&step=${timer.stepIndex + 1}`;
}

/**
 * Inline positioning for a dragged dock. Default anchor comes from CSS classes,
 * so this returns undefined until the user has moved it; while cook mode is open
 * the bottom is raised to clear its footer without mutating the stored position.
 */
function dockStyle(
  position: DockPosition | null,
  cookModeOpen: boolean,
): React.CSSProperties | undefined {
  if (position) {
    return {
      right: position.right,
      bottom: cookModeOpen
        ? Math.max(position.bottom, cookModeFooterClearance())
        : position.bottom,
    };
  }
  return cookModeOpen ? { bottom: cookModeFooterClearance() } : undefined;
}

/** Short "step N" tag when the originating step is known. */
function stepTag(timer: CookingTimer): string | null {
  return timer.stepIndex === undefined ? null : `step ${timer.stepIndex + 1}`;
}

function CollapsedTimerDock({
  grip,
  primary,
  timerCount,
  onExpand,
  activeStep,
}: Readonly<{
  grip: React.ReactNode;
  primary: CookingTimer;
  timerCount: number;
  onExpand: () => void;
  activeStep: CookModeActiveStep | null;
}>) {
  const completed = primary.state === "completed";
  const tag = stepTag(primary);

  return (
    <div
      className={[
        "flex items-center rounded-full py-1 pr-2.5 pl-1.5 text-[var(--paper)] shadow-lg",
        completed ? "bg-[var(--berry)]" : "bg-[var(--ink)]",
      ].join(" ")}
    >
      {grip}
      <button
        type="button"
        onClick={onExpand}
        aria-expanded="false"
        aria-label={
          completed
            ? `Time's up for ${primary.label}. Expand cooking timers (${timerCount})`
            : `Expand cooking timers (${timerCount})`
        }
        className="flex items-center gap-2 py-0.5 pl-1"
      >
        {completed && (
          <BellRing className="size-5 shrink-0 text-[var(--butter)]" />
        )}
        <span className="flex min-w-0 flex-col text-left leading-tight">
          <span
            className="rt-mono max-w-40 truncate text-[9px]"
            style={{ color: dotColor(primary) }}
          >
            ● {primary.label}
            {tag && (
              <span
                className={
                  completed
                    ? "text-[var(--paper)] opacity-75"
                    : "text-[var(--ink-4)]"
                }
              >
                {" "}
                · {tag}
              </span>
            )}
          </span>
          <span
            className={[
              "rt-display text-xl leading-none tabular-nums",
              primary.state === "paused" ? "opacity-60" : "",
            ].join(" ")}
          >
            {completed
              ? "time's up!"
              : formatCountdown(primary.remainingSeconds)}
          </span>
        </span>
        {timerCount > 1 && (
          <span className="rt-mono rounded-full bg-[var(--paper)]/15 px-1.5 py-0.5 text-[9px]">
            +{timerCount - 1}
          </span>
        )}
        <ChevronUp className="size-3.5 opacity-60" />
      </button>
      <AddTimerPopover
        align="end"
        recipeSlug={activeStep?.recipeSlug}
        recipeTitle={activeStep?.recipeTitle}
        stepIndex={activeStep?.stepIndex}
        stepText={activeStep?.stepText}
        trigger={
          <button
            type="button"
            aria-label="Add a custom timer"
            className="ml-1 rounded-full p-1.5 text-[var(--paper)]/80 transition-colors hover:bg-[var(--paper)]/15 hover:text-[var(--paper)]"
          >
            <Plus className="size-4" />
          </button>
        }
      />
    </div>
  );
}

/**
 * Floating dock for every active cooking timer. Collapsed (the default) it is
 * a single compact pill showing the most urgent timer plus a count of the
 * rest, so several running timers never wall off the page; expanding reveals
 * per-timer controls. Draggable by its grip handle, and the position sticks.
 */
export function TimerDock() {
  const timers = useCookingTimers();
  const [expanded, setExpanded] = useState(false);
  const [position, setPosition] = useState<DockPosition | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [attentionRevision, setAttentionRevision] = useState(0);
  const dockRef = useRef<HTMLElement>(null);
  const attentionRef = useRef<HTMLDivElement>(null);
  const previousCompletedIdsRef = useRef<ReadonlySet<string>>(new Set());
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startRight: number;
    startBottom: number;
    moved: boolean;
  } | null>(null);

  const { cookModeOpen, activeStep } = useCookMode();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setPosition(loadPosition());
  }, []);

  // A dragged position only belongs to the current batch of timers. Once the
  // last timer is dismissed, return the idle dock (and the next timer) to its
  // default corner instead of stranding it at a location that can no longer be
  // adjusted while idle.
  useEffect(() => {
    if (timers.length > 0) return;
    setPosition(null);
    clearPosition();
  }, [timers.length]);

  const completedTimers = timers.filter((timer) => timer.state === "completed");
  const completedIdsKey = completedTimerIdsKey(timers);
  const nextAnnouncement = completionAnnouncement(completedTimers);

  // Keep the live region empty before inserting its message so restored
  // completions are announced too. Track newly completed ids separately from
  // dock expansion, so the visual cue replays for a later timer but not when
  // someone opens or closes the dock to act on an existing alert.
  useEffect(() => {
    const completedIds = new Set<string>(JSON.parse(completedIdsKey));
    const hasNewCompletion = [...completedIds].some(
      (id) => !previousCompletedIdsRef.current.has(id),
    );
    previousCompletedIdsRef.current = completedIds;
    setAnnouncement("");
    if (!hasNewCompletion) return;

    setAttentionRevision((revision) => revision + 1);
    const announceHandle = globalThis.setTimeout(
      () => setAnnouncement(nextAnnouncement),
      100,
    );
    return () => globalThis.clearTimeout(announceHandle);
  }, [completedIdsKey, nextAnnouncement]);

  // Replay the finite attention animation whenever a new timer completes.
  // Restarting it in place — rather than remounting the dock via a changing
  // key — keeps the interactive subtree (notably AddTimerPopover's open state
  // and typed-in values) intact while a later timer expires.
  useLayoutEffect(() => {
    if (attentionRevision === 0) return;
    const node = attentionRef.current;
    if (!node) return;
    node.classList.remove("rt-timer-attention");
    void node.offsetWidth; // force reflow so the re-added class restarts the animation
    node.classList.add("rt-timer-attention");
  }, [attentionRevision]);

  // A dragged position is stored as bottom-right offsets measured at the
  // dock's size at drag time. Expanding, gaining timers, or rotating the
  // screen changes the dock's size (or the viewport), which can push parts of
  // it off-screen — re-clamp whenever that happens so the controls stay
  // reachable.
  const clampToViewport = useCallback(() => {
    setPosition((current) => {
      if (!current) return current;
      const rect = dockRef.current?.getBoundingClientRect();
      if (!rect) return current;
      const next = {
        right: clamp(
          current.right,
          EDGE_MARGIN,
          globalThis.innerWidth - rect.width - EDGE_MARGIN,
        ),
        bottom: clamp(
          current.bottom,
          EDGE_MARGIN,
          globalThis.innerHeight - rect.height - EDGE_MARGIN,
        ),
      };
      if (next.right === current.right && next.bottom === current.bottom) {
        return current;
      }
      savePosition(next);
      return next;
    });
  }, []);

  // Re-clamp when the dock's size changes (expand / timer count) and, crucially,
  // right after a persisted position is restored on mount — the saved offsets
  // were measured in a possibly larger viewport and could land off-screen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: expanded/timers.length/position drive the re-clamp even though clampToViewport doesn't close over them
  useLayoutEffect(() => {
    clampToViewport();
  }, [expanded, timers.length, position, clampToViewport]);

  useEffect(() => {
    globalThis.addEventListener("resize", clampToViewport);
    return () => globalThis.removeEventListener("resize", clampToViewport);
  }, [clampToViewport]);

  const onGripPointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const dock = dockRef.current;
      if (!dock) return;
      const rect = dock.getBoundingClientRect();
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startRight: globalThis.innerWidth - rect.right,
        startBottom: globalThis.innerHeight - rect.bottom,
        moved: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [],
  );

  const onGripPointerMove = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const rect = dockRef.current?.getBoundingClientRect();
      drag.moved = true;
      setPosition({
        right: clamp(
          drag.startRight + (drag.startX - event.clientX),
          EDGE_MARGIN,
          globalThis.innerWidth - (rect?.width ?? 0) - EDGE_MARGIN,
        ),
        bottom: clamp(
          drag.startBottom + (drag.startY - event.clientY),
          EDGE_MARGIN,
          globalThis.innerHeight - (rect?.height ?? 0) - EDGE_MARGIN,
        ),
      });
    },
    [],
  );

  const onGripPointerEnd = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      dragRef.current = null;
      if (drag.moved) {
        setPosition((current) => {
          if (current) savePosition(current);
          return current;
        });
      }
    },
    [],
  );

  // Hide the dock when idle, but keep it while cook mode is open (even with no
  // timers) so add-timer stays one tap away.
  if (!mounted || (timers.length === 0 && !cookModeOpen)) return null;

  const sorted = [...timers].sort(byUrgency);
  const primary = sorted[0];
  const style = dockStyle(position, cookModeOpen);

  const addTimerControl = (
    <AddTimerPopover
      align="end"
      recipeSlug={activeStep?.recipeSlug}
      recipeTitle={activeStep?.recipeTitle}
      stepIndex={activeStep?.stepIndex}
      stepText={activeStep?.stepText}
      trigger={
        <button
          type="button"
          aria-label="Add a custom timer"
          className="flex items-center gap-1.5 rounded-full px-2 py-1.5 text-[var(--paper)]/85 transition-colors hover:bg-[var(--paper)]/15 hover:text-[var(--paper)]"
        >
          <Plus className="size-4" />
          <span className="rt-mono text-[11px]">add timer</span>
        </button>
      }
    />
  );

  // Cook mode open with no timers yet: show just the add-timer entry point.
  if (!primary) {
    return createPortal(
      <section
        ref={dockRef}
        aria-label="Cooking timers"
        className="rt-timer-dock fixed right-3 bottom-3 z-[80] sm:right-4 sm:bottom-4"
        style={style}
      >
        <div className="flex items-center rounded-full bg-[var(--ink)] px-1 py-1 text-[var(--paper)] shadow-lg">
          {addTimerControl}
        </div>
      </section>,
      document.body,
    );
  }

  const grip = (
    <button
      type="button"
      aria-label="Move timers"
      onPointerDown={onGripPointerDown}
      onPointerMove={onGripPointerMove}
      onPointerUp={onGripPointerEnd}
      onPointerCancel={onGripPointerEnd}
      className="touch-none cursor-grab self-stretch rounded-full px-1 py-2 opacity-50 transition-opacity hover:opacity-90 active:cursor-grabbing"
      title="Drag to move"
    >
      <GripVertical className="size-4" />
    </button>
  );

  // Portaled to <body> (a sibling of the cook-mode dialog, which also portals
  // to <body>) so cook mode can mark the rest of the app inert for assistive
  // tech while leaving the dock reachable. Theme tokens come from the classes
  // RecipeThemeBody mirrors onto <body>.
  return createPortal(
    <section
      ref={dockRef}
      aria-label="Cooking timers"
      className="rt-timer-dock fixed right-3 bottom-3 z-[80] sm:right-4 sm:bottom-4"
      style={style}
    >
      <span role="alert" aria-atomic="true" className="sr-only">
        {announcement}
      </span>
      <div
        ref={attentionRef}
        className={[
          expanded ? "rounded-2xl" : "rounded-full",
          attentionRevision > 0 && completedTimers.length > 0
            ? "rt-timer-attention"
            : "",
        ].join(" ")}
      >
        {expanded ? (
          <div className="flex min-w-60 max-w-[calc(100vw-1rem)] flex-col rounded-2xl bg-[var(--ink)] p-2 text-[var(--paper)] shadow-lg">
            <div className="flex items-center gap-1">
              {grip}
              <span className="rt-mono flex-1 text-[9px] text-[var(--ink-4)]">
                cooking timers
              </span>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                aria-expanded="true"
                aria-label="Collapse timers"
                className="rounded-full p-2 opacity-70 transition-opacity hover:opacity-100"
              >
                <ChevronDown className="size-4" />
              </button>
            </div>
            {/* Many timers must scroll inside the panel rather than grow it
              past the top of the screen. */}
            <div className="max-h-[45vh] overflow-y-auto overscroll-contain">
              {sorted.map((timer) => (
                <DockRow key={timer.id} timer={timer} />
              ))}
            </div>
            <div className="mt-1 border-t border-[var(--paper)]/10 pt-1">
              {addTimerControl}
            </div>
          </div>
        ) : (
          <CollapsedTimerDock
            grip={grip}
            primary={primary}
            timerCount={sorted.length}
            onExpand={() => setExpanded(true)}
            activeStep={activeStep}
          />
        )}
      </div>
    </section>,
    document.body,
  );
}

function DockRow({ timer }: Readonly<{ timer: CookingTimer }>) {
  const completed = timer.state === "completed";
  const paused = timer.state === "paused";
  const tag = stepTag(timer);
  const href = timerHref(timer);
  const subtitle = timer.stepText || timer.recipeTitle || "custom timer";
  const tooltip = [
    timer.recipeTitle,
    tag && `${tag} of ${timer.recipeTitle}`,
    timer.stepText,
  ]
    .filter(Boolean)
    .join(" — ");

  const detailClassName = "flex min-w-0 flex-1 flex-col leading-tight";
  const detail = (
    <>
      <span
        className="rt-mono max-w-40 truncate text-[9px]"
        style={{ color: dotColor(timer) }}
      >
        ● {timer.label}
        {tag && (
          <span
            className={
              completed
                ? "text-[var(--paper)] opacity-75"
                : "text-[var(--ink-4)]"
            }
          >
            {" "}
            · {tag}
          </span>
        )}
      </span>
      <span
        className={[
          "max-w-40 truncate font-[family-name:var(--font-kalam)] text-[10px]",
          completed ? "text-[var(--paper)] opacity-75" : "text-[var(--ink-4)]",
        ].join(" ")}
      >
        {subtitle}
      </span>
      <span
        className={[
          "rt-display text-lg leading-none tabular-nums",
          paused ? "opacity-60" : "",
        ].join(" ")}
      >
        {completed ? "time's up!" : formatCountdown(timer.remainingSeconds)}
      </span>
    </>
  );

  return (
    <div
      className={[
        "flex items-center gap-1.5 rounded-lg px-1 py-0.5",
        completed ? "bg-[var(--berry)]" : "",
      ].join(" ")}
    >
      {/* A plain <a> (full navigation), not next/link: deep-linking into cook
          mode relies on RecipeContent reading ?cook=1&step=N on mount, which a
          client-side transition to the same recipe route wouldn't retrigger.
          Timers persist across the reload, so the dock survives. Custom timers
          have no recipe to return to, so they render as a plain block. */}
      {href === null ? (
        <div className={detailClassName} title={tooltip || undefined}>
          {detail}
        </div>
      ) : (
        <a href={href} className={detailClassName} title={tooltip}>
          {detail}
        </a>
      )}
      {!completed && (
        <button
          type="button"
          onClick={() =>
            paused ? resumeTimer(timer.id) : pauseTimer(timer.id)
          }
          className="rounded-full p-2 opacity-70 transition-opacity hover:opacity-100"
          aria-label={
            paused
              ? `Resume ${timer.label} timer`
              : `Pause ${timer.label} timer`
          }
        >
          {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
        </button>
      )}
      {!completed && (
        <button
          type="button"
          onClick={() => extendTimer(timer.id)}
          className="rt-mono rounded-full px-1 py-2 text-[10px] opacity-70 transition-opacity hover:opacity-100"
          aria-label={`Add one minute to ${timer.label} timer`}
        >
          +1m
        </button>
      )}
      <button
        type="button"
        onClick={() => dismissTimer(timer.id)}
        className="rounded-full p-2 opacity-70 transition-opacity hover:opacity-100"
        aria-label={`Dismiss ${timer.label} timer`}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
