import { z } from "zod";
import { DefaultOverrideSchema } from "../platform/platform";
import type { ADRRef, ADRSlug, ProjectSlug } from "../slugs";
import {
  ADRRefSchema,
  ADRSlugSchema,
  IdeaSlugSchema,
  ProjectSlugSchema,
  TechnologySlugSchema,
} from "../slugs";

export type { ADRRef, ADRSlug };

export const ADRStatusSchema = z.enum([
  "Accepted",
  "Rejected",
  "Deprecated",
  "Proposed",
]);
export type ADRStatus = z.infer<typeof ADRStatusSchema>;

export const ADR_STATUSES = ADRStatusSchema.options;

export const ADR_STATUS_CONFIG: Record<
  ADRStatus,
  { label: string; color: string; badgeClass: string }
> = {
  Accepted: {
    label: "Accepted",
    color: "text-green-500",
    badgeClass: "bg-green-600 text-white hover:bg-green-700 border-transparent",
  },
  Rejected: {
    label: "Rejected",
    color: "text-red-500",
    badgeClass: "bg-red-600 text-white hover:bg-red-700 border-transparent",
  },
  Deprecated: {
    label: "Deprecated",
    color: "text-amber-600",
    badgeClass: "bg-amber-600 text-white hover:bg-amber-700 border-transparent",
  },
  Proposed: {
    label: "Proposed",
    color: "text-blue-600",
    badgeClass: "bg-blue-600 text-white hover:bg-blue-700 border-transparent",
  },
};

export const ADRSchema = z.object({
  adrRef: ADRRefSchema,
  slug: ADRSlugSchema,
  projectSlug: ProjectSlugSchema,
  title: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: ADRStatusSchema,
  inheritsFrom: ADRRefSchema.optional(),
  supersedes: ADRRefSchema.optional(),
  overridesDefault: DefaultOverrideSchema.optional(),
  content: z.string(),
  readingTime: z.string(),
});

export type ADR = z.infer<typeof ADRSchema>;

export const ADRRelationsSchema = z.object({
  project: ProjectSlugSchema,
  technologies: z.array(TechnologySlugSchema).default([]),
  ideas: z.array(IdeaSlugSchema).default([]),
});

export type ADRRelations = z.infer<typeof ADRRelationsSchema>;

export function makeADRRef(projectSlug: ProjectSlug, adrSlug: ADRSlug): ADRRef {
  return `${projectSlug}:${adrSlug}`;
}

export function formatADRIndex(index: number): string {
  return String(Math.max(0, index)).padStart(3, "0");
}

export function formatADRSlugIndex(slug: string): string {
  const prefix = /^\d+/.exec(slug)?.[0];
  return prefix ? formatADRIndex(Number.parseInt(prefix, 10)) : "---";
}

export function normalizeADRTitle(title: string): string {
  return title.replace(/^ADR\s+\d+\s*:\s*/i, "");
}

export function parseADRRef(adrRef: ADRRef): {
  projectSlug: ProjectSlug;
  adrSlug: ADRSlug;
} {
  const separatorIndex = adrRef.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === adrRef.length - 1) {
    throw new Error(`Invalid ADRRef format: '${adrRef}'`);
  }
  if (adrRef.indexOf(":", separatorIndex + 1) !== -1) {
    throw new Error(`Invalid ADRRef format: '${adrRef}'`);
  }

  const projectSlug = adrRef.slice(0, separatorIndex);
  const adrSlug = adrRef.slice(separatorIndex + 1);
  return {
    projectSlug: projectSlug as ProjectSlug,
    adrSlug: adrSlug as ADRSlug,
  };
}
