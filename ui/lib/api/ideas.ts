import {
  getAllIdeas as getAllIdeaEntities,
  getIdea as getIdeaEntity,
  getIdeaLinksForADR as getIdeaLinksForADREntity,
  getIdeaLinksForBlog as getIdeaLinksForBlogEntity,
  getIdeaLinksForProject as getIdeaLinksForProjectEntity,
  getRelatedContentForIdea as getRelatedContentForIdeaEntity,
  getRelatedIdeaLinks,
  loadDomainRepository,
} from "@/lib/domain";

const repository = loadDomainRepository();

export function getAllIdeaSlugs(): string[] {
  return Array.from(repository.ideas.keys());
}

export function getAllIdeas() {
  return getAllIdeaEntities(repository).map((idea) => {
    const relatedContent = getRelatedContentForIdeaEntity(
      repository,
      idea.slug,
    );
    const relatedIdeas = getRelatedIdeaLinks(repository, idea.slug);
    return {
      ...idea,
      relatedIdeas,
      referenceCount:
        relatedIdeas.length +
        relatedContent.technologies.length +
        relatedContent.projects.length +
        relatedContent.blogs.length +
        relatedContent.adrs.length +
        relatedContent.productDecisions.length,
    };
  });
}

export function getIdea(slug: string) {
  const idea = getIdeaEntity(repository, slug);
  if (!idea) return null;
  return {
    ...idea,
    relatedIdeas: getRelatedIdeaLinks(repository, idea.slug),
    relatedContent: getRelatedContentForIdeaEntity(repository, idea.slug),
  };
}

export function getIdeasForProject(slug: string) {
  return getIdeaLinksForProjectEntity(repository, slug);
}

export function getIdeasForBlog(slug: string) {
  return getIdeaLinksForBlogEntity(repository, slug);
}

export function getIdeasForADR(adrRef: string) {
  return getIdeaLinksForADREntity(repository, adrRef);
}
