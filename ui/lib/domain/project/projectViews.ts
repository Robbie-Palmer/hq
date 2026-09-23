import type { ADRCardView } from "../adr/adrViews";
import type {
  DefaultSelection,
  DefaultSlot,
  LayerSlotPolicy,
  LayerSlug,
  PlatformLayer,
} from "../platform/platform";
import type {
  EffectivePolicySource,
  EffectiveTechnologySource,
} from "../platform/platformQueries";
import type { RoleListItemView } from "../role/roleViews";
import type { TechnologyBadgeView } from "../technology/technologyViews";
import type { PitchDeck } from "./pitchDeck";
import type { Project, ProjectStatus } from "./project";

export type ProjectCardView = {
  slug: string;
  title: string;
  description: string;
  date: string;
  updated?: string;
  status: ProjectStatus;
  repoUrl?: string;
  demoUrl?: string;
  productUrl?: string;
  paperUrl?: string;
  paperTitle?: string;
  technologies: TechnologyBadgeView[];
  adrCount: number;
  role?: RoleListItemView;
  tags: string[];
};

export type ProjectDetailView = {
  slug: string;
  title: string;
  description: string;
  date: string;
  updated?: string;
  status: ProjectStatus;
  repoUrl?: string;
  demoUrl?: string;
  productUrl?: string;
  paperUrl?: string;
  paperTitle?: string;
  pitch?: PitchDeck;
  content: string;
  technologies: TechnologyBadgeView[];
  adrSlugs: string[];
  role?: RoleListItemView;
  tags: string[];
};

export type ProjectListItemView = {
  slug: string;
  title: string;
  status: ProjectStatus;
};

export type ProjectWithADRsView = {
  slug: string;
  title: string;
  description: string;
  date: string;
  updated?: string;
  status: ProjectStatus;
  repoUrl?: string;
  demoUrl?: string;
  productUrl?: string;
  paperUrl?: string;
  paperTitle?: string;
  pitch?: PitchDeck;
  content: string;
  technologies: TechnologyBadgeView[];
  adrSlugs: string[];
  adrs: ADRCardView[];
  role?: RoleListItemView;
  tags: string[];
  builtOn?: Array<{
    slug: LayerSlug;
    title: string;
    adopted: string;
    until?: string;
    tracking: boolean;
    decision?: string;
    rationale?: string;
  }>;
  platformTechnologies?: Array<
    TechnologyBadgeView & {
      source: Exclude<EffectiveTechnologySource, "project-specific">;
      layer?: LayerSlug;
      slot?: string;
      decision?: string;
      policyDecision?: string;
      originProjects?: string[];
      evidenceADRs?: string[];
      adoptionDecision?: string;
      adoptionRationale?: string;
    }
  >;
  platformPolicies?: Array<{
    value: string;
    source: EffectivePolicySource;
    layer?: LayerSlug;
    slot?: string;
    decision?: string;
    policyDecision?: string;
    originProjects?: string[];
    evidenceADRs?: string[];
    adoptionDecision?: string;
    adoptionRationale?: string;
  }>;
  platformManifest?: {
    layers: PlatformLayer[];
    policies: LayerSlotPolicy[];
    slots: Array<
      DefaultSlot & {
        selections: Array<
          DefaultSelection & {
            lifecycleStatus: DefaultSelection["status"] | "Superseded";
          }
        >;
        users: string[];
        overrides: string[];
      }
    >;
  };
};

export function toProjectCardView(
  project: Project,
  technologies: TechnologyBadgeView[],
  adrCount: number,
  role: RoleListItemView | undefined,
  tags: string[],
): ProjectCardView {
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
    technologies,
    adrCount,
    role,
    tags,
  };
}

export function toProjectDetailView(
  project: Project,
  technologies: TechnologyBadgeView[],
  adrSlugs: string[],
  role: RoleListItemView | undefined,
  tags: string[],
): ProjectDetailView {
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
    technologies,
    adrSlugs,
    role,
    tags,
  };
}

export function toProjectListItemView(project: Project): ProjectListItemView {
  return {
    slug: project.slug,
    title: project.title,
    status: project.status,
  };
}
