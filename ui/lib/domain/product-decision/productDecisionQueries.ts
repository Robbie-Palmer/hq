import type { DomainRepository } from "@/lib/repository";
import {
  getADRsImplementingProductDecision,
  getBlogsForProductDecision,
  getIdeasForProductDecision,
  getProjectsForProductDecision,
} from "@/lib/repository/graph/queries";
import type { ProductDecisionRef } from "../slugs";

export function getAllProductDecisions(repository: DomainRepository) {
  return Array.from(repository.productDecisions.values()).sort(
    (left, right) =>
      right.date.localeCompare(left.date) ||
      right.pdrRef.localeCompare(left.pdrRef),
  );
}

export function getProductDecision(
  repository: DomainRepository,
  slug: ProductDecisionRef,
) {
  return repository.productDecisions.get(slug) ?? null;
}

export function getProductDecisionBacklinks(
  repository: DomainRepository,
  slug: ProductDecisionRef,
) {
  return {
    projects: Array.from(getProjectsForProductDecision(repository.graph, slug))
      .map((projectSlug) => repository.projects.get(projectSlug))
      .filter((project) => project !== undefined),
    ideas: Array.from(getIdeasForProductDecision(repository.graph, slug))
      .map((ideaSlug) => repository.ideas.get(ideaSlug))
      .filter((idea) => idea !== undefined),
    informedByADRs: Array.from(
      repository.graph.edges.productDecisionInformedByADRs.get(slug) ?? [],
    )
      .map((adrRef) => repository.adrs.get(adrRef))
      .filter((adr) => adr !== undefined),
    implementingADRs: Array.from(
      getADRsImplementingProductDecision(repository.graph, slug),
    )
      .map((adrRef) => repository.adrs.get(adrRef))
      .filter((adr) => adr !== undefined),
    blogs: Array.from(getBlogsForProductDecision(repository.graph, slug))
      .map((blogSlug) => repository.blogs.get(blogSlug))
      .filter((blog) => blog !== undefined),
    evidence: repository.graph.edges.productDecisionEvidence.get(slug) ?? [],
  };
}
