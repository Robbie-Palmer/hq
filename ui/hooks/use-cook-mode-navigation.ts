import { useCallback, useEffect, useRef, useState } from "react";
import { useCookMode } from "@/contexts/cook-mode-context";
import { releaseWakeLock, retainWakeLock } from "@/lib/cooking/wakeLock";

const WAKE_LOCK_KEY = "cook-mode";
const SWIPE_THRESHOLD_PX = 48;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

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

function stepOffsetForKey(key: string): number {
  if (key === "ArrowRight") return 1;
  if (key === "ArrowLeft") return -1;
  return 0;
}

function handleCookModeKeyDown(
  event: KeyboardEvent,
  options: {
    clampedStep: number;
    container: HTMLElement | null;
    goTo: (step: number) => void;
    onExit: () => void;
    setShowIngredients: (show: boolean) => void;
    showIngredients: boolean;
  },
): void {
  if (document.querySelector('[data-slot="popover-content"]')) return;
  if (event.key === "Tab") {
    trapFocus(event, options.container);
    return;
  }
  if (isEditableTarget(event.target)) return;
  const stepOffset = stepOffsetForKey(event.key);
  if (stepOffset !== 0) {
    event.preventDefault();
    options.goTo(options.clampedStep + stepOffset);
    return;
  }
  if (event.key !== "Escape") return;
  event.preventDefault();
  if (options.showIngredients) {
    options.setShowIngredients(false);
  } else {
    options.onExit();
  }
}

export function useCookModeNavigation<TStep extends { text: string }>({
  onExit,
  onStepChange,
  recipeSlug,
  recipeTitle,
  step,
  steps,
}: {
  onExit: () => void;
  onStepChange: (step: number) => void;
  recipeSlug: string;
  recipeTitle: string;
  step: number;
  steps: readonly TStep[];
}) {
  const { setCookModeOpen, setActiveStep } = useCookMode();
  const clampedStep = Math.min(Math.max(step, 0), steps.length - 1);
  const current = steps[clampedStep];
  const [showIngredients, setShowIngredients] = useState(false);
  const containerRef = useRef<HTMLDialogElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const goTo = useCallback(
    (next: number) => {
      onStepChange(Math.min(Math.max(next, 0), steps.length - 1));
    },
    [onStepChange, steps.length],
  );

  useEffect(() => {
    retainWakeLock(WAKE_LOCK_KEY);
    return () => releaseWakeLock(WAKE_LOCK_KEY);
  }, []);

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
      for (const element of changed) {
        element.removeAttribute("inert");
        element.removeAttribute("aria-hidden");
      }
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) =>
      handleCookModeKeyDown(event, {
        clampedStep,
        container: containerRef.current,
        goTo,
        onExit,
        setShowIngredients,
        showIngredients,
      });
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

  return {
    clampedStep,
    containerRef,
    current,
    goTo,
    onTouchEnd,
    onTouchStart,
    setShowIngredients,
    showIngredients,
  };
}
