import { z } from "zod";
import type { BlogSlug } from "../slugs";
import {
  BlogSlugSchema,
  IdeaSlugSchema,
  ProductDecisionSlugSchema,
  RoleSlugSchema,
  TechnologySlugSchema,
} from "../slugs";

export type { BlogSlug };

export const BlogPostSchema = z.object({
  slug: BlogSlugSchema,
  title: z.string().min(1),
  description: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  updated: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  canonicalUrl: z.string().url().optional(),
  content: z.string(),
  readingTime: z.string(),
  image: z.string().regex(/^blog\/[a-z0-9_-]+-\d{4}-\d{2}-\d{2}$/),
  imageAlt: z.string().min(1),
});

export type BlogPost = z.infer<typeof BlogPostSchema>;

export const BlogRelationsSchema = z.object({
  technologies: z.array(TechnologySlugSchema).default([]),
  ideas: z.array(IdeaSlugSchema).default([]),
  tags: z.array(z.string()).default([]),
  role: RoleSlugSchema.optional(),
  productDecisions: z.array(ProductDecisionSlugSchema).default([]),
});

type ParsedBlogRelations = z.infer<typeof BlogRelationsSchema>;
export type BlogRelations = Omit<ParsedBlogRelations, "productDecisions"> & {
  productDecisions?: ParsedBlogRelations["productDecisions"];
};
