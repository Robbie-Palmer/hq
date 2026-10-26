import type { TechnologyBadgeView } from "../technology/technologyViews";
import type { ADR, ADRStatus } from "./adr";

export type ADRCardView = {
  adrRef: string;
  slug: string;
  title: string;
  date: string;
  status: ADRStatus;
  supersedes?: string;
  readingTime: string;
  projectSlug: string;
  originProjectSlug: string;
  originAdrSlug: string;
  isInherited: boolean;
  supersededInProject?: boolean;
  technologies: TechnologyBadgeView[];
};

export type ADRDetailView = {
  adrRef: string;
  slug: string;
  title: string;
  date: string;
  status: ADRStatus;
  supersedes?: string;
  content: string;
  readingTime: string;
  projectSlug: string;
  originProjectSlug: string;
  originAdrSlug: string;
  isInherited: boolean;
  inheritedSourceSummary?: string;
  inheritedProjectNotes?: string;
  supersededInProject?: boolean;
  technologies: TechnologyBadgeView[];
};

export type ADRListItemView = {
  slug: string;
  projectSlug: string;
  title: string;
  status: ADRStatus;
};

export function toADRCardView(
  adr: ADR,
  technologies: TechnologyBadgeView[],
  projectSlug: string,
  options?: {
    isInherited?: boolean;
    supersededInProject?: boolean;
    originProjectSlug?: string;
    originAdrSlug?: string;
  },
): ADRCardView {
  return {
    adrRef: adr.adrRef,
    slug: adr.slug,
    title: adr.title,
    date: adr.date,
    status: adr.status,
    supersedes: adr.supersedes,
    readingTime: adr.readingTime,
    projectSlug,
    originProjectSlug: options?.originProjectSlug ?? adr.projectSlug,
    originAdrSlug: options?.originAdrSlug ?? adr.slug,
    isInherited: options?.isInherited ?? false,
    supersededInProject: options?.supersededInProject,
    technologies,
  };
}

export function toADRDetailView(
  adr: ADR,
  technologies: TechnologyBadgeView[],
  projectSlug: string,
  options?: {
    isInherited?: boolean;
    supersededInProject?: boolean;
    originProjectSlug?: string;
    originAdrSlug?: string;
    inheritedSourceSummary?: string;
    inheritedProjectNotes?: string;
  },
): ADRDetailView {
  return {
    adrRef: adr.adrRef,
    slug: adr.slug,
    title: adr.title,
    date: adr.date,
    status: adr.status,
    supersedes: adr.supersedes,
    content: adr.content,
    readingTime: adr.readingTime,
    projectSlug,
    originProjectSlug: options?.originProjectSlug ?? adr.projectSlug,
    originAdrSlug: options?.originAdrSlug ?? adr.slug,
    isInherited: options?.isInherited ?? false,
    inheritedSourceSummary: options?.inheritedSourceSummary,
    inheritedProjectNotes: options?.inheritedProjectNotes,
    supersededInProject: options?.supersededInProject,
    technologies,
  };
}

export function toADRListItemView(adr: ADR): ADRListItemView {
  return {
    slug: adr.slug,
    projectSlug: adr.projectSlug,
    title: adr.title,
    status: adr.status,
  };
}
