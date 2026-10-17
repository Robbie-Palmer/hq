import { z } from "zod";
import {
  EffectivePeriodSchema,
  IdentifierSchema,
  ProvenanceSchema,
  TimestampSchema,
} from "./model";

export const GitCommitShaSchema = z.string().regex(/^[0-9a-f]{40}$/);

export const RepositorySchema = z
  .object({
    id: IdentifierSchema,
    providerId: IdentifierSchema,
    owner: z.string().trim().min(1),
    name: z.string().trim().min(1),
    visibility: z.enum(["public", "private"]),
    defaultBranch: z.string().trim().min(1),
  })
  .strict();
export type Repository = z.infer<typeof RepositorySchema>;

export const RepositoryRevisionSchema = z
  .object({
    repositoryId: IdentifierSchema,
    commitSha: GitCommitShaSchema,
    committedAt: TimestampSchema,
    provenance: ProvenanceSchema,
  })
  .strict();
export type RepositoryRevision = z.infer<typeof RepositoryRevisionSchema>;

export const ProjectRepositoryScopeSchema = z
  .object({
    id: IdentifierSchema,
    projectId: IdentifierSchema,
    repositoryId: IdentifierSchema,
    includedPaths: z.array(z.string().trim().min(1)).min(1),
    excludedPaths: z.array(z.string().trim().min(1)),
    effectivePeriod: EffectivePeriodSchema,
    provenance: ProvenanceSchema,
  })
  .strict();
export type ProjectRepositoryScope = z.infer<
  typeof ProjectRepositoryScopeSchema
>;

const LanguageBytesSchema = z
  .object({
    language: z.string().trim().min(1),
    bytes: z.number().int().nonnegative(),
  })
  .strict();

const SourceLinesSchema = z
  .object({
    language: z.string().trim().min(1),
    classification: z.enum([
      "production",
      "test",
      "tooling",
      "configuration",
      "unclassified",
    ]),
    lines: z.number().int().nonnegative(),
  })
  .strict();

export const RepositorySnapshotSchema = z
  .object({
    id: IdentifierSchema,
    projectId: IdentifierSchema,
    repositoryId: IdentifierSchema,
    commitSha: GitCommitShaSchema,
    scopeId: IdentifierSchema,
    observedAt: TimestampSchema,
    languageInventory: z
      .object({
        includedBytes: z.number().int().nonnegative(),
        languages: z.array(LanguageBytesSchema),
        method: z.enum(["repository-provider", "project-path-scan"]),
      })
      .strict(),
    sourceLineInventory: z
      .object({
        sourceLines: z.array(SourceLinesSchema),
        documentationLines: z.number().int().nonnegative(),
        counter: z.string().trim().min(1),
        counterVersion: z.string().trim().min(1),
        classificationRulesVersion: z.string().trim().min(1),
      })
      .strict(),
    excludedPathRules: z.array(z.string().trim().min(1)),
    exceptions: z.array(z.string().trim().min(1)),
    provenance: ProvenanceSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    const languageBytes = snapshot.languageInventory.languages.reduce(
      (sum, language) => sum + language.bytes,
      0,
    );
    if (languageBytes !== snapshot.languageInventory.includedBytes) {
      context.addIssue({
        code: "custom",
        message: "Language byte counts must reconcile to included bytes",
        path: ["languageInventory", "languages"],
      });
    }
    const languageNames = new Set(
      snapshot.languageInventory.languages.map(({ language }) => language),
    );
    if (languageNames.size !== snapshot.languageInventory.languages.length) {
      context.addIssue({
        code: "custom",
        message: "A language inventory cannot repeat a language",
        path: ["languageInventory", "languages"],
      });
    }
    const sourceLineKeys = new Set(
      snapshot.sourceLineInventory.sourceLines.map(
        ({ language, classification }) => `${language}\u0000${classification}`,
      ),
    );
    if (sourceLineKeys.size !== snapshot.sourceLineInventory.sourceLines.length) {
      context.addIssue({
        code: "custom",
        message: "A source-line inventory cannot repeat a language and classification",
        path: ["sourceLineInventory", "sourceLines"],
      });
    }
  });
export type RepositorySnapshot = z.infer<typeof RepositorySnapshotSchema>;

export const ActivityEventSchema = z
  .object({
    id: IdentifierSchema,
    projectId: IdentifierSchema,
    repositoryId: IdentifierSchema,
    kind: z.enum(["product", "knowledge", "maintenance"]),
    eventType: z.enum([
      "integrated-change",
      "release",
      "production-deployment",
      "rollback",
    ]),
    occurredAt: TimestampSchema,
    commitSha: GitCommitShaSchema,
    evidenceUrl: z.url({ protocol: /^https?$/ }),
    provenance: ProvenanceSchema,
  })
  .strict();
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;
