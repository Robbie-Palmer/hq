"use client";

import { Timer } from "lucide-react";
import { type ReactElement, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { startCustomTimer } from "@/lib/cooking/timerStore";
import { cn } from "@/lib/generic/styles";

const QUICK_MINUTES = [1, 3, 5, 10, 15] as const;

function clampInt(value: string, max: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(parsed, max);
}

export function AddTimerPopover({
  trigger,
  defaultLabel = "",
  defaultMinutes = 5,
  recipeSlug,
  recipeTitle,
  stepIndex,
  stepText,
  align = "center",
  onStarted,
}: Readonly<{
  /** Radix `asChild` requires a single focusable element, so ReactElement (not ReactNode). */
  trigger: ReactElement;
  defaultLabel?: string;
  defaultMinutes?: number;
  recipeSlug?: string;
  recipeTitle?: string;
  stepIndex?: number;
  stepText?: string;
  align?: "start" | "center" | "end";
  onStarted?: (id: string) => void;
}>) {
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState(String(defaultMinutes));
  const [seconds, setSeconds] = useState("0");
  const [label, setLabel] = useState(defaultLabel);
  const labelId = useId();
  const minutesId = useId();
  const secondsId = useId();

  const durationSeconds = clampInt(minutes, 999) * 60 + clampInt(seconds, 59);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setMinutes(String(defaultMinutes));
      setSeconds("0");
      setLabel(defaultLabel);
    }
    setOpen(next);
  };

  const start = () => {
    if (durationSeconds <= 0) return;
    const id = startCustomTimer({
      label: label.trim() || "Timer",
      durationSeconds,
      recipeSlug,
      recipeTitle,
      stepIndex,
      stepText,
    });
    onStarted?.(id);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      {/* Above the cook-mode dialog (z-60) and the floating dock (z-80): this
          popover is opened from inside both, and the shared PopoverContent's
          default z-50 would otherwise render it behind the opaque cook-mode
          overlay — i.e. "nothing happens" when you tap add-timer while cooking. */}
      <PopoverContent align={align} className="z-[90] w-64">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            start();
          }}
          className="flex flex-col gap-3"
        >
          <div className="rt-mono flex items-center gap-1.5 text-[var(--terracotta)]">
            <Timer className="size-3.5" />
            add a timer
          </div>

          <div className="flex items-end gap-2">
            <label className="flex flex-1 flex-col gap-1" htmlFor={minutesId}>
              <span className="rt-mono text-[10px] text-[var(--ink-3)]">
                min
              </span>
              <Input
                id={minutesId}
                type="number"
                inputMode="numeric"
                min={0}
                max={999}
                value={minutes}
                onChange={(event) => setMinutes(event.target.value)}
                // Snap the field to the value actually used, so a typed 1000
                // doesn't read as 1000 while the timer starts at 999.
                onBlur={() => setMinutes(String(clampInt(minutes, 999)))}
                className="tabular-nums"
              />
            </label>
            <span className="pb-2 text-[var(--ink-3)]">:</span>
            <label className="flex flex-1 flex-col gap-1" htmlFor={secondsId}>
              <span className="rt-mono text-[10px] text-[var(--ink-3)]">
                sec
              </span>
              <Input
                id={secondsId}
                type="number"
                inputMode="numeric"
                min={0}
                max={59}
                value={seconds}
                onChange={(event) => setSeconds(event.target.value)}
                onBlur={() => setSeconds(String(clampInt(seconds, 59)))}
                className="tabular-nums"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {QUICK_MINUTES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMinutes(String(m));
                  setSeconds("0");
                }}
                className={cn(
                  "rt-mono rounded-full border border-[var(--line-strong)] px-2 py-0.5 text-[11px] transition-colors hover:bg-[var(--butter-soft)]",
                  clampInt(minutes, 999) === m &&
                    clampInt(seconds, 59) === 0 &&
                    "bg-[var(--butter-soft)] font-semibold",
                )}
              >
                {m}m
              </button>
            ))}
          </div>

          <label className="flex flex-col gap-1" htmlFor={labelId}>
            <span className="rt-mono text-[10px] text-[var(--ink-3)]">
              label (optional)
            </span>
            <Input
              id={labelId}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="e.g. pasta"
              maxLength={40}
            />
          </label>

          <Button
            type="submit"
            size="sm"
            disabled={durationSeconds <= 0}
            className="bg-[var(--terracotta)] text-white hover:bg-[var(--terracotta-deep)]"
          >
            Start timer
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
