"use client";

import { useNavbarVisibility } from "@/hooks/use-navbar-visibility";
import type { TechnologyBadgeView } from "@/lib/domain/technology/technologyViews";
import { cn } from "@/lib/generic/styles";
import { TechNavContent } from "./tech-nav-content";

interface TechStickySidebarProps {
  technologies: TechnologyBadgeView[];
  className?: string;
}

export function TechStickySidebar({
  technologies,
  className,
}: Readonly<TechStickySidebarProps>) {
  const isNavbarVisible = useNavbarVisibility();
  return (
    <aside
      className={cn(
        "hidden lg:block sticky border-r pr-6 transition-all duration-200 ease-in-out overflow-hidden",
        isNavbarVisible
          ? "top-24 h-[calc(100vh-8rem)]"
          : "top-4 h-[calc(100vh-2rem)]",
        className,
      )}
    >
      <TechNavContent technologies={technologies} className="h-full" />
    </aside>
  );
}
