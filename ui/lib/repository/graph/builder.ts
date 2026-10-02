import type { ADRRef } from "@/lib/domain/adr/adr";
import type { BlogSlug } from "@/lib/domain/blog/blogPost";
import type { IdeaSlug } from "@/lib/domain/idea/idea";
import type { InitiativeSlug } from "@/lib/domain/initiative/initiative";
import type {
  DefaultOverride,
  PlatformManifest,
  ProjectLayerUse,
} from "@/lib/domain/platform/platform";
import type { ProjectSlug } from "@/lib/domain/project/project";
import type { RoleSlug } from "@/lib/domain/role/jobRole";
import type { TechnologySlug } from "@/lib/domain/technology/technology";
import { type ContentGraph, makeNodeId, type NodeId } from "./types";

export interface RelationData {
  projectTechnologies: Map<ProjectSlug, TechnologySlug[]>;
  projectADRs: Map<ProjectSlug, ADRRef[]>;
  projectRole: Map<ProjectSlug, RoleSlug>;
  projectTags: Map<ProjectSlug, string[]>;
  projectInitiatives: Map<ProjectSlug, InitiativeSlug[]>;
  blogTechnologies: Map<BlogSlug, TechnologySlug[]>;
  blogIdeas: Map<BlogSlug, IdeaSlug[]>;
  blogTags: Map<BlogSlug, string[]>;
  adrTechnologies: Map<ADRRef, TechnologySlug[]>;
  adrIdeas: Map<ADRRef, IdeaSlug[]>;
  adrProject: Map<ADRRef, ProjectSlug>;
  adrSupersedes: Map<ADRRef, ADRRef>;
  adrInheritsFrom: Map<ADRRef, ADRRef>;
  roleTechnologies: Map<RoleSlug, TechnologySlug[]>;
  blogRole: Map<BlogSlug, RoleSlug>;
  projectIdeas: Map<ProjectSlug, IdeaSlug[]>;
  technologyIdeas: Map<TechnologySlug, IdeaSlug[]>;
  ideaRelatedIdeas: Map<IdeaSlug, IdeaSlug[]>;
  platformManifest?: PlatformManifest;
  projectLayerUses: Map<ProjectSlug, ProjectLayerUse[]>;
  adrOverridesDefault: Map<ADRRef, DefaultOverride>;
}

export function createEmptyRelationData(): RelationData {
  return {
    projectTechnologies: new Map(),
    projectADRs: new Map(),
    projectRole: new Map(),
    projectTags: new Map(),
    projectInitiatives: new Map(),
    blogTechnologies: new Map(),
    blogIdeas: new Map(),
    blogTags: new Map(),
    adrTechnologies: new Map(),
    adrIdeas: new Map(),
    adrProject: new Map(),
    adrSupersedes: new Map(),
    adrInheritsFrom: new Map(),
    roleTechnologies: new Map(),
    blogRole: new Map(),
    projectIdeas: new Map(),
    technologyIdeas: new Map(),
    ideaRelatedIdeas: new Map(),
    platformManifest: undefined,
    projectLayerUses: new Map(),
    adrOverridesDefault: new Map(),
  };
}

interface BuildGraphInput {
  technologySlugs: Iterable<TechnologySlug>;
  projectSlugs: Iterable<ProjectSlug>;
  initiativeSlugs?: Iterable<InitiativeSlug>;
  ideaSlugs?: Iterable<IdeaSlug>;
  relations: RelationData;
}

/** Applies each relation group in the graph's fixed construction order. */
class ContentGraphBuilder {
  private readonly graph: ContentGraph;
  private readonly relations: RelationData;

  constructor(input: BuildGraphInput) {
    this.graph = initializeGraph(input);
    this.relations = input.relations;
  }

  addTechnologyIdeas(): this {
    addTechnologyIdeaRelations(this.graph, this.relations);
    return this;
  }

  addProjects(): this {
    addProjectRelations(this.graph, this.relations);
    return this;
  }

  addAdrs(): this {
    addAdrRelations(this.graph, this.relations);
    return this;
  }

  addBlogsAndRoles(): this {
    addBlogAndRoleRelations(this.graph, this.relations);
    return this;
  }

  addPlatform(): this {
    addPlatformRelations(this.graph, this.relations);
    return this;
  }

  build(): ContentGraph {
    return this.graph;
  }
}

export function buildContentGraph(input: BuildGraphInput): ContentGraph {
  return new ContentGraphBuilder(input)
    .addTechnologyIdeas()
    .addProjects()
    .addAdrs()
    .addBlogsAndRoles()
    .addPlatform()
    .build();
}

function initializeGraph(input: BuildGraphInput): ContentGraph {
  const graph: ContentGraph = {
    edges: {
      usesTechnology: new Map(),
      partOfProject: new Map(),
      supersedes: new Map(),
      inheritsFrom: new Map(),
      hasTag: new Map(),
      contributesToInitiative: new Map(),
      createdAtRole: new Map(),
      writtenAtRole: new Map(),
      referencesIdea: new Map(),
      technologyIdeas: new Map(),
      relatedIdea: new Map(),
      platformOwnsLayer: new Map(),
      layerSlotPolicies: new Map(),
      defaultSelections: new Map(),
      projectLayerUses: new Map(),
      projectSlotUses: new Map(),
      adrOverridesDefault: new Map(),
    },
    reverse: {
      technologyUsedBy: new Map(),
      projectADRs: new Map(),
      supersededBy: new Map(),
      inheritedBy: new Map(),
      tagUsedBy: new Map(),
      initiativeProjects: new Map(),
      roleProjects: new Map(),
      roleBlogs: new Map(),
      ideaReferencedBy: new Map(),
      ideaTechnologies: new Map(),
      layerOwnedBy: new Map(),
      layerUsers: new Map(),
      slotOverrides: new Map(),
    },
  };
  for (const techSlug of input.technologySlugs) {
    graph.reverse.technologyUsedBy.set(techSlug, new Set());
  }
  for (const projectSlug of input.projectSlugs) {
    graph.reverse.projectADRs.set(projectSlug, new Set());
  }
  for (const initiativeSlug of input.initiativeSlugs ?? []) {
    graph.reverse.initiativeProjects.set(initiativeSlug, new Set());
  }
  for (const ideaSlug of input.ideaSlugs ?? []) {
    graph.reverse.ideaReferencedBy.set(ideaSlug, new Set());
    graph.reverse.ideaTechnologies.set(ideaSlug, new Set());
  }
  return graph;
}

function addTechnologyIdeaRelations(
  graph: ContentGraph,
  relations: RelationData,
): void {
  for (const [techSlug, ideas] of relations.technologyIdeas) {
    if (ideas.length === 0) continue;
    graph.edges.technologyIdeas.set(techSlug, new Set(ideas));
    for (const ideaSlug of ideas) {
      graph.reverse.ideaTechnologies.get(ideaSlug)?.add(techSlug);
    }
  }
}

function addProjectRelations(
  graph: ContentGraph,
  relations: RelationData,
): void {
  for (const [slug, technologies] of relations.projectTechnologies) {
    addTechnologyEdges(graph, makeNodeId("project", slug), technologies);
  }
  for (const [slug, tags] of relations.projectTags) {
    addTagEdges(graph, makeNodeId("project", slug), tags);
  }
  for (const [slug, ideas] of relations.projectIdeas) {
    addIdeaEdges(graph, makeNodeId("project", slug), ideas);
  }
  for (const [projectSlug, initiatives] of relations.projectInitiatives) {
    if (initiatives.length === 0) continue;
    graph.edges.contributesToInitiative.set(projectSlug, new Set(initiatives));
    for (const initiativeSlug of initiatives) {
      graph.reverse.initiativeProjects.get(initiativeSlug)?.add(projectSlug);
    }
  }
  for (const [projectSlug, adrRefs] of relations.projectADRs) {
    for (const adrRef of adrRefs) {
      graph.reverse.projectADRs.get(projectSlug)?.add(adrRef);
    }
  }
}

function addAdrRelations(graph: ContentGraph, relations: RelationData): void {
  for (const [slug, technologies] of relations.adrTechnologies) {
    addTechnologyEdges(graph, makeNodeId("adr", slug), technologies);
  }
  for (const [slug, ideas] of relations.adrIdeas) {
    addIdeaEdges(graph, makeNodeId("adr", slug), ideas);
  }
  for (const [slug, projectSlug] of relations.adrProject) {
    graph.edges.partOfProject.set(slug, projectSlug);
    graph.reverse.projectADRs.get(projectSlug)?.add(slug);
  }
  for (const [supersedingSlug, supersededSlug] of relations.adrSupersedes) {
    graph.edges.supersedes.set(supersedingSlug, supersededSlug);
    graph.reverse.supersededBy.set(supersededSlug, supersedingSlug);
  }
  for (const [childAdrRef, parentAdrRef] of relations.adrInheritsFrom) {
    graph.edges.inheritsFrom.set(childAdrRef, parentAdrRef);
    if (!graph.reverse.inheritedBy.has(parentAdrRef)) {
      graph.reverse.inheritedBy.set(parentAdrRef, new Set());
    }
    graph.reverse.inheritedBy.get(parentAdrRef)?.add(childAdrRef);
  }
}

function addBlogAndRoleRelations(
  graph: ContentGraph,
  relations: RelationData,
): void {
  for (const [slug, technologies] of relations.blogTechnologies) {
    addTechnologyEdges(graph, makeNodeId("blog", slug), technologies);
  }
  for (const [slug, tags] of relations.blogTags) {
    addTagEdges(graph, makeNodeId("blog", slug), tags);
  }
  for (const [slug, ideas] of relations.blogIdeas) {
    addIdeaEdges(graph, makeNodeId("blog", slug), ideas);
  }

  for (const [slug, relatedIdeas] of relations.ideaRelatedIdeas) {
    if (relatedIdeas.length > 0) {
      graph.edges.relatedIdea.set(slug, new Set(relatedIdeas));
    }
  }

  for (const [slug, technologies] of relations.roleTechnologies) {
    addTechnologyEdges(graph, makeNodeId("role", slug), technologies);
  }

  for (const [projectSlug, roleSlug] of relations.projectRole) {
    graph.edges.createdAtRole.set(projectSlug, roleSlug);
    if (!graph.reverse.roleProjects.has(roleSlug)) {
      graph.reverse.roleProjects.set(roleSlug, new Set());
    }
    graph.reverse.roleProjects.get(roleSlug)?.add(projectSlug);
  }

  for (const [blogSlug, roleSlug] of relations.blogRole) {
    graph.edges.writtenAtRole.set(blogSlug, roleSlug);
    if (!graph.reverse.roleBlogs.has(roleSlug)) {
      graph.reverse.roleBlogs.set(roleSlug, new Set());
    }
    graph.reverse.roleBlogs.get(roleSlug)?.add(blogSlug);
  }
}

function addPlatformRelations(
  graph: ContentGraph,
  relations: RelationData,
): void {
  const manifest = relations.platformManifest;
  if (manifest) {
    graph.edges.platformOwnsLayer.set(
      manifest.project,
      new Set(manifest.layers.map((layer) => layer.slug)),
    );
    for (const layer of manifest.layers) {
      graph.reverse.layerOwnedBy.set(layer.slug, manifest.project);
      graph.reverse.layerUsers.set(layer.slug, new Set());
    }
    for (const policy of manifest.policies) {
      graph.edges.layerSlotPolicies.set(policy.id, policy);
    }
    for (const selection of manifest.selections) {
      graph.edges.defaultSelections.set(selection.id, selection);
    }
  }

  for (const [project, uses] of relations.projectLayerUses) {
    for (const [useIndex, use] of uses.entries()) {
      const useId = `${project}:${use.layer}:${useIndex}`;
      graph.edges.projectLayerUses.set(useId, { project, use });
      graph.reverse.layerUsers.get(use.layer)?.add(project);
      for (const [slotIndex, slotUse] of use.slots.entries()) {
        graph.edges.projectSlotUses.set(`${useId}:${slotIndex}`, {
          project,
          layer: use.layer,
          use: slotUse,
        });
      }
    }
  }

  for (const [adrRef, override] of relations.adrOverridesDefault) {
    graph.edges.adrOverridesDefault.set(adrRef, override);
    const overrides =
      graph.reverse.slotOverrides.get(override.slot) ?? new Set();
    overrides.add(adrRef);
    graph.reverse.slotOverrides.set(override.slot, overrides);
  }
}

function addIdeaEdges(
  graph: ContentGraph,
  nodeId: NodeId,
  ideas: IdeaSlug[],
): void {
  if (ideas.length === 0) return;
  graph.edges.referencesIdea.set(nodeId, new Set(ideas));
  for (const idea of ideas) {
    graph.reverse.ideaReferencedBy.get(idea)?.add(nodeId);
  }
}

function addTechnologyEdges(
  graph: ContentGraph,
  nodeId: NodeId,
  technologies: TechnologySlug[],
): void {
  if (technologies.length === 0) return;
  graph.edges.usesTechnology.set(nodeId, new Set(technologies));
  for (const tech of technologies) {
    graph.reverse.technologyUsedBy.get(tech)?.add(nodeId);
  }
}

function addTagEdges(
  graph: ContentGraph,
  nodeId: NodeId,
  tags: string[],
): void {
  if (tags.length === 0) return;
  graph.edges.hasTag.set(nodeId, new Set(tags));
  for (const tag of tags) {
    if (!graph.reverse.tagUsedBy.has(tag)) {
      graph.reverse.tagUsedBy.set(tag, new Set());
    }
    graph.reverse.tagUsedBy.get(tag)?.add(nodeId);
  }
}
