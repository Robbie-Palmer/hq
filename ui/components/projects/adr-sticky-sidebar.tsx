"use client";

import { useNavbarVisibility } from "@/hooks/use-navbar-visibility";
import type { ProjectWithADRs } from "@/lib/api/projects";
import { cn } from "@/lib/generic/styles";
import { ADRNavContent } from "./adr-nav-content";

interface ADRStickySidebarProps {
  project: ProjectWithADRs;
  className?: string;
}

export function ADRStickySidebar({
  project,
  className,
}: Readonly<ADRStickySidebarProps>) {
  const isNavbarVisible = useNavbarVisibility();
  return (
    <aside
      className={cn(
        "hidden lg:block sticky border-r pr-6 transition-all duration-200 ease-in-out overflow-hidden",
        isNavbarVisible
          ? "top-24 h-[calc(100vh-8rem)]" // Normal state: Navbar present
          : "top-4 h-[calc(100vh-2rem)]", // Expanded state: Navbar hidden (moves up, grows)
        className,
      )}
    >
      <ADRNavContent project={project} className="h-full" />
    </aside>
  );
}
