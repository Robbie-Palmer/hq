"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { hasTechIcon, TechIcon } from "@/lib/api/tech-icons";
import { cn } from "@/lib/generic/styles";

interface TechStackItem {
  name: string;
  slug: string;
  iconSlug?: string;
}

interface ProjectTechStackProps {
  techStack: TechStackItem[];
  className?: string;
}

export function ProjectTechStack({
  techStack,
  className,
}: Readonly<ProjectTechStackProps>) {
  const [isExpanded, setIsExpanded] = useState(false);

  const itemsWithIcons = techStack.filter((tech) =>
    hasTechIcon(tech.name, tech.iconSlug),
  );
  const hiddenCount = techStack.length - itemsWithIcons.length;
  const visibleItems = isExpanded ? techStack : itemsWithIcons;

  return (
    <TooltipProvider>
      <div className={cn("space-y-3", className)}>
        <div className="flex flex-wrap gap-2">
          {visibleItems.map((tech) => {
            const hasIcon = hasTechIcon(tech.name, tech.iconSlug);

            // Render logic:
            // If Collapsed AND Has Icon: Show Icon Only Badge (with Tooltip)
            // If Expanded OR No Icon: Show Badge with Text (+ Icon if available)
            if (isExpanded || !hasIcon) {
              return (
                <Link key={tech.slug} href={`/technologies/${tech.slug}`}>
                  <Badge
                    variant="secondary"
                    interactive
                    className="h-6 text-sm px-3 gap-1"
                  >
                    {hasIcon && (
                      <TechIcon
                        name={tech.name}
                        iconSlug={tech.iconSlug}
                        className="w-3 h-3"
                      />
                    )}
                    {tech.name}
                  </Badge>
                </Link>
              );
            }

            // Collapsed state with icon
            return (
              <Tooltip key={tech.slug}>
                <TooltipTrigger asChild>
                  <Link href={`/technologies/${tech.slug}`}>
                    <Badge
                      variant="secondary"
                      interactive
                      className="h-6 text-sm px-2"
                    >
                      <TechIcon
                        name={tech.name}
                        iconSlug={tech.iconSlug}
                        className="w-4 h-4"
                      />
                      <span className="sr-only">{tech.name}</span>
                    </Badge>
                  </Link>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{tech.name}</p>
                </TooltipContent>
              </Tooltip>
            );
          })}

          {!isExpanded && hiddenCount > 0 && (
            <Badge
              variant="secondary"
              interactive
              className="h-6 text-sm px-2 cursor-pointer hover:bg-primary/20 hover:text-primary transition-colors"
              onClick={() => setIsExpanded(true)}
            >
              +{hiddenCount}
            </Badge>
          )}
        </div>

        {techStack.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground gap-2 h-auto py-1 px-2"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <span className="text-xs font-medium">
              {isExpanded ? "Show less" : "Show details"}
            </span>
            <ChevronDown
              className={cn(
                "w-3 h-3 transition-transform duration-200",
                isExpanded && "rotate-180",
              )}
            />
          </Button>
        )}
      </div>
    </TooltipProvider>
  );
}
