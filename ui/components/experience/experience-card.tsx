"use client";

import { Calendar, ChevronDown, MapPin } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import posthog from "posthog-js";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Experience } from "@/lib/api/experience";
import { getTitleTimeline } from "@/lib/api/experience";
import { hasTechIcon, TechIcon } from "@/lib/api/tech-icons";
import type { BlogListItemView } from "@/lib/domain/blog/blogViews";
import type { ProjectListItemView } from "@/lib/domain/project/projectViews";
import { smoothScrollTo } from "@/lib/generic/scroll";
import { normalizeSlug } from "@/lib/generic/slugs";
import { BlogBadge } from "./blog-badge";
import { ProjectBadge } from "./project-badge";

interface ExperienceCardProps {
  experience: Experience;
  dateLabel: string;
  id?: string;
  projects?: ProjectListItemView[];
  blogs?: BlogListItemView[];
}

export function ExperienceCard({
  experience,
  dateLabel,
  id,
  projects = [],
  blogs = [],
}: Readonly<ExperienceCardProps>) {
  const [isExpanded, setIsExpanded] = useState(false);
  const titleTimeline = getTitleTimeline(experience);

  useEffect(() => {
    if (!id || typeof window === "undefined") return;

    let timeoutId: ReturnType<typeof setTimeout>;
    let scrollCancel: (() => void) | undefined;

    const checkAndActivate = () => {
      if (window.location.hash !== `#${id}`) return;

      setIsExpanded(true);

      // Clear any existing timeout to avoid race conditions
      if (timeoutId) clearTimeout(timeoutId);
      // Cancel any existing scroll
      if (scrollCancel) scrollCancel();
      // Small timeout to allow expansion to render before scrolling
      timeoutId = setTimeout(() => {
        const { cancel } = smoothScrollTo(`exp-${id}`, {
          offset: 150,
          duration: 800,
        });
        scrollCancel = cancel;
      }, 100);
    };

    // Check on mount
    checkAndActivate();
    // Check on hash change
    window.addEventListener("hashchange", checkAndActivate);
    return () => {
      window.removeEventListener("hashchange", checkAndActivate);
      if (timeoutId) clearTimeout(timeoutId);
      if (scrollCancel) scrollCancel();
    };
  }, [id]);

  const handleToggle = () => {
    if (!isExpanded) {
      posthog.capture("experience_card_expanded", {
        company: experience.company,
        role_title: experience.title,
      });
    }
    setIsExpanded(!isExpanded);
  };

  return (
    <TooltipProvider>
      <div className="relative">
        {/* Timeline dot */}
        <div className="absolute left-[11px] top-8 w-6 h-6 rounded-full bg-background border-2 border-primary hidden md:flex items-center justify-center z-10">
          <div className="w-2 h-2 rounded-full bg-primary" />
        </div>

        <Card
          id={id ? `exp-${id}` : undefined}
          className="transition-all hover:shadow-lg hover:border-primary/50 md:ml-14 scroll-mt-24"
        >
          <CardHeader
            className="space-y-3 cursor-pointer"
            onClick={handleToggle}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-3">
                <div className="space-y-1">
                  <CardTitle className="text-2xl">{experience.title}</CardTitle>
                  {titleTimeline && titleTimeline.length > 1 && (
                    <p className="text-sm text-muted-foreground">
                      <span className="text-muted-foreground/60">
                        previously{" "}
                      </span>
                      {titleTimeline
                        .slice(1)
                        .map((entry) => entry.title)
                        .join(" · ")}
                    </p>
                  )}
                </div>
                <CardDescription className="text-base flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                  <a
                    href={experience.companyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 font-medium text-blue-600 dark:text-blue-400 underline underline-offset-2 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Image
                      src={experience.logoPath}
                      alt={`${experience.company} logo`}
                      width={20}
                      height={20}
                      className="object-contain"
                    />
                    {experience.company}
                  </a>
                  <span className="hidden sm:inline text-muted-foreground/50">
                    •
                  </span>
                  <span className="flex items-center gap-1.5 font-medium text-foreground/80">
                    <MapPin className="w-4 h-4" />
                    {experience.location}
                  </span>
                  <span className="hidden sm:inline text-muted-foreground/50">
                    •
                  </span>
                  <span className="flex items-center gap-1.5 font-medium text-foreground/80">
                    <Calendar className="w-4 h-4" />
                    {dateLabel}
                  </span>
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggle();
                }}
                aria-label={isExpanded ? "Collapse details" : "Expand details"}
                aria-expanded={isExpanded}
              >
                <ChevronDown
                  className={`w-5 h-5 transition-transform ${
                    isExpanded ? "rotate-180" : ""
                  }`}
                />
              </Button>
            </div>

            {/* Summary - always visible */}
            {!isExpanded && (
              <div className="animate-in fade-in duration-100">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {experience.description}
                </p>
                {projects.length > 0 && (
                  <div className="pt-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                      Projects
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {projects.map((project) => (
                        <ProjectBadge key={project.slug} project={project} />
                      ))}
                    </div>
                  </div>
                )}
                {blogs.length > 0 && (
                  <div className="pt-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                      Blog Posts
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {blogs.map((blog) => (
                        <BlogBadge key={blog.slug} blog={blog} />
                      ))}
                    </div>
                  </div>
                )}
                {experience.technologies.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-2">
                    {experience.technologies.slice(0, 10).map((tech) => {
                      const hasIcon = hasTechIcon(tech);
                      return hasIcon ? (
                        <Tooltip key={tech}>
                          <TooltipTrigger asChild>
                            <Badge
                              variant="secondary"
                              className="cursor-default"
                            >
                              <TechIcon name={tech} className="w-4 h-4" />
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{tech}</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <Badge key={tech} variant="secondary">
                          {tech}
                        </Badge>
                      );
                    })}
                    {experience.technologies.length > 10 && (
                      <Badge variant="secondary">
                        +{experience.technologies.length - 10} more
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardHeader>

          {/* Expanded details */}
          {isExpanded && (
            <CardContent className="space-y-4 pt-0 animate-in fade-in duration-100">
              {titleTimeline && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Title History
                  </p>
                  <div className="space-y-1">
                    {titleTimeline.map((entry) => (
                      <div key={`${entry.title}-${entry.dateRange}`}>
                        <p
                          className={`text-sm ${
                            entry.isCurrent
                              ? "font-medium"
                              : "text-muted-foreground"
                          }`}
                        >
                          {entry.title}
                        </p>
                        <p className="text-xs text-muted-foreground/60">
                          {entry.dateRange}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <ul className="space-y-1.5 text-sm">
                {experience.responsibilities.map((responsibility) => (
                  <li key={responsibility} className="flex gap-2 items-start">
                    <span className="text-primary shrink-0 leading-snug">
                      •
                    </span>
                    <span className="leading-snug">{responsibility}</span>
                  </li>
                ))}
              </ul>
              {projects.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                    Projects
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {projects.map((project) => (
                      <ProjectBadge key={project.slug} project={project} />
                    ))}
                  </div>
                </div>
              )}
              {blogs.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                    Blog Posts
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {blogs.map((blog) => (
                      <BlogBadge key={blog.slug} blog={blog} />
                    ))}
                  </div>
                </div>
              )}
              {experience.technologies.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {experience.technologies.map((tech) => {
                    const slug = normalizeSlug(tech);
                    return (
                      <Link
                        key={slug}
                        href={`/technologies/${encodeURIComponent(slug)}`}
                      >
                        <Badge variant="secondary" interactive>
                          <TechIcon name={tech} />
                          {tech}
                        </Badge>
                      </Link>
                    );
                  })}
                </div>
              )}
            </CardContent>
          )}
        </Card>
      </div>
    </TooltipProvider>
  );
}
