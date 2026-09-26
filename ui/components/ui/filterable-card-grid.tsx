"use client";

import Fuse, { type FuseResult, type IFuseOptions } from "fuse.js";
import { ArrowDown, ArrowUp, Clock } from "lucide-react";
import { usePathname } from "next/navigation";
import posthog from "posthog-js";
import type { ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { DateRangeFilter } from "@/components/ui/date-range-filter";
import {
  FilterBar,
  type MobileFilterSection,
} from "@/components/ui/filter-bar";
import {
  MultiSelect,
  type MultiSelectOption,
} from "@/components/ui/multi-select";
import { useDebouncedSearchTracking } from "@/hooks/use-debounced-search-tracking";
import {
  type FilterParamConfig,
  type FilterState,
  filterAppliedAction,
  nextFilterState,
  useFilterParams,
} from "@/hooks/use-filter-params";
import { useSortParam } from "@/hooks/use-sort-param";

const SORT_OPTIONS = ["newest", "oldest", "updated"] as const;
type SortOption = (typeof SORT_OPTIONS)[number];

export interface MultiFilterConfig<T> {
  paramName: string;
  isMulti: boolean;
  label: string;
  getItemValues: (item: T) => string[];
  icon?: ReactNode;
  getValueLabel?: (value: string) => string;
  getOptionIcon?: (value: string) => ReactNode;
}

export interface SearchConfig<T> {
  placeholder: string;
  ariaLabel: string;
  keys: IFuseOptions<T>["keys"];
  /** Fuse.js threshold (default: 0.3) */
  threshold?: number;
}

interface SortConfig<T> {
  getDate: (item: T) => string;
  getUpdated?: (item: T) => string | undefined;
}

interface EmptyStateConfig {
  icon: ReactNode;
  message: string;
}

interface DateRangeConfig<T> {
  getDate: (item: T) => string;
}

interface FilterableCardGridProps<T> {
  items: T[];
  renderCard: (item: T, index: number) => ReactNode;
  getItemKey: (item: T) => string;
  searchConfig: SearchConfig<T>;
  filterConfigs?: MultiFilterConfig<T>[];
  filterBarContent?: ReactNode;
  dateRangeConfig?: DateRangeConfig<T>;
  sortConfig: SortConfig<T>;
  defaultSort?: SortOption;
  emptyState: EmptyStateConfig;
  itemName: string;
  /**
   * Optionally hoist the search box out of the grid (e.g. into a nav bar).
   * When both are provided the search becomes controlled by the parent; pair
   * with `hideInlineSearch` to remove the in-grid search input.
   */
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  hideInlineSearch?: boolean;
  stackControls?: boolean;
}

export function FilterableCardGrid<T>({
  items,
  renderCard,
  getItemKey,
  searchConfig,
  filterConfigs,
  filterBarContent,
  dateRangeConfig,
  sortConfig,
  defaultSort = "newest",
  emptyState,
  itemName,
  searchValue,
  onSearchChange,
  hideInlineSearch = false,
  stackControls = false,
}: Readonly<FilterableCardGridProps<T>>) {
  const { currentSort, cycleSortOrder } = useSortParam<SortOption>(
    SORT_OPTIONS,
    defaultSort,
  );
  const pathname = usePathname();
  const [internalSearchQuery, setInternalSearchQuery] = useState("");
  const isSearchControlled =
    searchValue !== undefined && onSearchChange !== undefined;
  const searchQuery = isSearchControlled ? searchValue : internalSearchQuery;
  const setSearchQuery = isSearchControlled
    ? onSearchChange
    : setInternalSearchQuery;

  const filterParamConfigs: FilterParamConfig[] = useMemo(() => {
    if (filterConfigs) {
      return filterConfigs.map((fc) => ({
        paramName: fc.paramName,
        isMulti: fc.isMulti,
      }));
    }
    return [];
  }, [filterConfigs]);

  const {
    getValues,
    getExcludedValues,
    getSelection,
    getState,
    peekState,
    setValues,
    setState,
    clearFilter,
    clearAllFilters,
    hasActiveFilters,
    activeFilterCount,
    getDateRange,
    setDateRange,
  } = useFilterParams({ filters: filterParamConfigs });

  const handleDateRangeChange = useCallback(
    (from: string | undefined, to: string | undefined) => {
      posthog.capture("filter_applied", {
        page: pathname,
        filter_type: "date_range",
        filter_value: `${from || "any"} to ${to || "any"}`,
        action: "changed",
      });
      setDateRange(from, to);
    },
    [pathname, setDateRange],
  );

  const fuse = useMemo(
    () =>
      new Fuse(items, {
        keys: searchConfig.keys,
        threshold: searchConfig.threshold ?? 0.3,
        ignoreLocation: true,
      }),
    [items, searchConfig.keys, searchConfig.threshold],
  );

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
  const filteredItems = useMemo(() => {
    let filtered = searchQuery.trim()
      ? fuse.search(searchQuery).map((result: FuseResult<T>) => result.item)
      : items;

    // Apply multi-filters. Across different filters: AND. Within one filter:
    // OR over included values, then drop anything carrying an excluded value.
    if (filterConfigs) {
      for (const fc of filterConfigs) {
        const { include, exclude } = getSelection(fc.paramName);
        if (include.length === 0 && exclude.length === 0) continue;
        filtered = filtered.filter((item: T) => {
          const itemValues = fc.getItemValues(item);
          if (exclude.some((v) => itemValues.includes(v))) return false;
          if (include.length > 0) {
            return include.some((v) => itemValues.includes(v));
          }
          return true;
        });
      }
    }

    if (dateRangeConfig) {
      const { from, to } = getDateRange();
      if (from) {
        const fromDate = new Date(from);
        filtered = filtered.filter(
          (item: T) => new Date(dateRangeConfig.getDate(item)) >= fromDate,
        );
      }
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999); // Include the entire "to" day
        filtered = filtered.filter(
          (item: T) => new Date(dateRangeConfig.getDate(item)) <= toDate,
        );
      }
    }

    return filtered;
  }, [
    fuse,
    searchQuery,
    items,
    filterConfigs,
    getSelection,
    dateRangeConfig,
    getDateRange,
  ]);

  useDebouncedSearchTracking({
    searchQuery,
    resultCount: filteredItems.length,
    location: itemName,
  });

  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a: T, b: T) => {
      if (currentSort === "oldest") {
        return (
          new Date(sortConfig.getDate(a)).getTime() -
          new Date(sortConfig.getDate(b)).getTime()
        );
      }
      if (currentSort === "updated") {
        const aDate = new Date(
          sortConfig.getUpdated?.(a) ?? sortConfig.getDate(a),
        ).getTime();
        const bDate = new Date(
          sortConfig.getUpdated?.(b) ?? sortConfig.getDate(b),
        ).getTime();
        return bDate - aDate;
      }
      return (
        new Date(sortConfig.getDate(b)).getTime() -
        new Date(sortConfig.getDate(a)).getTime()
      );
    });
  }, [filteredItems, currentSort, sortConfig]);

  const getSortIcon = () => {
    switch (currentSort) {
      case "oldest":
        return <ArrowUp className="h-4 w-4" />;
      case "updated":
        return <Clock className="h-4 w-4" />;
      default:
        return <ArrowDown className="h-4 w-4" />;
    }
  };

  const getSortLabel = () => {
    switch (currentSort) {
      case "oldest":
        return "Oldest first";
      case "updated":
        return "Recently updated";
      default:
        return "Newest first";
    }
  };

  const activeFilters = useMemo(() => {
    const filters: Array<{
      paramName: string;
      label: string;
      value: string;
      displayValue: string;
      icon?: ReactNode;
      excluded?: boolean;
    }> = [];

    if (filterConfigs) {
      for (const fc of filterConfigs) {
        const { include, exclude } = getSelection(fc.paramName);
        for (const value of include) {
          filters.push({
            paramName: fc.paramName,
            label: fc.label,
            value,
            displayValue: fc.getValueLabel?.(value) ?? value,
            icon: fc.icon,
          });
        }
        for (const value of exclude) {
          filters.push({
            paramName: fc.paramName,
            label: fc.label,
            value,
            displayValue: fc.getValueLabel?.(value) ?? value,
            icon: fc.icon,
            excluded: true,
          });
        }
      }
    }

    return filters;
  }, [filterConfigs, getSelection]);

  const captureFilterChange = useCallback(
    (paramName: string, value: string, nextState: FilterState) => {
      posthog.capture("filter_applied", {
        page: pathname,
        filter_type: paramName,
        filter_value: value,
        action: filterAppliedAction(nextState),
      });
    },
    [pathname],
  );

  const cycleFilter = useCallback(
    (paramName: string, value: string) => {
      // peekState, not getState: the reactive read can lag the URL, which would
      // record an action that doesn't match the state written here.
      const next = nextFilterState(peekState(paramName, value));
      captureFilterChange(paramName, value, next);
      setState(paramName, value, next);
    },
    [captureFilterChange, peekState, setState],
  );

  const filterOptions = useMemo(() => {
    if (!filterConfigs) return [];
    return filterConfigs.map((config) => {
      const uniqueValues = new Map<string, string>();
      for (const item of items) {
        for (const value of config.getItemValues(item)) {
          if (!uniqueValues.has(value)) {
            uniqueValues.set(value, config.getValueLabel?.(value) ?? value);
          }
        }
      }
      const options: MultiSelectOption[] = Array.from(uniqueValues.entries())
        .map(([value, label]) => ({
          value,
          label,
          icon: config.getOptionIcon?.(value),
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
      return { config, options };
    });
  }, [filterConfigs, items]);

  const mobileFilterSections: MobileFilterSection[] = useMemo(() => {
    return filterOptions.map(({ config, options }) => {
      return {
        paramName: config.paramName,
        label: config.label,
        icon: config.icon,
        options: options.map((option) => ({
          ...option,
          icon: option.icon ?? config.icon,
        })),
        getOptionState: (value: string) => getState(config.paramName, value),
        onCycleOption: (value: string) => cycleFilter(config.paramName, value),
      };
    });
  }, [filterOptions, getState, cycleFilter]);

  const handleRemoveFilter = (paramName: string, value: string) => {
    captureFilterChange(paramName, value, "off");
    if (filterConfigs) {
      setState(paramName, value, "off");
    } else {
      clearFilter(paramName);
    }
  };

  const isFiltering = searchQuery || hasActiveFilters;
  const sortButton = (
    <Button
      variant="outline"
      size="icon"
      onClick={cycleSortOrder}
      title={getSortLabel()}
      aria-label={`Sort: ${getSortLabel()}. Click to change sort order.`}
    >
      {getSortIcon()}
    </Button>
  );

  return (
    <div className="space-y-6">
      <FilterBar
        showSearch={!hideInlineSearch}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder={searchConfig.placeholder}
        searchAriaLabel={searchConfig.ariaLabel}
        stackControls={stackControls}
        activeFilters={activeFilters}
        onRemoveFilter={handleRemoveFilter}
        onCycleFilter={filterConfigs ? cycleFilter : undefined}
        onClearAll={clearAllFilters}
        hasActiveFilters={hasActiveFilters}
        activeFilterCount={activeFilterCount}
        sortButton={sortButton}
        mobileFilterSections={mobileFilterSections}
        mobileExtraContentLabel={dateRangeConfig ? "Date Range" : undefined}
        mobileExtraContent={
          dateRangeConfig ? (
            <DateRangeFilter
              from={getDateRange().from}
              to={getDateRange().to}
              onChange={handleDateRangeChange}
              size="default"
              className="w-full"
            />
          ) : undefined
        }
      >
        {filterBarContent ? (
          filterBarContent
        ) : (
          <>
            {/* Auto-generated desktop filters */}
            {filterOptions.map(({ config: fc, options }) => {
              return (
                <MultiSelect
                  key={fc.paramName}
                  options={options}
                  triState
                  value={getValues(fc.paramName)}
                  excludedValues={getExcludedValues(fc.paramName)}
                  onSetState={(value, state) => {
                    captureFilterChange(fc.paramName, value, state);
                    setState(fc.paramName, value, state);
                  }}
                  onClearAll={() => clearFilter(fc.paramName)}
                  onChange={(v) => setValues(fc.paramName, v)}
                  label={fc.label}
                  placeholder={`All ${fc.label.toLowerCase()}`}
                  icon={fc.icon}
                  size="sm"
                  searchable={options.length > 5}
                  searchPlaceholder={`Search ${fc.label.toLowerCase()}...`}
                />
              );
            })}

            {dateRangeConfig && (
              <DateRangeFilter
                from={getDateRange().from}
                to={getDateRange().to}
                onChange={handleDateRangeChange}
                size="sm"
              />
            )}
          </>
        )}
      </FilterBar>

      {isFiltering && sortedItems.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Showing {sortedItems.length} of {items.length} {itemName}
          {searchQuery && ` matching "${searchQuery}"`}
        </p>
      )}

      {sortedItems.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border rounded-lg bg-muted/20">
          <div className="flex flex-col items-center gap-2">
            {emptyState.icon}
            <p>{emptyState.message}</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {sortedItems.map((item, index) => (
            <div key={getItemKey(item)}>{renderCard(item, index)}</div>
          ))}
        </div>
      )}
    </div>
  );
}
