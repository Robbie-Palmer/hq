import { z } from "zod";

export const CorpusPartitionSchema = z.enum([
  "train",
  "development",
  "regression",
]);
export type CorpusPartition = z.infer<typeof CorpusPartitionSchema>;

export const SYNTHETIC_CORPUS_KIND = "project-authored-synthetic" as const;
export const SYNTHETIC_EVALUATION_SCOPE = "deterministic-regression" as const;

export const COVERAGE_TAGS = [
  "json-ld",
  "json-ld-graph",
  "incomplete-markup",
  "conflicting-markup",
  "unusual-ingredient-layout",
  "unusual-step-layout",
  "malformed-json-ld",
  "known-failure",
  "focaccia-known-failure",
] as const;

export const CoverageTagSchema = z.enum(COVERAGE_TAGS);
export type CoverageTag = z.infer<typeof CoverageTagSchema>;

const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const PathSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.split("/").includes("..") &&
      !value.includes("\\"),
    "must be a relative POSIX path without traversal",
  );

export const ExpectedRecipeSchema = z
  .object({
    title: z.string().min(1).max(120),
    description: z.string().min(1).max(500),
    cuisine: z.string(),
    servings: z.number().int().positive(),
    prepTime: z.number().int().nonnegative().optional(),
    cookTime: z.number().int().nonnegative().optional(),
    source: z.string().min(1),
  })
  .strict();

export type ExpectedRecipe = z.infer<typeof ExpectedRecipeSchema>;

const ExpectedOutcomeSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("success"),
      recipe: ExpectedRecipeSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("no-recipe"),
      reason: z.enum(["malformed-json-ld", "incomplete-recipe"]),
    })
    .strict(),
]);

export const CorpusFixtureSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    sourceGroup: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    publisherProfile: z.string().min(1),
    patternFamily: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    coverage: z.array(CoverageTagSchema).min(1),
    originReference: z.string().min(1).optional(),
    retrieval: z
      .object({
        sourceUrl: z.url(),
        retrievedAt: z.iso.datetime(),
        method: z.literal("project-authored-synthetic"),
        contentType: z.literal("text/html; charset=utf-8"),
        httpStatus: z.null(),
      })
      .strict(),
    rights: z
      .object({
        basis: z.literal("project-authored-synthetic"),
        license: z.literal("AGPL-3.0-only"),
        storageAllowed: z.literal(true),
        evaluationAllowed: z.literal(true),
        redistributionAllowed: z.literal(true),
        reviewedAt: z.iso.datetime(),
        notes: z.string().min(1),
      })
      .strict(),
    artifact: z
      .object({
        path: PathSchema,
        bytes: z.number().int().positive(),
        sha256: Sha256Schema,
      })
      .strict(),
    expected: ExpectedOutcomeSchema,
    review: z
      .object({
        status: z.literal("approved"),
        reviewedAt: z.iso.datetime(),
        reviewer: z.string().min(1),
        method: z.literal("manual-synthetic-source-review"),
      })
      .strict(),
  })
  .strict();

export type CorpusFixture = z.infer<typeof CorpusFixtureSchema>;

export const PartitionManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    recordType: z.literal("recipe-url-import-partition"),
    corpusVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    fixtureOrigin: z.literal(SYNTHETIC_CORPUS_KIND),
    partition: CorpusPartitionSchema,
    fixtures: z.array(CorpusFixtureSchema).min(1),
  })
  .strict();

export type PartitionManifest = z.infer<typeof PartitionManifestSchema>;

const CatalogPartitionSchema = z
  .object({
    name: CorpusPartitionSchema,
    manifest: PathSchema,
    sha256: Sha256Schema,
    fixtureCount: z.number().int().positive(),
  })
  .strict();

export const CorpusCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    recordType: z.literal("recipe-url-import-corpus"),
    corpusVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    corpusKind: z.literal(SYNTHETIC_CORPUS_KIND),
    createdAt: z.iso.datetime(),
    description: z.string().min(1),
    license: z.literal("AGPL-3.0-only"),
    requiredCoverage: z.array(CoverageTagSchema).min(1),
    evaluationScope: z
      .object({
        intendedUse: z.literal(SYNTHETIC_EVALUATION_SCOPE),
        realWorldHoldout: z.literal(false),
        supportsRealWorldGeneralizationClaims: z.literal(false),
        knownFailurePartition: z.literal("regression"),
        knownFailuresGateRoutineReplay: z.literal(false),
      })
      .strict(),
    partitions: z.array(CatalogPartitionSchema).length(3),
  })
  .strict()
  .superRefine((catalog, context) => {
    const names = catalog.partitions.map(({ name }) => name);
    if (new Set(names).size !== names.length) {
      context.addIssue({
        code: "custom",
        path: ["partitions"],
        message: "partition names must be unique",
      });
    }
    for (const expected of CorpusPartitionSchema.options) {
      if (!names.includes(expected)) {
        context.addIssue({
          code: "custom",
          path: ["partitions"],
          message: `missing ${expected} partition`,
        });
      }
    }
  });

export type CorpusCatalog = z.infer<typeof CorpusCatalogSchema>;
