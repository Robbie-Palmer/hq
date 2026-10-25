import { z } from "zod";
import {
  IdeaSlugSchema,
  InitiativeSlugSchema,
  ProjectSlugSchema,
} from "../slugs";

export type { InitiativeSlug } from "../slugs";

export const InitiativeStatusSchema = z.enum(["idea", "active", "inactive"]);

export type InitiativeStatus = z.infer<typeof InitiativeStatusSchema>;

const InitiativeDateSchema = z.iso.date();

export const INITIATIVE_STATUS_CONFIG: Record<
  InitiativeStatus,
  { label: string; badgeClass: string }
> = {
  idea: {
    label: "Idea",
    badgeClass: "bg-blue-500 hover:bg-blue-600 border-transparent text-white",
  },
  active: {
    label: "Active",
    badgeClass: "bg-green-500 hover:bg-green-600 border-transparent text-white",
  },
  inactive: {
    label: "Inactive",
    badgeClass:
      "bg-muted hover:bg-muted/80 border-transparent text-muted-foreground",
  },
};

export const InitiativeSchema = z.object({
  slug: InitiativeSlugSchema,
  title: z.string().min(1),
  description: z.string().min(1),
  date: InitiativeDateSchema,
  updated: InitiativeDateSchema.optional(),
  status: InitiativeStatusSchema,
  projectContributions: z
    .record(ProjectSlugSchema, z.string().min(1))
    .default({}),
  content: z.string(),
});

export type Initiative = z.infer<typeof InitiativeSchema>;

export const InitiativeRelationsSchema = z.object({
  ideas: z.array(IdeaSlugSchema).default([]),
});

export type InitiativeRelations = z.infer<typeof InitiativeRelationsSchema>;
