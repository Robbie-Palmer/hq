import {
  getAllInitiatives as getAllInitiativeEntities,
  getIdeaLinksForInitiative,
  getInitiative as getInitiativeEntity,
  getInitiativeProjects,
  getProjectInitiatives as getProjectInitiativeEntities,
  getProjectWithADRs,
  loadDomainRepository,
  type ProjectWithADRsView,
} from "@/lib/domain";
import type { IdeaLinkView } from "@/lib/domain/idea";
import type { Initiative } from "@/lib/domain/initiative";

const repository = loadDomainRepository();

export interface InitiativeProject extends ProjectWithADRsView {
  contribution?: string;
}

export interface InitiativeWithProjects extends Initiative {
  projects: InitiativeProject[];
  ideas: IdeaLinkView[];
}

function withProjects(initiative: Initiative): InitiativeWithProjects {
  const projects = getInitiativeProjects(repository, initiative.slug)
    .map((project) => getProjectWithADRs(repository, project.slug))
    .filter((project): project is ProjectWithADRsView => project !== null)
    .map((project) => ({
      ...project,
      contribution: initiative.projectContributions[project.slug],
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const ideas = getIdeaLinksForInitiative(repository, initiative.slug);

  return { ...initiative, projects, ideas };
}

export function getAllInitiativeSlugs(): string[] {
  return Array.from(repository.initiatives.keys());
}

export function getAllInitiatives(): InitiativeWithProjects[] {
  return getAllInitiativeEntities(repository)
    .map(withProjects)
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function getInitiative(slug: string): InitiativeWithProjects | null {
  const initiative = getInitiativeEntity(repository, slug);
  if (!initiative) return null;
  return withProjects(initiative);
}

export function getInitiativesForProject(
  projectSlug: string,
): InitiativeWithProjects[] {
  return getProjectInitiativeEntities(repository, projectSlug)
    .map(withProjects)
    .sort((a, b) => a.title.localeCompare(b.title));
}
