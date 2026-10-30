"use client";

import Fuse, { type FuseResult } from "fuse.js";
import { Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useDebouncedSearchTracking } from "@/hooks/use-debounced-search-tracking";
import type { ProjectWithADRs } from "@/lib/api/projects";
import { formatADRSlugIndex, normalizeADRTitle } from "@/lib/domain/adr/adr";
import { cn } from "@/lib/generic/styles";
import { ADRBadge } from "./adr-badge";

interface ADRNavContentProps {
  project: ProjectWithADRs;
  className?: string;
  onLinkClick?: () => void;
}

export function ADRNavContent({
  project,
  className,
  onLinkClick,
}: Readonly<ADRNavContentProps>) {
  const pathname = usePathname();
  const [searchQuery, setSearchQuery] = useState("");

  const fuse = useMemo(
    () =>
      new Fuse(project.adrs, {
        keys: ["title", "slug"],
        threshold: 0.3,
        ignoreLocation: true,
      }),
    [project.adrs],
  );

  const filteredADRs = useMemo(() => {
    if (!searchQuery.trim()) {
      return project.adrs;
    }
    return fuse
      .search(searchQuery)
      .map((result: FuseResult<(typeof project.adrs)[number]>) => result.item);
  }, [fuse, searchQuery, project.adrs]);

  useDebouncedSearchTracking({
    searchQuery,
    resultCount: filteredADRs.length,
    location: "adr_sidebar",
  });

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <div className="flex flex-col gap-2 pb-4 shrink-0">
        <h3 className="font-semibold text-lg px-2">Decisions</h3>
        <div className="relative px-2">
          <Search className="absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search decisions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-9 h-9"
            aria-label="Search architecture decisions"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <p className="text-sm text-muted-foreground px-2">
          {searchQuery
            ? `${filteredADRs.length} of ${project.adrs.length} records`
            : `${project.adrs.length} records found`}
        </p>
        <Separator className="mt-2" />
      </div>

      <ScrollArea className="flex-1 basis-0 min-h-0 -mx-2">
        <div className="px-2 space-y-3 pb-6">
          {filteredADRs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <p>No decisions match &quot;{searchQuery}&quot;</p>
            </div>
          ) : (
            filteredADRs.map((adr) => {
              const href = `/projects/${project.slug}/adrs/${adr.slug}`;
              const isActive = pathname === href;

              return (
                <Link
                  key={adr.adrRef}
                  href={href}
                  onClick={onLinkClick}
                  className={cn(
                    "flex flex-col gap-2 p-3 rounded-lg text-sm transition-all border",
                    isActive
                      ? "bg-accent text-accent-foreground border-accent-foreground/20 shadow-sm"
                      : "text-muted-foreground border-border hover:bg-accent/50 hover:text-accent-foreground hover:border-accent",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs opacity-70">
                      ADR {formatADRSlugIndex(adr.slug)}
                    </span>
                    <ADRBadge
                      status={adr.status}
                      className="text-[10px] h-5 px-1.5"
                    />
                  </div>
                  <div
                    className={cn(
                      "font-medium leading-tight",
                      isActive && "text-foreground",
                    )}
                  >
                    {normalizeADRTitle(adr.title)}
                  </div>
                  {adr.isInherited && (
                    <div className="text-[11px] opacity-80">
                      Inherited from {adr.originProjectSlug}
                    </div>
                  )}
                </Link>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
