import type { DomainRepository } from "@/lib/repository";
import { makeNodeId } from "@/lib/repository/graph";
import type { ADRRef } from "../adr/adr";
import type { ProjectSlug } from "../project/project";
import type { TechnologySlug } from "../technology/technology";
import {
  compareUtcInstants,
  type DefaultSelection,
  type DefaultSlotSlug,
  isEffectiveAt,
  isUseEffectiveAt,
  type LayerSlotPolicy,
  type LayerSlug,
  type PlatformManifest,
  type ProjectLayerUse,
  previousUtcInstant,
} from "./platform";

export type EffectiveTechnologySource =
  | "project-specific"
  | "required-layer"
  | "preferred-layer"
  | "override";

export type EffectivePolicySource = Exclude<
  EffectiveTechnologySource,
  "project-specific"
>;

interface EffectiveDefaultUseBase {
  kind: "technology" | "policy";
  source: EffectiveTechnologySource;
  layer?: LayerSlug;
  slot?: DefaultSlotSlug;
  policy?: string;
  selection?: string;
  decision?: ADRRef;
  policyDecision?: ADRRef;
  originProjects?: ProjectSlug[];
  evidenceADRs?: ADRRef[];
  adoptionDecision?: ADRRef;
  adoptionRationale?: string;
}

export interface EffectiveTechnologyUse extends EffectiveDefaultUseBase {
  kind: "technology";
  technology: TechnologySlug;
}

export interface EffectivePolicyUse extends EffectiveDefaultUseBase {
  kind: "policy";
  source: EffectivePolicySource;
  value: string;
}

export interface EffectiveProjectStack {
  project: ProjectSlug;
  at: string;
  layers: LayerSlug[];
  technologies: EffectiveTechnologyUse[];
  policies: EffectivePolicyUse[];
}

function resolutionInstant(
  projectUses: ProjectLayerUse[],
  requested: string,
): string {
  if (projectUses.some((use) => use.tracking)) return requested;
  const closedAt = projectUses
    .filter((use) => !use.tracking && use.until)
    .map((use) => use.until as string)
    .toSorted(compareUtcInstants)
    .at(-1);
  if (!closedAt || compareUtcInstants(requested, closedAt) < 0)
    return requested;
  return previousUtcInstant(closedAt);
}

function currentSelections(
  manifest: PlatformManifest,
  slot: DefaultSlotSlug,
  instant: string,
): DefaultSelection[] {
  return manifest.selections.filter(
    (selection) =>
      selection.slot === slot &&
      selection.status === "Accepted" &&
      isEffectiveAt(selection, instant),
  );
}

function prerequisitesMet(
  prerequisites: { slot: DefaultSlotSlug; technology?: TechnologySlug }[],
  resolvedSlots: ReadonlyMap<DefaultSlotSlug, ReadonlySet<string>>,
): boolean {
  return prerequisites.every((prerequisite) => {
    const selected = resolvedSlots.get(prerequisite.slot);
    return (
      selected !== undefined &&
      (prerequisite.technology === undefined ||
        selected.has(prerequisite.technology))
    );
  });
}

type ProjectOverride =
  | { kind: "technology"; technology: TechnologySlug; decision: ADRRef }
  | { kind: "policy"; value: string; decision: ADRRef };

function getProjectOverrides(
  repository: DomainRepository,
  projectSlug: ProjectSlug,
  instant: string,
): Map<DefaultSlotSlug, ProjectOverride[]> {
  const overrides = new Map<DefaultSlotSlug, ProjectOverride[]>();
  for (const [adrRef, override] of repository.platform.adrOverrides) {
    const adr = repository.adrs.get(adrRef);
    if (
      adr?.projectSlug === projectSlug &&
      adr.status === "Accepted" &&
      isUseEffectiveAt(override, instant)
    ) {
      const resolvedOverride: ProjectOverride =
        override.kind === "technology"
          ? {
              kind: "technology",
              technology: override.technology,
              decision: adrRef,
            }
          : { kind: "policy", value: override.value, decision: adrRef };
      const slot = repository.platform.manifest?.slots.find(
        (candidate) => candidate.slug === override.slot,
      );
      overrides.set(
        override.slot,
        slot?.cardinality === "many"
          ? [...(overrides.get(override.slot) ?? []), resolvedOverride]
          : [resolvedOverride],
      );
    }
  }
  return overrides;
}

interface ResolutionState {
  manifest: PlatformManifest;
  instant: string;
  effectiveUses: ProjectLayerUse[];
  layers: Set<LayerSlug>;
  overrides: ReadonlyMap<DefaultSlotSlug, readonly ProjectOverride[]>;
  resolvedSlots: Map<DefaultSlotSlug, Set<string>>;
  technologies: EffectiveTechnologyUse[];
  policies: EffectivePolicyUse[];
}

function hasPreferredSlotUse(
  policy: LayerSlotPolicy,
  effectiveUses: ProjectLayerUse[],
  instant: string,
): boolean {
  return effectiveUses
    .flatMap((use) => use.slots)
    .some((use) => use.slot === policy.slot && isUseEffectiveAt(use, instant));
}

function getAdoptionProvenance(
  policy: LayerSlotPolicy,
  effectiveUses: ProjectLayerUse[],
  instant: string,
): Pick<EffectiveDefaultUseBase, "adoptionDecision" | "adoptionRationale"> {
  const layerUse = effectiveUses.find(
    (use) => use.layer === policy.layer && isUseEffectiveAt(use, instant),
  );
  const slotUse =
    policy.mode === "preferred"
      ? layerUse?.slots.find(
          (use) => use.slot === policy.slot && isUseEffectiveAt(use, instant),
        )
      : undefined;
  const adoption = slotUse ?? layerUse;
  return {
    adoptionDecision: adoption?.decision,
    adoptionRationale: adoption?.rationale,
  };
}

function defaultSource(
  policy: LayerSlotPolicy,
  hasOverride: boolean,
): EffectivePolicySource {
  if (hasOverride) return "override";
  return policy.mode === "required" ? "required-layer" : "preferred-layer";
}

function resolvePolicy(
  policy: LayerSlotPolicy,
  state: ResolutionState,
): Array<EffectiveTechnologyUse | EffectivePolicyUse> {
  if (!state.layers.has(policy.layer) || !isEffectiveAt(policy, state.instant))
    return [];
  if (
    policy.mode === "preferred" &&
    !hasPreferredSlotUse(policy, state.effectiveUses, state.instant)
  )
    return [];
  if (!prerequisitesMet(policy.prerequisites, state.resolvedSlots)) return [];

  const overrides = state.overrides.get(policy.slot) ?? [];
  const candidates =
    overrides.length > 0
      ? overrides.map((override) =>
          override.kind === "technology"
            ? {
                kind: "technology" as const,
                technology: override.technology,
                value: override.technology,
                decision: override.decision,
              }
            : {
                kind: "policy" as const,
                value: override.value,
                decision: override.decision,
              },
        )
      : currentSelections(state.manifest, policy.slot, state.instant).map(
          (selection) =>
            selection.kind === "technology"
              ? {
                  kind: "technology" as const,
                  technology: selection.technology,
                  value: selection.technology,
                  decision: selection.decision,
                  selection: selection.id,
                  originProjects: selection.originProjects,
                  evidenceADRs: selection.evidenceADRs,
                }
              : {
                  kind: "policy" as const,
                  value: selection.value,
                  decision: selection.decision,
                  selection: selection.id,
                  originProjects: selection.originProjects,
                  evidenceADRs: selection.evidenceADRs,
                },
        );
  const resolved = state.resolvedSlots.get(policy.slot);
  const candidateValues = new Set<string>();
  const adoption = getAdoptionProvenance(
    policy,
    state.effectiveUses,
    state.instant,
  );
  return candidates
    .filter((candidate) => {
      if (
        resolved?.has(candidate.value) ||
        candidateValues.has(candidate.value)
      )
        return false;
      candidateValues.add(candidate.value);
      return true;
    })
    .map((candidate) => ({
      ...candidate,
      source: defaultSource(policy, overrides.length > 0),
      layer: policy.layer,
      slot: policy.slot,
      policy: policy.id,
      policyDecision: policy.decision,
      ...adoption,
    }));
}

function activateDependentLayers(
  policy: LayerSlotPolicy,
  technology: TechnologySlug,
  state: ResolutionState,
): void {
  for (const layer of state.manifest.layers) {
    if (
      layer.activatedBy?.slot === policy.slot &&
      layer.activatedBy.technology === technology
    ) {
      state.layers.add(layer.slug);
    }
  }
}

function applyResolutionPass(state: ResolutionState): boolean {
  let resolvedAny = false;
  for (const policy of state.manifest.policies) {
    for (const use of resolvePolicy(policy, state)) {
      const values = state.resolvedSlots.get(policy.slot) ?? new Set<string>();
      values.add(use.kind === "technology" ? use.technology : use.value);
      state.resolvedSlots.set(policy.slot, values);
      if (use.kind === "technology") {
        state.technologies.push(use);
        activateDependentLayers(policy, use.technology, state);
      } else {
        state.policies.push(use);
      }
      resolvedAny = true;
    }
  }
  return resolvedAny;
}

export function resolveEffectiveProjectStack(
  repository: DomainRepository,
  projectSlug: ProjectSlug,
  requestedInstant = new Date().toISOString(),
): EffectiveProjectStack {
  const direct = repository.graph.edges.usesTechnology.get(
    makeNodeId("project", projectSlug),
  );
  const projectUses =
    repository.platform.projectLayerUses.get(projectSlug) ?? [];
  const instant = resolutionInstant(projectUses, requestedInstant);
  const technologies: EffectiveTechnologyUse[] = Array.from(direct ?? []).map(
    (technology) => ({
      kind: "technology",
      technology,
      source: "project-specific",
    }),
  );
  const policies: EffectivePolicyUse[] = [];
  const manifest = repository.platform.manifest;
  if (!manifest) {
    return {
      project: projectSlug,
      at: instant,
      layers: [],
      technologies,
      policies,
    };
  }

  const layers = new Set<LayerSlug>();
  const effectiveUses = projectUses.filter((use) =>
    isUseEffectiveAt(use, instant),
  );
  for (const use of effectiveUses) {
    layers.add(use.layer);
  }

  const overrides = getProjectOverrides(repository, projectSlug, instant);
  const resolvedSlots = new Map<DefaultSlotSlug, Set<string>>();
  const state: ResolutionState = {
    manifest,
    instant,
    effectiveUses,
    layers,
    overrides,
    resolvedSlots,
    technologies,
    policies,
  };
  while (applyResolutionPass(state)) {
    // Resolve prerequisite chains until a pass adds no technologies.
  }

  return {
    project: projectSlug,
    at: instant,
    layers: Array.from(layers),
    technologies,
    policies,
  };
}

export interface UpgradeRecommendation {
  project: ProjectSlug;
  layer: LayerSlug;
  slot: DefaultSlotSlug;
  from: DefaultSelection;
  to: DefaultSelection;
  decidingADRs: ADRRef[];
}

interface UpgradeContext {
  repository: DomainRepository;
  layer: LayerSlug;
  replacement: DefaultSelection;
  previous: DefaultSelection;
  at: string;
  priorInstant: string;
}

function shouldRecommendUpgrade(
  context: UpgradeContext,
  project: ProjectSlug,
  uses: ProjectLayerUse[],
): boolean {
  const { repository, layer, replacement, previous, at, priorInstant } =
    context;
  const entity = repository.projects.get(project);
  if (!entity || entity.status === "completed") return false;
  if (repository.graph.edges.createdAtRole.has(project)) return false;
  if (!uses.some((use) => use.tracking && isUseEffectiveAt(use, at)))
    return false;
  const stack = resolveEffectiveProjectStack(repository, project, priorInstant);
  if (!stack.layers.includes(layer)) return false;
  const usesPrevious =
    previous.kind === "technology"
      ? stack.technologies.some(
          (use) =>
            use.slot === replacement.slot && use.selection === previous.id,
        )
      : stack.policies.some(
          (use) =>
            use.slot === replacement.slot && use.selection === previous.id,
        );
  if (!usesPrevious) return false;
  const hasOverride = Array.from(repository.platform.adrOverrides).some(
    ([adrRef, value]) => {
      const adr = repository.adrs.get(adrRef);
      return (
        adr?.projectSlug === project &&
        adr.status === "Accepted" &&
        value.slot === replacement.slot &&
        isUseEffectiveAt(value, at)
      );
    },
  );
  return !hasOverride;
}

export function getUpgradeRecommendations(
  repository: DomainRepository,
  replacement: DefaultSelection,
  at = replacement.effectiveFrom,
): UpgradeRecommendation[] {
  if (!replacement.supersedes) return [];
  const manifest = repository.platform.manifest;
  const previous = manifest?.selections.find(
    (selection) => selection.id === replacement.supersedes,
  );
  if (!manifest || !previous) return [];
  const policy = manifest.policies.find(
    (candidate) =>
      candidate.slot === replacement.slot && isEffectiveAt(candidate, at),
  );
  if (!policy) return [];

  const recommendations: UpgradeRecommendation[] = [];
  const priorInstant = previousUtcInstant(replacement.effectiveFrom);
  const context: UpgradeContext = {
    repository,
    layer: policy.layer,
    replacement,
    previous,
    at,
    priorInstant,
  };
  for (const [project, uses] of repository.platform.projectLayerUses) {
    if (!shouldRecommendUpgrade(context, project, uses)) continue;
    recommendations.push({
      project,
      layer: policy.layer,
      slot: replacement.slot,
      from: previous,
      to: replacement,
      decidingADRs: [previous.decision, replacement.decision],
    });
  }
  return recommendations;
}
