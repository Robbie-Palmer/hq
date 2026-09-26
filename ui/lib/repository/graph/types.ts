import type { ADRRef } from "@/lib/domain/adr/adr";
import type { BlogSlug } from "@/lib/domain/blog/blogPost";
import type { IdeaSlug } from "@/lib/domain/idea/idea";
import type { InitiativeSlug } from "@/lib/domain/initiative/initiative";
import type {
  DefaultOverride,
  DefaultSelection,
  DefaultSlotSlug,
  LayerSlotPolicy,
  LayerSlug,
  ProjectLayerUse,
  ProjectSlotUse,
} from "@/lib/domain/platform/platform";
import type { ProjectSlug } from "@/lib/domain/project/project";
import type { RoleSlug } from "@/lib/domain/role/jobRole";
import type { TechnologySlug } from "@/lib/domain/technology/technology";

// Recipe types live in the separate RecipeRepository - see @/lib/domain/recipe/recipeGraph

export type NodeType =
  | "project"
  | "initiative"
  | "idea"
  | "adr"
  | "blog"
  | "role"
  | "paper"
  | "platform-layer"
  | "platform-policy"
  | "technology";

export type NodeId =
  | `project:${string}`
  | `initiative:${string}`
  | `idea:${string}`
  | `adr:${string}`
  | `blog:${string}`
  | `role:${string}`
  | `paper:${string}`
  | `platform-layer:${string}`
  | `platform-policy:${string}`
  | `technology:${string}`;

export type EdgeType =
  | "USES_TECHNOLOGY"
  | "PART_OF_PROJECT"
  | "SUPERSEDES"
  | "INHERITS_FROM"
  | "HAS_TAG"
  | "CONTRIBUTES_TO_INITIATIVE"
  | "CREATED_AT_ROLE"
  | "WRITTEN_AT_ROLE"
  | "HAS_RESEARCH_PAPER"
  | "REFERENCES_IDEA"
  | "HAS_IDEA"
  | "RELATED_IDEA";

export interface ContentGraph {
  edges: {
    usesTechnology: Map<NodeId, Set<TechnologySlug>>;
    partOfProject: Map<ADRRef, ProjectSlug>;
    supersedes: Map<ADRRef, ADRRef>;
    inheritsFrom: Map<ADRRef, ADRRef>;
    hasTag: Map<NodeId, Set<string>>;
    contributesToInitiative: Map<ProjectSlug, Set<InitiativeSlug>>;
    createdAtRole: Map<ProjectSlug, RoleSlug>;
    writtenAtRole: Map<BlogSlug, RoleSlug>;
    referencesIdea: Map<NodeId, Set<IdeaSlug>>;
    technologyIdeas: Map<TechnologySlug, Set<IdeaSlug>>;
    relatedIdea: Map<IdeaSlug, Set<IdeaSlug>>;
    platformOwnsLayer: Map<ProjectSlug, Set<LayerSlug>>;
    layerSlotPolicies: Map<string, LayerSlotPolicy>;
    defaultSelections: Map<string, DefaultSelection>;
    projectLayerUses: Map<
      string,
      { project: ProjectSlug; use: ProjectLayerUse }
    >;
    projectSlotUses: Map<
      string,
      { project: ProjectSlug; layer: LayerSlug; use: ProjectSlotUse }
    >;
    adrOverridesDefault: Map<ADRRef, DefaultOverride>;
  };

  reverse: {
    technologyUsedBy: Map<TechnologySlug, Set<NodeId>>;
    projectADRs: Map<ProjectSlug, Set<ADRRef>>;
    supersededBy: Map<ADRRef, ADRRef>;
    inheritedBy: Map<ADRRef, Set<ADRRef>>;
    tagUsedBy: Map<string, Set<NodeId>>;
    initiativeProjects: Map<InitiativeSlug, Set<ProjectSlug>>;
    roleProjects: Map<RoleSlug, Set<ProjectSlug>>;
    roleBlogs: Map<RoleSlug, Set<BlogSlug>>;
    ideaReferencedBy: Map<IdeaSlug, Set<NodeId>>;
    ideaTechnologies: Map<IdeaSlug, Set<TechnologySlug>>;
    layerOwnedBy: Map<LayerSlug, ProjectSlug>;
    layerUsers: Map<LayerSlug, Set<ProjectSlug>>;
    slotOverrides: Map<DefaultSlotSlug, Set<ADRRef>>;
  };
}

export function makeNodeId<T extends NodeType>(type: T, slug: string): NodeId {
  return `${type}:${slug}` as NodeId;
}

export function parseNodeId(id: NodeId): { type: NodeType; slug: string } {
  const colonIndex = id.indexOf(":");
  return {
    type: id.slice(0, colonIndex) as NodeType,
    slug: id.slice(colonIndex + 1),
  };
}

export function getNodeType(id: NodeId): NodeType {
  return id.slice(0, id.indexOf(":")) as NodeType;
}

export function getNodeSlug(id: NodeId): string {
  return id.slice(id.indexOf(":") + 1);
}

export function isNodeType<T extends NodeType>(
  id: NodeId,
  type: T,
): id is `${T}:${string}` {
  return id.startsWith(`${type}:`);
}
