import {
  type DomainRepository,
  getContentReferencingIdeaByType,
  getIdeasForADR,
  getIdeasForBlog,
  getIdeasForProject,
  getProjectForADR,
  getRelatedIdeas,
  getTechnologiesForIdea,
} from "@/lib/repository";
import { toADRListItemView } from "../adr/adrViews";
import { toBlogListItemView } from "../blog/blogViews";
import { toProjectListItemView } from "../project/projectViews";
import type { ADRRef, BlogSlug, ProjectSlug } from "../slugs";
import { toTechnologyDetailView } from "../technology/technologyViews";
import type { Idea, IdeaSlug } from "./idea";
import { type IdeaLinkView, toIdeaLinkView } from "./ideaViews";

export function getIdea(
  repository: DomainRepository,
  slug: IdeaSlug,
): Idea | null {
  return repository.ideas.get(slug) ?? null;
}

export function getAllIdeas(repository: DomainRepository): Idea[] {
  return Array.from(repository.ideas.values()).sort((a, b) =>
    a.title.localeCompare(b.title),
  );
}

function resolveIdeaLinks(
  repository: DomainRepository,
  slugs: Iterable<IdeaSlug>,
): IdeaLinkView[] {
  return Array.from(slugs)
    .map((slug) => repository.ideas.get(slug))
    .filter((idea): idea is Idea => idea !== undefined)
    .map(toIdeaLinkView)
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function getIdeaLinksForProject(
  repository: DomainRepository,
  slug: ProjectSlug,
): IdeaLinkView[] {
  return resolveIdeaLinks(
    repository,
    getIdeasForProject(repository.graph, slug),
  );
}

export function getIdeaLinksForBlog(
  repository: DomainRepository,
  slug: BlogSlug,
): IdeaLinkView[] {
  return resolveIdeaLinks(repository, getIdeasForBlog(repository.graph, slug));
}

export function getIdeaLinksForADR(
  repository: DomainRepository,
  adrRef: ADRRef,
): IdeaLinkView[] {
  return resolveIdeaLinks(repository, getIdeasForADR(repository.graph, adrRef));
}

export function getRelatedIdeaLinks(
  repository: DomainRepository,
  slug: IdeaSlug,
): IdeaLinkView[] {
  return resolveIdeaLinks(repository, getRelatedIdeas(repository.graph, slug));
}

export function getRelatedContentForIdea(
  repository: DomainRepository,
  slug: IdeaSlug,
) {
  const references = getContentReferencingIdeaByType(repository.graph, slug);
  return {
    technologies: Array.from(getTechnologiesForIdea(repository.graph, slug))
      .map((technologySlug) => repository.technologies.get(technologySlug))
      .filter(
        (technology): technology is NonNullable<typeof technology> =>
          technology !== undefined,
      )
      .map(toTechnologyDetailView)
      .sort((a, b) => a.name.localeCompare(b.name)),
    projects: references.projects
      .map((projectSlug) => repository.projects.get(projectSlug))
      .filter((project): project is NonNullable<typeof project> =>
        Boolean(project),
      )
      .map(toProjectListItemView),
    blogs: references.blogs
      .map((blogSlug) => repository.blogs.get(blogSlug))
      .filter((blog): blog is NonNullable<typeof blog> => Boolean(blog))
      .map(toBlogListItemView),
    adrs: references.adrs.flatMap((adrRef) => {
      const adr = repository.adrs.get(adrRef);
      const projectSlug = getProjectForADR(repository.graph, adrRef);
      if (!adr || !projectSlug || adr.inheritsFrom) return [];
      return [{ ...toADRListItemView(adr), projectSlug }];
    }),
    productDecisions: references.productDecisions
      .map((decisionSlug) => repository.productDecisions.get(decisionSlug))
      .filter((decision) => decision !== undefined),
  };
}
