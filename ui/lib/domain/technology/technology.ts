import { z } from "zod";
import type { TechnologySlug } from "../slugs";
import { IdeaSlugSchema, TechnologySlugSchema } from "../slugs";

export type { TechnologySlug };

export const TechnologyTypeSchema = z.enum([
  "language",
  "platform",
  "library",
  "tool",
  "database",
]);

export type TechnologyType = z.infer<typeof TechnologyTypeSchema>;

export const TECHNOLOGY_TYPES = TechnologyTypeSchema.options;

export const TECHNOLOGY_TYPE_CONFIG: Record<
  TechnologyType,
  { label: string; color: string }
> = {
  language: {
    label: "Language",
    color: "text-blue-500",
  },
  platform: {
    label: "Platform",
    color: "text-green-500",
  },
  library: {
    label: "Library",
    color: "text-purple-500",
  },
  tool: {
    label: "Tool",
    color: "text-orange-500",
  },
  database: {
    label: "Database",
    color: "text-cyan-500",
  },
};

// Content definition schema (slug is optional, will be derived from name if not provided)
const TechnologyContentSchema = z.object({
  name: z.string().min(1),
  slug: TechnologySlugSchema.optional(),
  description: z.string().optional(),
  overview: z.string().optional(),
  website: z.url(),
  iconSlug: z.string().optional(), // Only when icon slug differs from what's derived from name
  type: TechnologyTypeSchema.optional(),
  // Date (YYYY-MM-DD) the technology was added to the catalogue.
  added: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "added must be in YYYY-MM-DD format")
    .optional(),
  ideas: z.array(IdeaSlugSchema).default([]),
});

export type TechnologyContent = z.input<typeof TechnologyContentSchema>;

// Runtime Technology type always has a slug
export type Technology = Omit<
  z.output<typeof TechnologyContentSchema>,
  "slug"
> & {
  slug: TechnologySlug;
};

export const TechnologySchema = TechnologyContentSchema;
