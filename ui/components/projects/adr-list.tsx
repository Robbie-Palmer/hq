"use client";

import Fuse, { type FuseResult } from "fuse.js";
import { ArrowUpDown } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { StatusFilter } from "@/components/filters/status-filter";
import { TechnologyFilter } from "@/components/filters/technology-filter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import {
  FilterBar,
  type MobileFilterSection,
} from "@/components/ui/filter-bar";
import { useFilterParams } from "@/hooks/use-filter-params";
import { useSortParam } from "@/hooks/use-sort-param";
import type { ADR } from "@/lib/api/projects";
import { hasTechIcon, TechIcon } from "@/lib/api/tech-icons";
import {
  ADR_STATUS_CONFIG,
  ADR_STATUSES,
  formatADRSlugIndex,
  normalizeADRTitle,
} from "@/lib/domain/adr/adr";
import { ADRBadge } from "./adr-badge";

interface ADRListProps {
  projectSlug: string;
  adrs: ADR[];
  description?: React.ReactNode;
}

const SORT_OPTIONS = ["newest", "oldest"] as const;
type SortOption = (typeof SORT_OPTIONS)[number];

export function ADRList({
  projectSlug,
  adrs,
  description,
}: Readonly<ADRListProps>) {
  const { currentSort, cycleSortOrder } = useSortParam<SortOption>(
    SORT_OPTIONS,
    "newest",
  );
  const [searchQuery, setSearchQuery] = useState("");

  const allTechnologies = useMemo(() => {
    const techMap = new Map<
      string,
      { slug: string; name: string; iconSlug?: string }
    >();
    for (const adr of adrs) {
      if (adr.technologies) {
        for (const tech of adr.technologies) {
          if (!techMap.has(tech.slug)) {
            techMap.set(tech.slug, tech);
          }
        }
      }
    }
    return Array.from(techMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [adrs]);

  const filterParams = useFilterParams({
    filters: [
      { paramName: "status", isMulti: true },
      { paramName: "tech", isMulti: true },
    ],
  });
  const selectedStatus = filterParams.getValues("status");
  const selectedTech = filterParams.getValues("tech");
  const excludedStatus = filterParams.getExcludedValues("status");
  const excludedTech = filterParams.getExcludedValues("tech");

  const fuse = useMemo(
    () =>
      new Fuse(adrs, {
        keys: ["title", "slug"],
        threshold: 0.3,
        ignoreLocation: true,
      }),
    [adrs],
  );

  const filteredADRs = useMemo(() => {
    let filtered = searchQuery.trim()
      ? fuse.search(searchQuery).map((result: FuseResult<ADR>) => result.item)
      : adrs;
    if (selectedStatus.length > 0) {
      filtered = filtered.filter((adr) => selectedStatus.includes(adr.status));
    }
    if (excludedStatus.length > 0) {
      filtered = filtered.filter((adr) => !excludedStatus.includes(adr.status));
    }
    if (selectedTech.length > 0) {
      filtered = filtered.filter((adr) =>
        adr.technologies?.some((tech) => selectedTech.includes(tech.slug)),
      );
    }
    if (excludedTech.length > 0) {
      filtered = filtered.filter(
        (adr) =>
          !adr.technologies?.some((tech) => excludedTech.includes(tech.slug)),
      );
    }
    return filtered;
  }, [
    fuse,
    searchQuery,
    adrs,
    selectedStatus,
    selectedTech,
    excludedStatus,
    excludedTech,
  ]);

  const sortedADRs = [...filteredADRs].sort((a, b) => {
    const direction = currentSort === "newest" ? -1 : 1;
    return a.slug.localeCompare(b.slug) * direction;
  });

  const activeFilters = useMemo(() => {
    const filters: Array<{
      paramName: string;
      label: string;
      value: string;
      displayValue: string;
      excluded?: boolean;
    }> = [];

    for (const status of selectedStatus) {
      filters.push({
        paramName: "status",
        label: "Status",
        value: status,
        displayValue: status,
      });
    }
    for (const status of excludedStatus) {
      filters.push({
        paramName: "status",
        label: "Status",
        value: status,
        displayValue: status,
        excluded: true,
      });
    }
    for (const tech of selectedTech) {
      const techObj = allTechnologies.find((t) => t.slug === tech);
      filters.push({
        paramName: "tech",
        label: "Tech",
        value: tech,
        displayValue: techObj?.name ?? tech,
      });
    }
    for (const tech of excludedTech) {
      const techObj = allTechnologies.find((t) => t.slug === tech);
      filters.push({
        paramName: "tech",
        label: "Tech",
        value: tech,
        displayValue: techObj?.name ?? tech,
        excluded: true,
      });
    }
    return filters;
  }, [
    selectedStatus,
    selectedTech,
    excludedStatus,
    excludedTech,
    allTechnologies,
  ]);

  const handleRemoveFilter = (paramName: string, value: string) => {
    filterParams.setState(paramName, value, "off");
  };
  const isFiltering = searchQuery || filterParams.hasActiveFilters;
  const sortButton = (
    <Button
      variant="outline"
      size="default"
      onClick={cycleSortOrder}
      className="gap-2 shrink-0"
    >
      <ArrowUpDown className="w-4 h-4" />
      {currentSort === "newest" ? "Newest First" : "Oldest First"}
    </Button>
  );

  const filterBarContent = (
    <>
      <StatusFilter
        type="adr"
        value={selectedStatus}
        onChange={(v) => filterParams.setValues("status", v)}
        triState
        excludedValues={excludedStatus}
        onSetState={(value, state) =>
          filterParams.setState("status", value, state)
        }
        onClearAll={() => filterParams.clearFilter("status")}
        size="sm"
      />
      {allTechnologies.length > 0 && (
        <TechnologyFilter
          technologies={allTechnologies}
          value={selectedTech}
          triState
          excludedValues={excludedTech}
          onSetState={(value, state) =>
            filterParams.setState("tech", value, state)
          }
          onClearAll={() => filterParams.clearFilter("tech")}
          onChange={(v) => filterParams.setValues("tech", v)}
          size="sm"
        />
      )}
    </>
  );

  const mobileFilterSections: MobileFilterSection[] = useMemo(() => {
    const statusOptions = ADR_STATUSES.map((status) => ({
      value: status,
      label: ADR_STATUS_CONFIG[status].label,
    }));
    const sections: MobileFilterSection[] = [
      {
        paramName: "status",
        label: "Status",
        options: statusOptions,
        getOptionState: (value: string) =>
          filterParams.getState("status", value),
        onCycleOption: (value: string) =>
          filterParams.cycleValue("status", value),
      },
    ];
    if (allTechnologies.length > 0) {
      sections.push({
        paramName: "tech",
        label: "Technology",
        options: allTechnologies.map((t) => ({
          value: t.slug,
          label: t.name,
        })),
        getOptionState: (value: string) => filterParams.getState("tech", value),
        onCycleOption: (value: string) =>
          filterParams.cycleValue("tech", value),
      });
    }
    return sections;
  }, [allTechnologies, filterParams]);

  if (adrs.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground border rounded-lg bg-muted/20">
        No Architecture Decision Records (ADRs) found for this project.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex-1">{description}</div>

        <FilterBar
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search decisions..."
          activeFilters={activeFilters}
          onRemoveFilter={handleRemoveFilter}
          onClearAll={filterParams.clearAllFilters}
          hasActiveFilters={filterParams.hasActiveFilters}
          activeFilterCount={filterParams.activeFilterCount}
          sortButton={sortButton}
          mobileFilterSections={mobileFilterSections}
        >
          {filterBarContent}
        </FilterBar>

        {isFiltering && sortedADRs.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Showing {sortedADRs.length} of {adrs.length} records
            {searchQuery && ` matching "${searchQuery}"`}
          </p>
        )}
      </div>

      {sortedADRs.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border rounded-lg bg-muted/20">
          <p>No decisions match &quot;{searchQuery}&quot;</p>
        </div>
      ) : (
        sortedADRs.map((adr) => {
          return (
            <Card
              key={adr.adrRef}
              className="hover:border-primary/50 transition-colors relative group overflow-hidden"
            >
              <Link
                href={`/projects/${projectSlug}/adrs/${adr.slug}`}
                className="absolute inset-0 z-0"
              >
                <span className="sr-only">View {adr.title}</span>
              </Link>
              <CardHeader className="py-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 min-w-0 pointer-events-none z-10 flex-wrap">
                  <span className="font-mono text-sm text-muted-foreground shrink-0 w-24">
                    ADR {formatADRSlugIndex(adr.slug)}
                  </span>
                  <span className="font-semibold text-lg group-hover:text-primary transition-colors">
                    {normalizeADRTitle(adr.title)}
                  </span>

                  {adr.technologies &&
                    adr.technologies.length > 0 &&
                    adr.technologies.map((tech) => (
                      <Link
                        key={tech.slug}
                        href={`/technologies/${tech.slug}`}
                        className="cursor-pointer pointer-events-auto w-fit shrink-0"
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`View ${tech.name} technology`}
                      >
                        <Badge
                          variant="secondary"
                          className="flex items-center gap-1.5 hover:bg-secondary/80"
                        >
                          {hasTechIcon(tech.name) && (
                            <TechIcon name={tech.name} className="w-3 h-3" />
                          )}
                          <span>{tech.name}</span>
                        </Badge>
                      </Link>
                    ))}

                  <ADRBadge status={adr.status} className="shrink-0 w-fit" />
                  {adr.isInherited && (
                    <span className="text-xs text-muted-foreground">
                      Inherited from {adr.originProjectSlug}
                    </span>
                  )}
                </div>
              </CardHeader>
            </Card>
          );
        })
      )}
    </div>
  );
}
