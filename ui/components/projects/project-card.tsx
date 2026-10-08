"use client";

import { ExternalLink, FileText, Github, Globe, Tag } from "lucide-react";
import Link from "next/link";
import posthog from "posthog-js";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Project } from "@/lib/api/projects";
import { hasTechIcon, TechIcon } from "@/lib/api/tech-icons";
import { prioritiseSelected } from "@/lib/generic/array";
import { ProjectRoleBadge } from "./project-role-badge";
import { ProjectStatusBadge } from "./project-status-badge";

interface ProjectCardProps {
  project: Project;
  selectedTech?: string[];
  onTechClick: (techSlug: string) => void;
  selectedTags?: string[];
  onTagClick: (tag: string) => void;
  selectedStatuses?: string[];
  onStatusClick: (status: string) => void;
  selectedRoles?: string[];
  onRoleClick: (roleSlug: string) => void;
}

export function ProjectCard({
  project,
  selectedTech = [],
  onTechClick,
  selectedTags = [],
  onTagClick,
  selectedStatuses = [],
  onStatusClick,
  selectedRoles = [],
  onRoleClick,
}: Readonly<ProjectCardProps>) {
  const sortedTechnologies = useMemo(
    () => prioritiseSelected(project.technologies, selectedTech, (t) => t.slug),
    [project.technologies, selectedTech],
  );
  return (
    <Card className="flex flex-col h-full hover:shadow-lg transition-all hover:border-primary/50 group relative overflow-hidden">
      {/* Clickable Area for the whole card */}
      <Link href={`/projects/${project.slug}`} className="absolute inset-0 z-0">
        <span className="sr-only">View {project.title}</span>
      </Link>

      <CardHeader>
        <div className="flex justify-between items-start gap-4 pointer-events-none">
          <div className="flex flex-col gap-2 pointer-events-auto">
            <div className="flex gap-2 flex-wrap">
              <ProjectStatusBadge
                status={project.status}
                className="z-10"
                interactive
                active={selectedStatuses.includes(project.status)}
                onClick={(e) => {
                  e.stopPropagation();
                  onStatusClick(project.status);
                }}
              />
              {project.adrs.length > 0 && (
                <Badge variant="secondary" className="bg-muted-foreground/10">
                  {project.adrs.length}{" "}
                  {project.adrs.length === 1 ? "ADR" : "ADRs"}
                </Badge>
              )}
              {(() => {
                const { role } = project;
                if (!role) return null;
                return (
                  <ProjectRoleBadge
                    role={role}
                    className="z-10"
                    interactive
                    active={selectedRoles.includes(role.slug)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRoleClick(role.slug);
                    }}
                  />
                );
              })()}
            </div>
            <CardTitle className="text-xl group-hover:text-primary transition-colors">
              <Link
                href={`/projects/${project.slug}`}
                className="hover:underline underline-offset-4"
              >
                {project.title}
              </Link>
            </CardTitle>
          </div>
          <div className="flex items-center gap-2 pointer-events-auto z-10 text-muted-foreground">
            {project.repoUrl && (
              <a
                href={project.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground transition-colors"
                aria-label="View Source"
                onClick={() =>
                  posthog.capture("project_external_link_clicked", {
                    project_slug: project.slug,
                    link_type: "github",
                    url: project.repoUrl,
                  })
                }
              >
                <Github className="w-5 h-5" />
              </a>
            )}
            {project.demoUrl && (
              <a
                href={project.demoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground transition-colors"
                aria-label="Live Demo"
                onClick={() =>
                  posthog.capture("project_external_link_clicked", {
                    project_slug: project.slug,
                    link_type: "demo",
                    url: project.demoUrl,
                  })
                }
              >
                <ExternalLink className="w-5 h-5" />
              </a>
            )}
            {project.productUrl && (
              <a
                href={project.productUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground transition-colors"
                aria-label="Product Page"
                onClick={() =>
                  posthog.capture("project_external_link_clicked", {
                    project_slug: project.slug,
                    link_type: "product",
                    url: project.productUrl,
                  })
                }
              >
                <Globe className="w-5 h-5" />
              </a>
            )}
            {project.paperUrl && (
              <a
                href={project.paperUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground transition-colors"
                aria-label="Read Research Paper"
                onClick={() =>
                  posthog.capture("project_external_link_clicked", {
                    project_slug: project.slug,
                    link_type: "paper",
                    url: project.paperUrl,
                  })
                }
              >
                <FileText className="w-5 h-5" />
              </a>
            )}
          </div>
        </div>
        <CardDescription className="line-clamp-3">
          {project.description}
        </CardDescription>
      </CardHeader>

      <div className="flex-grow" />

      <CardFooter className="flex flex-col items-start gap-4">
        {project.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 z-10">
            {project.tags.map((tag) => {
              const isActive = selectedTags.includes(tag);
              return (
                <Badge
                  key={tag}
                  variant={isActive ? "default" : "secondary"}
                  interactive
                  active={isActive}
                  className="gap-1 cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTagClick(tag);
                  }}
                >
                  <Tag className="h-3 w-3" />
                  {tag}
                </Badge>
              );
            })}
          </div>
        )}
        <div className="flex flex-wrap gap-2 z-10">
          {sortedTechnologies.slice(0, 5).map((tech) => {
            const isActive = selectedTech.includes(tech.slug);

            return (
              <Badge
                key={tech.slug}
                variant={isActive ? "default" : "secondary"}
                interactive
                active={isActive}
                className="flex items-center gap-1 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onTechClick(tech.slug);
                }}
              >
                {hasTechIcon(tech.name, tech.iconSlug) && (
                  <TechIcon
                    name={tech.name}
                    iconSlug={tech.iconSlug}
                    className="w-3 h-3"
                  />
                )}
                {tech.name}
              </Badge>
            );
          })}
          {sortedTechnologies.length > 5 && (
            <Badge variant="secondary">+{sortedTechnologies.length - 5}</Badge>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}
