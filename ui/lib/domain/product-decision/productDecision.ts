import { z } from "zod";
import {
  ADRRefSchema,
  IdeaSlugSchema,
  ProductDecisionSlugSchema,
  ProjectSlugSchema,
} from "../slugs";

export type { ProductDecisionSlug } from "../slugs";

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ProductDecisionAuthoredStatusSchema = z.enum([
  "Proposed",
  "Accepted",
  "Rejected",
  "Deprecated",
]);

export const ProductDecisionStatusSchema = z.enum([
  ...ProductDecisionAuthoredStatusSchema.options,
  "Superseded",
]);

export const ProductDecisionEvidenceLinkSchema = z.object({
  title: z.string().min(1),
  url: z.url(),
});

export type ProductDecisionEvidenceLink = z.infer<
  typeof ProductDecisionEvidenceLinkSchema
>;

export const ProductDecisionFrontmatterSchema = z
  .object({
    title: z.string().regex(/^PDR \d{3}: .+/),
    date: DateSchema,
    status: ProductDecisionAuthoredStatusSchema,
    decision_date: DateSchema.optional(),
    deprecated_date: DateSchema.optional(),
    supersedes: ProductDecisionSlugSchema.optional(),
    evidence: z.array(ProductDecisionEvidenceLinkSchema).default([]),
    ideas: z.array(IdeaSlugSchema).default([]),
    affected_projects: z.array(ProjectSlugSchema).min(1),
    informed_by_adrs: z.array(ADRRefSchema).default([]),
  })
  .strict()
  .superRefine((record, context) => {
    const decided = record.status !== "Proposed";
    if (decided && !record.decision_date) {
      context.addIssue({
        code: "custom",
        path: ["decision_date"],
        message: `${record.status} decisions require a decision_date`,
      });
    }
    if (!decided && record.decision_date) {
      context.addIssue({
        code: "custom",
        path: ["decision_date"],
        message: "Proposed decisions cannot have a decision_date",
      });
    }

    if (record.status === "Deprecated" && !record.deprecated_date) {
      context.addIssue({
        code: "custom",
        path: ["deprecated_date"],
        message: "Deprecated decisions require a deprecated_date",
      });
    }
    if (record.status !== "Deprecated" && record.deprecated_date) {
      context.addIssue({
        code: "custom",
        path: ["deprecated_date"],
        message: "Only Deprecated decisions can have a deprecated_date",
      });
    }

    if (record.decision_date && record.decision_date < record.date) {
      context.addIssue({
        code: "custom",
        path: ["decision_date"],
        message: "decision_date cannot precede date",
      });
    }
    if (
      record.deprecated_date &&
      record.decision_date &&
      record.deprecated_date < record.decision_date
    ) {
      context.addIssue({
        code: "custom",
        path: ["deprecated_date"],
        message: "deprecated_date cannot precede decision_date",
      });
    }
  });

export type ProductDecisionAuthoredStatus = z.infer<
  typeof ProductDecisionAuthoredStatusSchema
>;
export type ProductDecisionStatus = z.infer<typeof ProductDecisionStatusSchema>;
export type ProductDecisionFrontmatter = z.infer<
  typeof ProductDecisionFrontmatterSchema
>;

export const ProductDecisionSchema = z.object({
  slug: ProductDecisionSlugSchema,
  title: z.string().regex(/^PDR \d{3}: .+/),
  date: DateSchema,
  status: ProductDecisionStatusSchema,
  authoredStatus: ProductDecisionAuthoredStatusSchema,
  decisionDate: DateSchema.optional(),
  deprecatedDate: DateSchema.optional(),
  supersedes: ProductDecisionSlugSchema.optional(),
  content: z.string().min(1),
  readingTime: z.string().min(1),
});

export type ProductDecision = z.infer<typeof ProductDecisionSchema>;

export const ProductDecisionRelationsSchema = z.object({
  evidence: z.array(ProductDecisionEvidenceLinkSchema).default([]),
  ideas: z.array(IdeaSlugSchema).default([]),
  affectedProjects: z.array(ProjectSlugSchema).min(1),
  informedByADRs: z.array(ADRRefSchema).default([]),
});

export type ProductDecisionRelations = z.infer<
  typeof ProductDecisionRelationsSchema
>;
