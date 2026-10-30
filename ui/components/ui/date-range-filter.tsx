"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { format, startOfYear, subDays, subMonths } from "date-fns";
import { CalendarIcon, ChevronDownIcon, X } from "lucide-react";
import { useCallback, useId, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/generic/styles";

interface DateRangePreset {
  label: string;
  getRange: () => { from: string; to: string };
}

const DEFAULT_PRESETS: DateRangePreset[] = [
  {
    label: "Last 30 days",
    getRange: () => ({
      from: format(subDays(new Date(), 30), "yyyy-MM-dd"),
      to: format(new Date(), "yyyy-MM-dd"),
    }),
  },
  {
    label: "Last 6 months",
    getRange: () => ({
      from: format(subMonths(new Date(), 6), "yyyy-MM-dd"),
      to: format(new Date(), "yyyy-MM-dd"),
    }),
  },
  {
    label: "This year",
    getRange: () => ({
      from: format(startOfYear(new Date()), "yyyy-MM-dd"),
      to: format(new Date(), "yyyy-MM-dd"),
    }),
  },
  {
    label: "Last year",
    getRange: () => {
      const lastYear = new Date().getFullYear() - 1;
      return {
        from: `${lastYear}-01-01`,
        to: `${lastYear}-12-31`,
      };
    },
  },
];

interface DateRangeFilterProps {
  from: string | undefined;
  to: string | undefined;
  onChange: (from: string | undefined, to: string | undefined) => void;
  placeholder?: string;
  label?: string;
  presets?: DateRangePreset[];
  className?: string;
  disabled?: boolean;
  size?: "sm" | "default";
}

export function DateRangeFilter({
  from,
  to,
  onChange,
  placeholder = "Date range",
  label,
  presets = DEFAULT_PRESETS,
  className,
  disabled = false,
  size = "default",
}: Readonly<DateRangeFilterProps>) {
  const [open, setOpen] = useState(false);
  const [localFrom, setLocalFrom] = useState(from ?? "");
  const [localTo, setLocalTo] = useState(to ?? "");
  const id = useId();

  const hasValue = from || to;

  const displayValue = useMemo(() => {
    if (!from && !to) {
      return <span className="text-muted-foreground">{placeholder}</span>;
    }
    if (from && to) {
      return `${from} – ${to}`;
    }
    if (from) {
      return `From ${from}`;
    }
    return `Until ${to}`;
  }, [from, to, placeholder]);

  const handleApply = useCallback(() => {
    onChange(localFrom || undefined, localTo || undefined);
    setOpen(false);
  }, [localFrom, localTo, onChange]);

  const handlePreset = useCallback(
    (preset: DateRangePreset) => {
      const range = preset.getRange();
      setLocalFrom(range.from);
      setLocalTo(range.to);
      onChange(range.from, range.to);
      setOpen(false);
    },
    [onChange],
  );

  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setLocalFrom("");
      setLocalTo("");
      onChange(undefined, undefined);
    },
    [onChange],
  );

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (isOpen) {
        setLocalFrom(from ?? "");
        setLocalTo(to ?? "");
      }
      setOpen(isOpen);
    },
    [from, to],
  );

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <PopoverPrimitive.Trigger asChild>
        {/* biome-ignore lint/a11y/useSemanticElements: usage of div is intentional to avoid nested buttons */}
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          data-slot="date-range-filter-trigger"
          aria-disabled={disabled}
          className={cn(
            "border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 flex w-fit items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] aria-disabled:cursor-not-allowed aria-disabled:opacity-50 cursor-pointer [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
            size === "default" && "h-9",
            size === "sm" && "h-8 text-xs px-2",
            className,
          )}
        >
          <span className="flex items-center gap-2 min-w-0">
            <CalendarIcon className="size-4" />
            {label && (
              <span className="text-muted-foreground shrink-0">{label}:</span>
            )}
            <span className="truncate">{displayValue}</span>
          </span>
          <span className="flex items-center gap-1 shrink-0">
            {hasValue && (
              <button
                type="button"
                onClick={handleClear}
                className="rounded-full p-0.5 hover:bg-muted transition-colors"
                aria-label="Clear date range"
              >
                <X className="size-3" />
              </button>
            )}
            <ChevronDownIcon
              className={cn(
                "size-4 opacity-50 transition-transform",
                open && "rotate-180",
              )}
            />
          </span>
        </div>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          data-slot="date-range-filter-content"
          className={cn(
            "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-[280px] origin-(--radix-popover-content-transform-origin) overflow-hidden rounded-md border shadow-md",
          )}
          sideOffset={4}
          align="start"
        >
          <div className="p-3 space-y-3">
            <div className="space-y-2">
              <label htmlFor={`${id}-from`} className="text-sm font-medium">
                From
              </label>
              <Input
                id={`${id}-from`}
                type="date"
                value={localFrom}
                onChange={(e) => setLocalFrom(e.target.value)}
                max={localTo || undefined}
                className="w-full"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor={`${id}-to`} className="text-sm font-medium">
                To
              </label>
              <Input
                id={`${id}-to`}
                type="date"
                value={localTo}
                onChange={(e) => setLocalTo(e.target.value)}
                min={localFrom || undefined}
                className="w-full"
              />
            </div>
            <Button onClick={handleApply} className="w-full" size="sm">
              Apply
            </Button>
          </div>

          {presets.length > 0 && (
            <div className="border-t p-2">
              <div className="text-xs text-muted-foreground px-2 py-1">
                Quick select
              </div>
              <div className="space-y-0.5">
                {presets.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => handlePreset(preset)}
                    className={cn(
                      "w-full text-left px-2 py-1.5 text-sm rounded-sm",
                      "hover:bg-accent hover:text-accent-foreground",
                      "focus:bg-accent focus:text-accent-foreground focus:outline-none",
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
