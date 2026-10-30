"use client";

import Link from "next/link";
import posthog from "posthog-js";
import { Badge } from "@/components/ui/badge";
import type { ProjectListItemView } from "@/lib/domain/project/projectViews";
import { cn } from "@/lib/generic/styles";

interface ProjectBadgeProps {
  project: ProjectListItemView;
  className?: string;
  source_type?: string;
}

export function ProjectBadge({
  project,
  className,
  source_type = "experience",
}: Readonly<ProjectBadgeProps>) {
  return (
    <Link
      href={`/projects/${project.slug}`}
      onClick={(e) => {
        e.stopPropagation();
        posthog.capture("cross_reference_clicked", {
          source_type,
          target_type: "project",
          target_slug: project.slug,
        });
      }}
      aria-label={`View project ${project.title}`}
    >
      <Badge variant="outline" interactive className={cn(className)}>
        {project.title}
      </Badge>
    </Link>
  );
}
