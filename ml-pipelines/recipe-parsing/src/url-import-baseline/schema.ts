import { z } from "zod";

export const EVALUATED_PARTITIONS = ["train", "development"] as const;

export const PIPELINE_STAGES = [
  "schema-org-extraction",
  "dom-heuristics",
  "normalization",
  "quantity-unit-parsing",
  "step-segmentation",
  "ontology-matching",
] as const;

export const FIELD_NAMES = [
  "title",
  "description",
  "cuisine",
  "servings",
  "prepTime",
  "cookTime",
  "ingredientName",
  "ingredientQuantity",
  "ingredientUnit",
  "instructionText",
] as const;

export type FieldName = (typeof FIELD_NAMES)[number];

export const FAILURE_CATEGORIES = [
  "extraction-missed-recipe",
  "extraction-unexpected-recipe",
  "normalization-failed",
  "scalar-field-mismatch",
  "ingredient-name-mismatch",
  "quantity-mismatch",
  "unit-mismatch",
  "step-content-mismatch",
  "step-segmentation-mismatch",
  "ontology-unmatched",
] as const;

export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

export type CountMetric = {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
};

export type Failure = {
  fixtureId: string;
  partition: (typeof EVALUATED_PARTITIONS)[number];
  sourceGroup: string;
  category: FailureCategory;
  field?: string;
  expected?: unknown;
  actual?: unknown;
};

export type SourceStratum = {
  sourceGroup: string;
  publisherProfile: string;
  patternFamilies: string[];
  fixtures: number;
  expectedImports: number;
  usableImports: number;
  usableImportRate: number;
  failureCounts: Record<FailureCategory, number>;
};

export type BaselineReport = {
  schemaVersion: 1;
  recordType: "recipe-url-import-deterministic-baseline";
  corpusVersion: string;
  corpusKind: "project-authored-synthetic";
  evaluationScope: "deterministic-regression";
  supportsRealWorldGeneralizationClaims: false;
  partitions: Array<(typeof EVALUATED_PARTITIONS)[number]>;
  offline: true;
  pipelineStages: Array<(typeof PIPELINE_STAGES)[number]>;
  cacheKey: string;
  summary: {
    fixtures: number;
    expectedImports: number;
    expectedNoRecipe: number;
    usableImports: number;
    usableImportRate: number;
    correctNoRecipe: number;
    noRecipeAccuracy: number;
  };
  fieldMetrics: Record<FieldName, CountMetric>;
  ontology: {
    mentions: number;
    matched: number;
    coverage: number;
    methods: {
      exact: number;
      fuzzy: number;
      unmatched: number;
    };
  };
  sourceStrata: SourceStratum[];
  failureCounts: Record<FailureCategory, number>;
};

export type FailureReport = {
  schemaVersion: 1;
  recordType: "recipe-url-import-deterministic-failures";
  corpusVersion: string;
  partitions: Array<(typeof EVALUATED_PARTITIONS)[number]>;
  cacheKey: string;
  counts: Record<FailureCategory, number>;
  failures: Failure[];
};

const MetricReferenceSchema = z
  .object({
    precision: z.number().min(0).max(1),
    recall: z.number().min(0).max(1),
  })
  .strict();

export const RegressionConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    corpusVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    partitions: z.tuple([z.literal("train"), z.literal("development")]),
    reference: z
      .object({
        usableImportRate: z.number().min(0).max(1),
        ontologyCoverage: z.number().min(0).max(1),
        fieldMetrics: z.record(z.enum(FIELD_NAMES), MetricReferenceSchema),
        failureCounts: z.record(
          z.enum(FAILURE_CATEGORIES),
          z.number().int().nonnegative(),
        ),
      })
      .strict(),
    budgets: z
      .object({
        usableImportRateDrop: z.number().min(0).max(1),
        ontologyCoverageDrop: z.number().min(0).max(1),
        fieldPrecisionDrop: z.number().min(0).max(1),
        fieldRecallDrop: z.number().min(0).max(1),
        failureCountIncrease: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type RegressionConfig = z.infer<typeof RegressionConfigSchema>;

export type RegressionViolation = {
  metric: string;
  reference: number;
  actual: number;
  allowedRegression: number;
};

export type RegressionGateReport = {
  schemaVersion: 1;
  recordType: "recipe-url-import-regression-gate";
  corpusVersion: string;
  cacheKey: string;
  passed: boolean;
  budgets: RegressionConfig["budgets"];
  violations: RegressionViolation[];
};

export type CachedEvaluation = {
  schemaVersion: 1;
  cacheKey: string;
  report: BaselineReport;
  failures: FailureReport;
};
