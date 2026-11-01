"use client";

import Fuse, { type FuseResult } from "fuse.js";
import { Circle, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { TechnologyTypeFilter } from "@/components/filters/technology-type-filter";
import { TechnologyCard } from "@/components/technology/technology-card";
import {
  FilterBar,
  type MobileFilterSection,
} from "@/components/ui/filter-bar";
import { type FilterState, nextFilterState } from "@/hooks/use-filter-params";
import {
  TECHNOLOGY_TYPE_CONFIG,
  TECHNOLOGY_TYPES,
  type TechnologyType,
} from "@/lib/domain/technology/technology";
import type { TechnologyBadgeView } from "@/lib/domain/technology/technologyViews";

interface RankedTechnology {
  badge: TechnologyBadgeView;
  description?: string;
}

interface SearchableTechnologyGridProps {
  technologies: RankedTechnology[];
}

export function SearchableTechnologyGrid({
  technologies,
}: Readonly<SearchableTechnologyGridProps>) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [excludedTypes, setExcludedTypes] = useState<string[]>([]);

  const typeState = (value: string): FilterState => {
    if (excludedTypes.includes(value)) return "exclude";
    if (selectedTypes.includes(value)) return "include";
    return "off";
  };

  const setTypeState = (value: string, state: FilterState) => {
    setSelectedTypes((prev) =>
      state === "include"
        ? [...prev.filter((t) => t !== value), value]
        : prev.filter((t) => t !== value),
    );
    setExcludedTypes((prev) =>
      state === "exclude"
        ? [...prev.filter((t) => t !== value), value]
        : prev.filter((t) => t !== value),
    );
  };

  const cycleType = (value: string) => {
    setTypeState(value, nextFilterState(typeState(value)));
  };

  const fuse = useMemo(
    () =>
      new Fuse(technologies, {
        keys: [{ name: "badge.name", weight: 1 }],
        threshold: 0.3,
        ignoreLocation: true,
      }),
    [technologies],
  );

  const filteredTechnologies = useMemo(() => {
    let results = technologies;

    // Apply search filter
    if (searchQuery.trim()) {
      results = fuse
        .search(searchQuery)
        .map((result: FuseResult<RankedTechnology>) => result.item);
    }

    // Apply type filter: OR over included, then drop excluded.
    if (selectedTypes.length > 0) {
      results = results.filter((tech) =>
        selectedTypes.includes(tech.badge.type as TechnologyType),
      );
    }
    if (excludedTypes.length > 0) {
      results = results.filter(
        (tech) => !excludedTypes.includes(tech.badge.type as TechnologyType),
      );
    }

    return results;
  }, [fuse, searchQuery, selectedTypes, excludedTypes, technologies]);

  const hasActiveFilters = selectedTypes.length > 0 || excludedTypes.length > 0;

  const activeFilters = [
    ...selectedTypes.map((type) => {
      const config = TECHNOLOGY_TYPE_CONFIG[type as TechnologyType];
      return {
        paramName: "type",
        label: "Type",
        value: type,
        displayValue: config.label,
        icon: <Circle className={`size-2 fill-current ${config.color}`} />,
      };
    }),
    ...excludedTypes.map((type) => {
      const config = TECHNOLOGY_TYPE_CONFIG[type as TechnologyType];
      return {
        paramName: "type",
        label: "Type",
        value: type,
        displayValue: config.label,
        icon: <Circle className={`size-2 fill-current ${config.color}`} />,
        excluded: true,
      };
    }),
  ];

  const handleRemoveFilter = (_paramName: string, value: string) => {
    setTypeState(value, "off");
  };

  const mobileFilterSections: MobileFilterSection[] = [
    {
      paramName: "type",
      label: "Type",
      options: TECHNOLOGY_TYPES.map((type) => ({
        value: type,
        label: TECHNOLOGY_TYPE_CONFIG[type].label,
        icon: (
          <Circle
            className={`size-2 fill-current ${TECHNOLOGY_TYPE_CONFIG[type].color}`}
          />
        ),
      })),
      getOptionState: (value: string) => typeState(value),
      onCycleOption: cycleType,
    },
  ];

  return (
    <div className="space-y-6">
      <FilterBar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search technologies..."
        activeFilters={activeFilters}
        onRemoveFilter={handleRemoveFilter}
        onClearAll={() => {
          setSelectedTypes([]);
          setExcludedTypes([]);
        }}
        hasActiveFilters={hasActiveFilters}
        activeFilterCount={selectedTypes.length + excludedTypes.length}
        mobileFilterSections={mobileFilterSections}
      >
        <TechnologyTypeFilter
          value={selectedTypes}
          onChange={setSelectedTypes}
          triState
          excludedValues={excludedTypes}
          onSetState={setTypeState}
          onClearAll={() => {
            setSelectedTypes([]);
            setExcludedTypes([]);
          }}
          size="sm"
        />
      </FilterBar>

      {(searchQuery || hasActiveFilters) && filteredTechnologies.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Showing {filteredTechnologies.length} of {technologies.length}{" "}
          technologies
          {searchQuery && <> matching &quot;{searchQuery}&quot;</>}
        </p>
      )}

      {filteredTechnologies.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border rounded-lg bg-muted/20">
          <div className="flex flex-col items-center gap-2">
            <Search className="w-10 h-10 text-muted-foreground/50" />
            <p>
              No technologies found
              {searchQuery && <> matching &quot;{searchQuery}&quot;</>}
              {hasActiveFilters && <> with the selected filters</>}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {filteredTechnologies.map(({ badge, description }) => (
            <TechnologyCard
              key={badge.slug}
              technology={badge}
              description={description}
            />
          ))}
        </div>
      )}
    </div>
  );
}
