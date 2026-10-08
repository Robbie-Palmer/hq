import { z } from "zod";
import {
  ADRRelationsSchema,
  ADRStatusSchema,
  ADRSchema as BaseADRSchema,
} from "./adr/adr";
import { IdeaSchema as BaseIdeaSchema, IdeaRelationsSchema } from "./idea/idea";
import { PreviousTitleSchema } from "./role/jobRole";
import { ADRRefSchema as CanonicalADRRefSchema, IdeaSlugSchema } from "./slugs";

export type { IdeaSlug } from "./slugs";
export { IdeaSlugSchema };

export const TechnologySlugSchema = z.string().min(1);
export const BlogSlugSchema = z.string().min(1);
export const ADRSlugSchema = z.string().min(1);
export const ADRRefSchema = CanonicalADRRefSchema;
export const ProjectSlugSchema = z.string().min(1);
export const InitiativeSlugSchema = z.string().min(1);
export const RoleSlugSchema = z.string().min(1);

export type TechnologySlug = z.infer<typeof TechnologySlugSchema>;
export type BlogSlug = z.infer<typeof BlogSlugSchema>;
export type ADRSlug = z.infer<typeof ADRSlugSchema>;
export type ADRRef = z.infer<typeof ADRRefSchema>;
export type ProjectSlug = z.infer<typeof ProjectSlugSchema>;
export type InitiativeSlug = z.infer<typeof InitiativeSlugSchema>;
export type RoleSlug = z.infer<typeof RoleSlugSchema>;

export const IdeaSchema = BaseIdeaSchema.extend({
  relations: IdeaRelationsSchema.default({ relatedIdeas: [] }),
});

export type Idea = z.infer<typeof IdeaSchema>;

export const TechnologySchema = z.object({
  name: z.string().min(1),
  slug: TechnologySlugSchema.optional(),
  description: z.string().optional(),
  website: z.string().url().optional(),
  iconSlug: z.string().optional(),

  relations: z
    .object({
      blogs: z.array(BlogSlugSchema).default([]),
      adrs: z.array(ADRRefSchema).default([]),
      projects: z.array(ProjectSlugSchema).default([]),
      roles: z.array(RoleSlugSchema).default([]),
      ideas: z.array(IdeaSlugSchema).default([]),
    })
    .default({
      blogs: [],
      adrs: [],
      projects: [],
      roles: [],
      ideas: [],
    }),
});

export type Technology = z.infer<typeof TechnologySchema>;

export const BlogPostSchema = z.object({
  slug: BlogSlugSchema,
  title: z.string().min(1),
  description: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  updated: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  tags: z.array(z.string()).default([]),
  canonicalUrl: z.string().url().optional(),
  content: z.string(),
  readingTime: z.string(),
  image: z.string().regex(/^blog\/[a-z0-9_-]+-\d{4}-\d{2}-\d{2}$/),
  imageAlt: z.string().min(1),

  relations: z
    .object({
      technologies: z.array(TechnologySlugSchema).default([]),
      ideas: z.array(IdeaSlugSchema).default([]),
    })
    .default({
      technologies: [],
      ideas: [],
    }),
});

export type BlogPost = z.infer<typeof BlogPostSchema>;

export type { Initiative } from "./initiative/initiative";
export {
  InitiativeSchema,
  InitiativeStatusSchema,
} from "./initiative/initiative";

export { ADRStatusSchema };
export type ADRStatus = z.infer<typeof ADRStatusSchema>;

export const ADRSchema = BaseADRSchema.extend({
  relations: ADRRelationsSchema.extend({
    ideas: z.array(IdeaSlugSchema).default([]),
  }),
});

export type ADR = z.infer<typeof ADRSchema>;

import { type ProjectStatus, ProjectStatusSchema } from "./project/project";

export type { ProjectStatus };
export { ProjectStatusSchema };

export const ProjectSchema = z
  .object({
    slug: ProjectSlugSchema,
    title: z.string().min(1),
    description: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    updated: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    status: ProjectStatusSchema,
    repoUrl: z.string().url().optional(),
    demoUrl: z.string().url().optional(),
    paperUrl: z.url().optional(),
    paperTitle: z.string().min(1).optional(),
    content: z.string(),

    relations: z
      .object({
        technologies: z.array(TechnologySlugSchema).default([]),
        ideas: z.array(IdeaSlugSchema).default([]),
        adrs: z.array(ADRRefSchema).default([]),
        initiatives: z.array(InitiativeSlugSchema).default([]),
      })
      .default({
        technologies: [],
        ideas: [],
        adrs: [],
        initiatives: [],
      }),
  })
  .superRefine((project, context) => {
    if (project.paperUrl && !project.paperTitle) {
      context.addIssue({
        code: "custom",
        path: ["paperTitle"],
        message: "Paper title is required when paper URL is set",
      });
    }
    if (project.paperTitle && !project.paperUrl) {
      context.addIssue({
        code: "custom",
        path: ["paperUrl"],
        message: "Paper URL is required when paper title is set",
      });
    }
  });

export type Project = z.infer<typeof ProjectSchema>;

export const JobRoleSchema = z.object({
  slug: RoleSlugSchema,
  company: z.string().min(1),
  companyUrl: z.string().url(),
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

  relations: z
    .object({
      technologies: z.array(TechnologySlugSchema).default([]),
    })
    .default({
      technologies: [],
    }),
});

export type JobRole = z.infer<typeof JobRoleSchema>;

export type ValidationResult<T> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      error: z.ZodError;
    };

export interface ReferentialIntegrityError {
  type: "missing_reference" | "invalid_reference" | "circular_reference";
  entity: string;
  field: string;
  value: string;
  message: string;
}

export type DomainValidationResult<T> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      schemaErrors?: z.ZodError;
      referentialErrors?: ReferentialIntegrityError[];
    };
