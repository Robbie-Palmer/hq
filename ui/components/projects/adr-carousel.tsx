"use client";

import type { EmblaOptionsType } from "embla-carousel";
import Link from "next/link";
import { useMemo } from "react";
import { formatDate } from "ts-base/dates";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ContentCarousel } from "@/components/ui/content-carousel";
import type { ProjectADR } from "@/lib/api/projects";
import { TechIcon } from "@/lib/api/tech-icons";
import { defaultCarouselConfig } from "@/lib/config/carousel-config";
import { cn } from "@/lib/styles";
import { ADRBadge } from "./adr-badge";
import { getADRCarouselTechIcons } from "./adr-carousel-tech-icons";

type ADRCarouselProps = {
  adrs: ProjectADR[];
  options?: EmblaOptionsType;
  autoScroll?: boolean;
  scrollSpeed?: number;
  stopOnInteraction?: boolean;
  stopOnMouseEnter?: boolean;
};

function getADRCarouselItemKey(adr: ProjectADR) {
  return `${adr.projectSlug}-${adr.slug}`;
}

export function ADRCarousel({
  adrs,
  options,
  autoScroll = defaultCarouselConfig.autoScroll,
  scrollSpeed = defaultCarouselConfig.scrollSpeed,
  stopOnInteraction = defaultCarouselConfig.stopOnInteraction,
  stopOnMouseEnter = defaultCarouselConfig.stopOnMouseEnter,
}: Readonly<ADRCarouselProps>) {
  const techIconsByADRKey = useMemo(
    () =>
      new Map(
        adrs.map((adr) => [
          getADRCarouselItemKey(adr),
          getADRCarouselTechIcons(adr.technologies),
        ]),
      ),
    [adrs],
  );

  return (
    <ContentCarousel
      items={adrs}
      getItemKey={getADRCarouselItemKey}
      options={options}
      autoScroll={autoScroll}
      scrollSpeed={scrollSpeed}
      stopOnInteraction={stopOnInteraction}
      stopOnMouseEnter={stopOnMouseEnter}
      renderItem={(adr) => {
        const { visibleIcons, hiddenIconCount } =
          techIconsByADRKey.get(getADRCarouselItemKey(adr)) ??
          getADRCarouselTechIcons(adr.technologies);
        const adrHref = `/projects/${encodeURIComponent(adr.projectSlug)}/adrs/${encodeURIComponent(adr.slug)}`;
        const hasSingleVisibleIcon =
          visibleIcons.length === 1 && hiddenIconCount === 0;

        return (
          <Card className="h-full flex flex-col overflow-hidden transition-all hover:shadow-lg hover:border-primary/50 relative bg-card">
            <div className="absolute top-4 left-4 right-20 z-10 pointer-events-none">
              <div
                className="text-lg font-semibold text-muted-foreground truncate"
                title={adr.projectTitle}
              >
                {adr.projectTitle}
              </div>
            </div>
            <div className="absolute top-4 right-4 z-10 pointer-events-none">
              <ADRBadge status={adr.status} />
            </div>
            <CardHeader className="flex-1 pt-12 mt-2 min-w-0">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                <CardTitle className="line-clamp-3 group-hover:text-primary transition-colors text-base sm:text-lg min-w-0">
                  <Link href={adrHref} className="after:absolute after:inset-0">
                    {adr.title}
                  </Link>
                </CardTitle>
                {visibleIcons.length > 0 && (
                  <div className="flex flex-wrap justify-end gap-1.5 max-w-[4.625rem] flex-shrink-0 pt-0.5 pointer-events-auto">
                    {visibleIcons.map((tech) => (
                      <Link
                        key={tech.slug}
                        href={`/technologies/${encodeURIComponent(tech.slug)}`}
                        aria-label={`View ${tech.name} technology`}
                        onClick={(e) => e.stopPropagation()}
                        className="z-20 relative p-1 rounded-md hover:bg-muted/80 hover:scale-110 transition-all -m-1"
                      >
                        <TechIcon
                          name={tech.name}
                          iconSlug={tech.iconSlug}
                          className={cn(
                            "text-foreground transition-all",
                            hasSingleVisibleIcon ? "size-12" : "size-8",
                          )}
                        />
                      </Link>
                    ))}
                    {hiddenIconCount > 0 && (
                      <Link
                        href={adrHref}
                        className="z-20 relative inline-flex size-8 items-center justify-center rounded-md bg-muted text-[0.6875rem] font-medium text-muted-foreground hover:bg-muted/80 transition-colors"
                        aria-label={`View ADR with ${hiddenIconCount} more technologies`}
                        title={`${hiddenIconCount} more technologies`}
                      >
                        +{hiddenIconCount}
                      </Link>
                    )}
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-xs text-muted-foreground">
                <time>{formatDate(adr.date)}</time>
                <span className="mx-2">·</span>
                <span>{adr.readingTime}</span>
              </div>
            </CardContent>
          </Card>
        );
      }}
    />
  );
}
