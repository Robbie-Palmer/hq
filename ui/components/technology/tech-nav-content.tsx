"use client";

import Fuse, { type FuseResult } from "fuse.js";
import { Search, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useDebouncedSearchTracking } from "@/hooks/use-debounced-search-tracking";
import { getTechIconUrl } from "@/lib/api/tech-icons";
import type { TechnologyBadgeView } from "@/lib/domain/technology/technologyViews";
import { cn } from "@/lib/generic/styles";

interface TechNavContentProps {
  technologies: TechnologyBadgeView[];
  className?: string;
  onLinkClick?: () => void;
}

export function TechNavContent({
  technologies,
  className,
  onLinkClick,
}: Readonly<TechNavContentProps>) {
  const pathname = usePathname();
  const [searchQuery, setSearchQuery] = useState("");

  const fuse = useMemo(
    () =>
      new Fuse(technologies, {
        keys: ["name", "slug"],
        threshold: 0.3,
        ignoreLocation: true,
      }),
    [technologies],
  );

  const filteredTechnologies = useMemo(() => {
    if (!searchQuery.trim()) {
      return technologies;
    }
    return fuse
      .search(searchQuery)
      .map((result: FuseResult<(typeof technologies)[number]>) => result.item);
  }, [fuse, searchQuery, technologies]);

  useDebouncedSearchTracking({
    searchQuery,
    resultCount: filteredTechnologies.length,
    location: "technology_sidebar",
  });

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <div className="flex flex-col gap-2 pb-4 shrink-0">
        <h3 className="font-semibold text-lg px-2">Technologies</h3>
        <div className="relative px-2">
          <Search className="absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search technologies..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-9 h-9"
            aria-label="Search technologies"
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
            ? `${filteredTechnologies.length} of ${technologies.length} technologies`
            : `${technologies.length} technologies`}
        </p>
        <Separator className="mt-2" />
      </div>

      <ScrollArea className="flex-1 basis-0 min-h-0 -mx-2">
        <div className="px-2 space-y-3 pb-6">
          {filteredTechnologies.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <p>No technologies match &quot;{searchQuery}&quot;</p>
            </div>
          ) : (
            filteredTechnologies.map((tech) => {
              const href = `/technologies/${tech.slug}`;
              const isActive = pathname === href;
              const iconUrl = getTechIconUrl(tech.name, tech.iconSlug);

              return (
                <Link
                  key={tech.slug}
                  href={href}
                  scroll={false}
                  onClick={onLinkClick}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-lg text-sm transition-all border",
                    isActive
                      ? "bg-accent text-accent-foreground border-accent-foreground/20 shadow-sm"
                      : "text-muted-foreground border-border hover:bg-accent/50 hover:text-accent-foreground hover:border-accent",
                  )}
                >
                  {iconUrl && (
                    <div className="shrink-0 w-8 h-8 flex items-center justify-center bg-muted/50 rounded-md p-1">
                      <Image
                        src={iconUrl}
                        alt=""
                        width={24}
                        height={24}
                        className="block object-contain brightness-0 dark:invert"
                      />
                    </div>
                  )}
                  <span
                    className={cn(
                      "font-medium leading-tight",
                      isActive && "text-foreground",
                    )}
                  >
                    {tech.name}
                  </span>
                </Link>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
