import {
  type DomainRepository,
  getADRCountForProject,
  getADRSlugsForProject,
  getContentUsingTechnologyByType,
  getProjectsForRole,
  getRoleForProject,
  getTagsForProject,
  getTechnologiesForProject,
} from "@/lib/repository";
import { parseADRRef } from "../adr/adr";
import { getADRsForProject } from "../adr/adrQueries";
import {
  compareUtcInstants,
  getSelectionLifecycleStatus,
  isUseEffectiveAt,
  type LayerSlug,
} from "../platform/platform";
import {
  type EffectiveProjectStack,
  resolveEffectiveProjectStack,
} from "../platform/platformQueries";
import type { RoleSlug } from "../role/jobRole";
import type { RoleListItemView } from "../role/roleViews";
import { toRoleListItemView } from "../role/roleViews";
import { resolveTechnologiesToBadgeViews } from "../technology/technologyViews";
import type { ProjectSlug } from "./project";
import {
  type ProjectCardView,
  type ProjectDetailView,
  type ProjectListItemView,
  type ProjectWithADRsView,
  toProjectCardView,
  toProjectDetailView,
  toProjectListItemView,
} from "./projectViews";

function getRoleView(
  repository: DomainRepository,
  slug: ProjectSlug,
): RoleListItemView | undefined {
  const roleSlug = getRoleForProject(repository.graph, slug);
  const role = roleSlug ? repository.roles.get(roleSlug) : undefined;
  return role ? toRoleListItemView(role) : undefined;
}

export function getProjectCard(
  repository: DomainRepository,
  slug: ProjectSlug,
): ProjectCardView | null {
  const project = repository.projects.get(slug);
  if (!project) return null;

  const technologySlugs = getTechnologiesForProject(repository.graph, slug);
  const technologies = resolveTechnologiesToBadgeViews(repository, [
    ...technologySlugs,
  ]);
  const adrCount = getADRCountForProject(repository.graph, slug);
  const role = getRoleView(repository, slug);
  const tags = Array.from(getTagsForProject(repository.graph, slug));

  return toProjectCardView(project, technologies, adrCount, role, tags);
}

export function getProjectDetail(
  repository: DomainRepository,
  slug: ProjectSlug,
): ProjectDetailView | null {
  const project = repository.projects.get(slug);
  if (!project) return null;

  const technologySlugs = getTechnologiesForProject(repository.graph, slug);
  const technologies = resolveTechnologiesToBadgeViews(repository, [
    ...technologySlugs,
  ]);
  const adrSlugs = getADRSlugsForProject(repository.graph, slug);
  const role = getRoleView(repository, slug);
  const tags = Array.from(getTagsForProject(repository.graph, slug));

  return toProjectDetailView(
    project,
    technologies,
    adrSlugs.map((adrRef) => parseADRRef(adrRef).adrSlug),
    role,
    tags,
  );
}

export function getProjectListItem(
  repository: DomainRepository,
  slug: ProjectSlug,
): ProjectListItemView | null {
  const project = repository.projects.get(slug);
  if (!project) return null;
  return toProjectListItemView(project);
}

export function getAllProjectCards(
  repository: DomainRepository,
): ProjectCardView[] {
  return Array.from(repository.projects.values()).map((project) => {
    const technologySlugs = getTechnologiesForProject(
      repository.graph,
      project.slug,
    );
    const technologies = resolveTechnologiesToBadgeViews(repository, [
      ...technologySlugs,
    ]);
    const adrCount = getADRCountForProject(repository.graph, project.slug);
    const role = getRoleView(repository, project.slug);
    const tags = Array.from(getTagsForProject(repository.graph, project.slug));

    return toProjectCardView(project, technologies, adrCount, role, tags);
  });
}

export function getAllProjectListItems(
  repository: DomainRepository,
): ProjectListItemView[] {
  return Array.from(repository.projects.values()).map(toProjectListItemView);
}

export function getProjectsUsingTechnology(
  repository: DomainRepository,
  technologySlug: string,
): ProjectCardView[] {
  const { projects: projectSlugs } = getContentUsingTechnologyByType(
    repository.graph,
    technologySlug,
  );

  const matchingSlugs = new Set(projectSlugs);
  for (const project of repository.projects.keys()) {
    const stack = resolveEffectiveProjectStack(repository, project);
    if (
      stack.technologies.some(
        (use) =>
          use.source !== "project-specific" &&
          use.technology === technologySlug,
      )
    ) {
      matchingSlugs.add(project);
    }
  }

  return Array.from(matchingSlugs)
    .map((slug) => repository.projects.get(slug))
    .filter(
      (project): project is NonNullable<typeof project> =>
        project !== undefined,
    )
    .map((project) => {
      const techSlugs = getTechnologiesForProject(
        repository.graph,
        project.slug,
      );
      const technologies = resolveTechnologiesToBadgeViews(repository, [
        ...techSlugs,
      ]);
      const adrCount = getADRCountForProject(repository.graph, project.slug);
      const role = getRoleView(repository, project.slug);
      const tags = Array.from(
        getTagsForProject(repository.graph, project.slug),
      );

      return toProjectCardView(project, technologies, adrCount, role, tags);
    });
}

export function getBuildingPhilosophy(repository: DomainRepository): string {
  return repository.buildingPhilosophy;
}

export function getProjectWithADRs(
  repository: DomainRepository,
  slug: ProjectSlug,
): ProjectWithADRsView | null {
  const project = repository.projects.get(slug);
  if (!project) return null;

  const projectTechSlugs = getTechnologiesForProject(repository.graph, slug);
  const projectTechnologies = resolveTechnologiesToBadgeViews(repository, [
    ...projectTechSlugs,
  ]);

  const adrs = getADRsForProject(repository, slug);

  const adrTechnologies = adrs
    .filter((adr) => adr.status === "Accepted")
    .flatMap((adr) => adr.technologies);

  const seenSlugs = new Set<string>();
  const mergedTechnologies = [
    ...projectTechnologies,
    ...adrTechnologies,
  ].filter((tech) => {
    if (seenSlugs.has(tech.slug)) return false;
    seenSlugs.add(tech.slug);
    return true;
  });

  const adrSlugs = getADRSlugsForProject(repository.graph, slug);
  const role = getRoleView(repository, slug);
  const tags = Array.from(getTagsForProject(repository.graph, slug));
  const manifest = repository.platform.manifest;
  const stack = resolveEffectiveProjectStack(repository, slug);
  const layerUses = repository.platform.projectLayerUses.get(slug) ?? [];
  const builtOn = stack.layers.map((layerSlug) => {
    const explicitUse = layerUses.find(
      (use) => use.layer === layerSlug && isUseEffectiveAt(use, stack.at),
    );
    const activatedUse = explicitUse
      ? undefined
      : getActivatedLayerTechnologyUse(repository, stack, layerSlug);
    return {
      slug: layerSlug,
      title:
        manifest?.layers.find((layer) => layer.slug === layerSlug)?.title ??
        layerSlug,
      adopted:
        explicitUse?.adopted ??
        getActivatedLayerAdoptionInstant(repository, stack, layerSlug),
      until: explicitUse?.until,
      tracking: explicitUse?.tracking ?? true,
      decision: explicitUse?.decision ?? activatedUse?.adoptionDecision,
      rationale: explicitUse?.rationale ?? activatedUse?.adoptionRationale,
    };
  });
  const seenPlatformTechnologies = new Set<string>();
  const platformTechnologies = stack.technologies
    .filter(
      (
        use,
      ): use is typeof use & {
        source: Exclude<typeof use.source, "project-specific">;
      } => use.source !== "project-specific",
    )
    .flatMap((use) => {
      if (seenPlatformTechnologies.has(use.technology)) return [];
      const [technology] = resolveTechnologiesToBadgeViews(repository, [
        use.technology,
      ]);
      if (technology) seenPlatformTechnologies.add(use.technology);
      return technology
        ? [
            {
              ...technology,
              source: use.source,
              layer: use.layer,
              slot: use.slot,
              decision: use.decision,
              policyDecision: use.policyDecision,
              originProjects: use.originProjects,
              evidenceADRs: use.evidenceADRs,
              adoptionDecision: use.adoptionDecision,
              adoptionRationale: use.adoptionRationale,
            },
          ]
        : [];
    });
  const platformPolicies = stack.policies.map((use) => ({
    value: use.value,
    source: use.source,
    layer: use.layer,
    slot: use.slot,
    decision: use.decision,
    policyDecision: use.policyDecision,
    originProjects: use.originProjects,
    evidenceADRs: use.evidenceADRs,
    adoptionDecision: use.adoptionDecision,
    adoptionRationale: use.adoptionRationale,
  }));
  const platformManifest =
    manifest?.project === slug
      ? {
          layers: manifest.layers,
          policies: manifest.policies,
          slots: manifest.slots.map((slot) => ({
            ...slot,
            selections: manifest.selections
              .filter((selection) => selection.slot === slot.slug)
              .map((selection) => ({
                ...selection,
                lifecycleStatus: getSelectionLifecycleStatus(
                  manifest,
                  selection,
                ),
              })),
            users: Array.from(
              new Set(
                manifest.policies
                  .filter((policy) => policy.slot === slot.slug)
                  .flatMap((policy) =>
                    Array.from(
                      repository.graph.reverse.layerUsers.get(policy.layer) ??
                        [],
                    ),
                  ),
              ),
            ),
            overrides: Array.from(
              repository.graph.reverse.slotOverrides.get(slot.slug) ?? [],
            ),
          })),
        }
      : undefined;

  return {
    slug: project.slug,
    title: project.title,
    description: project.description,
    date: project.date,
    updated: project.updated,
    status: project.status,
    repoUrl: project.repoUrl,
    demoUrl: project.demoUrl,
    productUrl: project.productUrl,
    paperUrl: project.paperUrl,
    paperTitle: project.paperTitle,
    pitch: project.pitch,
    content: project.content,
    technologies: mergedTechnologies,
    adrSlugs: adrSlugs.map((adrRef) => parseADRRef(adrRef).adrSlug),
    adrs,
    role,
    tags,
    builtOn,
    platformTechnologies,
    platformPolicies,
    platformManifest,
  };
}

function getActivatedLayerTechnologyUse(
  repository: DomainRepository,
  stack: EffectiveProjectStack,
  layerSlug: LayerSlug,
) {
  const manifest = repository.platform.manifest;
  const activation = manifest?.layers.find(
    (layer) => layer.slug === layerSlug,
  )?.activatedBy;
  const technologyUse = activation
    ? stack.technologies.find(
        (use) =>
          use.slot === activation.slot &&
          use.technology === activation.technology,
      )
    : undefined;
  if (!manifest || !technologyUse) {
    throw new Error(
      `Cannot derive adoption time for platform layer '${layerSlug}'`,
    );
  }
  return technologyUse;
}

function getActivatedLayerAdoptionInstant(
  repository: DomainRepository,
  stack: EffectiveProjectStack,
  layerSlug: LayerSlug,
): string {
  const manifest = repository.platform.manifest;
  if (!manifest) {
    throw new Error("Cannot derive adoption time without a platform manifest");
  }
  const technologyUse = getActivatedLayerTechnologyUse(
    repository,
    stack,
    layerSlug,
  );
  const selection = manifest.selections.find(
    (candidate) => candidate.id === technologyUse.selection,
  );
  const override = technologyUse.decision
    ? repository.platform.adrOverrides.get(technologyUse.decision)
    : undefined;
  const policy = manifest.policies.find(
    (candidate) => candidate.id === technologyUse.policy,
  );
  const dates = [
    selection?.effectiveFrom,
    override?.adopted,
    policy?.effectiveFrom,
    policy
      ? repository.platform.projectLayerUses
          .get(stack.project)
          ?.find(
            (use) =>
              use.layer === policy.layer && isUseEffectiveAt(use, stack.at),
          )?.adopted
      : undefined,
  ].filter((date): date is string => date !== undefined);
  const adopted = dates.toSorted(compareUtcInstants).at(-1);
  if (!adopted) {
    throw new Error(
      `Cannot derive adoption time for platform layer '${layerSlug}'`,
    );
  }
  return adopted;
}

export function getRoleProjects(
  repository: DomainRepository,
  roleSlug: RoleSlug,
): ProjectListItemView[] {
  const projectSlugs = getProjectsForRole(repository.graph, roleSlug);

  return Array.from(projectSlugs)
    .map((slug) => repository.projects.get(slug))
    .filter(
      (project): project is NonNullable<typeof project> =>
        project !== undefined,
    )
    .map(toProjectListItemView);
}
