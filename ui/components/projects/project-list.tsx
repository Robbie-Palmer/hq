"use client";

import { Circle, FolderGit2, Tag } from "lucide-react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useMemo } from "react";
import {
  createRoleFilterOptions,
  createStatusFilterOptions,
  createTagFilterOptions,
  createTechFilterOptions,
} from "@/components/command-palette-filters";
import { useCommandPalette } from "@/components/command-palette-shell";
import { cycleFilterFromCard } from "@/components/filters/cycle-filter-from-card";
import { FilterableCardGrid } from "@/components/ui/filterable-card-grid";
import { useFilterParams } from "@/hooks/use-filter-params";
import type { Project, ProjectStatus } from "@/lib/api/projects";
import { hasTechIcon, TechIcon } from "@/lib/api/tech-icons";
import { PROJECT_STATUS_CONFIG } from "@/lib/domain/project/project";
import { ProjectCard } from "./project-card";

interface ProjectListProps {
  projects: Project[];
}

export function ProjectList({ projects }: Readonly<ProjectListProps>) {
  const allTechnologies = useMemo(() => {
    const techMap = new Map<
      string,
      { slug: string; name: string; iconSlug?: string }
    >();
    for (const project of projects) {
      for (const tech of project.technologies) {
        if (!techMap.has(tech.slug)) {
          techMap.set(tech.slug, tech);
        }
      }
    }
    return Array.from(techMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [projects]);

  const allRolesMap = useMemo(() => {
    const roleMap = new Map<
      string,
      { slug: string; company: string; logoPath: string; title: string }
    >();
    for (const project of projects) {
      if (project.role && !roleMap.has(project.role.slug)) {
        roleMap.set(project.role.slug, project.role);
      }
    }
    return roleMap;
  }, [projects]);

  const allRoles = useMemo(
    () =>
      Array.from(allRolesMap.values()).sort((a, b) =>
        a.company.localeCompare(b.company),
      ),
    [allRolesMap],
  );

  const allTags = useMemo(
    () =>
      Array.from(new Set(projects.flatMap((p) => p.tags))).sort((a, b) =>
        a.localeCompare(b, "en"),
      ),
    [projects],
  );

  const filterParams = useFilterParams({
    filters: [
      { paramName: "tech", isMulti: true },
      { paramName: "status", isMulti: true },
      { paramName: "role", isMulti: true },
      { paramName: "tags", isMulti: true },
    ],
  });

  const selectedTech = filterParams.getValues("tech");
  const selectedTags = filterParams.getValues("tags");
  const selectedStatuses = filterParams.getValues("status");
  const selectedRoles = filterParams.getValues("role");
  const pathname = usePathname();
  const { registerFilters, unregisterFilters } = useCommandPalette();

  useEffect(() => {
    const filters = [
      ...createTechFilterOptions(allTechnologies),
      ...createRoleFilterOptions(allRoles),
      ...createStatusFilterOptions(
        Object.entries(PROJECT_STATUS_CONFIG).map(([value, config]) => ({
          value,
          label: config.label,
        })),
      ),
      ...createTagFilterOptions(allTags),
    ];
    registerFilters(filters);
    return () => unregisterFilters();
  }, [allTechnologies, allRoles, allTags, registerFilters, unregisterFilters]);

  return (
    <FilterableCardGrid
      items={projects}
      getItemKey={(project) => project.slug}
      searchConfig={{
        placeholder: "Search projects...",
        ariaLabel: "Search projects",
        keys: [
          { name: "title", weight: 3 },
          { name: "description", weight: 2 },
          { name: "technologies.name", weight: 2 },
          { name: "tags", weight: 2 },
          { name: "content", weight: 1 },
        ],
        threshold: 0.3,
      }}
      filterConfigs={[
        {
          paramName: "status",
          isMulti: true,
          label: "Status",
          getItemValues: (project) => [project.status],
          getValueLabel: (value) =>
            PROJECT_STATUS_CONFIG[value as ProjectStatus]?.label ?? value,
          getOptionIcon: (value) => {
            const config = PROJECT_STATUS_CONFIG[value as ProjectStatus];
            if (!config) return null;
            return (
              <Circle className={`w-2 h-2 fill-current ${config.color}`} />
            );
          },
        },
        {
          paramName: "role",
          isMulti: true,
          label: "Role",
          getItemValues: (project) => (project.role ? [project.role.slug] : []),
          getValueLabel: (value) => {
            const role = allRolesMap.get(value);
            return role?.company ?? value;
          },
          getOptionIcon: (value) => {
            const role = allRolesMap.get(value);
            if (!role) return null;
            return (
              <Image
                src={role.logoPath}
                alt={`${role.company} logo`}
                width={12}
                height={12}
                className="w-3 h-3 object-contain"
              />
            );
          },
        },
        {
          paramName: "tech",
          isMulti: true,
          label: "Tech",
          getItemValues: (project) => project.technologies.map((t) => t.slug),
          getValueLabel: (value) => {
            const tech = allTechnologies.find((t) => t.slug === value);
            return tech?.name ?? value;
          },
          getOptionIcon: (value) => {
            const tech = allTechnologies.find((t) => t.slug === value);
            if (!tech || !hasTechIcon(tech.name, tech.iconSlug)) return null;
            return (
              <TechIcon
                name={tech.name}
                iconSlug={tech.iconSlug}
                className="w-3 h-3 grayscale"
              />
            );
          },
        },
        {
          paramName: "tags",
          isMulti: true,
          label: "Tags",
          getItemValues: (project) => project.tags,
          icon: <Tag className="h-4 w-4" />,
          getValueLabel: (value) => value,
          getOptionIcon: () => <Tag className="h-3 w-3" />,
        },
      ]}
      dateRangeConfig={{
        getDate: (project) => project.date,
      }}
      sortConfig={{
        getDate: (project) => project.date,
        getUpdated: (project) => project.updated,
      }}
      emptyState={{
        icon: <FolderGit2 className="w-10 h-10 text-muted-foreground/50" />,
        message: "No projects found matching your criteria.",
      }}
      itemName="projects"
      renderCard={(project) => (
        <ProjectCard
          project={project}
          selectedTech={selectedTech}
          onTechClick={(tech) =>
            cycleFilterFromCard({
              filterParams,
              paramName: "tech",
              value: tech,
              label: allTechnologies.find((t) => t.slug === tech)?.name ?? tech,
              page: pathname,
            })
          }
          selectedTags={selectedTags}
          onTagClick={(tag) =>
            cycleFilterFromCard({
              filterParams,
              paramName: "tags",
              value: tag,
              label: tag,
              page: pathname,
            })
          }
          selectedStatuses={selectedStatuses}
          onStatusClick={(status) =>
            cycleFilterFromCard({
              filterParams,
              paramName: "status",
              value: status,
              label:
                PROJECT_STATUS_CONFIG[status as ProjectStatus]?.label ?? status,
              page: pathname,
            })
          }
          selectedRoles={selectedRoles}
          onRoleClick={(role) =>
            cycleFilterFromCard({
              filterParams,
              paramName: "role",
              value: role,
              label: allRolesMap.get(role)?.company ?? role,
              page: pathname,
            })
          }
        />
      )}
    />
  );
}
