import type { DomainRepository } from "@/lib/domain";
import { normalizeADRTitle, parseADRRef } from "@/lib/domain/adr/adr";
import {
  type DefaultSelection,
  isEffectiveAt,
  isUseEffectiveAt,
  type LayerSlotPolicy,
  resolveEffectiveProjectStack,
} from "@/lib/domain/platform";
import type { NodeType } from "@/lib/repository/graph";

export const NON_NAVIGABLE_HREF = "#";

export interface GraphNode {
  id: string;
  name: string;
  type: NodeType | "tag";
  href: string;
  connections: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  provenance?: {
    layer?: string;
    slot?: string;
    policy?: string;
    selection?: string;
    decision?: string;
    mode?: "required" | "preferred";
    status?: string;
    effectiveFrom?: string;
    effectiveUntil?: string;
    adopted?: string;
    until?: string;
    tracking?: boolean;
  };
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

type GraphBuildState = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  connectionCounts: Map<string, number>;
};

function addConnection(state: GraphBuildState, id: string): void {
  state.connectionCounts.set(id, (state.connectionCounts.get(id) ?? 0) + 1);
}

function addEdge(
  state: GraphBuildState,
  source: string,
  target: string,
  type: string,
  provenance?: GraphEdge["provenance"],
): void {
  state.edges.push({
    source,
    target,
    type,
    ...(provenance ? { provenance } : {}),
  });
  addConnection(state, source);
  addConnection(state, target);
}

function addContentNodes(
  repository: DomainRepository,
  state: GraphBuildState,
): void {
  for (const [slug, initiative] of repository.initiatives) {
    state.nodes.push({
      id: `initiative:${slug}`,
      name: initiative.title,
      type: "initiative",
      href: `/initiatives/${slug}`,
      connections: 0,
    });
  }
  for (const [slug, project] of repository.projects) {
    state.nodes.push({
      id: `project:${slug}`,
      name: project.title,
      type: "project",
      href: `/projects/${slug}`,
      connections: 0,
    });
  }
  for (const [slug, blog] of repository.blogs) {
    state.nodes.push({
      id: `blog:${slug}`,
      name: blog.title,
      type: "blog",
      href: `/blog/${slug}`,
      connections: 0,
    });
  }
  for (const [slug, role] of repository.roles) {
    state.nodes.push({
      id: `role:${slug}`,
      name: `${role.title} @ ${role.company}`,
      type: "role",
      href: `/experience#${slug}`,
      connections: 0,
    });
  }
  for (const [slug, idea] of repository.ideas) {
    state.nodes.push({
      id: `idea:${slug}`,
      name: idea.title,
      type: "idea",
      href: `/ideas/${slug}`,
      connections: 0,
    });
  }
}

function addAdrNodes(
  repository: DomainRepository,
  state: GraphBuildState,
): void {
  for (const [adrRef, adr] of repository.adrs) {
    const projectSlug = repository.graph.edges.partOfProject.get(adrRef);
    if (!projectSlug) continue;
    const { adrSlug } = parseADRRef(adrRef);
    const displayTitle = normalizeADRTitle(adr.title);
    const localIndex = /^(\d+)/.exec(adrSlug)?.[1];
    state.nodes.push({
      id: `adr:${adrRef}`,
      name: localIndex ? `ADR ${localIndex}: ${displayTitle}` : adr.title,
      type: "adr",
      href: `/projects/${projectSlug}/adrs/${adrSlug}`,
      connections: 0,
    });
  }
}

function addResearchPaperNodes(
  repository: DomainRepository,
  state: GraphBuildState,
): void {
  for (const [projectSlug, project] of repository.projects) {
    if (!project.paperUrl) continue;
    const paperId = `paper:${projectSlug}`;
    state.nodes.push({
      id: paperId,
      name: project.paperTitle ?? `${project.title} research paper`,
      type: "paper",
      href: project.paperUrl,
      connections: 0,
    });
    addEdge(state, `project:${projectSlug}`, paperId, "HAS_RESEARCH_PAPER");
  }
}

function addPlatformNodes(
  repository: DomainRepository,
  state: GraphBuildState,
  instant: string,
): void {
  const manifest = repository.platform?.manifest;
  if (!manifest) return;
  for (const layer of manifest.layers) {
    state.nodes.push({
      id: `platform-layer:${layer.slug}`,
      name: layer.title,
      type: "platform-layer",
      href: `/projects/${manifest.project}#layer-${layer.slug}`,
      connections: 0,
    });
  }
  for (const selection of manifest.selections) {
    if (
      selection.kind !== "policy" ||
      selection.status !== "Accepted" ||
      !isEffectiveAt(selection, instant)
    )
      continue;
    state.nodes.push({
      id: `platform-policy:${selection.id}`,
      name: selection.value,
      type: "platform-policy",
      href: `/projects/${manifest.project}#slot-${selection.slot}`,
      connections: 0,
    });
  }
}

function platformSelectionTarget(selection: DefaultSelection): string {
  if (selection.kind === "technology") {
    return `technology:${selection.technology}`;
  }
  return `platform-policy:${selection.id}`;
}

function platformSelectionEdgeType(
  selection: DefaultSelection,
  mode: LayerSlotPolicy["mode"],
): string {
  if (selection.kind === "technology") {
    return mode === "required" ? "REQUIRES_TECHNOLOGY" : "PREFERS_TECHNOLOGY";
  }
  return mode === "required" ? "REQUIRES_POLICY" : "PREFERS_POLICY";
}

function addTechnologyAndTagNodes(
  repository: DomainRepository,
  state: GraphBuildState,
): Set<string> {
  const connectedTechs = new Set<string>();
  for (const [techSlug, usedBy] of repository.graph.reverse.technologyUsedBy) {
    const ideas = repository.graph.edges.technologyIdeas.get(techSlug);
    const selectedByPlatform = repository.platform?.manifest?.selections.some(
      (selection) =>
        selection.kind === "technology" && selection.technology === techSlug,
    );
    if (
      usedBy.size === 0 &&
      (!ideas || ideas.size === 0) &&
      !selectedByPlatform
    )
      continue;
    const tech = repository.technologies.get(techSlug);
    if (!tech) continue;
    connectedTechs.add(techSlug);
    state.nodes.push({
      id: `technology:${techSlug}`,
      name: tech.name,
      type: "technology",
      href: `/technologies/${techSlug}`,
      connections: 0,
    });
  }
  for (const [tag, usedBy] of repository.graph.reverse.tagUsedBy) {
    if (usedBy.size === 0) continue;
    state.nodes.push({
      id: `tag:${tag}`,
      name: `#${tag}`,
      type: "tag",
      href: NON_NAVIGABLE_HREF,
      connections: 0,
    });
  }
  return connectedTechs;
}

function addTechnologyEdges(
  repository: DomainRepository,
  state: GraphBuildState,
  connectedTechs: ReadonlySet<string>,
): void {
  for (const [nodeId, techSlugs] of repository.graph.edges.usesTechnology) {
    for (const techSlug of techSlugs) {
      if (connectedTechs.has(techSlug)) {
        addEdge(state, nodeId, `technology:${techSlug}`, "USES_TECHNOLOGY");
      }
    }
  }
}

function addMappedEdges(
  state: GraphBuildState,
  entries: ReadonlyMap<string, string>,
  sourceId: (value: string) => string,
  targetId: (value: string) => string,
  type: string,
): void {
  const nodeIds = new Set(state.nodes.map((node) => node.id));
  for (const [sourceValue, targetValue] of entries) {
    const source = sourceId(sourceValue);
    const target = targetId(targetValue);
    if (nodeIds.has(source) && nodeIds.has(target)) {
      addEdge(state, source, target, type);
    }
  }
}

function addIdeaReferenceEdges(
  repository: DomainRepository,
  state: GraphBuildState,
  nodeIds: ReadonlySet<string>,
): void {
  for (const [nodeId, ideaSlugs] of repository.graph.edges.referencesIdea) {
    for (const ideaSlug of ideaSlugs) {
      const target = `idea:${ideaSlug}`;
      if (nodeIds.has(nodeId) && nodeIds.has(target)) {
        addEdge(state, nodeId, target, "REFERENCES_IDEA");
      }
    }
  }
}

function relatedIdeaPairKey(source: string, target: string): string {
  return source.localeCompare(target) <= 0
    ? `${source}|${target}`
    : `${target}|${source}`;
}

function addRelatedIdeaEdges(
  repository: DomainRepository,
  state: GraphBuildState,
  nodeIds: ReadonlySet<string>,
): void {
  const relatedIdeaPairs = new Set<string>();
  for (const [ideaSlug, relatedSlugs] of repository.graph.edges.relatedIdea) {
    for (const relatedSlug of relatedSlugs) {
      const source = `idea:${ideaSlug}`;
      const target = `idea:${relatedSlug}`;
      if (nodeIds.has(source) && nodeIds.has(target)) {
        const pairKey = relatedIdeaPairKey(source, target);
        if (relatedIdeaPairs.has(pairKey)) continue;
        relatedIdeaPairs.add(pairKey);
        addEdge(state, source, target, "RELATED_IDEA");
      }
    }
  }
}

function addIdeaEdges(
  repository: DomainRepository,
  state: GraphBuildState,
): void {
  const nodeIds = new Set(state.nodes.map((node) => node.id));
  addIdeaReferenceEdges(repository, state, nodeIds);
  for (const [techSlug, ideaSlugs] of repository.graph.edges.technologyIdeas) {
    const source = `technology:${techSlug}`;
    for (const ideaSlug of ideaSlugs) {
      const target = `idea:${ideaSlug}`;
      if (nodeIds.has(source) && nodeIds.has(target)) {
        addEdge(state, source, target, "HAS_IDEA");
      }
    }
  }
  addRelatedIdeaEdges(repository, state, nodeIds);
}

function addRelationshipEdges(
  repository: DomainRepository,
  state: GraphBuildState,
): void {
  const nodeIds = new Set(state.nodes.map((node) => node.id));
  for (const [projectSlug, initiativeSlugs] of repository.graph.edges
    .contributesToInitiative) {
    for (const initiativeSlug of initiativeSlugs) {
      const source = `project:${projectSlug}`;
      const target = `initiative:${initiativeSlug}`;
      if (nodeIds.has(source) && nodeIds.has(target)) {
        addEdge(state, source, target, "CONTRIBUTES_TO_INITIATIVE");
      }
    }
  }
  addMappedEdges(
    state,
    repository.graph.edges.partOfProject,
    (ref) => `adr:${ref}`,
    (slug) => `project:${slug}`,
    "PART_OF_PROJECT",
  );
  addMappedEdges(
    state,
    repository.graph.edges.supersedes,
    (ref) => `adr:${ref}`,
    (ref) => `adr:${ref}`,
    "SUPERSEDES",
  );
  addMappedEdges(
    state,
    repository.graph.edges.inheritsFrom,
    (ref) => `adr:${ref}`,
    (ref) => `adr:${ref}`,
    "INHERITS_FROM",
  );
  addMappedEdges(
    state,
    repository.graph.edges.createdAtRole,
    (slug) => `project:${slug}`,
    (slug) => `role:${slug}`,
    "CREATED_AT_ROLE",
  );
  addMappedEdges(
    state,
    repository.graph.edges.writtenAtRole,
    (slug) => `blog:${slug}`,
    (slug) => `role:${slug}`,
    "WRITTEN_AT_ROLE",
  );

  addIdeaEdges(repository, state);
}

function addPlatformLayerOwnershipEdges(
  repository: DomainRepository,
  state: GraphBuildState,
): void {
  const manifest = repository.platform?.manifest;
  if (!manifest) return;
  for (const layer of manifest.layers) {
    addEdge(
      state,
      `project:${manifest.project}`,
      `platform-layer:${layer.slug}`,
      "OWNS_LAYER",
    );
  }
}

function addPlatformPolicyEdges(
  repository: DomainRepository,
  state: GraphBuildState,
  instant: string,
): void {
  const manifest = repository.platform?.manifest;
  if (!manifest) return;
  for (const policy of manifest.policies) {
    if (!isEffectiveAt(policy, instant)) continue;
    const selections = manifest.selections.filter(
      (candidate) =>
        candidate.slot === policy.slot &&
        candidate.status === "Accepted" &&
        isEffectiveAt(candidate, instant),
    );
    for (const selection of selections) {
      addEdge(
        state,
        `platform-layer:${policy.layer}`,
        platformSelectionTarget(selection),
        platformSelectionEdgeType(selection, policy.mode),
        {
          layer: policy.layer,
          slot: policy.slot,
          policy: policy.id,
          selection: selection.id,
          decision: selection.decision,
          mode: policy.mode,
          status: selection.status,
          effectiveFrom: selection.effectiveFrom,
          effectiveUntil: selection.effectiveUntil,
        },
      );
    }
  }
}

function addPlatformOriginEdges(
  repository: DomainRepository,
  state: GraphBuildState,
): void {
  const manifest = repository.platform?.manifest;
  if (!manifest) return;
  const linkedProjects = new Set<string>();
  for (const selection of manifest.selections) {
    for (const project of selection.originProjects) {
      const edgeKey = `${selection.decision}:${project}`;
      if (linkedProjects.has(edgeKey)) continue;
      linkedProjects.add(edgeKey);
      addEdge(
        state,
        `adr:${selection.decision}`,
        `project:${project}`,
        "DRIVEN_BY",
      );
    }
  }
}

function addProjectPlatformLayerEdges(
  repository: DomainRepository,
  state: GraphBuildState,
  instant: string,
): void {
  if (!repository.platform) return;
  for (const project of repository.platform.projectLayerUses.keys()) {
    const stack = resolveEffectiveProjectStack(repository, project, instant);
    for (const layer of stack.layers) {
      const use = repository.platform.projectLayerUses
        .get(project)
        ?.find(
          (candidate) =>
            candidate.layer === layer && isUseEffectiveAt(candidate, stack.at),
        );
      addEdge(
        state,
        `project:${project}`,
        `platform-layer:${layer}`,
        "USES_PLATFORM_LAYER",
        use
          ? {
              layer,
              adopted: use.adopted,
              until: use.until,
              tracking: use.tracking,
            }
          : { layer },
      );
    }
  }
}

function addPlatformEdges(
  repository: DomainRepository,
  state: GraphBuildState,
  instant: string,
): void {
  addPlatformLayerOwnershipEdges(repository, state);
  addPlatformPolicyEdges(repository, state, instant);
  addPlatformOriginEdges(repository, state);
  addProjectPlatformLayerEdges(repository, state, instant);
}

function addTagEdges(
  repository: DomainRepository,
  state: GraphBuildState,
): void {
  for (const [nodeId, tags] of repository.graph.edges.hasTag) {
    for (const tag of tags) {
      addEdge(state, nodeId, `tag:${tag}`, "HAS_TAG");
    }
  }
}

export function extractGraphData(
  repository: DomainRepository,
  instant = new Date().toISOString(),
): GraphData {
  const state: GraphBuildState = {
    nodes: [],
    edges: [],
    connectionCounts: new Map(),
  };
  addContentNodes(repository, state);
  addResearchPaperNodes(repository, state);
  addAdrNodes(repository, state);
  addPlatformNodes(repository, state, instant);
  const connectedTechs = addTechnologyAndTagNodes(repository, state);
  addTechnologyEdges(repository, state, connectedTechs);
  addRelationshipEdges(repository, state);
  addPlatformEdges(repository, state, instant);
  addTagEdges(repository, state);

  for (const node of state.nodes) {
    node.connections = state.connectionCounts.get(node.id) ?? 0;
  }
  return { nodes: state.nodes, edges: state.edges };
}
