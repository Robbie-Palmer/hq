"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { OrbitingCircles } from "@/components/ui/orbiting-circles";
import { getTechIconUrl } from "@/lib/api/tech-icons";
import { cn } from "@/lib/generic/styles";

export interface TechOrbitItem {
  name: string;
  slug?: string;
  iconSlug?: string;
  weight?: number; // Higher weight = prioritized in inner circles
  url?: string;
}

interface TechOrbitProps {
  technologies: TechOrbitItem[];
  className?: string;
  centerImage?: string;
  centerText?: string;
  centerContent?: React.ReactNode;
}

export function TechOrbit({
  technologies,
  className,
  centerImage,
  centerText,
  centerContent,
}: Readonly<TechOrbitProps>) {
  const [activeTech, setActiveTech] = useState<TechOrbitItem | null>(null);
  const [containerWidth, setContainerWidth] = useState(600);
  const [isVisible, setIsVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Track container width for responsive scaling. The width drives the orbit
  // height, radii and icon sizes inside this same container, so write the state
  // on the next frame instead of during the callback - resizing the observed
  // subtree mid-delivery makes browsers report a ResizeObserver loop. Rounding
  // keeps sub-pixel jitter from re-rendering for no visible gain.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let frame = 0;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const width = Math.round(entry.contentRect.width);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setContainerWidth((current) => (current === width ? current : width));
      });
    });
    observer.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  // Pause animations when not visible (with margin to start early)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry?.isIntersecting ?? false);
      },
      { rootMargin: "300px", threshold: 0 },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Cache icon URLs upfront to avoid redundant lookups
  const techsWithIcons = useMemo(() => {
    return technologies
      .map((tech) => ({
        ...tech,
        iconUrl: getTechIconUrl(tech.name, tech.iconSlug),
      }))
      .filter(
        (tech): tech is TechOrbitItem & { iconUrl: string } =>
          tech.iconUrl !== null,
      )
      .sort((a, b) => (b.weight || 1) - (a.weight || 1));
  }, [technologies]);

  const allRings: (TechOrbitItem & { iconUrl: string })[][] = [];
  let remaining = [...techsWithIcons];
  let ringNum = 1;
  while (remaining.length > 0) {
    const capacity = 8 * ringNum;
    allRings.push(remaining.slice(0, capacity));
    remaining = remaining.slice(capacity);
    ringNum++;
  }

  const isMobile = containerWidth < 500;
  // Limit rings on mobile for performance (4 rings = 80 icons max)
  const maxRings = isMobile ? 4 : allRings.length;
  const rings = allRings.slice(0, maxRings);

  const baseOutermostRadius =
    rings.length > 0 ? 80 + (rings.length - 1) * 70 : 80;
  // Scale factor: ensure outermost ring fits within container
  // Use less padding on mobile vs desktop
  const padding = isMobile ? 20 : 80;
  const maxRadius = (containerWidth - padding) / 2;
  const scale = Math.min(1, maxRadius / baseOutermostRadius);

  // Apply scale to radii and icon sizes
  const getRadius = (ringIndex: number) => (80 + ringIndex * 70) * scale;
  const outermostRadius = baseOutermostRadius * scale;
  const orbitHeight = 2 * outermostRadius + 40;
  const iconSize = Math.round(30 * scale);
  const orbitSize = Math.round(40 * scale);

  const renderIcon = (
    tech: TechOrbitItem & { iconUrl: string },
    size: number,
  ) => {
    const content = (
      <div
        className={cn(
          "relative flex items-center justify-center rounded-full bg-background p-1.5 shadow-sm border border-border/40 hover:scale-110 transition-transform cursor-pointer",
        )}
        style={{ width: size, height: size }}
        title={tech.name}
      >
        <Image
          src={tech.iconUrl}
          alt={tech.name}
          fill
          className={cn(
            "object-contain pointer-events-none select-none",
            "brightness-0 dark:invert",
          )}
        />
      </div>
    );

    const isSelected = activeTech?.name === tech.name;
    return (
      <button
        type="button"
        className={cn(
          "cursor-pointer transition-transform duration-200 outline-none focus-visible:scale-125 focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-full bg-transparent border-none p-0",
          isSelected ? "scale-125 z-20" : "hover:scale-110",
        )}
        onClick={(e) => {
          e.stopPropagation();
          setActiveTech(tech);
        }}
      >
        {content}
      </button>
    );
  };

  const selectedTechContent = activeTech && (
    <div
      key={activeTech.name}
      className="flex flex-col items-center justify-center p-2 text-center z-10 animate-in fade-in zoom-in duration-300"
    >
      <span className="text-xl font-bold bg-gradient-to-b from-black to-gray-500 bg-clip-text text-transparent dark:from-white dark:to-gray-400">
        {activeTech.name}
      </span>
      {activeTech.url && (
        <Link
          href={activeTech.url}
          className="text-xs text-muted-foreground mt-1 flex items-center gap-1 hover:text-foreground transition-colors group/link"
        >
          View Technology
        </Link>
      )}
    </div>
  );

  const centerDisplay = (() => {
    if (!isMobile && activeTech) return selectedTechContent;
    if (centerContent) {
      return <div className="z-10 relative">{centerContent}</div>;
    }
    if (centerImage) {
      return (
        <div className="z-10 relative size-20 rounded-full border border-border bg-background p-1 shadow-lg">
          <Image
            src={centerImage}
            alt="Center"
            fill
            className="rounded-full object-cover"
          />
        </div>
      );
    }
    return (
      <span
        key="default-center"
        className="pointer-events-none text-center font-semibold text-foreground whitespace-pre-wrap animate-in fade-in zoom-in duration-300"
        style={{ fontSize: `${Math.max(16, Math.round(24 * scale))}px` }}
      >
        {centerText || "Tech\nStack"}
      </span>
    );
  })();

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <div
        ref={containerRef}
        style={{ height: `${orbitHeight}px` }}
        className="relative flex w-full flex-col items-center justify-center overflow-hidden rounded-lg"
      >
        <button
          type="button"
          aria-label="Clear selected technology"
          disabled={!activeTech}
          onClick={() => setActiveTech(null)}
          className="absolute inset-0 cursor-default disabled:pointer-events-none"
        />

        {/* Show selected tech in center on desktop only */}
        {centerDisplay}

        {/* Dynamic rings */}
        {rings.map((ring, ringIndex) =>
          ring.map((tech, idx) => {
            const radius = getRadius(ringIndex);
            const duration = 30 + ringIndex * 10;
            const reverse = ringIndex % 2 === 0;
            return (
              <OrbitingCircles
                key={tech.name}
                className="border-none bg-transparent"
                style={{ width: orbitSize, height: orbitSize }}
                radius={radius}
                duration={duration}
                delay={idx * (duration / ring.length)}
                reverse={reverse}
                path={idx === 0}
                paused={!isVisible}
              >
                {renderIcon(tech, iconSize)}
              </OrbitingCircles>
            );
          }),
        )}
      </div>

      {/* Reserve space for selected tech below orbit on mobile */}
      {isMobile && (
        <div className="h-12 flex items-center justify-center">
          {activeTech && selectedTechContent}
        </div>
      )}
    </div>
  );
}
