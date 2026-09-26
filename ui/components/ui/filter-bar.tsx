"use client";

import {
  ArrowLeft,
  Check,
  ChevronRight,
  Filter,
  Minus,
  Search,
  X,
} from "lucide-react";
import type * as React from "react";
import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { FilterChip } from "@/components/ui/filter-chip";
import { Input } from "@/components/ui/input";
import {
  type FilterState,
  filterStateAriaLabel,
} from "@/hooks/use-filter-params";
import { cn } from "@/lib/generic/styles";

interface ActiveFilter {
  paramName: string;
  label: string;
  value: string;
  displayValue: string;
  icon?: React.ReactNode;
  excluded?: boolean;
}

export interface MobileFilterOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
}

export interface MobileFilterSection {
  paramName: string;
  label: string;
  icon?: React.ReactNode;
  options: MobileFilterOption[];
  getOptionState: (value: string) => FilterState;
  onCycleOption: (value: string) => void;
}

interface FilterBarProps {
  children: React.ReactNode;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  searchAriaLabel?: string;
  stackControls?: boolean;
  activeFilters?: ActiveFilter[];
  onRemoveFilter?: (paramName: string, value: string) => void;
  onCycleFilter?: (paramName: string, value: string) => void;
  onClearAll?: () => void;
  hasActiveFilters?: boolean;
  activeFilterCount?: number;
  className?: string;
  showSearch?: boolean;
  sortButton?: React.ReactNode;
  mobileFilterSections?: MobileFilterSection[];
  mobileExtraContent?: React.ReactNode;
  mobileExtraContentLabel?: string;
}

function availableSections(
  sections: MobileFilterSection[] | undefined,
): MobileFilterSection[] {
  return sections ?? [];
}

function SearchControl({
  onSearchChange,
  searchAriaLabel,
  searchPlaceholder,
  searchValue,
  stackControls,
}: Readonly<{
  onSearchChange: (value: string) => void;
  searchAriaLabel?: string;
  searchPlaceholder: string;
  searchValue: string;
  stackControls: boolean;
}>) {
  return (
    <div
      className={cn(
        "relative flex-1 min-w-[120px] md:min-w-[200px] max-w-md",
        stackControls && "w-full basis-full md:w-auto md:basis-auto",
      )}
    >
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        placeholder={searchPlaceholder}
        value={searchValue}
        onChange={(event) => onSearchChange(event.target.value)}
        className="pl-9 pr-9 [&::-webkit-search-cancel-button]:appearance-none"
        aria-label={searchAriaLabel ?? searchPlaceholder}
      />
      {searchValue && (
        <button
          type="button"
          onClick={() => onSearchChange("")}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label="Clear search"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export function FilterBar({
  children,
  searchValue = "",
  onSearchChange,
  searchPlaceholder = "Search...",
  searchAriaLabel,
  stackControls = false,
  activeFilters = [],
  onRemoveFilter,
  onCycleFilter,
  onClearAll,
  hasActiveFilters = false,
  activeFilterCount = 0,
  className,
  showSearch = true,
  sortButton,
  mobileFilterSections,
  mobileExtraContent,
  mobileExtraContentLabel,
}: Readonly<FilterBarProps>) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileSectionName, setMobileSectionName] = useState<string>();
  const [mobileFilterQuery, setMobileFilterQuery] = useState("");
  const [mobileOptionOrder, setMobileOptionOrder] = useState<string[]>([]);
  const mobileOptionsId = useId();
  const mobileResultsStatusId = useId();
  const availableMobileFilterSections = availableSections(mobileFilterSections);
  const mobileSection = availableMobileFilterSections.find(
    (section) => section.paramName === mobileSectionName,
  );
  const hasMobileFilterSections = availableMobileFilterSections.length > 0;
  const orderedMobileOptions = useMemo(() => {
    if (!mobileSection) return [];

    const orderByValue = new Map(
      mobileOptionOrder.map((value, index) => [value, index]),
    );
    return [...mobileSection.options].sort((a, b) => {
      const aIndex = orderByValue.get(a.value);
      const bIndex = orderByValue.get(b.value);
      if (aIndex === undefined && bIndex === undefined) return 0;
      if (aIndex === undefined) return 1;
      if (bIndex === undefined) return -1;
      return aIndex - bIndex;
    });
  }, [mobileOptionOrder, mobileSection]);
  const visibleMobileOptions = useMemo(() => {
    if (!mobileSection) return [];

    const query = mobileFilterQuery.trim().toLocaleLowerCase();
    if (!query) return orderedMobileOptions;
    return orderedMobileOptions.filter((option) =>
      option.label.toLocaleLowerCase().includes(query),
    );
  }, [mobileFilterQuery, mobileSection, orderedMobileOptions]);

  const handleMobileOpenChange = (open: boolean) => {
    // Keep the current content mounted during Vaul's close animation, then
    // reset the navigation state just before the next open.
    if (open) {
      setMobileSectionName(undefined);
      setMobileFilterQuery("");
      setMobileOptionOrder([]);
    }
    setMobileOpen(open);
  };

  const openMobileSection = (paramName: string) => {
    const section = availableMobileFilterSections.find(
      (candidate) => candidate.paramName === paramName,
    );
    const orderedOptions = section
      ? [...section.options].sort((a, b) => {
          const aIsActive = section.getOptionState(a.value) !== "off";
          const bIsActive = section.getOptionState(b.value) !== "off";
          if (aIsActive === bIsActive) return 0;
          return aIsActive ? -1 : 1;
        })
      : [];
    setMobileSectionName(paramName);
    setMobileFilterQuery("");
    // Capture the active-first order when entering the category. Keeping it
    // stable prevents a tapped row from moving underneath the user's finger.
    setMobileOptionOrder(orderedOptions.map((option) => option.value));
  };

  const closeMobileSection = () => {
    setMobileSectionName(undefined);
    setMobileFilterQuery("");
    setMobileOptionOrder([]);
  };
  const searchControl = showSearch && onSearchChange && (
    <SearchControl
      onSearchChange={onSearchChange}
      searchAriaLabel={searchAriaLabel}
      searchPlaceholder={searchPlaceholder}
      searchValue={searchValue}
      stackControls={stackControls}
    />
  );
  const desktopFilters = (
    <div className="hidden md:flex items-center gap-2 flex-wrap">
      {children}
    </div>
  );
  const mobileFilterButton = (
    <Drawer open={mobileOpen} onOpenChange={handleMobileOpenChange}>
      <DrawerTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="md:hidden flex items-center gap-2"
        >
          <Filter className="h-4 w-4" />
          <span>Filters</span>
          {activeFilterCount > 0 && (
            <span className="bg-primary text-primary-foreground text-xs px-1.5 py-0.5 rounded-full">
              {activeFilterCount}
            </span>
          )}
        </Button>
      </DrawerTrigger>
      <DrawerContent className="h-[85dvh] max-h-[85dvh] pb-[env(safe-area-inset-bottom)]">
        <DrawerHeader className="border-b pb-3">
          <div className="flex min-h-8 items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {mobileSection && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={closeMobileSection}
                  aria-label="Back to filter categories"
                  className="-ml-2"
                >
                  <ArrowLeft />
                </Button>
              )}
              <DrawerTitle className="truncate">
                {mobileSection?.label ?? "Filters"}
              </DrawerTitle>
            </div>
            <div className="flex items-center gap-1">
              {!mobileSection && hasActiveFilters && onClearAll && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onClearAll}
                >
                  Clear all
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleMobileOpenChange(false)}
              >
                Done
              </Button>
            </div>
          </div>
        </DrawerHeader>

        {/* Mobile filters use a category-first drill-down so large option sets
            never turn the drawer into one long, difficult-to-scan page. */}
        {hasMobileFilterSections && mobileSection && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 border-b p-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder={`Search ${mobileSection.label.toLocaleLowerCase()}…`}
                  value={mobileFilterQuery}
                  onChange={(event) => setMobileFilterQuery(event.target.value)}
                  className="h-11 pl-9 pr-9 [&::-webkit-search-cancel-button]:appearance-none"
                  aria-label={`Search ${mobileSection.label} filter values`}
                  aria-controls={mobileOptionsId}
                  aria-describedby={mobileResultsStatusId}
                />
                {mobileFilterQuery && (
                  <button
                    type="button"
                    onClick={() => setMobileFilterQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:text-foreground"
                    aria-label={`Clear ${mobileSection.label} search`}
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>Tap once to include · again to exclude</span>
                <span
                  id={mobileResultsStatusId}
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {visibleMobileOptions.length} of{" "}
                  {mobileSection.options.length}
                </span>
              </div>
            </div>
            <div
              id={mobileOptionsId}
              className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
            >
              {visibleMobileOptions.length > 0 ? (
                <div className="space-y-1">
                  {visibleMobileOptions.map((option) => {
                    const state = mobileSection.getOptionState(option.value);
                    const isIncluded = state === "include";
                    const isExcluded = state === "exclude";
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-label={filterStateAriaLabel(option.label, state)}
                        className={cn(
                          "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          (isIncluded || isExcluded) && "bg-accent/60",
                        )}
                        onClick={() =>
                          mobileSection.onCycleOption(option.value)
                        }
                      >
                        {option.icon && (
                          <span className="shrink-0 text-muted-foreground">
                            {option.icon}
                          </span>
                        )}
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate",
                            isExcluded && "line-through",
                          )}
                        >
                          {option.label}
                        </span>
                        {isIncluded && (
                          <span className="flex items-center gap-1 text-xs font-medium text-primary">
                            Included <Check className="size-4" />
                          </span>
                        )}
                        {isExcluded && (
                          <span className="flex items-center gap-1 text-xs font-medium text-destructive">
                            Excluded <Minus className="size-4" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="px-4 py-12 text-center">
                  <Search className="mx-auto mb-3 size-6 text-muted-foreground" />
                  <p className="font-medium">No matching values</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Try a different search for{" "}
                    {mobileSection.label.toLocaleLowerCase()}.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
        {hasMobileFilterSections && !mobileSection && (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <p className="mb-3 text-sm text-muted-foreground">
              Choose a category, then search or browse its values.
            </p>
            {mobileExtraContent && (
              <div className="mb-4 rounded-lg border p-3">
                {mobileExtraContentLabel && (
                  <h4 className="mb-2 text-sm font-medium">
                    {mobileExtraContentLabel}
                  </h4>
                )}
                {mobileExtraContent}
              </div>
            )}
            <div className="space-y-2">
              {availableMobileFilterSections.map((section) => {
                const activeCount = section.options.reduce(
                  (count, option) =>
                    count +
                    (section.getOptionState(option.value) === "off" ? 0 : 1),
                  0,
                );
                const activeDescription = activeCount
                  ? `, ${activeCount} active`
                  : "";
                return (
                  <button
                    key={section.paramName}
                    type="button"
                    onClick={() => openMobileSection(section.paramName)}
                    aria-label={`${section.label}, ${section.options.length} values${activeDescription}`}
                    className="flex min-h-14 w-full items-center gap-3 rounded-lg border bg-card px-3 py-2 text-left shadow-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {section.icon && (
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        {section.icon}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{section.label}</span>
                      <span className="block text-xs text-muted-foreground">
                        {section.options.length} values
                      </span>
                    </span>
                    {activeCount > 0 && (
                      <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                        {activeCount}
                      </span>
                    )}
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {!hasMobileFilterSections && (
          /* Fallback to children if no mobile sections provided */
          <div className="flex flex-col gap-3 py-4">{children}</div>
        )}
      </DrawerContent>
    </Drawer>
  );
  const toolbarControls = (
    <>
      {desktopFilters}
      {mobileFilterButton}
      {sortButton}

      {hasActiveFilters && onClearAll && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClearAll}
          className="hidden md:flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
          Clear filters
        </Button>
      )}
    </>
  );

  return (
    <div className={cn("space-y-3", className)}>
      {/* Main filter bar */}
      {stackControls ? (
        <div className="space-y-3">
          {searchControl}
          <div className="flex flex-wrap items-center gap-3">
            {toolbarControls}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {searchControl}
          {toolbarControls}
        </div>
      )}

      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Active filters:</span>
          {activeFilters.map((filter) => (
            <FilterChip
              key={`${filter.paramName}-${filter.excluded ? "!" : ""}${filter.value}`}
              icon={filter.icon}
              name={filter.displayValue}
              excluded={filter.excluded}
              onRemove={() => onRemoveFilter?.(filter.paramName, filter.value)}
              onCycle={
                onCycleFilter
                  ? () => onCycleFilter(filter.paramName, filter.value)
                  : undefined
              }
            >
              {filter.displayValue}
            </FilterChip>
          ))}
        </div>
      )}
    </div>
  );
}
