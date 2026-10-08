import { z } from "zod";

export const TechnologySlugSchema = z.string().min(1);
export type TechnologySlug = z.infer<typeof TechnologySlugSchema>;

export const BlogSlugSchema = z.string().min(1);
export type BlogSlug = z.infer<typeof BlogSlugSchema>;

export const ADRSlugSchema = z.string().min(1);
export type ADRSlug = z.infer<typeof ADRSlugSchema>;

export const ADRRefSchema = z.string().regex(/^[^:]+:[^:]+$/);
export type ADRRef = z.infer<typeof ADRRefSchema>;

export const ProductDecisionSlugSchema = z
  .string()
  .regex(/^\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*$/);
export type ProductDecisionSlug = z.infer<typeof ProductDecisionSlugSchema>;

export const ProjectSlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export type ProjectSlug = z.infer<typeof ProjectSlugSchema>;

export const InitiativeSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export type InitiativeSlug = z.infer<typeof InitiativeSlugSchema>;

export const RoleSlugSchema = z.string().min(1);
export type RoleSlug = z.infer<typeof RoleSlugSchema>;

export const IdeaSlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export type IdeaSlug = z.infer<typeof IdeaSlugSchema>;
