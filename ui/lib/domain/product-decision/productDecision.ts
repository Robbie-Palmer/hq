import { z } from "zod";
import {
  IdeaSlugSchema,
  ProductDecisionSlugSchema,
  ProjectSlugSchema,
} from "../slugs";

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
