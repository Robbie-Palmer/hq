"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { CheckIcon, ChevronDownIcon, Minus, Search, X } from "lucide-react";
import type * as React from "react";
import { useCallback, useId, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  type FilterState,
  filterStateAriaLabel,
  nextFilterState,
} from "@/hooks/use-filter-params";
import { cn } from "@/lib/generic/styles";

export interface MultiSelectOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

/**
 * Tri-state (opt-in) props. When enabled, a row cycles off → include →
 * exclude → off instead of a plain checkbox toggle. Requires `onSetState`;
 * excluded values are supplied via `excludedValues`. Kept as a standalone
 * interface so thin filter wrappers can forward it with a single spread.
 */
export interface MultiSelectTriStateProps {
  triState?: boolean;
  excludedValues?: string[];
  onSetState?: (value: string, state: FilterState) => void;
  /** Clears both included and excluded values. Falls back to `onChange([])`. */
  onClearAll?: () => void;
}

interface MultiSelectProps extends MultiSelectTriStateProps {
  options: MultiSelectOption[];
  /** Included values. */
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  label?: string;
  icon?: React.ReactNode;
  maxSelections?: number;
  searchable?: boolean;
  searchPlaceholder?: string;
  className?: string;
  disabled?: boolean;
  size?: "sm" | "default";
}

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = "Select...",
  label,
  icon,
  maxSelections,
  searchable = true,
  searchPlaceholder = "Search...",
  className,
  disabled = false,
  size = "default",
  triState = false,
  excludedValues = [],
  onSetState,
  onClearAll,
}: Readonly<MultiSelectProps>) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const optionsDialogId = useId();
  const isTri = triState && typeof onSetState === "function";

  const filteredOptions = useMemo(() => {
    if (!searchQuery.trim()) return options;
    const query = searchQuery.toLowerCase();
    return options.filter((option) =>
      option.label.toLowerCase().includes(query),
    );
  }, [options, searchQuery]);

  const stateOf = useCallback(
    (optionValue: string): FilterState => {
      if (excludedValues.includes(optionValue)) return "exclude";
      if (value.includes(optionValue)) return "include";
      return "off";
    },
    [excludedValues, value],
  );

  // Build chips straight from the selected values (not by filtering options),
  // so a stale token in the URL — one whose option no longer exists after the
  // data changed — still renders a labelled, removable chip instead of a
  // phantom count with no affordance.
  const optionByValue = useMemo(
    () => new Map(options.map((option) => [option.value, option])),
    [options],
  );
  const includedOptions = useMemo<MultiSelectOption[]>(
    () => value.map((v) => optionByValue.get(v) ?? { value: v, label: v }),
    [value, optionByValue],
  );
  const excludedOptions = useMemo<MultiSelectOption[]>(
    () =>
      isTri
        ? excludedValues.map(
            (v) => optionByValue.get(v) ?? { value: v, label: v },
          )
        : [],
    [isTri, excludedValues, optionByValue],
  );

  const activeCount = includedOptions.length + excludedOptions.length;

  const handleToggle = useCallback(
    (optionValue: string) => {
      if (isTri && onSetState) {
        onSetState(optionValue, nextFilterState(stateOf(optionValue)));
        return;
      }
      const isSelected = value.includes(optionValue);
      if (isSelected) {
        onChange(value.filter((v) => v !== optionValue));
      } else {
        if (maxSelections && value.length >= maxSelections) return;
        onChange([...value, optionValue]);
      }
    },
    [isTri, onSetState, stateOf, value, onChange, maxSelections],
  );

  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isTri && onClearAll) {
        onClearAll();
        return;
      }
      onChange([]);
    },
    [isTri, onClearAll, onChange],
  );

  const handleRemove = useCallback(
    (optionValue: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (isTri && onSetState) {
        onSetState(optionValue, "off");
        return;
      }
      onChange(value.filter((v) => v !== optionValue));
    },
    [isTri, onSetState, value, onChange],
  );

  const displayValue = useMemo(() => {
    if (activeCount === 0) {
      return <span className="text-muted-foreground">{placeholder}</span>;
    }
    if (activeCount === 1) {
      const option = includedOptions[0] ?? excludedOptions[0];
      const excluded = includedOptions.length === 0;
      return (
        <span className="flex items-center gap-1.5 truncate">
          {excluded && <Minus className="size-3 text-destructive" />}
          {option?.icon}
          <span className={cn(excluded && "line-through")}>
            {option?.label}
          </span>
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1.5">{activeCount} selected</span>
    );
  }, [activeCount, includedOptions, excludedOptions, placeholder]);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <div
          role="combobox"
          aria-controls={optionsDialogId}
          aria-expanded={open}
          aria-haspopup="dialog"
          data-slot="multi-select-trigger"
          tabIndex={disabled ? -1 : 0}
          className={cn(
            "border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 flex w-fit items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] cursor-pointer [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
            size === "default" && "h-9",
            size === "sm" && "h-8 text-xs px-2",
            disabled && "cursor-not-allowed opacity-50 pointer-events-none",
            className,
          )}
        >
          <span className="flex items-center gap-2 min-w-0">
            {icon}
            {label && (
              <span className="text-muted-foreground shrink-0">{label}:</span>
            )}
            <span className="truncate">{displayValue}</span>
          </span>
          <span className="flex items-center gap-1 shrink-0">
            {activeCount > 0 && (
              <button
                type="button"
                onClick={handleClear}
                className="rounded-full p-0.5 hover:bg-muted transition-colors cursor-pointer"
                aria-label="Clear all selections"
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
          id={optionsDialogId}
          role="dialog"
          aria-label={label ? `${label} options` : "Select options"}
          data-slot="multi-select-content"
          className={cn(
            "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[200px] max-w-[300px] origin-(--radix-popover-content-transform-origin) overflow-hidden rounded-md border shadow-md",
          )}
          sideOffset={4}
          align="start"
        >
          {searchable && (
            <div className="flex items-center border-b px-3">
              <Search className="size-4 text-muted-foreground shrink-0" />
              <input
                type="text"
                placeholder={searchPlaceholder}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent py-2.5 pl-2 text-sm outline-none placeholder:text-muted-foreground"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="rounded-full p-0.5 hover:bg-muted transition-colors"
                  aria-label="Clear search"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          )}

          {isTri && (
            <p className="border-b px-3 py-1.5 text-[11px] text-muted-foreground">
              Click to include · click again to exclude
            </p>
          )}

          <div className="max-h-[300px] overflow-y-auto p-1">
            {filteredOptions.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                No options found
              </div>
            ) : (
              filteredOptions.map((option) => {
                const state = stateOf(option.value);
                const isSelected = state === "include";
                const isExcluded = state === "exclude";
                const isDisabled =
                  option.disabled ||
                  (!isTri &&
                    !isSelected &&
                    maxSelections !== undefined &&
                    value.length >= maxSelections);

                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => !isDisabled && handleToggle(option.value)}
                    disabled={isDisabled}
                    aria-label={filterStateAriaLabel(option.label, state)}
                    className={cn(
                      "relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-2 text-sm outline-hidden select-none",
                      "hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
                      isDisabled && "pointer-events-none opacity-50",
                    )}
                  >
                    <div
                      className={cn(
                        "peer size-4 shrink-0 rounded-[4px] border border-input shadow-xs transition-shadow flex items-center justify-center",
                        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
                        isSelected &&
                          "bg-primary border-primary text-primary-foreground",
                        isExcluded &&
                          "bg-destructive border-destructive text-white",
                        state === "off" && "bg-background",
                        isDisabled && "cursor-not-allowed opacity-50",
                      )}
                    >
                      {isSelected && <CheckIcon className="size-3" />}
                      {isExcluded && <Minus className="size-3" />}
                    </div>
                    {option.icon && (
                      <span className="shrink-0">{option.icon}</span>
                    )}
                    <span
                      className={cn(
                        "truncate",
                        isExcluded && "line-through text-muted-foreground",
                      )}
                    >
                      {option.label}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {activeCount > 0 && (
            <div className="border-t p-2">
              <div className="flex flex-wrap gap-1">
                {includedOptions.map((option) => (
                  <Badge
                    key={option.value}
                    variant="secondary"
                    className="text-xs gap-1 pr-1"
                  >
                    {option.icon}
                    <span className="truncate max-w-[100px]">
                      {option.label}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => handleRemove(option.value, e)}
                      className="rounded-full p-0.5 hover:bg-background/50 transition-colors"
                      aria-label={`Remove ${option.label}`}
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
                {excludedOptions.map((option) => (
                  <Badge
                    key={option.value}
                    variant="destructive"
                    className="text-xs gap-1 pr-1"
                  >
                    <Minus className="size-3" />
                    <span className="truncate max-w-[100px] line-through">
                      {option.label}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => handleRemove(option.value, e)}
                      className="rounded-full p-0.5 hover:bg-background/50 transition-colors"
                      aria-label={`Remove ${option.label}`}
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
