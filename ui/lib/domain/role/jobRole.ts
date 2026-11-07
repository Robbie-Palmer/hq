import { z } from "zod";
import type { RoleSlug } from "../slugs";
import { RoleSlugSchema, TechnologySlugSchema } from "../slugs";

export type { RoleSlug };

export const PreviousTitleSchema = z.object({
  title: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}$/),
});

export type PreviousTitle = z.infer<typeof PreviousTitleSchema>;

export const JobRoleContentSchema = z.object({
  company: z.string().min(1),
  companyUrl: z.url(),
  logoPath: z.string().min(1),
  title: z.string().min(1),
  previousTitles: z.array(PreviousTitleSchema).optional(),
  location: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}$/),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  description: z.string().min(1),
  responsibilities: z.array(z.string()).min(1),
  technologies: z.array(z.string()).default([]),
});

export type JobRoleContent = z.infer<typeof JobRoleContentSchema>;

// Runtime JobRole type always has a slug and no technologies (those are in relations)
export const JobRoleSchema = z.object({
  slug: RoleSlugSchema,
  company: z.string().min(1),
  companyUrl: z.url(),
  logoPath: z.string().min(1),
  title: z.string().min(1),
  previousTitles: z.array(PreviousTitleSchema).optional(),
  location: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}$/),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  description: z.string().min(1),
  responsibilities: z.array(z.string()).min(1),
});

export type JobRole = z.infer<typeof JobRoleSchema>;

export const RoleRelationsSchema = z.object({
  technologies: z.array(TechnologySlugSchema).default([]),
});

export type RoleRelations = z.infer<typeof RoleRelationsSchema>;
