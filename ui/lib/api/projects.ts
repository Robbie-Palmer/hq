import {
  type ADRCardView,
  type ADRDetailView,
  type ADRStatus,
  getADRDetailForProject,
  getAllADRCards,
  getBuildingPhilosophy as getBuildingPhilosophyQuery,
  getProjectWithADRs,
  loadDomainRepository,
  type ProjectStatus,
  type ProjectWithADRsView,
} from "@/lib/domain";
import { parseADRRef } from "@/lib/domain/adr/adr";

const repository = loadDomainRepository();

export type { ADRDetailView, ADRStatus, ProjectStatus };

export type Project = ProjectWithADRsView;
export type ADR = ADRCardView;
export type ProjectWithADRs = ProjectWithADRsView;

export const PROJECT_STATUSES = [
  "idea",
  "in_progress",
  "live",
  "archived",
  "completed",
] as const;

export interface ProjectADR extends ADRCardView {
  projectSlug: string;
  projectTitle: string;
}

export function getAllProjectSlugs(): string[] {
  return Array.from(repository.projects.keys());
}

export function getAllProjectAliases(): Array<{
  alias: string;
  target: string;
}> {
  return Array.from(repository.projectAliases, ([alias, target]) => ({
    alias,
    target,
  }));
}

function resolveProjectSlug(slug: string): string {
  return repository.projectAliases.get(slug) ?? slug;
}

export function getAllLegacyADRPaths(): Array<{
  projectSlug: string;
  adrSlug: string;
  lastModified: string;
}> {
  return Array.from(repository.adrAliases).map(([alias, target]) => {
    const adr = repository.adrs.get(target);
    if (!adr) {
      throw new Error(`Legacy ADR target not found: ${target}`);
    }
    return { ...parseADRRef(alias), lastModified: adr.date };
  });
}

export function getAllProjectAliasADRPaths(): Array<{
  alias: string;
  target: string;
  adrSlug: string;
}> {
  const legacyADRPaths = getAllLegacyADRPaths();
  return getAllProjectAliases().flatMap(({ alias, target }) => {
    const project = getProject(target);
    const adrSlugs = new Set([
      ...project.adrs.map((adr) => adr.slug),
      ...legacyADRPaths
        .filter(({ projectSlug }) => projectSlug === target)
        .map(({ adrSlug }) => adrSlug),
    ]);
    return Array.from(adrSlugs, (adrSlug) => ({ alias, target, adrSlug }));
  });
}

export function getProject(slug: string): ProjectWithADRs {
  const project = getProjectWithADRs(repository, resolveProjectSlug(slug));
  if (!project) {
    throw new Error(`Project not found: ${slug}`);
  }
  return project;
}

export function getAllProjects(): ProjectWithADRs[] {
  return Array.from(repository.projects.keys())
    .map((slug) => getProject(slug))
    .sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      return dateB - dateA;
    });
}

export function getAllADRs(): ProjectADR[] {
  const allADRCards = getAllADRCards(repository);
  const allADRs = allADRCards.map((adr) => {
    const project = repository.projects.get(adr.projectSlug);
    if (!project) {
      throw new Error(`Project not found: ${adr.projectSlug}`);
    }
    return {
      ...adr,
      projectSlug: adr.projectSlug,
      projectTitle: project.title,
    };
  });
  return allADRs.sort((a, b) => {
    const dateA = new Date(a.date).getTime();
    const dateB = new Date(b.date).getTime();
    return dateB - dateA;
  });
}

export function getProjectADR(projectSlug: string, adrSlug: string) {
  const adrView = getADRDetailForProject(
    repository,
    resolveProjectSlug(projectSlug),
    adrSlug,
  );
  if (!adrView) {
    throw new Error(`ADR not found: ${projectSlug}/${adrSlug}`);
  }
  return adrView;
}

export function getBuildingPhilosophy(): string {
  return getBuildingPhilosophyQuery(repository);
}
