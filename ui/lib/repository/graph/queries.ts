import type { ADRRef } from "@/lib/domain/adr/adr";
import type { BlogSlug } from "@/lib/domain/blog/blogPost";
import type { IdeaSlug } from "@/lib/domain/idea/idea";
import type { InitiativeSlug } from "@/lib/domain/initiative/initiative";
import type {
  DefaultSlotSlug,
  LayerSlug,
} from "@/lib/domain/platform/platform";
import type { ProjectSlug } from "@/lib/domain/project/project";
import type { RoleSlug } from "@/lib/domain/role/jobRole";
import type { ProductDecisionSlug } from "@/lib/domain/slugs";
import type { TechnologySlug } from "@/lib/domain/technology/technology";
import {
  type ContentGraph,
  getNodeSlug,
  isNodeType,
  makeNodeId,
  type NodeId,
  type NodeType,
} from "./types";

function getTechnologiesFor(
  graph: ContentGraph,
  type: NodeType,
  slug: string,
): Set<TechnologySlug> {
  return graph.edges.usesTechnology.get(makeNodeId(type, slug)) ?? new Set();
}

export function getTechnologiesForProject(
  graph: ContentGraph,
  slug: ProjectSlug,
): Set<TechnologySlug> {
  return getTechnologiesFor(graph, "project", slug);
}

export function getTechnologiesForADR(
  graph: ContentGraph,
  adrRef: ADRRef,
): Set<TechnologySlug> {
  return getTechnologiesFor(graph, "adr", adrRef);
}

export function getTechnologiesForBlog(
  graph: ContentGraph,
  slug: BlogSlug,
): Set<TechnologySlug> {
  return getTechnologiesFor(graph, "blog", slug);
}

export function getTechnologiesForRole(
  graph: ContentGraph,
  slug: RoleSlug,
): Set<TechnologySlug> {
  return getTechnologiesFor(graph, "role", slug);
}

export function getIdeasForTechnology(
  graph: ContentGraph,
  slug: TechnologySlug,
): Set<IdeaSlug> {
  return graph.edges.technologyIdeas.get(slug) ?? new Set();
}

export function getTechnologiesForIdea(
  graph: ContentGraph,
  slug: IdeaSlug,
): Set<TechnologySlug> {
  return graph.reverse.ideaTechnologies.get(slug) ?? new Set();
}

export function getContentUsingTechnology(
  graph: ContentGraph,
  slug: TechnologySlug,
): Set<NodeId> {
  return graph.reverse.technologyUsedBy.get(slug) ?? new Set();
}

export function getContentUsingTechnologyByType(
  graph: ContentGraph,
  slug: TechnologySlug,
): {
  projects: ProjectSlug[];
  adrs: ADRRef[];
  blogs: BlogSlug[];
  roles: RoleSlug[];
} {
  const nodeIds = graph.reverse.technologyUsedBy.get(slug) ?? new Set();

  const result = {
    projects: [] as ProjectSlug[],
    adrs: [] as ADRRef[],
    blogs: [] as BlogSlug[],
    roles: [] as RoleSlug[],
  };

  for (const nodeId of nodeIds) {
    if (isNodeType(nodeId, "project"))
      result.projects.push(getNodeSlug(nodeId));
    else if (isNodeType(nodeId, "adr")) result.adrs.push(getNodeSlug(nodeId));
    else if (isNodeType(nodeId, "blog")) result.blogs.push(getNodeSlug(nodeId));
    else if (isNodeType(nodeId, "role")) result.roles.push(getNodeSlug(nodeId));
  }

  return result;
}

export function getADRsForProject(
  graph: ContentGraph,
  slug: ProjectSlug,
): Set<ADRRef> {
  return graph.reverse.projectADRs.get(slug) ?? new Set();
}

export function getProjectForADR(
  graph: ContentGraph,
  adrRef: ADRRef,
): ProjectSlug | undefined {
  return graph.edges.partOfProject.get(adrRef);
}

export function getSupersedingADR(
  graph: ContentGraph,
  adrRef: ADRRef,
): ADRRef | undefined {
  return graph.reverse.supersededBy.get(adrRef);
}

export function getSupersededADR(
  graph: ContentGraph,
  adrRef: ADRRef,
): ADRRef | undefined {
  return graph.edges.supersedes.get(adrRef);
}

export function filterNodesByType<T extends NodeType>(
  nodeIds: Set<NodeId>,
  type: T,
): string[] {
  const result: string[] = [];
  for (const nodeId of nodeIds) {
    if (isNodeType(nodeId, type)) {
      result.push(getNodeSlug(nodeId));
    }
  }
  return result;
}

export function getADRCountForProject(
  graph: ContentGraph,
  slug: ProjectSlug,
): number {
  return graph.reverse.projectADRs.get(slug)?.size ?? 0;
}

export function getADRSlugsForProject(
  graph: ContentGraph,
  slug: ProjectSlug,
): ADRRef[] {
  return Array.from(graph.reverse.projectADRs.get(slug) ?? []);
}

export function getTagsForContent(
  graph: ContentGraph,
  nodeId: NodeId,
): Set<string> {
  return graph.edges.hasTag.get(nodeId) ?? new Set();
}

export function getTagsForProject(
  graph: ContentGraph,
  slug: ProjectSlug,
): Set<string> {
  return getTagsForContent(graph, makeNodeId("project", slug));
}

export function getContentForTag(
  graph: ContentGraph,
  tag: string,
): Set<NodeId> {
  return graph.reverse.tagUsedBy.get(tag) ?? new Set();
}

export function getAllTags(graph: ContentGraph): string[] {
  return Array.from(graph.reverse.tagUsedBy.keys());
}

export function getRoleForProject(
  graph: ContentGraph,
  slug: ProjectSlug,
): RoleSlug | undefined {
  return graph.edges.createdAtRole.get(slug);
}

export function getProjectsForRole(
  graph: ContentGraph,
  slug: RoleSlug,
): Set<ProjectSlug> {
  return graph.reverse.roleProjects.get(slug) ?? new Set();
}

export function getInitiativesForProject(
  graph: ContentGraph,
  slug: ProjectSlug,
): Set<InitiativeSlug> {
  return graph.edges.contributesToInitiative.get(slug) ?? new Set();
}

export function getProjectsForInitiative(
  graph: ContentGraph,
  slug: InitiativeSlug,
): Set<ProjectSlug> {
  return graph.reverse.initiativeProjects.get(slug) ?? new Set();
}

export function getRoleForBlog(
  graph: ContentGraph,
  slug: BlogSlug,
): RoleSlug | undefined {
  return graph.edges.writtenAtRole.get(slug);
}

export function getBlogsForRole(
  graph: ContentGraph,
  slug: RoleSlug,
): Set<BlogSlug> {
  return graph.reverse.roleBlogs.get(slug) ?? new Set();
}

function getIdeasFor(
  graph: ContentGraph,
  type: NodeType,
  slug: string,
): Set<IdeaSlug> {
  return graph.edges.referencesIdea.get(makeNodeId(type, slug)) ?? new Set();
}

export function getIdeasForProject(
  graph: ContentGraph,
  slug: ProjectSlug,
): Set<IdeaSlug> {
  return getIdeasFor(graph, "project", slug);
}

export function getIdeasForBlog(
  graph: ContentGraph,
  slug: BlogSlug,
): Set<IdeaSlug> {
  return getIdeasFor(graph, "blog", slug);
}

export function getIdeasForADR(
  graph: ContentGraph,
  adrRef: ADRRef,
): Set<IdeaSlug> {
  return getIdeasFor(graph, "adr", adrRef);
}

export function getIdeasForProductDecision(
  graph: ContentGraph,
  slug: ProductDecisionSlug,
): Set<IdeaSlug> {
  return getIdeasFor(graph, "product-decision", slug);
}

export function getProjectsForProductDecision(
  graph: ContentGraph,
  slug: ProductDecisionSlug,
): Set<ProjectSlug> {
  return graph.edges.productDecisionAffectedProjects.get(slug) ?? new Set();
}

export function getProductDecisionsForProject(
  graph: ContentGraph,
  slug: ProjectSlug,
): Set<ProductDecisionSlug> {
  return graph.reverse.projectProductDecisions.get(slug) ?? new Set();
}

export function getADRsImplementingProductDecision(
  graph: ContentGraph,
  slug: ProductDecisionSlug,
): Set<ADRRef> {
  return graph.reverse.productDecisionImplementedByADRs.get(slug) ?? new Set();
}

export function getBlogsForProductDecision(
  graph: ContentGraph,
  slug: ProductDecisionSlug,
): Set<BlogSlug> {
  return graph.reverse.productDecisionBlogs.get(slug) ?? new Set();
}

export function getContentReferencingIdea(
  graph: ContentGraph,
  slug: IdeaSlug,
): Set<NodeId> {
  return graph.reverse.ideaReferencedBy.get(slug) ?? new Set();
}

export function getContentReferencingIdeaByType(
  graph: ContentGraph,
  slug: IdeaSlug,
): {
  projects: ProjectSlug[];
  adrs: ADRRef[];
  blogs: BlogSlug[];
  productDecisions: ProductDecisionSlug[];
} {
  const nodeIds = getContentReferencingIdea(graph, slug);
  return {
    projects: filterNodesByType(nodeIds, "project"),
    adrs: filterNodesByType(nodeIds, "adr"),
    blogs: filterNodesByType(nodeIds, "blog"),
    productDecisions: filterNodesByType(nodeIds, "product-decision"),
  };
}

export function getRelatedIdeas(
  graph: ContentGraph,
  slug: IdeaSlug,
): Set<IdeaSlug> {
  const related = new Set(graph.edges.relatedIdea.get(slug) ?? []);
  for (const [source, targets] of graph.edges.relatedIdea) {
    if (targets.has(slug)) related.add(source);
  }
  return related;
}

export function getPlatformLayersForProject(
  graph: ContentGraph,
  slug: ProjectSlug,
): Set<LayerSlug> {
  const layers = new Set<LayerSlug>();
  for (const record of graph.edges.projectLayerUses.values()) {
    if (record.project === slug) layers.add(record.use.layer);
  }
  return layers;
}

export function getProjectsForPlatformLayer(
  graph: ContentGraph,
  slug: LayerSlug,
): Set<ProjectSlug> {
  return graph.reverse.layerUsers.get(slug) ?? new Set();
}

export function getOverridesForDefaultSlot(
  graph: ContentGraph,
  slug: DefaultSlotSlug,
): Set<ADRRef> {
  return graph.reverse.slotOverrides.get(slug) ?? new Set();
}
